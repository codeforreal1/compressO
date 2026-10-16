use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::sys::quit;

/// Restarts the app (e.g. to apply a setting read when it starts). Asks first while media is being
/// compressed or not saved yet, since a restart cannot be stopped once it is requested.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    match quit::quit_reason(&app) {
        Some(reason) => {
            let restart_app_handle = app.clone();
            quit::confirm_quit(&app, reason, move || restart_app_handle.request_restart());
        }
        None => app.request_restart(),
    }
}

/// "Prevent sleep while compressing" & "Keep the screen on" (Settings -> General), for the
/// compressions started from now on
#[tauri::command]
pub fn set_keep_awake_settings(prevent_sleep: bool, keep_display_on: bool) {
    crate::sys::keep_awake::set_settings(prevent_sleep, keep_display_on);
}

/// Passed to the app when the system opens it at login (see `tauri_plugin_autostart` in `main.rs`)
pub const OPENED_AT_LOGIN_ARG: &str = "--autostart";

/// Whether the first main window was already told how the app was opened
static IS_OPENED_AT_LOGIN_TAKEN: AtomicBool = AtomicBool::new(false);

/// Whether the system opened the app at login: true once, for the first main window only, so a
/// main window opened later (e.g. from the menu bar) is always shown
#[tauri::command]
pub fn take_opened_at_login() -> bool {
    !IS_OPENED_AT_LOGIN_TAKEN.swap(true, Ordering::SeqCst)
        && std::env::args().any(|arg| arg == OPENED_AT_LOGIN_ARG)
}

/// Whether the system opens the app at login (Settings -> General), as the system has it
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAtLoginState {
    is_enabled: bool,
    /// The login item is kept but switched off in the system's settings, which the app cannot
    /// switch on again (macOS: System Settings > General > Login Items > Allow in the Background)
    needs_approval: bool,
}

/// Read from the system each time, so it is right when changed outside the app (e.g. in the
/// system's login items): its login item, unless switched off there
#[tauri::command]
pub fn get_open_at_login(app: AppHandle) -> Result<OpenAtLoginState, String> {
    let has_login_item = app.autolaunch().is_enabled().map_err(|err| err.to_string())?;
    if !has_login_item {
        return Ok(OpenAtLoginState {
            is_enabled: false,
            needs_approval: false,
        });
    }

    // The login item's file is kept when it is switched off in System Settings
    #[cfg(target_os = "macos")]
    {
        let plist_path = dirs_login_item_path(&app);
        let status = crate::macos::bridge::ffi::loginItemStatus(plist_path);
        // 2: switched off, 0: not registered (removed), 1 or -1: allowed or unknown
        if status == 2 || status == 0 {
            return Ok(OpenAtLoginState {
                is_enabled: false,
                needs_approval: status == 2,
            });
        }
    }

    // Desktops switch it off in the file (`Hidden` or `X-GNOME-Autostart-enabled`), keeping it
    #[cfg(target_os = "linux")]
    if is_linux_autostart_disabled(&app) {
        return Ok(OpenAtLoginState {
            is_enabled: false,
            needs_approval: false,
        });
    }

    Ok(OpenAtLoginState {
        is_enabled: true,
        needs_approval: false,
    })
}

/// The launch agent `tauri_plugin_autostart` writes on macOS
#[cfg(target_os = "macos")]
fn dirs_login_item_path(app: &AppHandle) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!(
        "{}/Library/LaunchAgents/{}.plist",
        home,
        app.package_info().name
    )
}

/// Whether the autostart file `tauri_plugin_autostart` writes on Linux was switched off in it
#[cfg(target_os = "linux")]
fn is_linux_autostart_disabled(app: &AppHandle) -> bool {
    let config_dir = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|dir| !dir.is_empty())
        .unwrap_or_else(|| format!("{}/.config", std::env::var("HOME").unwrap_or_default()));
    let path = format!("{}/autostart/{}.desktop", config_dir, app.package_info().name);
    std::fs::read_to_string(path)
        .map(|content| {
            content.lines().any(|line| {
                let line = line.trim().to_lowercase().replace(' ', "");
                line == "hidden=true" || line == "x-gnome-autostart-enabled=false"
            })
        })
        .unwrap_or(false)
}

/// Opens the system's login items, where a login item switched off there is switched on again
#[tauri::command]
pub fn open_login_items_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.LoginItems-Settings.extension")
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_open_at_login(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    }
    .map_err(|err| err.to_string())
}
