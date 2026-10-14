//! The app menu (macOS menu bar at the top of the screen) with a "Settings…" item, which opens the
//! app's settings like other macOS apps do

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::{App, AppHandle, Emitter, Manager};

use crate::tauri_commands::tray::{focus_or_create_main_window, MAIN_WINDOW_LABEL};

const SETTINGS_MENU_ID: &str = "settings";
/// Handled by the main window, which opens its settings dialog
const OPEN_SETTINGS_EVENT: &str = "open-settings";

/// Set when the settings were requested while the main window was not ready (e.g. closed), so they
/// open once it is
static IS_OPEN_SETTINGS_PENDING: AtomicBool = AtomicBool::new(false);

/// Replaces the default app menu with one that also has "Settings…" (⌘,)
pub fn init(app: &App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;

    // The first submenu is the app's own (About, Services, Hide, Quit, ...)
    if let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.into_iter().next() {
        let settings = MenuItem::with_id(
            app,
            SETTINGS_MENU_ID,
            "Settings…",
            true,
            Some("CmdOrCtrl+,"),
        )?;
        // After "About CompressO" & its separator, as in other macOS apps
        app_submenu.insert(&settings, 2)?;
        app_submenu.insert(&PredefinedMenuItem::separator(app)?, 3)?;
    }

    app.set_menu(menu)?;
    app.on_menu_event(|app_handle, event| {
        if event.id() == SETTINGS_MENU_ID {
            open_settings(app_handle);
        }
    });
    Ok(())
}

fn open_settings(app_handle: &AppHandle) {
    let has_main_window = app_handle.get_webview_window(MAIN_WINDOW_LABEL).is_some();
    if let Err(err) = focus_or_create_main_window(app_handle) {
        log::error!("Failed to open the main window for the settings: {}", err);
        return;
    }
    if has_main_window {
        let _ = app_handle.emit_to(MAIN_WINDOW_LABEL, OPEN_SETTINGS_EVENT, ());
    } else {
        // A new main window opens the settings once it is ready (see `on_frontend_ready`)
        IS_OPEN_SETTINGS_PENDING.store(true, Ordering::SeqCst);
    }
}

/// Opens the settings requested while the main window was not ready yet
pub fn on_frontend_ready(app_handle: &AppHandle) {
    if IS_OPEN_SETTINGS_PENDING.swap(false, Ordering::SeqCst) {
        let _ = app_handle.emit_to(MAIN_WINDOW_LABEL, OPEN_SETTINGS_EVENT, ());
    }
}
