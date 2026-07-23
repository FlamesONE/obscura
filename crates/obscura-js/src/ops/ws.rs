use std::cell::RefCell;
use std::rc::Rc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use deno_core::{op2, OpState};

use super::SharedState;

// --- WebSocket ops (stealth only) ---------------------------------------
//
// The JS WebSocket shim (bootstrap.js) drives these to run a real wss://
// connection over the wreq client. Without them the shim could only fake an
// `open` event and never deliver server frames, hanging any protocol that
// awaits a server-pushed message (e.g. iphey/MixVisit's WASM fingerprint,
// which opens wss://api.iphey.com/ws/<token>, sends nothing, and blocks its
// whole verdict on the server's pushed measurement).

/// Open a socket. Returns `{rid, protocol}` on success or `{error}` on failure.
#[cfg(feature = "stealth")]
#[op2(async)]
#[string]
pub(super) async fn op_ws_connect(
    state: Rc<RefCell<OpState>>,
    #[string] url: String,
    #[string] protocols_json: String,
) -> Result<String, deno_error::JsErrorBox> {
    let stealth = {
        let state_borrow = state.borrow();
        let gs = state_borrow.borrow::<SharedState>().clone();
        let gs = gs.borrow();
        gs.stealth_client.clone()
    };
    let Some(stealth) = stealth else {
        return Ok(serde_json::json!({ "error": "no stealth client" }).to_string());
    };
    let protocols: Vec<String> = serde_json::from_str(&protocols_json).unwrap_or_default();
    match stealth.ws_connect(&url, protocols).await {
        Ok(handle) => {
            let protocol = handle.protocol.clone();
            let state_borrow = state.borrow();
            let gs = state_borrow.borrow::<SharedState>().clone();
            let mut gs = gs.borrow_mut();
            gs.ws_counter += 1;
            let rid = gs.ws_counter;
            gs.ws_conns.insert(rid, std::sync::Arc::new(handle));
            Ok(serde_json::json!({ "rid": rid, "protocol": protocol }).to_string())
        }
        Err(e) => Ok(serde_json::json!({ "error": e.to_string() }).to_string()),
    }
}

/// Await the next inbound event on a socket. Resolves once per event; the shim
/// calls it in a loop. Types: `message` (with `text` or `bytesBase64`),
/// `close` (`code`,`reason`), `error` (`error`).
#[cfg(feature = "stealth")]
#[op2(async)]
#[string]
pub(super) async fn op_ws_recv(
    state: Rc<RefCell<OpState>>,
    #[smi] rid: u32,
) -> Result<String, deno_error::JsErrorBox> {
    let handle = {
        let state_borrow = state.borrow();
        let gs = state_borrow.borrow::<SharedState>().clone();
        let gs = gs.borrow();
        gs.ws_conns.get(&rid).cloned()
    };
    let Some(handle) = handle else {
        return Ok(serde_json::json!({ "type": "close", "code": 1006, "reason": "" }).to_string());
    };
    let mut rx = handle.in_rx.lock().await;
    let evt = rx.recv().await;
    Ok(match evt {
        Some(obscura_net::ws::WsEvent::Message { binary, text, bytes }) => {
            if binary {
                serde_json::json!({ "type": "message", "binary": true, "bytesBase64": BASE64.encode(&bytes) })
            } else {
                serde_json::json!({ "type": "message", "binary": false, "text": text })
            }
        }
        Some(obscura_net::ws::WsEvent::Close { code, reason }) => {
            serde_json::json!({ "type": "close", "code": code, "reason": reason })
        }
        Some(obscura_net::ws::WsEvent::Error(e)) => {
            serde_json::json!({ "type": "error", "error": e })
        }
        None => serde_json::json!({ "type": "close", "code": 1006, "reason": "" }),
    }
    .to_string())
}

/// Queue an outbound text frame.
#[cfg(feature = "stealth")]
#[op2(fast)]
pub(super) fn op_ws_send_text(state: &OpState, #[smi] rid: u32, #[string] text: &str) {
    let gs = state.borrow::<SharedState>().clone();
    let gs = gs.borrow();
    if let Some(handle) = gs.ws_conns.get(&rid) {
        let _ = handle.out_tx.send(obscura_net::ws::WsOut::Text(text.to_string()));
    }
}

/// Queue an outbound binary frame.
#[cfg(feature = "stealth")]
#[op2(fast)]
pub(super) fn op_ws_send_binary(state: &OpState, #[smi] rid: u32, #[buffer] bytes: &[u8]) {
    let gs = state.borrow::<SharedState>().clone();
    let gs = gs.borrow();
    if let Some(handle) = gs.ws_conns.get(&rid) {
        let _ = handle.out_tx.send(obscura_net::ws::WsOut::Binary(bytes.to_vec()));
    }
}

/// Close a socket and drop the handle.
#[cfg(feature = "stealth")]
#[op2(fast)]
pub(super) fn op_ws_close(state: &OpState, #[smi] rid: u32, #[smi] code: u32, #[string] reason: &str) {
    let gs = state.borrow::<SharedState>().clone();
    let mut gs = gs.borrow_mut();
    if let Some(handle) = gs.ws_conns.remove(&rid) {
        let _ = handle.out_tx.send(obscura_net::ws::WsOut::Close {
            code: code as u16,
            reason: reason.to_string(),
        });
    }
}
