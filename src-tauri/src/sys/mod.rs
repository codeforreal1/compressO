#[cfg(any(target_os = "macos", windows))]
pub mod clipboard_watch;
pub mod cli_install;
pub mod cli_ops;
pub mod cli_server;
pub mod cli_settings;
pub mod fs;
pub mod history;
pub mod keep_awake;
#[cfg(target_os = "linux")]
pub mod linux_clipboard;
pub mod logging;
pub mod native_text;
pub mod output_registry;
pub mod presets_bridge;
pub mod quit;
pub mod watch_folders;
pub mod watch_folders_bridge;
