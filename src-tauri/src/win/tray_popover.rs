//! The Windows system tray (notification area) icon & its popover, like the macOS menu bar popover
//! (see `macos::tray_popover`). Windows has no popover attached to tray icons, so the tray webview
//! is a small borderless window placed at the icon (above a bottom taskbar, as Windows' own flyouts),
//! hidden again when another window is clicked, unless pinned.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, LogicalSize, Manager, PhysicalPosition, Rect, Runtime, Theme, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

// The tray icon & the popover's webview window share this id/label
pub const TRAY_WINDOW_LABEL: &str = "tray";

const TRAY_WINDOW_URL: &str = "webviews/tray";
const TRAY_WINDOW_WIDTH: f64 = 320.0;
const TRAY_WINDOW_HEIGHT: f64 = 420.0;
/// Gap between the popover & the taskbar or the screen's edge (logical pixels), as Windows' flyouts
const MARGIN: f64 = 1.0;
/// A click on the tray icon this soon after the popover was hidden by that same click (it took the
/// focus) leaves it closed, instead of opening it again
const REOPEN_DELAY: Duration = Duration::from_millis(300);

#[derive(Default)]
pub struct TrayPopoverState {
    /// Pinned, the popover stays open when another window is clicked (see `set_pinned`)
    is_pinned: AtomicBool,
    /// Where the tray icon is (from its last click), to place the popover at it
    icon_rect: Mutex<Option<Rect>>,
    /// When the popover was last hidden because another window was clicked
    hidden_at: Mutex<Option<Instant>>,
}

pub trait WindowExt<R: Runtime> {
    fn is_tray_popover_visible(&self) -> bool;
    fn open_tray_popover(&self) -> Result<(), String>;
    fn close_tray_popover(&self) -> Result<(), String>;
    fn toggle_tray_popover(&self) -> Result<(), String>;
}

impl WindowExt<tauri::Wry> for WebviewWindow {
    fn is_tray_popover_visible(&self) -> bool {
        self.is_visible().unwrap_or(false)
    }

    fn open_tray_popover(&self) -> Result<(), String> {
        // Follows a change of the system's theme since it was last shown
        let theme = system_theme();
        if self.theme().ok() != Some(theme) {
            self.set_theme(Some(theme)).map_err(|err| err.to_string())?;
        }
        place_popover(self)?;
        self.show().map_err(|err| err.to_string())?;
        self.set_focus().map_err(|err| err.to_string())
    }

    fn close_tray_popover(&self) -> Result<(), String> {
        self.hide().map_err(|err| err.to_string())
    }

    fn toggle_tray_popover(&self) -> Result<(), String> {
        if self.is_tray_popover_visible() {
            return self.close_tray_popover();
        }
        // Clicking the icon while the popover is open first takes the focus from it, which hides it:
        // that click then means "close", as with an open popover
        let was_just_hidden = self
            .app_handle()
            .state::<TrayPopoverState>()
            .hidden_at
            .lock()
            .ok()
            .and_then(|hidden_at| *hidden_at)
            .is_some_and(|hidden_at| hidden_at.elapsed() < REOPEN_DELAY);
        if was_just_hidden {
            return Ok(());
        }
        self.open_tray_popover()
    }
}

/// The taskbar's edge, which the popover is placed against
enum TaskbarEdge {
    Bottom,
    Top,
    Left,
    Right,
}

/// Places the popover at the tray icon: centered on it, against the taskbar & inside the screen
/// area the taskbar leaves (its work area). Without the icon's place (e.g. opened before it was
/// clicked), at the bottom right of the main screen.
fn place_popover(window: &WebviewWindow) -> Result<(), String> {
    let app_handle = window.app_handle();
    let icon_rect = app_handle
        .state::<TrayPopoverState>()
        .icon_rect
        .lock()
        .ok()
        .and_then(|rect| *rect)
        .or_else(|| {
            app_handle
                .tray_by_id(TRAY_WINDOW_LABEL)
                .and_then(|tray| tray.rect().ok().flatten())
        });

    // The icon's center & size in physical pixels (Windows reports them so)
    let (icon_x, icon_y, icon_width, icon_height) = match icon_rect {
        Some(rect) => {
            let position = rect.position.to_physical::<f64>(1.0);
            let size = rect.size.to_physical::<f64>(1.0);
            (position.x, position.y, size.width, size.height)
        }
        None => (0.0, 0.0, 0.0, 0.0),
    };
    let icon_center_x = icon_x + icon_width / 2.0;
    let icon_center_y = icon_y + icon_height / 2.0;

    let monitor = match icon_rect {
        Some(_) => app_handle
            .monitor_from_point(icon_center_x, icon_center_y)
            .ok()
            .flatten(),
        None => None,
    }
    .or_else(|| app_handle.primary_monitor().ok().flatten())
    .ok_or("No screen found for the tray popover")?;

    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_left = work_area.position.x as f64;
    let work_top = work_area.position.y as f64;
    let work_right = work_left + work_area.size.width as f64;
    let work_bottom = work_top + work_area.size.height as f64;
    let screen_left = monitor.position().x as f64;
    let screen_top = monitor.position().y as f64;
    let screen_right = screen_left + monitor.size().width as f64;
    let screen_bottom = screen_top + monitor.size().height as f64;

    // The popover's size on that screen (its scale can differ from the screen it was last on)
    let window_scale = window.scale_factor().map_err(|err| err.to_string())?;
    let logical_size = window
        .outer_size()
        .map_err(|err| err.to_string())?
        .to_logical::<f64>(window_scale);
    let width = logical_size.width * scale;
    let height = logical_size.height * scale;
    let margin = MARGIN * scale;

    // The taskbar is on the edge where the work area stops short of the screen. With an auto-hidden
    // taskbar it does not, so the icon's side of the screen is used.
    let edge = if work_bottom < screen_bottom - 1.0 {
        TaskbarEdge::Bottom
    } else if work_top > screen_top + 1.0 {
        TaskbarEdge::Top
    } else if work_left > screen_left + 1.0 {
        TaskbarEdge::Left
    } else if work_right < screen_right - 1.0 {
        TaskbarEdge::Right
    } else if icon_rect.is_some() && icon_center_y < (screen_top + screen_bottom) / 2.0 {
        TaskbarEdge::Top
    } else {
        TaskbarEdge::Bottom
    };

    let (x, y) = match (edge, icon_rect.is_some()) {
        (_, false) => (work_right - width - margin, work_bottom - height - margin),
        (TaskbarEdge::Bottom, true) => (icon_center_x - width / 2.0, work_bottom - height - margin),
        (TaskbarEdge::Top, true) => (icon_center_x - width / 2.0, work_top + margin),
        (TaskbarEdge::Left, true) => (work_left + margin, icon_center_y - height / 2.0),
        (TaskbarEdge::Right, true) => (work_right - width - margin, icon_center_y - height / 2.0),
    };
    // Inside the work area, also when the icon is near a corner
    let x = x.clamp(
        work_left + margin,
        (work_right - width - margin).max(work_left + margin),
    );
    let y = y.clamp(
        work_top + margin,
        (work_bottom - height - margin).max(work_top + margin),
    );

    window
        .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
        .map_err(|err| err.to_string())
}

/// Pins the popover, so it stays open when another window is clicked (e.g. to drag files from File
/// Explorer), or restores the default
pub fn set_pinned(app_handle: &AppHandle, pinned: bool) {
    if let Some(state) = app_handle.try_state::<TrayPopoverState>() {
        state.is_pinned.store(pinned, Ordering::SeqCst);
    }
}

/// Resizes the popover, keeping it at the tray icon (e.g. growing upwards from a bottom taskbar).
/// The animation options are the macOS popover's.
pub fn resize_popover(
    app_handle: &AppHandle,
    width: f64,
    height: f64,
    _animate: Option<bool>,
    _blur_overlay_on_resize: Option<bool>,
) -> Result<(), String> {
    let Some(window) = app_handle.get_webview_window(TRAY_WINDOW_LABEL) else {
        return Ok(());
    };
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|err| err.to_string())?;
    if window.is_tray_popover_visible() {
        place_popover(&window)?;
    }
    Ok(())
}

/// Shows the progress in the tray icon, as a ring around the logo (see `tray_icon`), & in its
/// tooltip (e.g. "45%"), as Windows has no text beside tray icons. A progress of 0 removes it.
pub fn set_tray_progress(app_handle: &AppHandle, progress: f64) -> Result<(), String> {
    let Some(tray) = app_handle.tray_by_id(TRAY_WINDOW_LABEL) else {
        return Ok(());
    };
    if let Some(icon) = crate::win::tray_icon::icon_for_progress(progress) {
        tray.set_icon(Some(icon)).map_err(|err| err.to_string())?;
    }
    let tooltip = if progress <= 0.0 {
        "CompressO".to_string()
    } else {
        format!("CompressO - Compressing {}%", progress.round() as u32)
    };
    tray.set_tooltip(Some(tooltip))
        .map_err(|err| err.to_string())
}

/// The system's light or dark mode for apps, which the popover follows
fn system_theme() -> Theme {
    if crate::win::theme::apps_use_dark_mode() {
        Theme::Dark
    } else {
        Theme::Light
    }
}

fn create_tray_window(app_handle: &AppHandle) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(
        app_handle,
        TRAY_WINDOW_LABEL,
        WebviewUrl::App(TRAY_WINDOW_URL.into()),
    )
    .title("CompressO")
    .decorations(false)
    // Windows 11 draws it with rounded corners & a shadow, as its own flyouts
    .shadow(true)
    // So the Acrylic material shows through the page
    .transparent(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .focused(false)
    .inner_size(TRAY_WINDOW_WIDTH, TRAY_WINDOW_HEIGHT)
    .theme(Some(system_theme()))
    .build()
    .map_err(|err| err.to_string())?;

    // Windows' translucent material for flyouts (Acrylic), which blurs what is behind the popover &
    // follows its light or dark theme. Fails before Windows 11, where the page keeps a solid
    // background (see `TrayRoot`).
    if let Err(err) = window_vibrancy::apply_acrylic(&window, None) {
        log::warn!("Could not apply the tray window's material: {}", err);
    }

    // Hidden when another window is clicked, unless pinned
    let event_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            let app_handle = event_window.app_handle();
            let Some(state) = app_handle.try_state::<TrayPopoverState>() else {
                return;
            };
            if state.is_pinned.load(Ordering::SeqCst) || !event_window.is_tray_popover_visible() {
                return;
            }
            if let Ok(mut hidden_at) = state.hidden_at.lock() {
                *hidden_at = Some(Instant::now());
            }
            let _ = event_window.close_tray_popover();
        }
    });

    Ok(window)
}

/// Creates the tray window on another thread: called from synchronous commands, which run on the
/// main thread, where creating a webview deadlocks in Windows
fn create_tray_window_in_background(app_handle: &AppHandle) {
    let app_handle = app_handle.clone();
    std::thread::spawn(move || {
        if app_handle.get_webview_window(TRAY_WINDOW_LABEL).is_some() {
            return;
        }
        if let Err(err) = create_tray_window(&app_handle) {
            log::error!("Failed to create tray window: {}", err);
        }
    });
}

/// Creates the tray webview again if it is missing (e.g. suspended), while the tray icon is shown:
/// it compresses the drop zone's queue (see `drop_queue`)
pub fn ensure_tray_window(app_handle: &AppHandle) {
    if app_handle.tray_by_id(TRAY_WINDOW_LABEL).is_none()
        || app_handle.get_webview_window(TRAY_WINDOW_LABEL).is_some()
    {
        return;
    }
    create_tray_window_in_background(app_handle);
}

pub fn init(app: &App) {
    app.manage(TrayPopoverState::default());
    app.manage(crate::tauri_commands::tray::DroppedFilesState::default());
    app.manage(crate::tauri_commands::drop_queue::DropQueueState::default());
    crate::sys::clipboard_watch::init(app.handle());
}

/// Shows or removes the tray icon, which toggles the popover. Removing it also destroys the tray
/// window, so the app quits again when the main window is closed.
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

    // A right click shows the menu; a click opens the popover
    TrayIconBuilder::with_id(TRAY_WINDOW_LABEL)
        .icon(crate::win::tray_icon::plain_icon())
        .tooltip("CompressO")
        .menu(&crate::tauri_commands::tray::tray_icon_menu(app_handle)?)
        .show_menu_on_left_click(false)
        .on_menu_event(crate::tauri_commands::tray::handle_tray_icon_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app_handle = tray.app_handle();
                if let Some(state) = app_handle.try_state::<TrayPopoverState>() {
                    if let Ok(mut icon_rect) = state.icon_rect.lock() {
                        *icon_rect = Some(rect);
                    }
                }
                let window = match app_handle.get_webview_window(TRAY_WINDOW_LABEL) {
                    Some(window) => Some(window),
                    // The tray window was probably suspended -> create a new one
                    None => create_tray_window(app_handle)
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
    // White on a dark taskbar, near-black on a light one
    crate::win::tray_icon::watch_taskbar_theme(app_handle);

    if app_handle.get_webview_window(TRAY_WINDOW_LABEL).is_none() {
        create_tray_window_in_background(app_handle);
    }

    Ok(())
}

/// Destroys the tray webview window; a new one is created when the tray icon is clicked
pub fn destroy_tray_window(app_handle: &AppHandle) -> Result<(), String> {
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
