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
    crate::macos::tray_popover::set_tray_progress(&app_handle, progress)?;

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

    #[cfg(not(target_os = "macos"))]
    {
        // No-op on non-macOS platforms
        let _ = app_handle;
        log::debug!(
            "set_dock_progress called with {} on non-macOS platform",
            progress
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn clear_dock_badge(app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::macos::tray_popover::set_tray_progress(&app_handle, 0.0)?;

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

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn clear_dock_badge() -> Result<(), String> {
    // No-op on non-macOS platforms
    Ok(())
}
