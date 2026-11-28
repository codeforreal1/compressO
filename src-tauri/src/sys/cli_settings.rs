//! The settings the command line tool (`compresso`, see `src-tauri/cli`) works with: the presets
//! (with their save locations), the default presets, the output settings & the supported formats.
//! Kept in `cli-settings.json` in `app_data_dir` and updated both when the frontend syncs preset
//! metadata and whenever Rust `core::settings` updates domain settings headlessly.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::core::settings::DomainSettings;

pub const FILE_NAME: &str = "cli-settings.json";

static SETTINGS: Mutex<Option<Value>> = Mutex::new(None);

fn store_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join(FILE_NAME))
}

/// Loads `cli-settings.json` into memory at startup (upgrading pre-5.0 metadata such as
/// `outputExtensions` while keeping 4.x presets/defaults intact, or synthesizing one from
/// `core::contract` + `core::presets` + `core::settings` so CLI/MCP works before any WebView mounts).
pub fn load_from_disk(app_handle: &AppHandle) {
    if let Some(path) = store_path(app_handle) {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(mut parsed) = serde_json::from_str::<Value>(&raw) {
                let upgraded = crate::core::contract::upgrade_legacy_cli_settings(&mut parsed);
                if let Ok(mut stored) = SETTINGS.lock() {
                    if stored.is_none() || upgraded {
                        *stored = Some(parsed.clone());
                    }
                }
                if upgraded {
                    if let Ok(text) = serde_json::to_string_pretty(&parsed) {
                        if let Err(err) = write_atomically(&path, &text) {
                            log::warn!(
                                "[cli] Could not write upgraded command line settings: {}",
                                err
                            );
                        }
                    }
                }
                return;
            }
        }
    }
    let presets_data = crate::core::presets::get(app_handle);
    let domain = crate::core::settings::get(app_handle);
    crate::core::contract::sync_cli_settings_from_core(app_handle, &presets_data, &domain);
}

/// Keeps the settings sent by the frontend, & writes them to `cli-settings.json`
#[tauri::command]
pub fn sync_cli_settings(app_handle: AppHandle, settings: Value) {
    let text = serde_json::to_string_pretty(&settings).ok();
    if let Ok(mut stored) = SETTINGS.lock() {
        if stored.as_ref() == Some(&settings) {
            return;
        }
        *stored = Some(settings);
    }
    let (Some(text), Some(path)) = (text, store_path(&app_handle)) else {
        return;
    };
    if let Err(err) = write_atomically(&path, &text) {
        log::error!("[cli] Could not save the command line settings: {}", err);
    }
}

/// Mirrors updates from `core::settings` (`output`, `watchedFolders`, `showMenuBarIcon`) into
/// `cli-settings.json` so offline reads and headless CLI/MCP runs stay synchronized even with no
/// WebView open.
pub fn patch_from_domain_settings(app_handle: &AppHandle, domain: &DomainSettings) {
    let watched: Vec<Value> = domain
        .watched_folders
        .iter()
        .map(|folder| {
            let pids = folder.preset_ids.as_ref();
            json!({
                "id": folder.id,
                "path": folder.path,
                "isEnabled": folder.is_enabled,
                "presetIds": {
                    "video": pids.and_then(|p| p.video.as_deref()).unwrap_or("default"),
                    "image": pids.and_then(|p| p.image.as_deref()).unwrap_or("default"),
                    "audio": pids.and_then(|p| p.audio.as_deref()).unwrap_or("default"),
                }
            })
        })
        .collect();

    let updated_text = {
        let Ok(mut stored) = SETTINGS.lock() else {
            return;
        };
        let Some(current) = stored.as_mut() else {
            return;
        };
        let Some(root) = current.as_object_mut() else {
            return;
        };
        root.insert(
            String::from("output"),
            json!({
                "skipLargerOutputs": !domain.save_larger_outputs,
                "preserveFolderStructure": domain.preserve_folder_structure,
                "replaceOriginalFiles": domain.replace_original_files,
                "useHardwareAcceleration": domain.use_hardware_acceleration,
                "reachTargetSizesWithoutAcceleration": domain.retry_target_size_on_cpu,
            }),
        );
        root.insert(String::from("watchedFolders"), Value::Array(watched));
        root.insert(
            String::from("showMenuBarIcon"),
            Value::Bool(domain.show_menu_bar_icon),
        );
        serde_json::to_string_pretty(current).ok()
    };

    if let (Some(text), Some(path)) = (updated_text, store_path(app_handle)) {
        if let Err(err) = write_atomically(&path, &text) {
            log::error!("[cli] Could not mirror domain settings to cli-settings.json: {}", err);
        }
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

/// The settings cached in memory (from disk or synced by the frontend)
pub fn get() -> Option<Value> {
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
