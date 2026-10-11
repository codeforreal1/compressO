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
const TRAY_WINDOW_HEIGHT: f64 = 400.0;

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
        format!("{}%", progress.round())
    };
    tray.set_title(Some(title)).map_err(|err| err.to_string())
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
    .inner_size(TRAY_WINDOW_WIDTH, TRAY_WINDOW_HEIGHT)
    .build()
    .map_err(|err| err.to_string())
}

/// Adds the status bar (tray) icon, which toggles a native popover (NSPopover) hosting the tray
/// webview window
pub fn init(app: &App) -> Result<(), String> {
    app.manage(TrayPopoverState(Mutex::new(false)));

    TrayIconBuilder::with_id(TRAY_WINDOW_LABEL)
        .icon(tray_icon_image())
        .icon_as_template(true)
        .tooltip("CompressO")
        .on_tray_icon_event(|tray, event| {
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
        .build(app)
        .map_err(|err| err.to_string())?;

    let tray_window = create_tray_window(app.handle())?;
    tray_window.to_popover()?;

    Ok(())
}
