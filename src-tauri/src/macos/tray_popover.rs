use std::{self, sync::Mutex};
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::macos::bridge::ffi;

// The tray icon & the webview window shown inside its popover share this id/label
pub const TRAY_WINDOW_LABEL: &str = "tray";

const TRAY_WINDOW_URL: &str = "webviews/tray";
const TRAY_WINDOW_WIDTH: f64 = 320.0;
const TRAY_WINDOW_HEIGHT: f64 = 420.0;

pub trait WindowExt<R: Runtime> {
    fn to_popover(&self) -> Result<(), String>;
    fn is_tray_popover_visible(&self) -> bool;
    fn open_tray_popover(&self) -> Result<(), String>;
    fn close_tray_popover(&self) -> Result<(), String>;
    fn toggle_tray_popover(&self) -> Result<(), String>;
}

pub trait RawAppKitHandles {
    fn raw_statusbar_button(&self) -> Result<*mut std::ffi::c_void, String>;
}

impl<R: Runtime> RawAppKitHandles for TrayIcon<R> {
    fn raw_statusbar_button(&self) -> Result<*mut std::ffi::c_void, String> {
        struct SendPtr(*mut std::ffi::c_void);
        unsafe impl Send for SendPtr {}

        let send_ptr_result = self.with_inner_tray_icon(|inner| match inner.ns_status_item() {
            Some(status_item) => {
                let button: objc2::rc::Retained<objc2_app_kit::NSStatusBarButton> =
                    unsafe { objc2::msg_send![&*status_item, button] };
                let raw_ptr = objc2::rc::Retained::into_raw(button) as *mut std::ffi::c_void;

                Ok(SendPtr(raw_ptr))
            }
            None => Err("NSStatusItem instance was dropped or not initialized".to_string()),
        });

        match send_ptr_result {
            Ok(inner_result) => match inner_result {
                Ok(send_ptr) => Ok(send_ptr.0),
                Err(custom_err) => Err(custom_err),
            },
            Err(tauri_err) => Err(format!("Tauri tray runtime thread error: {}", tauri_err)),
        }
    }
}

impl<R: Runtime> WindowExt<R> for WebviewWindow<R> {
    fn to_popover(&self) -> Result<(), String> {
        let tray = self
            .app_handle()
            .tray_by_id(self.label())
            .ok_or_else(|| format!("Tray not found for label: {}", self.label()))?;

        let raw_button = tray.raw_statusbar_button().map_err(|err| err.to_string())?;
        let ns_window_ptr =
            self.ns_window().map_err(|err| err.to_string())? as *mut std::ffi::c_void;

        ffi::initTrayPopoverManager(ns_window_ptr, raw_button);

        let state = self.app_handle().state::<TrayPopoverState>();
        *state.0.lock().map_err(|err| err.to_string())? = true;

        Ok(())
    }

    fn is_tray_popover_visible(&self) -> bool {
        let state = self.app_handle().state::<TrayPopoverState>();
        if !*state.0.lock().unwrap() {
            return false;
        }

        ffi::isTrayPopoverVisible()
    }

    fn open_tray_popover(&self) -> Result<(), String> {
        let state = self.app_handle().state::<TrayPopoverState>();
        if !*state.0.lock().map_err(|err| err.to_string())? {
            return Err("Tray reference not found".to_string());
        }

        ffi::openTrayPopover();

        Ok(())
    }

    fn close_tray_popover(&self) -> Result<(), String> {
        let state = self.app_handle().state::<TrayPopoverState>();
        if !*state.0.lock().unwrap() {
            return Err("Tray reference not found".to_string());
        }

        ffi::closeTrayPopover();

        Ok(())
    }

    fn toggle_tray_popover(&self) -> Result<(), String> {
        if self.is_tray_popover_visible() {
            self.close_tray_popover()
        } else {
            self.open_tray_popover()
        }
    }
}

pub struct TrayPopoverState(pub Mutex<bool>);

/// Pins the popover, so it stays open when clicking outside it, or restores the default
pub fn set_pinned(_app_handle: &AppHandle, pinned: bool) {
    ffi::setTrayPopoverPinned(pinned);
}

/// Resizes the popover while it is shown
pub fn resize_popover(
    app_handle: &AppHandle,
    width: f64,
    height: f64,
    animate: Option<bool>,
    blur_overlay_on_resize: Option<bool>,
) -> Result<(), String> {
    let tray_window = app_handle
        .get_webview_window(TRAY_WINDOW_LABEL)
        .ok_or("Tray window not found")?;
    if tray_window.is_tray_popover_visible() {
        crate::macos::bridge::resize_tray_popover(width, height, animate, blur_overlay_on_resize);
    }
    Ok(())
}

fn tray_icon_image() -> Image<'static> {
    tauri::include_image!("./icons/tray.png")
}

/// Shows the progress (e.g. "45%") next to the tray icon, like the dock badge. A progress of 0
/// removes it.
pub fn set_tray_progress(app_handle: &AppHandle, progress: f64) -> Result<(), String> {
    let Some(tray) = app_handle.tray_by_id(TRAY_WINDOW_LABEL) else {
        return Ok(());
    };

    // `set_title(None)` is a no-op on macOS (the previous title stays), so clear it with ""
    let title = if progress <= 0.0 {
        String::new()
    } else {
        use_monospaced_digits(&tray);
        // Always 3 digits wide (padded with figure spaces, as wide as a digit), so the icon does
        // not resize & move the popover while it counts
        format!("{:\u{2007}>3}%", progress.round() as u32)
    };
    tray.set_title(Some(title)).map_err(|err| err.to_string())
}

/// The menu bar's font, with digits of one width (the menu bar's own font has narrower & wider
/// digits, so the title would change width as the progress changes)
fn use_monospaced_digits(tray: &TrayIcon) {
    let _ = tray.with_inner_tray_icon(|inner| {
        let Some(status_item) = inner.ns_status_item() else {
            return;
        };
        unsafe {
            let button: *mut objc2::runtime::AnyObject = objc2::msg_send![&*status_item, button];
            if button.is_null() {
                return;
            }
            let menu_bar_font: *mut objc2::runtime::AnyObject =
                objc2::msg_send![objc2::class!(NSFont), menuBarFontOfSize: 0.0f64];
            let size: f64 = if menu_bar_font.is_null() {
                13.0
            } else {
                objc2::msg_send![menu_bar_font, pointSize]
            };
            let font: *mut objc2::runtime::AnyObject = objc2::msg_send![
                objc2::class!(NSFont),
                monospacedDigitSystemFontOfSize: size,
                weight: 0.0f64
            ];
            if !font.is_null() {
                let _: () = objc2::msg_send![button, setFont: font];
            }
        }
    });
}

fn create_tray_window(app_handle: &AppHandle) -> Result<WebviewWindow, String> {
    WebviewWindowBuilder::new(
        app_handle,
        TRAY_WINDOW_LABEL,
        WebviewUrl::App(TRAY_WINDOW_URL.into()),
    )
    .decorations(false)
    .transparent(true)
    .visible(false)
    // A pinned popover is often not the active window; the first click should still act (e.g.
    // on "Open App") instead of only activating it
    .accept_first_mouse(true)
    .inner_size(TRAY_WINDOW_WIDTH, TRAY_WINDOW_HEIGHT)
    .build()
    .map_err(|err| err.to_string())
}

/// Creates the tray webview again if it is missing (e.g. suspended), while the tray icon is shown:
/// it compresses the drop zone's queue (see `drop_queue`)
pub fn ensure_tray_window(app_handle: &AppHandle) {
    if app_handle.tray_by_id(TRAY_WINDOW_LABEL).is_none()
        || app_handle.get_webview_window(TRAY_WINDOW_LABEL).is_some()
    {
        return;
    }
    if let Err(err) = create_tray_window(app_handle).and_then(|window| window.to_popover()) {
        log::error!("Failed to create tray window: {}", err);
    }
}

static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// For callbacks from Swift, which have no access to the app otherwise
pub fn app_handle() -> Option<AppHandle> {
    APP_HANDLE.get().cloned()
}

pub fn init(app: &App) {
    app.manage(TrayPopoverState(Mutex::new(false)));
    app.manage(crate::tauri_commands::tray::DroppedFilesState::default());
    app.manage(crate::tauri_commands::drop_queue::DropQueueState::default());
    let _ = APP_HANDLE.set(app.handle().clone());
    crate::sys::clipboard_watch::init(app.handle());
    crate::sys::watch_folders::init(app.handle());
}

/// Shows or removes the status bar (tray) icon, which toggles a native popover (NSPopover) hosting
/// the tray webview window. Removing it also destroys the tray window, so the app quits again when
/// the main window is closed.
pub fn set_tray_icon_enabled(app_handle: &AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        enable_tray_icon(app_handle)
    } else {
        disable_tray_icon(app_handle)
    }
}

fn enable_tray_icon(app_handle: &AppHandle) -> Result<(), String> {
    if app_handle.tray_by_id(TRAY_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    TrayIconBuilder::with_id(TRAY_WINDOW_LABEL)
        .icon(tray_icon_image())
        .icon_as_template(true)
        .tooltip("CompressO")
        // A right click shows the menu (see `show_tray_icon_menu`); a click opens the popover
        .on_menu_event(crate::tauri_commands::tray::handle_tray_icon_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Right,
                button_state: MouseButtonState::Down,
                ..
            } = event
            {
                if let Err(err) = show_tray_icon_menu(tray) {
                    log::error!("Failed to show the tray icon menu: {}", err);
                }
                return;
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app_handle = tray.app_handle();
                let window = match app_handle.get_webview_window(TRAY_WINDOW_LABEL) {
                    Some(window) => Some(window),
                    // The tray window was probably suspended -> create a new one
                    None => create_tray_window(app_handle)
                        .and_then(|window| window.to_popover().map(|_| window))
                        .map_err(|err| log::error!("Failed to create tray window: {}", err))
                        .ok(),
                };
                if let Some(window) = window {
                    if let Err(err) = window.toggle_tray_popover() {
                        log::error!("Failed to toggle tray popover: {}", err);
                    }
                }
            }
        })
        .build(app_handle)
        .map_err(|err| err.to_string())?;

    if app_handle.get_webview_window(TRAY_WINDOW_LABEL).is_none() {
        let tray_window = create_tray_window(app_handle)?;
        tray_window.to_popover()?;
    }

    Ok(())
}

/// Shows the tray icon's menu below the icon. The menu is only attached while it is shown: macOS
/// shows an attached menu on every click, so a click could not open the popover.
fn show_tray_icon_menu(tray: &TrayIcon) -> Result<(), String> {
    let menu = crate::tauri_commands::tray::tray_icon_menu(tray.app_handle())?;
    tray.set_menu(Some(menu)).map_err(|err| err.to_string())?;
    let button = tray.raw_statusbar_button()?;
    // Clicking the icon with the menu attached shows it, & returns once it is closed
    unsafe {
        let button = button as *mut objc2_app_kit::NSStatusBarButton;
        let _: () =
            objc2::msg_send![&*button, performClick: std::ptr::null::<objc2::runtime::AnyObject>()];
        // `raw_statusbar_button` gives a retained pointer
        drop(objc2::rc::Retained::from_raw(button));
    }
    tray.set_menu(None::<tauri::menu::Menu<tauri::Wry>>)
        .map_err(|err| err.to_string())
}

/// Destroys the tray webview window along with the native popover hosting it (which would
/// otherwise keep the destroyed webview alive). A new one is created when the tray icon is clicked.
pub fn destroy_tray_window(app_handle: &AppHandle) -> Result<(), String> {
    let state = app_handle.state::<TrayPopoverState>();
    *state.0.lock().map_err(|err| err.to_string())? = false;
    ffi::destroyTrayPopover();

    if let Some(tray_window) = app_handle.get_webview_window(TRAY_WINDOW_LABEL) {
        tray_window.destroy().map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn disable_tray_icon(app_handle: &AppHandle) -> Result<(), String> {
    destroy_tray_window(app_handle)?;

    if let Some(tray) = app_handle.remove_tray_by_id(TRAY_WINDOW_LABEL) {
        tray.set_visible(false).map_err(|err| err.to_string())?;
    }

    Ok(())
}
