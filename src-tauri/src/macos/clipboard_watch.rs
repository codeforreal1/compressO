#![allow(unexpected_cfgs)]

//! Watches the clipboard: files copied anywhere (e.g. in Finder) & copied images (e.g. in a browser)
//! are added to the media dropped on the menu bar, as if they were dropped there. Optional & off by default (Settings -> Drop Zone ->
//! Watch clipboard, or the switch in the menu bar popover), only while the menu bar icon is shown.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;
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

/// The copied image last saved as a file, with the pasteboard change count it was copied at, so the
/// same copy is saved once (e.g. watched, then pasted too)
static LAST_SAVED_IMAGE: Mutex<Option<(isize, String)>> = Mutex::new(None);

/// The media on the clipboard as paths: copied files (e.g. in Finder), or a copied image that is not
/// a file (e.g. in a browser), saved as one. Empty for anything else (e.g. text).
pub fn read_clipboard_media(app_handle: &AppHandle) -> Vec<String> {
    let Ok(ctx) = ClipboardContext::new() else {
        return Vec::new();
    };
    if let Ok(files) = ctx.get_files() {
        if !files.is_empty() {
            return files
                .into_iter()
                .map(|file| {
                    tauri::Url::parse(&file)
                        .ok()
                        .and_then(|url| url.to_file_path().ok())
                        .map(|path| path.to_string_lossy().to_string())
                        .unwrap_or(file)
                })
                .collect();
        }
    }

    let change_count = pasteboard_change_count();
    let Ok(mut last_saved) = LAST_SAVED_IMAGE.lock() else {
        return Vec::new();
    };
    if let Some((count, path)) = last_saved.as_ref() {
        if *count == change_count && std::path::Path::new(path).exists() {
            return vec![path.clone()];
        }
    }
    match crate::tauri_commands::fs::save_clipboard_image(app_handle, &ctx) {
        Ok(Some(path)) => {
            *last_saved = Some((change_count, path.clone()));
            vec![path]
        }
        _ => Vec::new(),
    }
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
        // Copied files & images only: text etc. is not media
        let paths = read_clipboard_media(&app_handle);
        if paths.is_empty() {
            continue;
        }
        // Unsupported files are skipped
        let _ = crate::tauri_commands::tray::add_dropped_files(app_handle.clone(), paths);
    });
}
