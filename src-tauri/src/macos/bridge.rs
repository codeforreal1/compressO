// FFI to the Swift library in `swift-library/` (compiled & linked by `build.rs`)

// `swift-bridge` resolves `std::ffi::c_void` through `super::`
use std;

#[swift_bridge::bridge]
pub mod ffi {
    #[derive(Debug)]
    enum TrayPopoverEventType {
        Opened,
        Closed,
    }

    extern "Rust" {
        fn tray_popover_event(event_type: TrayPopoverEventType);

        // files dropped on the status bar icon
        fn tray_can_accept_files() -> bool;
        fn tray_files_dropped(pathsJson: String) -> bool;
    }

    extern "Swift" {
        // tray popover
        fn initTrayPopoverManager(
            nsWindowPtr: *mut std::ffi::c_void,
            nsStatusBarButtonPtr: *mut std::ffi::c_void,
        );
        fn openTrayPopover();
        fn closeTrayPopover();
        fn destroyTrayPopover();
        fn setTrayPopoverPinned(pinned: bool);
        fn isTrayPopoverVisible() -> bool;
        fn resizeTrayPopover(width: f64, height: f64, animate: bool, blurOverlayOnResize: bool);

        // login item (see `login_item.swift`)
        fn loginItemStatus(plistPath: String) -> i32;
    }
}

// tray popover
fn tray_popover_event(event_type: ffi::TrayPopoverEventType) {
    log::debug!("Tray popover event {:?}", event_type);
}

// files dropped on the status bar icon
fn tray_can_accept_files() -> bool {
    crate::macos::tray_popover::app_handle()
        .map(|app_handle| crate::can_open_files_in_main_window(&app_handle))
        .unwrap_or(false)
}

fn tray_files_dropped(paths_json: String) -> bool {
    let Some(app_handle) = crate::macos::tray_popover::app_handle() else {
        return false;
    };
    let paths = serde_json::from_str::<Vec<String>>(&paths_json).unwrap_or_default();
    let path_count = paths.len();
    // Collected in the popover until "Open App"; unsupported files are skipped
    matches!(
        crate::tauri_commands::tray::add_dropped_files(app_handle, paths),
        Ok(skipped_count) if skipped_count < path_count
    )
}

pub fn resize_tray_popover(
    width: f64,
    height: f64,
    animate: Option<bool>,
    blur_overlay_on_resize: Option<bool>,
) {
    ffi::resizeTrayPopover(
        width,
        height,
        animate.unwrap_or(false),
        blur_overlay_on_resize.unwrap_or(false),
    )
}
