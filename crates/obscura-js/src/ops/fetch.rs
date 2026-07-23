use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
#[cfg(feature = "stealth")]
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use deno_core::{op2, OpState};
use obscura_net::{RequestInfo, ResourceType, Response};
#[cfg(feature = "stealth")]
use obscura_net::{CallbackRegistry, StealthHttpClient};

use super::{
    response_body_byte_limit, response_body_entry_limit, InterceptResolution, InterceptedRequest,
    JsNetworkEvent, SharedState, StoredNetworkResponseBody,
};

// op_fetch_url backs JS-level `fetch()` and XHR. Pre-#139 it used a
// process-wide `OnceLock<reqwest::Client>` initialised with no proxy, so
// every JS network call bypassed the configured upstream proxy. We now
// build a client per request, threading whatever `proxy_url` the page's
// ObscuraHttpClient was configured with.
//
// The per-request build cost is negligible (≪1ms) compared with the actual
// network round-trip; the simplification is worth not having to invalidate
// a cache when the proxy is reconfigured between fetches.
//
// Process-wide cache keyed by proxy URL. Previously we built a fresh
// reqwest::Client on every op_fetch_url call (every JS fetch(), XHR,
// dynamic script load). Each build re-initialised TLS roots and a
// fresh connection pool with zero reuse, costing ~5ms per fetch on top
// of any real network work. On an asset-heavy page with 30+ subresources
// that adds ~150ms of pure waste. With the cache, the first fetch on a
// given proxy pays the build cost once and every subsequent fetch reuses
// the same connection pool.
static FETCH_CLIENT_CACHE: std::sync::OnceLock<
    std::sync::RwLock<std::collections::HashMap<String, reqwest::Client>>,
> = std::sync::OnceLock::new();

/// Shared HTTP client cache for any code in obscura-js that needs a
/// reqwest::Client (op_fetch_url for JS-side fetch/XHR, the ES module
/// loader for dynamic imports). Keyed by proxy URL ("" = direct).
/// One client per distinct proxy, reused for every request, so the
/// connection pool actually warms up.
pub fn cached_request_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
    let key = proxy_url.unwrap_or("").to_string();
    let cache = FETCH_CLIENT_CACHE
        .get_or_init(|| std::sync::RwLock::new(std::collections::HashMap::new()));
    if let Ok(read) = cache.read() {
        if let Some(client) = read.get(&key) {
            return Ok(client.clone());
        }
    }
    let client = build_request_client(proxy_url)?;
    if let Ok(mut write) = cache.write() {
        write.entry(key).or_insert_with(|| client.clone());
    }
    Ok(client)
}

fn build_request_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
    // Redirects are followed manually below so each hop can be re-validated
    // against the same SSRF policy as the initial URL (GHSA-8v6v-g4rh-jmcm).
    // With reqwest's default auto-follow, an attacker-controlled origin can
    // 302 to http://127.0.0.1 and read the internal-service body.
    // Per-request timeout so a scripted fetch()/XHR, or a CORS preflight OPTIONS
    // (issue #251), to a server that accepts the connection but never responds
    // cannot hang forever. Without it op_fetch_url never returns, the fetch
    // promise never settles, and the JS XHR is stuck at readyState 1 with no
    // completion event (which stranded Angular HttpClient). On timeout reqwest's
    // send().await errors, which op_fetch_url propagates and the fetch shim turns
    // into an XHR `error`/`loadend`. Was 30s (matching other clients in the
    // workspace) but that's longer than execute_scripts' own soft deadline
    // (OBSCURA_SCRIPT_DEADLINE_MS, default 10s) and its hard watchdog
    // (+1000ms) — a page whose on-load script makes one stalling XHR against
    // a flaky upstream (proxy or origin) would hold the whole navigation for
    // the full 30s regardless of --wait-until, since a classic <script> runs
    // to completion before execute_scripts() returns. 15s halves that worst
    // case while staying generous for real slow-but-alive servers.
    // OBSCURA_FETCH_TIMEOUT_MS overrides it for tighter cloud limits.
    let timeout_ms: u64 = std::env::var("OBSCURA_FETCH_TIMEOUT_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(15_000);
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_millis(timeout_ms))
        // SSRF guard: also reject hostnames that resolve to a private/loopback IP.
        .dns_resolver(std::sync::Arc::new(obscura_net::SsrfGuardResolver::new(false)))
        // Be explicit about pool size: default is unbounded which is fine,
        // but pool_idle_timeout default (90s) is short for SPA-heavy
        // workloads where the same origin is hit dozens of times across
        // a navigation. Keep connections warm longer.
        .pool_idle_timeout(std::time::Duration::from_secs(300))
        .tcp_keepalive(std::time::Duration::from_secs(60));
    if let Some(proxy) = proxy_url {
        let p = reqwest::Proxy::all(proxy)
            .map_err(|e| format!("Invalid op_fetch_url proxy '{}': {}", proxy, e))?;
        builder = builder.proxy(p);
    }
    builder
        .build()
        .map_err(|e| format!("failed to build reqwest::Client: {}", e))
}

/// Cap on the number of redirect hops op_fetch_url will follow.
/// Matches reqwest's default policy of 10.
const FETCH_REDIRECT_LIMIT: usize = 10;

/// Decode an RFC 2397 `data:` URL into (content-type, bytes). Returns None when
/// malformed. Handles both base64 (`;base64`) and percent-encoded payloads.
fn decode_data_url(url: &str) -> Option<(String, Vec<u8>)> {
    let rest = url.strip_prefix("data:")?;
    let comma = rest.find(',')?;
    let meta = &rest[..comma];
    let data = &rest[comma + 1..];
    let is_base64 = meta.ends_with(";base64");
    let mime = meta.strip_suffix(";base64").unwrap_or(meta);
    let content_type = if mime.is_empty() {
        "text/plain;charset=US-ASCII".to_string()
    } else {
        mime.to_string()
    };
    let bytes = if is_base64 {
        // Long payloads may wrap; strip any whitespace before decoding.
        let cleaned: String = data.chars().filter(|c| !c.is_whitespace()).collect();
        BASE64.decode(cleaned.as_bytes()).ok()?
    } else {
        percent_decode_bytes(data)
    };
    Some((content_type, bytes))
}

/// Minimal percent-decoding for the non-base64 `data:` URL body.
fn percent_decode_bytes(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

#[op2(async)]
#[string]
pub(super) async fn op_fetch_url(
    state: Rc<RefCell<OpState>>,
    #[string] url: String,
    #[string] method: String,
    #[string] headers_json: String,
    #[string] body: String,
    #[string] origin: String,
    #[string] mode: String,
) -> Result<String, deno_error::JsErrorBox> {
    tracing::debug!("op_fetch_url called: {} {} (intercept check pending)", method, url);

    // data: URLs resolve locally (RFC 2397) — there is no network fetch. Real
    // browsers let fetch()/XHR read them; without this, `fetch("data:...")`
    // fell through to the network path and failed with net::ERR_FAILED. That
    // silently broke any page loading an inline resource this way — notably
    // iphey's MixVisit fingerprint, which fetches an inline WASM module as a
    // data: URL; the rejection left its whole verdict unresolved.
    if url.starts_with("data:") {
        return Ok(match decode_data_url(&url) {
            Some((content_type, bytes)) => serde_json::json!({
                "status": 200,
                "body": String::from_utf8_lossy(&bytes),
                "bodyBase64": BASE64.encode(&bytes),
                "url": url,
                "headers": { "content-type": content_type },
            }),
            None => serde_json::json!({
                "status": 0, "body": "", "url": url, "headers": {},
                "error": "malformed data: URL",
            }),
        }
        .to_string());
    }

    if let Ok(parsed_url) = url::Url::parse(&url) {
        if let Err(e) = validate_fetch_url(&parsed_url) {
            return Ok(serde_json::json!({
                "status": 0,
                "body": "",
                "url": url,
                "headers": {},
                "blocked": true,
                "error": e,
            }).to_string());
        }
    }

    let (cookie_jar, in_flight, intercept_tx, proxy_url, callbacks) = {
        let state_borrow = state.borrow();
        let gs = state_borrow.borrow::<SharedState>().clone();
        let mut gs = gs.borrow_mut();
        for pattern in &gs.blocked_urls {
            if pattern == "*" || url.contains(pattern) || glob_match(pattern, &url) {
                return Ok(serde_json::json!({
                    "status": 0,
                    "body": "",
                    "url": url,
                    "headers": {},
                    "blocked": true,
                }).to_string());
            }
        }
        // Record the resource the page pulled in via fetch()/XHR so `--dump
        // assets` can list it (issue #301). URL is already absolute here, since
        // reqwest needs an absolute URL to send the request.
        gs.fetched_urls.push(url.clone());
        let jar = gs.cookie_jar.clone();
        let in_flight = gs.http_client.as_ref().map(|c| c.in_flight.clone());
        // #139: thread the configured proxy through to the per-request
        // reqwest::Client. Without this, op_fetch_url silently bypasses
        // BrowserContext.proxy_url for every JS fetch() / XHR call.
        let proxy_url = gs.http_client.as_ref().and_then(|c| c.proxy_url().map(|s| s.to_string()));
        tracing::debug!("op_fetch_url: intercept_enabled={}, has_tx={}", gs.intercept_enabled, gs.intercept_tx.is_some());
        let itx = if gs.intercept_enabled {
            gs.intercept_counter += 1;
            gs.intercept_tx.clone().map(|tx| (tx, format!("intercept-{}", gs.intercept_counter)))
        } else {
            None
        };
        (jar, in_flight, itx, proxy_url, gs.callbacks.clone())
    };

    // Slots the interception channel can override via Continue so a consumer
    // can rewrite url/method/headers/body before the request goes out.
    let mut override_url: Option<String> = None;
    let mut override_method: Option<String> = None;
    let mut override_headers: Option<HashMap<String, String>> = None;
    let mut override_body: Option<String> = None;

    if let Some((tx, request_id)) = intercept_tx {
        let custom_headers: HashMap<String, String> = serde_json::from_str(&headers_json).unwrap_or_default();
        let (resolve_tx, resolve_rx) = tokio::sync::oneshot::channel();
        let intercepted = InterceptedRequest {
            request_id: request_id.clone(),
            url: url.clone(),
            method: method.clone(),
            headers: custom_headers.clone(),
            resource_type: "Fetch".to_string(),
            resolver: resolve_tx,
        };
        if tx.send(intercepted).is_ok() {
            match resolve_rx.await {
                Ok(InterceptResolution::Fulfill { status, headers: h, body: b }) => {
                    let resp_headers: HashMap<String, String> = h;
                    return Ok(serde_json::json!({
                        "status": status,
                        "body": b,
                        "url": url,
                        "headers": resp_headers,
                    }).to_string());
                }
                Ok(InterceptResolution::Fail { reason }) => {
                    return Ok(serde_json::json!({
                        "status": 0,
                        "body": "",
                        "url": url,
                        "headers": {},
                        "blocked": true,
                        "error": reason,
                    }).to_string());
                }
                Ok(InterceptResolution::Continue { url, method, headers, body }) => {
                    override_url = url;
                    override_method = method;
                    override_headers = headers;
                    override_body = body;
                    tracing::debug!(
                        "Interception: continue (overrides url={} method={} headers={} body={})",
                        override_url.is_some(), override_method.is_some(),
                        override_headers.is_some(), override_body.is_some()
                    );
                }
                Err(_) => {
                }
            }
        }
    }

    // Apply interception overrides (shadow the params for the rest of the op).
    // A Continue rewrite of the URL must pass the same SSRF / private-network
    // gate as the original request (checked above) and as redirects (checked
    // below). Without this re-validation a rewrite to an internal address would
    // bypass validate_fetch_url entirely.
    let url = if let Some(new_url) = override_url {
        if let Ok(parsed) = url::Url::parse(&new_url) {
            if let Err(reason) = validate_fetch_url(&parsed) {
                return Ok(serde_json::json!({
                    "status": 0,
                    "body": "",
                    "url": new_url,
                    "blocked": true,
                    "error": format!("Intercept rewrite to forbidden URL blocked: {}", reason),
                }).to_string());
            }
        }
        new_url
    } else {
        url
    };
    let method = override_method.unwrap_or(method);
    let body = override_body.unwrap_or(body);

    let client = cached_request_client(proxy_url.as_deref())
        .map_err(deno_error::JsErrorBox::generic)?;

    let request_origin = url::Url::parse(&url)
        .ok()
        .map(|u| {
            let host = u.host_str().unwrap_or("");
            match u.port() {
                Some(p) => format!("{}://{}:{}", u.scheme(), host, p),
                None => format!("{}://{}", u.scheme(), host),
            }
        })
        .unwrap_or_default();
    let page_origin = if origin.is_empty() { request_origin.clone() } else { origin.clone() };
    let is_cross_origin = !page_origin.is_empty() && request_origin != page_origin;

    let req_method: reqwest::Method = method.parse().unwrap_or(reqwest::Method::GET);

    let custom_headers: std::collections::HashMap<String, String> =
        override_headers.unwrap_or_else(|| serde_json::from_str(&headers_json).unwrap_or_default());

    // Passive request observation (non-blocking). Fires for every request that
    // reaches the network (Fulfill/Fail from the interception channel short-
    // circuit earlier). on_request/on_response previously fired only for
    // navigation; this wires them for JS fetch()/XHR too.
    if let Some(ref cbs) = callbacks {
        if cbs.has_request_callbacks().await {
            if let Ok(parsed) = url::Url::parse(&url) {
                let info = RequestInfo {
                    url: parsed,
                    method: method.clone(),
                    headers: custom_headers.clone(),
                    resource_type: ResourceType::Fetch,
                };
                cbs.fire_request(&info).await;
            }
        }
    }

    // Stealth mode: route the scripted request through the wreq client so its
    // TLS fingerprint and Chrome client hints match the main navigation. The
    // rustls ClientHello plus missing client hints that op_fetch_url's reqwest
    // path sends otherwise read as a non-browser script to bot managers (the
    // AWS WAF challenge verify call, Akamai sensors, etc.).
    #[cfg(feature = "stealth")]
    {
        let stealth = {
            let st = state.borrow();
            let gs = st.borrow::<SharedState>().clone();
            let client = gs.borrow().stealth_client.clone();
            client
        };
        if let Some(stealth) = stealth {
            return stealth_fetch_all(
                stealth,
                url.clone(),
                req_method.as_str().to_string(),
                custom_headers.clone(),
                body.clone(),
                page_origin.clone(),
                is_cross_origin,
                mode.clone(),
                callbacks.clone(),
            )
            .await;
        }
    }

    let needs_preflight = is_cross_origin
        && mode == "cors"
        && (req_method != reqwest::Method::GET
            && req_method != reqwest::Method::HEAD
            && req_method != reqwest::Method::POST
            || custom_headers.keys().any(|k| {
                let kl = k.to_lowercase();
                kl != "accept" && kl != "accept-language" && kl != "content-language"
                    && kl != "content-type"
            }));

    if needs_preflight {
        let preflight = client
            .request(reqwest::Method::OPTIONS, &url)
            .header("Origin", &page_origin)
            .header("Access-Control-Request-Method", method.as_str())
            .header(
                "Access-Control-Request-Headers",
                custom_headers.keys().cloned().collect::<Vec<_>>().join(", "),
            )
            .send()
            .await
            .map_err(|e| deno_error::JsErrorBox::generic(format!("CORS preflight failed: {}", e)))?;

        let allowed_origin = preflight
            .headers()
            .get("access-control-allow-origin")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        if allowed_origin != "*" && allowed_origin != page_origin {
            return Err(deno_error::JsErrorBox::generic(format!(
                "CORS preflight: Origin '{}' not allowed by Access-Control-Allow-Origin '{}'",
                page_origin, allowed_origin
            )));
        }
    }

    // Follow redirects manually so the SSRF policy applies to every hop.
    // reqwest's auto-follow would bypass validate_fetch_url on the redirect
    // target and let an attacker-allowed origin 302 to http://127.0.0.1
    // (GHSA-8v6v-g4rh-jmcm).
    let mut current_url = url.clone();
    let mut current_method = req_method;
    let mut current_body = body;
    let mut redirects_followed: usize = 0;
    let response = loop {
        let mut req = client.request(current_method.clone(), &current_url);

        if is_cross_origin {
            req = req.header("Origin", &page_origin);
        }

        if !is_cross_origin {
            if let Some(ref jar) = cookie_jar {
                if let Ok(parsed_url) = url::Url::parse(&current_url) {
                    let cookie_header = jar.get_cookie_header(&parsed_url);
                    if !cookie_header.is_empty() {
                        req = req.header("Cookie", &cookie_header);
                    }
                }
            }
        }

        // Send a default User-Agent on fetch()/XHR requests (the navigation path
        // sets one, but this op did not, so scripted requests went out with no UA
        // and UA-gated servers rejected them). Honor an explicit override.
        if !custom_headers.keys().any(|k| k.eq_ignore_ascii_case("user-agent")) {
            req = req.header(
                "User-Agent",
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
            );
        }

        for (k, v) in &custom_headers {
            req = req.header(k.as_str(), v.as_str());
        }

        if !current_body.is_empty() {
            req = req.body(current_body.clone());
        }

        if let Some(ref counter) = in_flight {
            counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }

        let resp = req.send().await.map_err(|e| {
            if let Some(ref counter) = in_flight {
                counter.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            }
            deno_error::JsErrorBox::generic(e.to_string())
        })?;

        if let Some(ref counter) = in_flight {
            counter.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
        }

        if let Some(ref jar) = cookie_jar {
            if let Ok(parsed_url) = url::Url::parse(&current_url) {
                for val in resp.headers().get_all(reqwest::header::SET_COOKIE) {
                    if let Ok(s) = val.to_str() {
                        jar.set_cookie(s, &parsed_url);
                    }
                }
            }
        }

        if !resp.status().is_redirection() {
            break resp;
        }

        let location_header = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let Some(location) = location_header else {
            // 3xx without a Location header is not actually a redirect.
            break resp;
        };

        let base = match url::Url::parse(&current_url) {
            Ok(b) => b,
            Err(_) => break resp,
        };
        let next_url = match base.join(&location) {
            Ok(u) => u,
            Err(_) => break resp,
        };

        // Re-validate every redirect target against the SSRF policy.
        if let Err(reason) = validate_fetch_url(&next_url) {
            return Ok(serde_json::json!({
                "status": 0,
                "body": "",
                "url": next_url.to_string(),
                "headers": {},
                "blocked": true,
                "error": format!("Redirect to forbidden URL blocked: {}", reason),
            })
            .to_string());
        }

        redirects_followed += 1;
        if redirects_followed > FETCH_REDIRECT_LIMIT {
            return Ok(serde_json::json!({
                "status": 0,
                "body": "",
                "url": next_url.to_string(),
                "headers": {},
                "blocked": true,
                "error": format!("Too many redirects (>{})", FETCH_REDIRECT_LIMIT),
            })
            .to_string());
        }

        // Browser semantics: 301/302/303 downgrade to GET with no body.
        // 307/308 preserve method and body.
        let status_code = resp.status().as_u16();
        if status_code == 301 || status_code == 302 || status_code == 303 {
            current_method = reqwest::Method::GET;
            current_body.clear();
        }

        current_url = next_url.to_string();
    };

    let status = response.status().as_u16();

    let resp_headers: std::collections::HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    if is_cross_origin && mode == "cors" {
        let allowed = resp_headers
            .get("access-control-allow-origin")
            .map(|s| s.as_str())
            .unwrap_or("");

        if allowed != "*" && allowed != page_origin {
            return Ok(serde_json::json!({
                "status": 0,
                "body": "",
                "url": url,
                "headers": {},
                "corsBlocked": true,
                "corsError": format!("CORS error: Origin '{}' not in Access-Control-Allow-Origin '{}'", page_origin, allowed),
            })
            .to_string());
        }
    }

    let resp_bytes = response
        .bytes()
        .await
        .map_err(|e| deno_error::JsErrorBox::generic(e.to_string()))?;
    let resp_body = String::from_utf8_lossy(&resp_bytes).to_string();
    let resp_body_base64 = BASE64.encode(&resp_bytes);
    if let Some(ref cbs) = callbacks {
        if cbs.has_response_callbacks().await {
            let resp = fetch_response(&url, status, resp_headers.clone(), resp_bytes.to_vec());
            let info = RequestInfo {
                url: resp.url.clone(),
                method: method.clone(),
                headers: resp_headers.clone(),
                resource_type: ResourceType::Fetch,
            };
            cbs.fire_response(&info, &resp).await;
        }
    }
    let response_request_id = {
        let state_borrow = state.borrow();
        let gs = state_borrow.borrow::<SharedState>().clone();
        let mut gs = gs.borrow_mut();
        gs.network_response_body_counter += 1;
        let request_id = format!("fetch-{}", gs.network_response_body_counter);
        let max_entries = response_body_entry_limit();
        let max_bytes = response_body_byte_limit();
        if max_entries > 0 && max_bytes > 0 && resp_bytes.len() <= max_bytes {
            gs.network_response_bodies.insert(
                request_id.clone(),
                StoredNetworkResponseBody {
                    body: resp_body.clone(),
                    base64_encoded: false,
                },
            );
            gs.network_response_body_order.push_back(request_id.clone());
            while gs.network_response_body_order.len() > max_entries {
                if let Some(oldest) = gs.network_response_body_order.pop_front() {
                    gs.network_response_bodies.remove(&oldest);
                }
            }
        }
        // Record a network event so the CDP layer emits requestWillBeSent /
        // responseReceived for this script-initiated request (#406). Keyed by
        // the same fetch-{N} id as the stored body so Network.getResponseBody
        // resolves. Capped to keep a long-lived page from growing unbounded.
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        gs.js_network_events.push(JsNetworkEvent {
            request_id: request_id.clone(),
            url: url.clone(),
            method: method.clone(),
            status,
            response_headers: resp_headers.clone(),
            body_size: resp_bytes.len(),
            timestamp,
        });
        const MAX_JS_NETWORK_EVENTS: usize = 4096;
        if gs.js_network_events.len() > MAX_JS_NETWORK_EVENTS {
            let overflow = gs.js_network_events.len() - MAX_JS_NETWORK_EVENTS;
            gs.js_network_events.drain(0..overflow);
        }
        request_id
    };

    tracing::debug!("op_fetch_url completed: {} {} ({} bytes)", method, url, resp_body.len());

    Ok(serde_json::json!({
        "status": status,
        "body": resp_body,
        "bodyBase64": resp_body_base64,
        "requestId": response_request_id,
        "url": url,
        "headers": resp_headers,
    })
    .to_string())
}

/// Assemble a `Response` for the on_response interception callbacks from the
/// parts op_fetch_url already holds. Navigation gets a Response straight from
/// the http client, but the JS fetch path builds the pieces itself.
fn fetch_response(url: &str, status: u16, headers: HashMap<String, String>, body: Vec<u8>) -> Response {
    Response {
        url: url::Url::parse(url).unwrap_or_else(|_| url::Url::parse("http://0.0.0.0/").unwrap()),
        status,
        headers,
        body,
        redirected_from: Vec::new(),
    }
}

/// Stealth-mode scripted fetch()/XHR: mirrors op_fetch_url's redirect, SSRF,
/// and CORS semantics but sends every hop through the wreq stealth client so
/// the request carries the Chrome TLS fingerprint and client hints. Cookie
/// handling lives inside StealthHttpClient::send_single, which shares the
/// context jar. Response bodies are not mirrored into the CDP
/// Network.getResponseBody buffer here; that is a follow-up for stealth fetches.
#[cfg(feature = "stealth")]
async fn stealth_fetch_all(
    stealth: Arc<StealthHttpClient>,
    url: String,
    method: String,
    custom_headers: HashMap<String, String>,
    body: String,
    page_origin: String,
    is_cross_origin: bool,
    mode: String,
    callbacks: Option<Arc<CallbackRegistry>>,
) -> Result<String, deno_error::JsErrorBox> {
    let mut current_url = url.clone();
    let mut current_method = method;
    let mut current_body = body;
    let mut redirects_followed: usize = 0;

    let (status, resp_headers, resp_bytes): (u16, HashMap<String, String>, Vec<u8>) = loop {
        let parsed_current = match url::Url::parse(&current_url) {
            Ok(u) => u,
            Err(_) => {
                return Ok(serde_json::json!({
                    "status": 0, "body": "", "url": current_url, "headers": {},
                })
                .to_string());
            }
        };

        let mut req_headers: HashMap<String, String> = HashMap::new();
        if is_cross_origin {
            req_headers.insert("origin".to_string(), page_origin.clone());
        }
        for (k, v) in &custom_headers {
            req_headers.insert(k.to_lowercase(), v.clone());
        }

        let r = stealth
            .send_single(&current_method, &parsed_current, &req_headers, &current_body)
            .await
            .map_err(|e| deno_error::JsErrorBox::generic(e.to_string()))?;

        if !(300..400).contains(&r.status) {
            break (r.status, r.headers, r.body);
        }
        let Some(location) = r.headers.get("location").cloned() else {
            break (r.status, r.headers, r.body);
        };
        let next_url = match parsed_current.join(&location) {
            Ok(u) => u,
            Err(_) => break (r.status, r.headers, r.body),
        };
        // Re-validate every redirect target against the SSRF policy, matching
        // op_fetch_url (GHSA-8v6v-g4rh-jmcm).
        if let Err(reason) = validate_fetch_url(&next_url) {
            return Ok(serde_json::json!({
                "status": 0, "body": "", "url": next_url.to_string(), "headers": {},
                "blocked": true,
                "error": format!("Redirect to forbidden URL blocked: {}", reason),
            })
            .to_string());
        }
        redirects_followed += 1;
        if redirects_followed > FETCH_REDIRECT_LIMIT {
            return Ok(serde_json::json!({
                "status": 0, "body": "", "url": next_url.to_string(), "headers": {},
                "blocked": true,
                "error": format!("Too many redirects (>{})", FETCH_REDIRECT_LIMIT),
            })
            .to_string());
        }
        // Browser semantics: 301/302/303 downgrade to GET with no body.
        if r.status == 301 || r.status == 302 || r.status == 303 {
            current_method = "GET".to_string();
            current_body.clear();
        }
        current_url = next_url.to_string();
    };

    if is_cross_origin && mode == "cors" {
        let allowed = resp_headers
            .get("access-control-allow-origin")
            .map(|s| s.as_str())
            .unwrap_or("");
        if allowed != "*" && allowed != page_origin {
            return Ok(serde_json::json!({
                "status": 0, "body": "", "url": url, "headers": {},
                "corsBlocked": true,
                "corsError": format!(
                    "CORS error: Origin '{}' not in Access-Control-Allow-Origin '{}'",
                    page_origin, allowed
                ),
            })
            .to_string());
        }
    }

    let resp_body = String::from_utf8_lossy(&resp_bytes).to_string();
    let resp_body_base64 = BASE64.encode(&resp_bytes);
    if let Some(ref cbs) = callbacks {
        if cbs.has_response_callbacks().await {
            let resp = fetch_response(&url, status, resp_headers.clone(), resp_bytes.clone());
            let info = RequestInfo {
                url: resp.url.clone(),
                method: current_method.clone(),
                headers: resp_headers.clone(),
                resource_type: ResourceType::Fetch,
            };
            cbs.fire_response(&info, &resp).await;
        }
    }

    Ok(serde_json::json!({
        "status": status,
        "body": resp_body,
        "bodyBase64": resp_body_base64,
        "url": url,
        "headers": resp_headers,
    })
    .to_string())
}

fn glob_match(pattern: &str, url: &str) -> bool {
    if pattern == "*" {
        return true;
    }

    let mut remainder = url;
    let mut first = true;
    for part in pattern.split('*') {
        if part.is_empty() {
            continue;
        }

        let Some(index) = remainder.find(part) else {
            return false;
        };

        if first && !pattern.starts_with('*') && index != 0 {
            return false;
        }

        remainder = &remainder[index + part.len()..];
        first = false;
    }

    pattern.ends_with('*') || remainder.is_empty()
}

#[cfg(test)]
mod tests {
    use super::{decode_data_url, glob_match};

    #[test]
    fn decode_data_url_base64_and_plain() {
        // base64 payload (the shape iphey's inline WASM uses)
        let (ct, bytes) = decode_data_url("data:application/wasm;base64,AGFzbQEAAAA=").unwrap();
        assert_eq!(ct, "application/wasm");
        assert_eq!(bytes, vec![0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

        // plain (percent-encoded) payload
        let (ct, bytes) = decode_data_url("data:text/plain,Hello%20World").unwrap();
        assert_eq!(ct, "text/plain");
        assert_eq!(bytes, b"Hello World");

        // empty mediatype → RFC 2397 default
        let (ct, _) = decode_data_url("data:,abc").unwrap();
        assert_eq!(ct, "text/plain;charset=US-ASCII");

        // malformed (no comma)
        assert!(decode_data_url("data:application/wasm;base64").is_none());
    }

    #[test]
    fn glob_match_handles_cdp_blocked_url_patterns() {
        assert!(glob_match(
            "*://*.google.com/maps/vt/*",
            "https://www.google.com/maps/vt/pb=!1m4!1m3",
        ));
        assert!(glob_match(
            "*://*.gstatic.com/*.woff2",
            "https://fonts.gstatic.com/s/inter/v18/font.woff2",
        ));
        assert!(glob_match(
            "https://example.com/assets/*",
            "https://example.com/assets/app.js",
        ));
        assert!(!glob_match(
            "https://example.com/assets/*",
            "https://cdn.example.com/assets/app.js",
        ));
        assert!(!glob_match(
            "*://*.gstatic.com/*.woff2",
            "https://fonts.gstatic.com/s/inter/v18/font.woff",
        ));
    }
}

fn validate_fetch_url(url: &url::Url) -> Result<(), String> {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" && scheme != "file" {
        return Err(format!(
            "Forbidden URL scheme '{}' - only http, https, and file are allowed",
            scheme
        ));
    }

    if scheme == "file" || obscura_net::env_allows_private_network() {
        return Ok(());
    }

    if let Some(host) = url.host() {
        match host {
            url::Host::Ipv4(ip) => {
                if obscura_net::is_forbidden_ip(std::net::IpAddr::V4(ip)) {
                    return Err(format!(
                        "Access to private/internal IP address {} is not allowed",
                        ip
                    ));
                }
            }
            url::Host::Ipv6(ip) => {
                if obscura_net::is_forbidden_ip(std::net::IpAddr::V6(ip)) {
                    return Err(format!(
                        "Access to private/internal IPv6 address {} is not allowed",
                        ip
                    ));
                }
            }
            url::Host::Domain(domain) => {
                let lower_domain = domain.to_lowercase();
                if lower_domain == "localhost"
                    || lower_domain.ends_with(".localhost")
                    || lower_domain == "127.0.0.1"
                    || lower_domain == "::1"
                {
                    return Err(format!(
                        "Access to localhost domain '{}' is not allowed",
                        domain
                    ));
                }
            }
        }
    }

    Ok(())
}

#[op2]
#[string]
pub(super) fn op_get_cookies(state: &OpState) -> String {
    let gs = state.borrow::<SharedState>().clone();
    let gs = gs.borrow();
    let jar = match &gs.cookie_jar {
        Some(j) => j,
        None => return String::new(),
    };
    let url = match url::Url::parse(&gs.url) {
        Ok(u) => u,
        Err(_) => return String::new(),
    };
    jar.get_js_visible_cookies(&url)
}

#[op2(fast)]
pub(super) fn op_set_cookie(state: &OpState, #[string] cookie_str: &str) {
    let gs = state.borrow::<SharedState>().clone();
    let gs = gs.borrow();
    let jar = match &gs.cookie_jar {
        Some(j) => j,
        None => return,
    };
    let url = match url::Url::parse(&gs.url) {
        Ok(u) => u,
        Err(_) => return,
    };
    jar.set_cookie_from_js(cookie_str, &url);
}

#[op2]
#[string]
pub(super) fn op_frame_html(state: &OpState, #[string] frame_id: &str) -> String {
    let gs = state.borrow::<SharedState>().clone();
    let gs = gs.borrow();
    gs.frame_snapshots
        .get(frame_id)
        .map(|snapshot| snapshot.html.clone())
        .unwrap_or_default()
}

#[op2]
#[serde]
pub(super) fn op_frame_meta(state: &OpState, #[string] frame_id: &str) -> serde_json::Value {
    let gs = state.borrow::<SharedState>().clone();
    let gs = gs.borrow();
    if let Some(snapshot) = gs.frame_snapshots.get(frame_id) {
        serde_json::json!({
            "url": snapshot.url,
            "sameOrigin": snapshot.same_origin,
        })
    } else {
        serde_json::json!(null)
    }
}

#[op2(fast)]
pub(super) fn op_navigate(state: &OpState, #[string] url: &str, #[string] method: &str, #[string] body: &str) {
    let gs = state.borrow::<SharedState>().clone();
    let mut gs = gs.borrow_mut();
    gs.url = url.to_string();
    gs.pending_navigation = Some((url.to_string(), method.to_string(), body.to_string()));
}

// Registers an <iframe> that page JS inserted at runtime so the page loop can
// load+execute it. Mirrors op_navigate: pure enqueue, the heavy lifting (fetch,
// parse, child runtime, script execution) happens Rust-side on drain.
#[op2(fast)]
pub(super) fn op_register_dynamic_iframe(state: &OpState, #[smi] node_id: u32, #[string] src: &str) {
    let gs = state.borrow::<SharedState>().clone();
    let mut gs = gs.borrow_mut();
    gs.pending_iframe_loads.push((node_id, src.to_string()));
}

#[op2(async)]
pub(super) async fn op_sleep(#[number] millis: u64) {
    tokio::time::sleep(std::time::Duration::from_millis(millis)).await;
}

// Records a binding call from page JS. The CDP layer drains this queue
// after every dispatch and emits one `Runtime.bindingCalled` event per
// entry, that's how puppeteer's `page.exposeFunction` callbacks fire.
#[op2(fast)]
pub(super) fn op_binding_called(state: &OpState, #[string] name: &str, #[string] payload: &str) {
    let gs = state.borrow::<SharedState>().clone();
    let mut gs = gs.borrow_mut();
    gs.pending_binding_calls.push((name.to_string(), payload.to_string()));
}
