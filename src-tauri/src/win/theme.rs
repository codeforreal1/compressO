//! The system's light & dark modes (Settings -> Personalization -> Colors), read from Windows itself:
//! the webview's own detection can report light in dark mode.

/// Whether apps use dark mode, which the tray popover follows
pub fn apps_use_dark_mode() -> bool {
    personalize_setting("AppsUseLightTheme") == Some(0)
}

/// Whether Windows itself (the taskbar, so the tray icons) uses dark mode. Dark when unknown, as
/// the taskbar of Windows 10 is.
pub fn taskbar_uses_dark_mode() -> bool {
    personalize_setting("SystemUsesLightTheme") != Some(1)
}

fn personalize_setting(name: &str) -> Option<u32> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
    let value = wide(name);
    let mut data: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut data as *mut u32 as *mut std::ffi::c_void,
            &mut size,
        )
    };
    (status == 0).then_some(data)
}
