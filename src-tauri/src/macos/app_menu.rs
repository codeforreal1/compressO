//! The app menu (macOS menu bar at the top of the screen) with a "Settings…" item, which opens the
//! app's settings like other macOS apps do. Like Tauri's default menu, in the app's language (see
//! `native_text`).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{
    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
use tauri::{App, AppHandle, Emitter, Manager, Wry};

use crate::sys::native_text;
use crate::tauri_commands::tray::{focus_or_create_main_window, MAIN_WINDOW_LABEL};

const SETTINGS_MENU_ID: &str = "settings";
/// Handled by the main window, which opens its settings dialog
const OPEN_SETTINGS_EVENT: &str = "open-settings";

/// Set when the settings were requested while the main window was not ready (e.g. closed), so they
/// open once it is
static IS_OPEN_SETTINGS_PENDING: AtomicBool = AtomicBool::new(false);

/// Replaces the default app menu with one that also has "Settings…" (⌘,)
pub fn init(app: &App) -> tauri::Result<()> {
    app.set_menu(build(app.handle())?)?;
    app.on_menu_event(|app_handle, event| {
        if event.id() == SETTINGS_MENU_ID {
            open_settings(app_handle);
        }
    });
    Ok(())
}

/// Rebuilds the menu in the app's language, after it changed
pub fn update(app_handle: &AppHandle) -> tauri::Result<()> {
    app_handle.set_menu(build(app_handle)?)?;
    Ok(())
}

/// Tauri's default menu (see `Menu::default`), with "Settings…" & the texts of the app's language
fn build(app_handle: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let texts = native_text::get();
    let pkg_info = app_handle.package_info();
    let config = app_handle.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|publisher| vec![publisher]),
        ..Default::default()
    };
    let separator = || PredefinedMenuItem::separator(app_handle);

    let app_submenu = Submenu::with_items(
        app_handle,
        pkg_info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app_handle, Some(&texts.about_app), Some(about_metadata))?,
            &separator()?,
            // After "About CompressO" & its separator, as in other macOS apps
            &MenuItem::with_id(
                app_handle,
                SETTINGS_MENU_ID,
                &texts.settings,
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &separator()?,
            &PredefinedMenuItem::services(app_handle, Some(&texts.services))?,
            &separator()?,
            &PredefinedMenuItem::hide(app_handle, Some(&texts.hide_app))?,
            &PredefinedMenuItem::hide_others(app_handle, Some(&texts.hide_others))?,
            &separator()?,
            &PredefinedMenuItem::quit(app_handle, Some(&texts.quit_app))?,
        ],
    )?;
    let file_submenu = Submenu::with_items(
        app_handle,
        &texts.file,
        true,
        &[&PredefinedMenuItem::close_window(app_handle, Some(&texts.close_window))?],
    )?;
    let edit_submenu = Submenu::with_items(
        app_handle,
        &texts.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app_handle, Some(&texts.undo))?,
            &PredefinedMenuItem::redo(app_handle, Some(&texts.redo))?,
            &separator()?,
            &PredefinedMenuItem::cut(app_handle, Some(&texts.cut))?,
            &PredefinedMenuItem::copy(app_handle, Some(&texts.copy))?,
            &PredefinedMenuItem::paste(app_handle, Some(&texts.paste))?,
            &PredefinedMenuItem::select_all(app_handle, Some(&texts.select_all))?,
        ],
    )?;
    let view_submenu = Submenu::with_items(
        app_handle,
        &texts.view,
        true,
        &[&PredefinedMenuItem::fullscreen(app_handle, Some(&texts.full_screen))?],
    )?;
    // The ids make macOS list the windows here & add its help search
    let window_submenu = Submenu::with_id_and_items(
        app_handle,
        WINDOW_SUBMENU_ID,
        &texts.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app_handle, Some(&texts.minimize))?,
            &PredefinedMenuItem::maximize(app_handle, Some(&texts.zoom))?,
            &separator()?,
            &PredefinedMenuItem::close_window(app_handle, Some(&texts.close_window))?,
        ],
    )?;
    let help_submenu = Submenu::with_id_and_items(app_handle, HELP_SUBMENU_ID, &texts.help, true, &[])?;

    Menu::with_items(
        app_handle,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
            &help_submenu,
        ],
    )
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
