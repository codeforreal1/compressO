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
    }

    extern "Swift" {
        // tray popover
        fn initTrayPopoverManager(
            nsWindowPtr: *mut std::ffi::c_void,
            nsStatusBarButtonPtr: *mut std::ffi::c_void,
        );
        fn openTrayPopover();
        fn closeTrayPopover();
        fn isTrayPopoverVisible() -> bool;
        fn resizeTrayPopover(width: f64, height: f64, animate: bool, blurOverlayOnResize: bool);
    }
}

// tray popover
fn tray_popover_event(event_type: ffi::TrayPopoverEventType) {
    log::debug!("Tray popover event {:?}", event_type);
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
