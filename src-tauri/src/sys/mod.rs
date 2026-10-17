#[cfg(any(target_os = "macos", windows))]
pub mod clipboard_watch;
pub mod fs;
pub mod keep_awake;
pub mod logging;
pub mod quit;
