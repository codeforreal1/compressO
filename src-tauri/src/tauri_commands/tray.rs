use std::sync::Mutex;
use tauri::{webview::PageLoadEvent, AppHandle, Emitter, Manager, Url, WebviewWindowBuilder};

use crate::macos::{
    bridge,
    tray_popover::{self, WindowExt, TRAY_WINDOW_LABEL},
};

pub const MAIN_WINDOW_LABEL: &str = "main";

#[tauri::command]
pub fn open_tray_popover(app_handle: AppHandle) -> Result<(), String> {
    let tray_window = app_handle
        .get_webview_window(TRAY_WINDOW_LABEL)
        .ok_or("Tray window not found")?;
    tray_window.open_tray_popover()
}

/// Closes the tray popover. `suspend` also destroys the tray webview, which is recreated the next
/// time the tray icon is clicked.
#[tauri::command]
pub fn close_tray_popover(app_handle: AppHandle, suspend: Option<bool>) -> Result<(), String> {
    let tray_window = app_handle
        .get_webview_window(TRAY_WINDOW_LABEL)
        .ok_or("Tray window not found")?;
    if suspend.unwrap_or(false) {
        return tray_popover::destroy_tray_window(&app_handle);
    }
    tray_window.close_tray_popover()
}

#[tauri::command]
pub fn resize_tray_popover(
    app_handle: AppHandle,
    width: f64,
    height: f64,
    animate: Option<bool>,
    blur_overlay_on_resize: Option<bool>,
) -> Result<(), String> {
    let tray_window = app_handle
        .get_webview_window(TRAY_WINDOW_LABEL)
        .ok_or("Tray window not found")?;
    if tray_window.is_tray_popover_visible() {
        bridge::resize_tray_popover(width, height, animate, blur_overlay_on_resize);
    }
    Ok(())
}

#[tauri::command]
pub fn is_tray_popover_visible(app_handle: AppHandle) -> bool {
    app_handle
        .get_webview_window(TRAY_WINDOW_LABEL)
        .map(|tray_window| tray_window.is_tray_popover_visible())
        .unwrap_or(false)
}

/// Pins the tray popover, so it stays open when clicking outside it, or restores the default
#[tauri::command]
pub fn set_tray_popover_pinned(pinned: bool) {
    bridge::ffi::setTrayPopoverPinned(pinned);
}

/// Adds files copied to the clipboard to the media dropped on the menu bar (or stops doing so)
#[tauri::command]
pub fn set_clipboard_watch_enabled(app_handle: AppHandle, enabled: bool) {
    crate::macos::clipboard_watch::set_enabled(&app_handle, enabled);
}

#[tauri::command]
pub fn is_clipboard_watch_enabled() -> bool {
    crate::macos::clipboard_watch::is_enabled()
}

/// Shows or removes the menu bar (tray) icon
#[tauri::command]
pub fn set_tray_icon_enabled(app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    tray_popover::set_tray_icon_enabled(&app_handle, enabled)
}

/// Files & folders dropped on the menu bar icon or popover, opened in the main window with
/// "Open App"
#[derive(Default)]
pub struct DroppedFilesState {
    files: Mutex<Vec<String>>,
    /// Lowercase extensions of the media that can be compressed, sent by the tray popover
    supported_extensions: Mutex<Vec<String>>,
}

const DROPPED_FILES_EVENT: &str = "tray-dropped-files";

fn dropped_files(app_handle: &AppHandle) -> Vec<String> {
    app_handle
        .try_state::<DroppedFilesState>()
        .and_then(|state| state.files.lock().ok().map(|files| files.clone()))
        .unwrap_or_default()
}

/// Changes the dropped files & sends them to the tray popover
fn update_dropped_files(app_handle: &AppHandle, update: impl FnOnce(&mut Vec<String>)) {
    let files = {
        let Some(state) = app_handle.try_state::<DroppedFilesState>() else {
            return;
        };
        let Ok(mut files) = state.files.lock() else {
            return;
        };
        update(&mut files);
        files.clone()
    };
    let _ = app_handle.emit_to(TRAY_WINDOW_LABEL, DROPPED_FILES_EVENT, files);
}

/// Whether a dropped path can be added: a folder (its media is picked when opened) or a file with a
/// supported extension
fn is_supported_drop(app_handle: &AppHandle, path: &str) -> bool {
    let path = std::path::Path::new(path);
    if path.is_dir() {
        return true;
    }
    let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    let extension = extension.to_lowercase();
    app_handle
        .try_state::<DroppedFilesState>()
        .and_then(|state| {
            state
                .supported_extensions
                .lock()
                .ok()
                .map(|extensions| extensions.contains(&extension))
        })
        .unwrap_or(false)
}

/// The media extensions that can be dropped (the frontend's list of supported inputs)
#[tauri::command]
pub fn set_supported_drop_extensions(app_handle: AppHandle, extensions: Vec<String>) {
    if let Some(state) = app_handle.try_state::<DroppedFilesState>() {
        if let Ok(mut supported_extensions) = state.supported_extensions.lock() {
            *supported_extensions = extensions.iter().map(|ext| ext.to_lowercase()).collect();
        }
    }
}

/// Adds dropped files (each once), skipping unsupported ones. Returns how many were skipped.
/// Refused while they cannot be opened (e.g. while compressing).
#[tauri::command]
pub fn add_dropped_files(app_handle: AppHandle, paths: Vec<String>) -> Result<usize, String> {
    if !crate::can_open_files_in_main_window(&app_handle) {
        return Err("Media cannot be added right now.".to_string());
    }
    let (supported, unsupported): (Vec<_>, Vec<_>) = paths
        .into_iter()
        .partition(|path| is_supported_drop(&app_handle, path));
    update_dropped_files(&app_handle, |files| {
        for path in supported {
            if !files.contains(&path) {
                files.push(path);
            }
        }
    });
    Ok(unsupported.len())
}

#[tauri::command]
pub fn remove_dropped_file(app_handle: AppHandle, path: String) {
    update_dropped_files(&app_handle, |files| files.retain(|file| *file != path));
}

#[tauri::command]
pub fn clear_dropped_files(app_handle: AppHandle) {
    update_dropped_files(&app_handle, |files| files.clear());
}

#[tauri::command]
pub fn get_dropped_files(app_handle: AppHandle) -> Vec<String> {
    dropped_files(&app_handle)
}

/// Shows the main window, with the files dropped on the menu bar (if any & if they can be opened)
#[tauri::command]
pub fn focus_main_window(app_handle: AppHandle) -> Result<(), String> {
    let files = dropped_files(&app_handle);
    if !files.is_empty() && crate::can_open_files_in_main_window(&app_handle) {
        let urls = files
            .iter()
            .filter_map(|path| Url::from_file_path(path).ok())
            .collect::<Vec<_>>();
        // Delivered to the main window once it is ready (see `frontend-ready`)
        crate::handle_open_with_app(&app_handle, urls)?;
        update_dropped_files(&app_handle, |files| files.clear());
    }
    focus_or_create_main_window(&app_handle)
}

#[tauri::command]
pub fn quit_app(app_handle: AppHandle) {
    app_handle.exit(0);
}

/// Shows & focuses the main window, recreating it if it was closed (the app keeps running while
/// the tray is alive)
pub fn focus_or_create_main_window(app_handle: &AppHandle) -> Result<(), String> {
    match app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(window) => {
            window.unminimize().map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
        None => {
            let window_config = app_handle
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == MAIN_WINDOW_LABEL)
                .cloned()
                .unwrap_or_default();

            // The window starts hidden (see `tauri.conf.json`), so show it once it has loaded
            WebviewWindowBuilder::from_config(app_handle, &window_config)
                .map_err(|e| e.to_string())?
                .on_page_load(|window, payload| {
                    if let PageLoadEvent::Finished = payload.event() {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                })
                .build()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
