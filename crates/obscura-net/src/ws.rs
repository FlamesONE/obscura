//! Real WebSocket client over the stealth `wreq` transport.
//!
//! A page's `new WebSocket(url)` needs an actual `wss://` connection that
//! carries the same Chrome TLS fingerprint as navigations. A JS stub that fakes
//! the `open` event but never delivers server frames leaves any protocol that
//! waits for a server-pushed message hung forever — notably iphey's MixVisit
//! fingerprint, whose Rust/WASM core opens `wss://api.iphey.com/ws/<token>`,
//! sends nothing, and awaits the server's pushed measurement before it can
//! resolve the whole verdict.
//!
//! The socket is owned by a background task; frames cross to JS through
//! channels the ops (`op_ws_send` / `op_ws_recv`) drive.

use tokio::sync::{mpsc, Mutex};
use wreq::ws::message::{CloseFrame, Message};

/// Outgoing intent from JS `send()` / `close()`.
pub enum WsOut {
    Text(String),
    Binary(Vec<u8>),
    Close { code: u16, reason: String },
}

/// Inbound event surfaced to JS as a WebSocket event.
pub enum WsEvent {
    Message {
        binary: bool,
        text: String,
        bytes: Vec<u8>,
    },
    Close {
        code: u16,
        reason: String,
    },
    Error(String),
}

/// Page-side handle to a live socket. `out_tx` feeds the driver task; `in_rx`
/// is awaited by `op_ws_recv` for the next inbound event. Only one recv is ever
/// outstanding per socket (the JS read loop is sequential), so the `Mutex` is
/// uncontended and just satisfies the borrow rules for the shared handle.
pub struct WsHandle {
    pub out_tx: mpsc::UnboundedSender<WsOut>,
    pub in_rx: Mutex<mpsc::UnboundedReceiver<WsEvent>>,
    pub protocol: String,
}

/// Take an established `wreq` WebSocket and spawn the driver that shuttles
/// frames both directions, returning the page-side handle.
pub fn spawn_ws_driver(mut socket: wreq::ws::WebSocket) -> WsHandle {
    let protocol = socket
        .protocol()
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<WsOut>();
    let (in_tx, in_rx) = mpsc::unbounded_channel::<WsEvent>();

    tracing::debug!("ws driver spawning (protocol={:?})", protocol);
    tokio::spawn(async move {
        loop {
            tokio::select! {
                out = out_rx.recv() => match out {
                    Some(WsOut::Text(s)) => {
                        if socket.send(Message::text(s)).await.is_err() { break; }
                    }
                    Some(WsOut::Binary(b)) => {
                        if socket.send(Message::binary(b)).await.is_err() { break; }
                    }
                    Some(WsOut::Close { code, reason }) => {
                        let frame = CloseFrame { code: code.into(), reason: reason.into() };
                        let _ = socket.send(Message::close(Some(frame))).await;
                        break;
                    }
                    // Page dropped every sender: it discarded the socket.
                    None => break,
                },
                inc = socket.recv() => match inc {
                    Some(Ok(Message::Text(t))) => {
                        let _ = in_tx.send(WsEvent::Message {
                            binary: false,
                            text: t.as_str().to_string(),
                            bytes: Vec::new(),
                        });
                    }
                    Some(Ok(Message::Binary(b))) => {
                        let _ = in_tx.send(WsEvent::Message {
                            binary: true,
                            text: String::new(),
                            bytes: b.to_vec(),
                        });
                    }
                    // Ping/Pong are answered by wreq automatically.
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = frame
                            .map(|f| (u16::from(f.code), f.reason.as_str().to_string()))
                            .unwrap_or((1005, String::new()));
                        let _ = in_tx.send(WsEvent::Close { code, reason });
                        break;
                    }
                    Some(Err(e)) => {
                        let _ = in_tx.send(WsEvent::Error(e.to_string()));
                        break;
                    }
                    // Stream ended without a close frame.
                    None => {
                        let _ = in_tx.send(WsEvent::Close { code: 1006, reason: String::new() });
                        break;
                    }
                },
            }
        }
    });

    WsHandle {
        out_tx,
        in_rx: Mutex::new(in_rx),
        protocol,
    }
}
