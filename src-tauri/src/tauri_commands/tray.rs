use tauri::{webview::PageLoadEvent, AppHandle, Manager, WebviewWindowBuilder};

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

/// Shows or removes the menu bar (tray) icon
#[tauri::command]
pub fn set_tray_icon_enabled(app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    tray_popover::set_tray_icon_enabled(&app_handle, enabled)
}

#[tauri::command]
pub fn focus_main_window(app_handle: AppHandle) -> Result<(), String> {
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
