#[cfg(feature = "stealth")]
use std::collections::HashMap;
#[cfg(feature = "stealth")]
use std::error::Error;
#[cfg(feature = "stealth")]
use std::sync::Arc;
#[cfg(feature = "stealth")]
use std::time::Duration;

#[cfg(feature = "stealth")]
use tokio::sync::RwLock;
#[cfg(feature = "stealth")]
use url::Url;

#[cfg(feature = "stealth")]
use crate::cookies::CookieJar;
#[cfg(feature = "stealth")]
use crate::client::{Response, ObscuraNetError};

// Default stealth JS identity, matched to the default TLS profile's wire
// headers. As of wreq_util 3.0.0-rc.12 the Chrome147 profile with
// `.platform(Windows)` DOES emit a fully Windows wire identity — verified
// against tls.peet.ws: `user-agent: ...Windows NT 10.0...Chrome/147`,
// `sec-ch-ua-platform: "Windows"`, brands v147. (An earlier rc pinned the wire
// to Linux regardless of `.platform`; that is no longer the case.) The
// JS-visible navigator below is set to Windows to agree with that wire so a
// detector comparing the two sees one coherent OS. An operator who overrides
// `tls.profile`/`user_agent` via OBSCURA_FP replaces both surfaces together.
#[cfg(feature = "stealth")]
pub const STEALTH_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
#[cfg(feature = "stealth")]
pub const STEALTH_NAVIGATOR_PLATFORM: &str = "Win32";
#[cfg(feature = "stealth")]
pub const STEALTH_UA_PLATFORM: &str = "Windows";
#[cfg(feature = "stealth")]
pub const STEALTH_UA_PLATFORM_VERSION: &str = "15.0.0";

#[cfg(feature = "stealth")]
pub struct StealthHttpClient {
    client: wreq::Client,
    pub cookie_jar: Arc<CookieJar>,
    pub extra_headers: RwLock<HashMap<String, String>>,
    pub in_flight: Arc<std::sync::atomic::AtomicU32>,
}

#[cfg(feature = "stealth")]
impl StealthHttpClient {
    pub fn new(cookie_jar: Arc<CookieJar>) -> Self {
        Self::with_proxy(cookie_jar, None)
    }

    pub fn with_proxy(cookie_jar: Arc<CookieJar>, proxy_url: Option<&str>) -> Self {
        // JA3/JA4 (TLS + HTTP2 + header presets) come from this emulation
        // profile. Default is Chrome147/Windows; an operator can pin any wreq
        // profile via OBSCURA_FP's `tls` key (see tls_profile.rs). When they do,
        // they are expected to also set a matching user_agent/platform in the
        // config so wire and JS identities agree.
        // .platform() is currently a no-op for Chrome147 in wreq_util
        // 3.0.0-rc.12 (see STEALTH_USER_AGENT's doc comment); it is honored by
        // other profiles, so the override is still meaningful there.
        let tls_cfg = crate::tls_profile::TlsConfig::from_env();
        let emulation_opts = wreq_util::Emulation::builder()
            .profile(tls_cfg.resolve_profile().unwrap_or(wreq_util::Profile::Chrome147))
            .platform(tls_cfg.resolve_platform().unwrap_or(wreq_util::Platform::Windows))
            .build();

        // This one timeout bounds both the main-document fetch (`fetch()`,
        // called once per navigation) and every scripted fetch()/XHR a page
        // makes during execute_scripts() (`send_single()`). It used to be a
        // hardcoded 15s to keep worst-case navigation hangs short, but that
        // cut off Cloudflare's own challenge-platform script fetch on slower
        // residential-proxy hops (observed: a legitimate, non-hanging
        // response arriving at ~15-20s got killed mid-flight, leaving the
        // interactive challenge permanently stuck). Override via
        // OBSCURA_STEALTH_TIMEOUT_MS for slow proxies. The default is derived
        // to sit ABOVE the whole-navigation budget (OBSCURA_NAV_TIMEOUT_MS,
        // page.rs navigate_with_wait_post) so this per-request cap can never
        // preempt a slow-but-legit fetch the nav-level deadline would still
        // allow — the nav ceiling reaps it with an informative error instead
        // of this lower cap silently cutting the Cloudflare challenge fetch
        // mid-flight (the flat 20s default did exactly that against a 30s nav
        // budget). Tracking the nav env means bumping the nav budget alone
        // can't re-introduce the inversion. (See op_fetch_url's
        // OBSCURA_FETCH_TIMEOUT_MS in obscura-js/src/ops.rs for the op-level cap.)
        let stealth_timeout_ms: u64 = std::env::var("OBSCURA_STEALTH_TIMEOUT_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| {
                let nav_ms = std::env::var("OBSCURA_NAV_TIMEOUT_MS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(30_000u64);
                nav_ms + 5_000
            });
        let mut builder = wreq::Client::builder()
            .emulation(emulation_opts)
            .timeout(Duration::from_millis(stealth_timeout_ms))
            .redirect(wreq::redirect::Policy::none());

        if let Some(proxy) = proxy_url {
            match wreq::Proxy::all(proxy) {
                Ok(p) => builder = builder.proxy(p),
                // A proxy wreq can't parse used to be dropped silently, so every
                // fetch then left the box's own IP. For a CF-gated host that
                // means a much harder challenge from the wrong IP, and a
                // cf_clearance minted on the intended sticky IP won't match.
                // Surface it loudly instead of failing open to a direct route.
                Err(e) => tracing::error!(
                    "proxy {proxy:?} rejected by wreq ({e}); requests will go DIRECT from this host's IP"
                ),
            }
        }

        let client = builder.build().expect("failed to build wreq stealth client");

        StealthHttpClient {
            client,
            cookie_jar,
            extra_headers: RwLock::new(HashMap::new()),
            in_flight: Arc::new(std::sync::atomic::AtomicU32::new(0)),
        }
    }

    pub async fn fetch(&self, url: &Url) -> Result<Response, ObscuraNetError> {
        let mut current_url = url.clone();

        if let Some(host) = current_url.host_str() {
            if crate::blocklist::is_blocked(host) {
                tracing::debug!("Blocked tracker: {}", current_url);
                return Ok(Response {
                    status: 0,
                    url: current_url,
                    headers: HashMap::new(),
                    body: Vec::new(),
                    redirected_from: Vec::new(),
                });
            }
        }

        let mut redirects = Vec::new();

        for _ in 0..20 {
            let mut req = self.client.get(current_url.as_str());

            let cookie_header = self.cookie_jar.get_cookie_header(&current_url);
            if !cookie_header.is_empty() {
                req = req.header("Cookie", &cookie_header);
            }

            for (k, v) in self.extra_headers.read().await.iter() {
                req = req.header(k.as_str(), v.as_str());
            }

            self.in_flight.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            tracing::debug!("wreq hop start: {}", current_url);
            let hop_started = std::time::Instant::now();
            let resp = req.send().await.map_err(|e| {
                self.in_flight.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                tracing::debug!("wreq hop failed after {:?}: {}", hop_started.elapsed(), e);
                ObscuraNetError::Network(format!("{}: {} (source: {:?})", current_url, e, e.source()))
            })?;
            self.in_flight.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            tracing::debug!("wreq hop done in {:?}: status {}", hop_started.elapsed(), resp.status());

            let status = resp.status();

            for val in resp.headers().get_all("set-cookie") {
                if let Ok(s) = val.to_str() {
                    self.cookie_jar.set_cookie(s, &current_url);
                }
            }

            let response_headers: HashMap<String, String> = resp
                .headers()
                .iter()
                .map(|(k, v)| (k.as_str().to_lowercase(), v.to_str().unwrap_or("").to_string()))
                .collect();

            if status.is_redirection() {
                if let Some(location) = resp.headers().get("location") {
                    let location_str = location.to_str().map_err(|_| {
                        ObscuraNetError::Network("Invalid redirect Location".into())
                    })?;
                    let next_url = current_url.join(location_str).map_err(|e| {
                        ObscuraNetError::Network(format!("Invalid redirect URL: {}", e))
                    })?;
                    redirects.push(current_url.clone());
                    current_url = next_url;
                    continue;
                }
            }

            let body = resp.bytes().await.map_err(|e| {
                ObscuraNetError::Network(format!("Failed to read body: {}", e))
            })?.to_vec();

            return Ok(Response {
                url: current_url,
                status: status.as_u16(),
                headers: response_headers,
                body,
                redirected_from: redirects,
            });
        }

        Err(ObscuraNetError::TooManyRedirects(url.to_string()))
    }

    /// One request with no redirect following, for scripted fetch()/XHR. Reads
    /// the cookie jar for the Cookie header and stores Set-Cookie back into it,
    /// so the caller only owns redirect hops and SSRF re-validation. Used in
    /// stealth mode so JS-level requests carry the same Chrome TLS fingerprint
    /// and client hints as the main navigation instead of the rustls ClientHello
    /// that op_fetch_url would otherwise send (which bot managers read as a
    /// non-browser script and reject, e.g. the AWS WAF challenge verify call).
    pub async fn send_single(
        &self,
        method: &str,
        url: &Url,
        headers: &HashMap<String, String>,
        body: &str,
    ) -> Result<Response, ObscuraNetError> {
        if let Some(host) = url.host_str() {
            if crate::blocklist::is_blocked(host) {
                tracing::debug!("Blocked tracker: {}", url);
                return Ok(Response {
                    status: 0,
                    url: url.clone(),
                    headers: HashMap::new(),
                    body: Vec::new(),
                    redirected_from: Vec::new(),
                });
            }
        }

        let req_method = method
            .parse::<wreq::Method>()
            .map_err(|e| ObscuraNetError::Network(format!("invalid method '{}': {}", method, e)))?;
        let mut req = self.client.request(req_method, url.as_str());

        let cookie_header = self.cookie_jar.get_cookie_header(url);
        if !cookie_header.is_empty() {
            req = req.header("cookie", &cookie_header);
        }
        for (k, v) in self.extra_headers.read().await.iter() {
            req = req.header(k.as_str(), v.as_str());
        }
        for (k, v) in headers.iter() {
            req = req.header(k.as_str(), v.as_str());
        }
        if !body.is_empty() {
            req = req.body(body.to_string());
        }

        self.in_flight.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let resp = req.send().await.map_err(|e| {
            self.in_flight.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            ObscuraNetError::Network(format!("{}: {}", url, e))
        })?;
        self.in_flight.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);

        let status = resp.status();
        for val in resp.headers().get_all("set-cookie") {
            if let Ok(s) = val.to_str() {
                self.cookie_jar.set_cookie(s, url);
            }
        }
        let response_headers: HashMap<String, String> = resp
            .headers()
            .iter()
            .map(|(k, v)| (k.as_str().to_lowercase(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let resp_body = resp
            .bytes()
            .await
            .map_err(|e| ObscuraNetError::Network(format!("Failed to read body: {}", e)))?
            .to_vec();

        Ok(Response {
            url: url.clone(),
            status: status.as_u16(),
            headers: response_headers,
            body: resp_body,
            redirected_from: Vec::new(),
        })
    }

    /// Open a real WebSocket over the stealth transport. Inherits this client's
    /// proxy, TLS emulation (JA3/JA4) and timeout, so the `wss://` handshake
    /// looks identical on the wire to the page's navigations. Returns a driver
    /// handle whose channels the WS ops pump; see `crate::ws`.
    pub async fn ws_connect(
        &self,
        url: &str,
        protocols: Vec<String>,
    ) -> Result<crate::ws::WsHandle, ObscuraNetError> {
        if let Ok(u) = Url::parse(url) {
            if let Some(host) = u.host_str() {
                if crate::blocklist::is_blocked(host) {
                    return Err(ObscuraNetError::Network(format!("blocked tracker: {}", host)));
                }
            }
        }

        let mut builder = self.client.websocket(url);
        if !protocols.is_empty() {
            builder = builder.protocols(protocols);
        }
        if let Ok(u) = Url::parse(url) {
            let cookie_header = self.cookie_jar.get_cookie_header(&u);
            if !cookie_header.is_empty() {
                builder = builder.header("Cookie", cookie_header);
            }
        }
        for (k, v) in self.extra_headers.read().await.iter() {
            builder = builder.header(k.as_str(), v.as_str());
        }

        self.in_flight.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let handshake = builder
            .send()
            .await
            .map_err(|e| ObscuraNetError::Network(format!("ws connect {}: {}", url, e)));
        self.in_flight.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
        let resp = handshake?;

        let socket = resp
            .into_websocket()
            .await
            .map_err(|e| ObscuraNetError::Network(format!("ws upgrade {}: {}", url, e)))?;
        Ok(crate::ws::spawn_ws_driver(socket))
    }

    pub async fn set_extra_headers(&self, headers: HashMap<String, String>) {
        *self.extra_headers.write().await = headers;
    }

    pub fn active_requests(&self) -> u32 {
        self.in_flight.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn is_network_idle(&self) -> bool {
        self.active_requests() == 0
    }
}
