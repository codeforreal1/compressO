pub mod dock;
pub mod ffmpeg;
pub mod ffprobe;
pub mod file_manager;
pub mod fs;
pub mod image;
pub mod media;
pub mod updater;

#[cfg(target_os = "linux")]
pub mod server;

#[cfg(target_os = "macos")]
pub mod tray;
