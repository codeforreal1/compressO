#![allow(unexpected_cfgs)]

//! Watches the clipboard: files copied anywhere (e.g. in Finder) are added to the media dropped on
//! the menu bar, as if they were dropped there. Optional & off by default (Settings -> Drop Zone ->
//! Watch clipboard, or the switch in the menu bar popover), only while the menu bar icon is shown.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::time::Duration;

use clipboard_rs::{Clipboard, ClipboardContext};
use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use tauri::{AppHandle, Emitter};

static IS_ENABLED: AtomicBool = AtomicBool::new(false);
/// Pasteboard change count already handled (or to ignore, like CompressO's own copies)
static HANDLED_CHANGE_COUNT: AtomicIsize = AtomicIsize::new(-1);

const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Increases whenever anything is copied; cheap to read, so the clipboard is only read on changes
fn pasteboard_change_count() -> isize {
    unsafe {
        let pasteboard: *mut Object = msg_send![class!(NSPasteboard), generalPasteboard];
        msg_send![pasteboard, changeCount]
    }
}

/// Sent to every window when watching is turned on or off, so all switches show the same
const CLIPBOARD_WATCH_EVENT: &str = "clipboard-watch-changed";

pub fn is_enabled() -> bool {
    IS_ENABLED.load(Ordering::SeqCst)
}

/// Starts or stops watching. What is already on the clipboard is ignored; only new copies count.
pub fn set_enabled(app_handle: &AppHandle, enabled: bool) {
    let was_enabled = IS_ENABLED.swap(enabled, Ordering::SeqCst);
    if enabled && !was_enabled {
        HANDLED_CHANGE_COUNT.store(pasteboard_change_count(), Ordering::SeqCst);
    }
    if enabled != was_enabled {
        let _ = app_handle.emit(CLIPBOARD_WATCH_EVENT, enabled);
    }
}

/// Call after CompressO itself copies to the clipboard (e.g. the compressed output), which must not
/// be added back as new media
pub fn ignore_current_change() {
    HANDLED_CHANGE_COUNT.store(pasteboard_change_count(), Ordering::SeqCst);
}

/// Starts the background watcher, which does nothing while disabled
pub fn init(app_handle: &AppHandle) {
    let app_handle = app_handle.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_INTERVAL);
        // Copied files go to the menu bar's dropped media, so only with the menu bar icon
        if !IS_ENABLED.load(Ordering::SeqCst)
            || app_handle
                .tray_by_id(crate::macos::tray_popover::TRAY_WINDOW_LABEL)
                .is_none()
        {
            continue;
        }

        let change_count = pasteboard_change_count();
        if HANDLED_CHANGE_COUNT.swap(change_count, Ordering::SeqCst) == change_count {
            continue;
        }
        // Only copied files: text, images copied from apps, etc. are not media files
        let Ok(files) = ClipboardContext::new().and_then(|ctx| ctx.get_files()) else {
            continue;
        };
        if files.is_empty() {
            continue;
        }
        let paths = files
            .into_iter()
            .map(|file| {
                tauri::Url::parse(&file)
                    .ok()
                    .and_then(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or(file)
            })
            .collect::<Vec<_>>();
        // Refused while compressing etc.; unsupported files are skipped
        let _ = crate::tauri_commands::tray::add_dropped_files(app_handle.clone(), paths);
    });
}
