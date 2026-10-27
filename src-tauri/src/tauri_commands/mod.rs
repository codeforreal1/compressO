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

// The queue of the drop zone of the tray (the macOS menu bar or the Windows system tray), & of the
// watched folders (also on Linux, where the main window compresses it)
pub mod drop_queue;

#[cfg(any(target_os = "macos", windows))]
pub mod tray;
