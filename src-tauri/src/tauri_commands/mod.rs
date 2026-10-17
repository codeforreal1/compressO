pub mod app;
pub mod compression_status;
pub mod dock;
pub mod ffmpeg;
pub mod ffprobe;
pub mod file_manager;
pub mod fs;
pub mod hardware_encoder;
pub mod image;
pub mod media;
pub mod sound;
pub mod updater;
pub mod window;

#[cfg(target_os = "linux")]
pub mod server;

// The drop zone of the tray (the macOS menu bar or the Windows system tray)
#[cfg(any(target_os = "macos", windows))]
pub mod drop_queue;

#[cfg(any(target_os = "macos", windows))]
pub mod tray;
