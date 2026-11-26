//! Shared request/response bridge for sending CLI commands to a frontend webview window
//! (tray popover where present, otherwise main) and waiting for the answer.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

const ANSWER_TIMEOUT: Duration = Duration::from_secs(10);
const RETRY_INTERVAL: Duration = Duration::from_millis(500);

type PendingRequests = Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>;

fn pending() -> &'static PendingRequests {
    static PENDING: OnceLock<PendingRequests> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

/// The window that owns settings/presets/watched-folders: tray where available, otherwise main
pub fn target_window(app_handle: &AppHandle) -> Option<&'static str> {
    #[cfg(any(target_os = "macos", windows))]
    if app_handle
        .get_webview_window(crate::tray_popover::TRAY_WINDOW_LABEL)
        .is_some()
    {
        return Some(crate::tray_popover::TRAY_WINDOW_LABEL);
    }
    if app_handle.get_webview_window("main").is_some() {
        return Some("main");
    }
    None
}

/// Emits `event_name` with `{ requestId, command }` to a single window and waits for `complete`
pub async fn forward<T: Serialize>(
    app_handle: &AppHandle,
    event_name: &str,
    command: &T,
    label: &str,
) -> Result<Value, String> {
    let request_id = nanoid::nanoid!();
    let (sender, mut receiver) = tokio::sync::oneshot::channel();
    {
        let mut requests = pending()
            .lock()
            .map_err(|_| format!("CompressO could not process {label}."))?;
        requests.insert(request_id.clone(), sender);
    }

    let Some(window) = target_window(app_handle) else {
        if let Ok(mut requests) = pending().lock() {
            requests.remove(&request_id);
        }
        log::warn!("[{label}] No window is open to process {event_name}");
        return Err(format!(
            "Open CompressO once, then try again. It has no window to process {label}."
        ));
    };

    let payload = json!({ "requestId": request_id, "command": command });
    let deadline = Instant::now() + ANSWER_TIMEOUT;
    let result = loop {
        if let Err(err) = app_handle.emit_to(window, event_name, &payload) {
            log::warn!("[{label}] Could not ask {window}: {err}");
            break Err(format!(
                "CompressO closed the window before processing {label}."
            ));
        }
        match tokio::time::timeout(RETRY_INTERVAL, &mut receiver).await {
            Ok(Ok(result)) => break Ok(result),
            Ok(Err(_)) => {
                log::warn!("[{label}] Request {request_id} closed before answering");
                break Err(format!(
                    "CompressO closed the window before processing {label}."
                ));
            }
            Err(_) if Instant::now() >= deadline => {
                log::warn!("[{label}] Request {request_id} timed out on {window}");
                break Err(String::from(
                    "CompressO did not answer. Open CompressO once, then try again.",
                ));
            }
            Err(_) => {}
        }
    };

    if let Ok(mut requests) = pending().lock() {
        requests.remove(&request_id);
    }
    result
}

pub fn complete(request_id: String, result: Value) {
    let Some(sender) = pending()
        .lock()
        .ok()
        .and_then(|mut requests| requests.remove(&request_id))
    else {
        return;
    };
    let _ = sender.send(result);
}
