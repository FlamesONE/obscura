use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use std::sync::Arc;

use deno_core::Extension;
use obscura_dom::DomTree;
use obscura_net::{CallbackRegistry, CookieJar, ObscuraHttpClient};
#[cfg(feature = "stealth")]
use obscura_net::StealthHttpClient;
use tokio::sync::Mutex;

mod crypto;
mod dom;
mod fetch;
mod url;
#[cfg(feature = "stealth")]
mod ws;

pub use self::fetch::cached_request_client;

use self::crypto::*;
use self::dom::*;
use self::fetch::*;
use self::url::*;
#[cfg(feature = "stealth")]
use self::ws::*;

pub type InterceptCallback = Arc<Mutex<Option<Box<dyn Fn(String, String, String) -> Option<(u16, String, String)> + Send + Sync>>>>;

#[derive(Debug)]
pub enum InterceptResolution {
    Continue {
        url: Option<String>,
        method: Option<String>,
        headers: Option<HashMap<String, String>>,
        body: Option<String>,
    },
    Fulfill {
        status: u16,
        headers: HashMap<String, String>,
        body: String,
    },
    Fail { reason: String },
}

pub struct InterceptedRequest {
    pub request_id: String,
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub resource_type: String,
    pub resolver: tokio::sync::oneshot::Sender<InterceptResolution>,
}

#[derive(Debug, Clone)]
pub struct StoredNetworkResponseBody {
    pub body: String,
    pub base64_encoded: bool,
}

#[derive(Debug, Clone)]
pub struct FrameSnapshot {
    pub html: String,
    pub url: String,
    pub same_origin: bool,
}

/// A network request made from page JS (fetch()/XHR/dynamic resource) recorded
/// so the CDP layer can emit Network.requestWillBeSent / responseReceived for
/// it. Static navigation subresources go through Page::record_network_event;
/// this is the parallel channel for script-initiated requests, which run in the
/// V8 op layer and would otherwise never surface as CDP Network events (#406).
#[derive(Debug, Clone)]
pub struct JsNetworkEvent {
    /// Matches the `fetch-{N}` id under which the body is stored, so CDP
    /// Network.getResponseBody resolves for the same request.
    pub request_id: String,
    pub url: String,
    pub method: String,
    pub status: u16,
    pub response_headers: HashMap<String, String>,
    pub body_size: usize,
    pub timestamp: f64,
}

pub struct ObscuraState {
    pub dom: Option<DomTree>,
    /// Cached real layout geometry keyed by obscura-dom NodeId u32, computed
    /// lazily by `op_layout_box` (serialize tagged HTML -> Blitz layout) and
    /// invalidated to `None` on any DOM mutation. Value is (x, y, w, h) in CSS
    /// pixels. Backs the real getBoundingClientRect / offset* geometry.
    pub layout_cache: Option<std::collections::HashMap<u32, (f32, f32, f32, f32)>>,
    pub url: String,
    /// WHATWG canonical name of the document's character encoding (e.g.
    /// "UTF-8", "EUC-JP"). Backs `document.characterSet` and the URL query
    /// encoding override for `<a>`/`<area>` hrefs in legacy-charset documents.
    pub encoding: String,
    pub title: String,
    pub blocked_urls: Vec<String>,
    pub cookie_jar: Option<Arc<CookieJar>>,
    pub http_client: Option<Arc<ObscuraHttpClient>>,
    /// The owning page's passive on_request/on_response callbacks (issue
    /// #408). Page-scoped, so scripted fetch()/XHR observation stays local to
    /// the page that registered it.
    pub callbacks: Option<Arc<CallbackRegistry>>,
    /// When set (stealth mode), scripted fetch()/XHR is routed through the wreq
    /// client so the request carries the Chrome TLS fingerprint and client
    /// hints instead of the rustls ClientHello op_fetch_url would otherwise send.
    #[cfg(feature = "stealth")]
    pub stealth_client: Option<Arc<StealthHttpClient>>,
    pub pending_navigation: Option<(String, String, String)>,
    // (node_id, resolved_src) of <iframe> elements inserted into the DOM at
    // runtime (dynamic append / .src=). Drained by the page loop, which loads
    // each frame through the same path as static iframes so its scripts run.
    // This is how a Cloudflare Turnstile widget iframe (created by api.js at
    // runtime, never present in the initial HTML) gets a live runtime.
    pub pending_iframe_loads: Vec<(u32, String)>,
    pub intercept_tx: Option<tokio::sync::mpsc::UnboundedSender<InterceptedRequest>>,
    pub intercept_counter: u64,
    pub intercept_enabled: bool,
    // Queue of (binding_name, payload) calls made by page JS via the
    // `op_binding_called` op. Drained by the CDP layer after each dispatch
    // and emitted as `Runtime.bindingCalled` events.
    pub pending_binding_calls: Vec<(String, String)>,
    pub network_response_bodies: HashMap<String, StoredNetworkResponseBody>,
    pub network_response_body_order: VecDeque<String>,
    pub network_response_body_counter: u64,
    // Absolute URLs requested via JS fetch() / XHR (op_fetch_url), in request
    // order. Surfaced by `--dump assets` so resources pulled in by script, not
    // just static DOM attributes, are listed (issue #301).
    pub fetched_urls: Vec<String>,
    pub frame_snapshots: HashMap<String, FrameSnapshot>,
    // Network events for script-initiated requests (fetch/XHR/dynamic resource),
    // drained by the Page into its network_events so the CDP layer emits
    // Network.requestWillBeSent / responseReceived for them (issue #406).
    pub js_network_events: Vec<JsNetworkEvent>,
    // Live WebSocket connections opened by page JS (`new WebSocket(url)`),
    // keyed by the id handed back to the shim. Each holds the driver channels
    // (see obscura_net::ws) that op_ws_send / op_ws_recv pump. Stealth-only:
    // the transport is the wreq client, so a real wss:// handshake carries the
    // page's Chrome TLS fingerprint.
    #[cfg(feature = "stealth")]
    pub ws_conns: HashMap<u32, std::sync::Arc<obscura_net::ws::WsHandle>>,
    #[cfg(feature = "stealth")]
    pub ws_counter: u32,
}

impl ObscuraState {
    pub fn new() -> Self {
        ObscuraState {
            dom: None,
            layout_cache: None,
            url: "about:blank".to_string(),
            encoding: "UTF-8".to_string(),
            title: String::new(),
            blocked_urls: Vec::new(),
            cookie_jar: None,
            http_client: None,
            callbacks: None,
            #[cfg(feature = "stealth")]
            stealth_client: None,
            pending_navigation: None,
            pending_iframe_loads: Vec::new(),
            intercept_tx: None,
            intercept_counter: 0,
            intercept_enabled: false,
            pending_binding_calls: Vec::new(),
            network_response_bodies: HashMap::new(),
            network_response_body_order: VecDeque::new(),
            network_response_body_counter: 0,
            fetched_urls: Vec::new(),
            frame_snapshots: HashMap::new(),
            js_network_events: Vec::new(),
            #[cfg(feature = "stealth")]
            ws_conns: HashMap::new(),
            #[cfg(feature = "stealth")]
            ws_counter: 0,
        }
    }
}

fn response_body_entry_limit() -> usize {
    std::env::var("OBSCURA_NETWORK_BODY_BUFFER_ENTRIES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(128)
}

fn response_body_byte_limit() -> usize {
    std::env::var("OBSCURA_NETWORK_BODY_BUFFER_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2 * 1024 * 1024)
}

pub type SharedState = Rc<RefCell<ObscuraState>>;

pub fn build_extension() -> Extension {
    #[allow(unused_mut)]
    let mut ops: Vec<deno_core::OpDecl> = vec![
        op_dom(),
        op_layout_box(),
        op_console_msg(),
        op_fetch_url(),
        op_get_cookies(),
        op_set_cookie(),
        op_frame_html(),
        op_frame_meta(),
        op_navigate(),
        op_register_dynamic_iframe(),
        op_sleep(),
        op_binding_called(),
        op_subtle_digest(),
        op_subtle_hmac(),
        op_subtle_aes_gcm(),
        op_subtle_aes_cbc(),
        op_subtle_aes_ctr(),
        op_subtle_pbkdf2(),
        op_subtle_hkdf(),
        op_random_bytes(),
        op_url_parse(),
        op_url_set(),
        op_url_resolve(),
        op_encoding_for_label(),
        op_text_decode(),
        op_url_encode_query(),
    ];
    #[cfg(feature = "stealth")]
    ops.extend([
        op_ws_connect(),
        op_ws_recv(),
        op_ws_send_text(),
        op_ws_send_binary(),
        op_ws_close(),
    ]);
    Extension {
        name: "obscura_dom",
        ops: std::borrow::Cow::Owned(ops),
        ..Default::default()
    }
}
