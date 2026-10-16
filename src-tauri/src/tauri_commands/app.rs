use tauri::AppHandle;

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
