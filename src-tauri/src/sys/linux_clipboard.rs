//! Reads the clipboard on Linux through GTK, which reads it as the desktop serves it: from Wayland
//! or X11. The clipboard library reads it through X11 only, which under Wayland sees no copied files
//! (and can lag behind new copies), and on X11 could return an earlier copy.

use std::sync::mpsc;
use std::time::Duration;

use tauri::AppHandle;

/// How long the desktop may take to hand over the clipboard
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// The media on the clipboard as paths: copied files or folders (e.g. in a file manager), or a
/// copied image that is not a file (e.g. in a browser), saved as a PNG in the app's assets. Empty
/// for anything else (e.g. text).
pub fn read_clipboard_media(app_handle: &AppHandle) -> Result<Vec<String>, String> {
    let assets_dir = crate::sys::fs::ensure_assets_dir(app_handle)?;
    let (sender, receiver) = mpsc::channel();
    // GTK is used on its own thread only
    app_handle
        .run_on_main_thread(move || {
            let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
            let _ = sender.send(read_media(&clipboard, &assets_dir));
        })
        .map_err(|err| err.to_string())?;
    receiver
        .recv_timeout(READ_TIMEOUT)
        .map_err(|_| "The clipboard could not be read".to_string())?
}

fn read_media(
    clipboard: &gtk::Clipboard,
    assets_dir: &std::path::Path,
) -> Result<Vec<String>, String> {
    // Copied files, as file URLs
    let files: Vec<String> = clipboard
        .wait_for_uris()
        .iter()
        .filter_map(|uri| crate::tauri_commands::fs::clipboard_entry_to_path(uri))
        .collect();
    if !files.is_empty() {
        return Ok(files);
    }

    // Some file managers only offer the files' paths as text, one per line
    if let Some(text) = clipboard.wait_for_text() {
        return Ok(paths_in_text(&text));
    }

    // A copied image that is not a file
    if let Some(image) = clipboard.wait_for_image() {
        let image_path = assets_dir.join(format!("{}.png", nanoid::nanoid!()));
        image
            .savev(&image_path, "png", &[])
            .map_err(|err| err.to_string())?;
        return Ok(vec![image_path.to_string_lossy().to_string()]);
    }

    Ok(Vec::new())
}

/// The text as paths, when every line of it is an existing file or folder (so copied text that is
/// not only paths is never taken for files)
fn paths_in_text(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in text.lines() {
        let Some(path) = crate::tauri_commands::fs::clipboard_entry_to_path(line) else {
            continue;
        };
        if !(path.starts_with('/') && std::path::Path::new(&path).exists()) {
            return Vec::new();
        }
        paths.push(path);
    }
    paths
}

/// Copies files to the clipboard as file managers do, so they can be pasted there (or in other
/// apps): as file URLs, as GNOME's copied files & as their paths. GTK hands them out while the app
/// runs, and to the clipboard manager (if any), which keeps them after it quits.
pub fn write_files(app_handle: &AppHandle, paths: Vec<String>) -> Result<(), String> {
    let uris: Vec<String> = paths
        .iter()
        .map(|path| {
            tauri::Url::from_file_path(path)
                .map(|url| url.to_string())
                .map_err(|_| format!("Invalid path: {path}"))
        })
        .collect::<Result<_, _>>()?;
    let (sender, receiver) = mpsc::channel();
    app_handle
        .run_on_main_thread(move || {
            let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
            let targets = [
                gtk::TargetEntry::new("x-special/gnome-copied-files", gtk::TargetFlags::empty(), 0),
                gtk::TargetEntry::new("text/uri-list", gtk::TargetFlags::empty(), 1),
                gtk::TargetEntry::new("UTF8_STRING", gtk::TargetFlags::empty(), 2),
                gtk::TargetEntry::new("text/plain;charset=utf-8", gtk::TargetFlags::empty(), 2),
                gtk::TargetEntry::new("text/plain", gtk::TargetFlags::empty(), 2),
            ];
            let is_set = clipboard.set_with_data(&targets, move |_, selection, info| {
                let data = match info {
                    0 => format!("copy\n{}", uris.join("\n")),
                    1 => format!("{}\r\n", uris.join("\r\n")),
                    _ => paths.join("\n"),
                };
                selection.set(&selection.target(), 8, data.as_bytes());
            });
            if is_set {
                // Kept by the clipboard manager, also once the app quits
                clipboard.store();
            }
            let _ = sender.send(is_set);
        })
        .map_err(|err| err.to_string())?;
    match receiver.recv_timeout(READ_TIMEOUT) {
        Ok(true) => Ok(()),
        _ => Err("The files could not be copied".to_string()),
    }
}
