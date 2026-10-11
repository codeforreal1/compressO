use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Label of the macOS menu bar (tray) popover window, which shows the status
const TRAY_WINDOW_LABEL: &str = "tray";

#[derive(Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompressionState {
    #[default]
    Idle,
    Compressing,
    Completed,
}

/// What the main window is doing. Shown in the menu bar popover (macOS) & used to confirm quitting during a compression. A batch only has an overall progress.
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionStatus {
    pub state: CompressionState,
    /// Overall progress (0-100)
    pub progress: f64,
    pub media_count: usize,
    /// Name of the file, for a single media
    pub file_name: Option<String>,
}

pub struct CompressionStatusState(pub Mutex<CompressionStatus>);

const COMPRESSION_STATUS_EVENT: &str = "compression-status";

pub fn is_compressing(app_handle: &AppHandle) -> bool {
    app_handle
        .try_state::<CompressionStatusState>()
        .and_then(|state| state.0.lock().ok().map(|s| s.state))
        == Some(CompressionState::Compressing)
}

/// Stores the main window's compression status & sends it to the tray popover (macOS)
pub fn update_compression_status(app_handle: &AppHandle, status: CompressionStatus) {
    if let Some(state) = app_handle.try_state::<CompressionStatusState>() {
        if let Ok(mut current) = state.0.lock() {
            *current = status.clone();
        }
    }
    let _ = app_handle.emit_to(TRAY_WINDOW_LABEL, COMPRESSION_STATUS_EVENT, status);
}

#[tauri::command]
pub fn set_compression_status(app_handle: AppHandle, status: CompressionStatus) {
    update_compression_status(&app_handle, status);
}

#[tauri::command]
pub fn get_compression_status(app_handle: AppHandle) -> CompressionStatus {
    app_handle
        .try_state::<CompressionStatusState>()
        .and_then(|state| state.0.lock().ok().map(|s| s.clone()))
        .unwrap_or_default()
}
