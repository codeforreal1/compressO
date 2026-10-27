#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
use cocoa::appkit::NSApp;
#[cfg(target_os = "macos")]
use cocoa::base::nil;
#[cfg(target_os = "macos")]
use cocoa::foundation::NSString as cocoa_NSString;
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

/// Sets the macOS dock badge to show compression progress
///
/// # Arguments
/// * `progress` - Progress value from 0 to 100
///
/// # Example
/// ```
/// set_dock_progress(45) // Shows "45%" badge
/// set_dock_progress(0)  // Clears the badge
/// ```
#[tauri::command]
pub fn set_dock_progress(app_handle: tauri::AppHandle, progress: f64) -> Result<(), String> {
    let progress = progress.clamp(0.0, 100.0);

    // The menu bar (tray) icon shows the same progress
    #[cfg(target_os = "macos")]
    crate::tray_popover::set_tray_progress(&app_handle, progress)?;

    #[cfg(target_os = "macos")]
    unsafe {
        let app = NSApp();
        if app.is_null() {
            return Err("Failed to get NSApp".to_string());
        }

        let dock_tile: *const objc::runtime::Object = msg_send![app, dockTile];
        if dock_tile.is_null() {
            return Err("Failed to get dock tile".to_string());
        }

        if progress <= 0.0 {
            let empty = cocoa_NSString::alloc(nil).init_str("");
            let _: () = msg_send![dock_tile, setBadgeLabel: empty];
        } else {
            let badge = format!("{}%", progress.round());
            let ns_string = cocoa_NSString::alloc(nil).init_str(&badge);
            let _: () = msg_send![dock_tile, setBadgeLabel: ns_string];
        }

        let _: () = msg_send![dock_tile, display];
    }

    // The tray icon's tooltip & the main window's taskbar button show the progress
    #[cfg(windows)]
    {
        crate::tray_popover::set_tray_progress(&app_handle, progress)?;
        set_taskbar_progress(&app_handle, progress);
    }

    #[cfg(target_os = "linux")]
    {
        // No-op on Linux
        let _ = app_handle;
        log::debug!("set_dock_progress called with {} on Linux", progress);
    }

    Ok(())
}

/// Fills the main window's taskbar button with the progress (as file copies do), or empties it at 0
#[cfg(windows)]
fn set_taskbar_progress(app_handle: &tauri::AppHandle, progress: f64) {
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    use tauri::Manager;

    let Some(window) =
        app_handle.get_webview_window(crate::tauri_commands::tray::MAIN_WINDOW_LABEL)
    else {
        return;
    };
    let state = if progress <= 0.0 {
        ProgressBarState {
            status: Some(ProgressBarStatus::None),
            progress: None,
        }
    } else {
        ProgressBarState {
            status: Some(ProgressBarStatus::Normal),
            progress: Some(progress.round() as u64),
        }
    };
    let _ = window.set_progress_bar(state);
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn clear_dock_badge(app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::tray_popover::set_tray_progress(&app_handle, 0.0)?;

    unsafe {
        let app = NSApp();
        if app.is_null() {
            return Err("Failed to get NSApp".to_string());
        }

        let dock_tile: *const objc::runtime::Object = msg_send![app, dockTile];
        if dock_tile.is_null() {
            return Err("Failed to get dock tile".to_string());
        }

        let empty = cocoa_NSString::alloc(nil).init_str("");
        let _: () = msg_send![dock_tile, setBadgeLabel: empty];
        let _: () = msg_send![dock_tile, display];
    }

    Ok(())
}

#[cfg(windows)]
#[tauri::command]
pub fn clear_dock_badge(app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::tray_popover::set_tray_progress(&app_handle, 0.0)?;
    set_taskbar_progress(&app_handle, 0.0);
    Ok(())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn clear_dock_badge() -> Result<(), String> {
    // No-op on Linux
    Ok(())
}
