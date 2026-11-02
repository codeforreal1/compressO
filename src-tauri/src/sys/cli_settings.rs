//! The settings the command line tool (`compresso`, see `src-tauri/cli`) works with: the presets
//! (with their save locations), the default presets, the output settings & the supported formats.
//! They are kept by the frontend (`localStorage`), which sends them here when the app starts & each
//! time they change. They are kept for the command line jobs (see `cli_server`), & written to
//! `cli-settings.json` in the app's data folder, so the command line can list the presets without
//! starting the app. Only the app changes them, so the file is always up to date.
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

pub const FILE_NAME: &str = "cli-settings.json";

static SETTINGS: Mutex<Option<serde_json::Value>> = Mutex::new(None);

/// Keeps the settings sent by the frontend, & writes them to `cli-settings.json`
#[tauri::command]
pub fn sync_cli_settings(app_handle: AppHandle, settings: serde_json::Value) {
    let text = serde_json::to_string_pretty(&settings).ok();
    if let Ok(mut stored) = SETTINGS.lock() {
        if stored.as_ref() == Some(&settings) {
            return;
        }
        *stored = Some(settings);
    }
    let (Some(text), Ok(directory)) = (text, app_handle.path().app_data_dir()) else {
        return;
    };
    if let Err(err) = write_atomically(&directory.join(FILE_NAME), &text) {
        log::error!("[cli] Could not save the command line settings: {}", err);
    }
}

/// Written next to the file & renamed over it, so the command line never reads half a file
fn write_atomically(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory)?;
    }
    let temporary: PathBuf = path.with_extension("json.tmp");
    std::fs::write(&temporary, text)?;
    std::fs::rename(&temporary, path)
}

/// The settings, once the frontend has sent them
pub fn get() -> Option<serde_json::Value> {
    SETTINGS.lock().ok().and_then(|settings| settings.clone())
}

/// The media type of a file by its extension (`video`, `image` or `audio`), as the frontend's
/// queue has it: audio formats first, then images, then videos. `None` when not supported.
pub fn media_type(path: &str) -> Option<&'static str> {
    let extension = Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_lowercase();
    let settings = get()?;
    let has = |media_type: &str| {
        settings["extensions"][media_type]
            .as_array()
            .is_some_and(|extensions| {
                extensions
                    .iter()
                    .any(|value| value.as_str() == Some(extension.as_str()))
            })
    };
    ["audio", "image", "video"]
        .into_iter()
        .find(|media_type| has(media_type))
}
