use tauri::{Theme, WebviewWindow};

/// Turns the tinted window on or off: the native translucent material behind the (then
/// semi-transparent) app background, like macOS' own windows. `dark` matches the material to the
/// app's theme, unless it follows the system's (`follows_system`), when the window is left to
/// follow it too, so its theme changes are still seen. **macOS & Windows 11 only** (Acrylic);
/// other platforms return an error.
#[tauri::command]
pub fn set_window_tint(
    window: WebviewWindow,
    enabled: bool,
    dark: bool,
    follows_system: bool,
) -> Result<(), String> {
    window
        .set_theme(if enabled && !follows_system {
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

/// Windows' translucent Acrylic material, as the tray popover's, which blurs what is behind the
/// window & follows its theme (set above). Before Windows 11 build 22523, Acrylic lags while the
/// window is moved or resized, so Mica (tinted by the desktop wallpaper) is used there instead.
#[cfg(windows)]
fn apply_window_tint(window: &WebviewWindow, enabled: bool, dark: bool) -> Result<(), String> {
    let has_system_acrylic = matches!(
        tauri_plugin_os::version(),
        tauri_plugin_os::Version::Semantic(10, 0, build) if build >= 22523
    );
    if enabled {
        if has_system_acrylic {
            window_vibrancy::apply_acrylic(window, None).map_err(|err| err.to_string())
        } else {
            // Fails before Windows 11
            window_vibrancy::apply_mica(window, Some(dark)).map_err(|err| err.to_string())
        }
    } else if has_system_acrylic {
        window_vibrancy::clear_acrylic(window).map_err(|err| err.to_string())
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

/// Whether the system is in dark mode, read from the system itself: a window set to a theme (see
/// `set_window_tint`) reports that theme instead. `None` where it is not read (Linux), where the
/// webview's own detection is used.
#[tauri::command]
pub fn get_system_dark_mode() -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        Some(macos_dark_mode())
    }
    #[cfg(windows)]
    {
        Some(crate::win::theme::apps_use_dark_mode())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        None
    }
}

/// macOS sets `AppleInterfaceStyle` to "Dark" while in dark mode (also when it changes on its own,
/// with "Auto"), & removes it in light mode
#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn macos_dark_mode() -> bool {
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSString;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let defaults: id = msg_send![class!(NSUserDefaults), standardUserDefaults];
        let key = NSString::alloc(nil).init_str("AppleInterfaceStyle");
        let style: id = msg_send![defaults, stringForKey: key];
        let _: () = msg_send![key, release];
        if style == nil {
            return false;
        }
        std::ffi::CStr::from_ptr(style.UTF8String())
            .to_str()
            .map(|style| style.eq_ignore_ascii_case("dark"))
            .unwrap_or(false)
    }
}
