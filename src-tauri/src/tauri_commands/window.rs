use tauri::{Theme, WebviewWindow};

/// Turns the tinted window on or off: the native translucent material behind the (then
/// semi-transparent) app background, like macOS' own windows. `dark` matches the material to the
/// app's theme. **macOS & Windows 11 only** (Mica); other platforms return an error.
#[tauri::command]
pub fn set_window_tint(window: WebviewWindow, enabled: bool, dark: bool) -> Result<(), String> {
    window
        .set_theme(if enabled {
            Some(if dark { Theme::Dark } else { Theme::Light })
        } else {
            None
        })
        .map_err(|err| err.to_string())?;

    apply_window_tint(&window, enabled, dark)
}

#[cfg(target_os = "macos")]
fn apply_window_tint(window: &WebviewWindow, enabled: bool, _dark: bool) -> Result<(), String> {
    use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};

    // AppKit views can only be changed on the main thread
    let target_window = window.clone();
    window
        .run_on_main_thread(move || {
            // Cleared first, as applying again would stack another material view
            if let Err(err) = window_vibrancy::clear_vibrancy(&target_window) {
                log::error!("Failed to clear the window tint: {}", err);
            }
            if enabled {
                if let Err(err) = window_vibrancy::apply_vibrancy(
                    &target_window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::FollowsWindowActiveState),
                    None,
                ) {
                    log::error!("Failed to apply the window tint: {}", err);
                }
            }
        })
        .map_err(|err| err.to_string())
}

#[cfg(windows)]
fn apply_window_tint(window: &WebviewWindow, enabled: bool, dark: bool) -> Result<(), String> {
    if enabled {
        // Fails before Windows 11
        window_vibrancy::apply_mica(window, Some(dark)).map_err(|err| err.to_string())
    } else {
        window_vibrancy::clear_mica(window)
            .map(|_| ())
            .map_err(|err| err.to_string())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn apply_window_tint(_window: &WebviewWindow, _enabled: bool, _dark: bool) -> Result<(), String> {
    Err("The tinted window is not supported on this platform.".to_string())
}
