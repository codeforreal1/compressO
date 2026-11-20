//! Changes to the watched folders asked for by the command line (see `cli_server`): the folders are
//! kept by the frontend (`localStorage`), so the app's windows are asked to change them, & one of
//! them answers once the change is applied (see `useWatchedFoldersCommand`).
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::core::domain::CustomEvents;

/// How long the command line waits for a window to apply a change
const ANSWER_TIMEOUT: Duration = Duration::from_secs(10);
/// How long before the event is sent again (a window may still be loading its frontend)
const RETRY_INTERVAL: Duration = Duration::from_millis(500);

/// A change to one of the watched folders' presets, by media type; omitted ones stay unchanged
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PresetChanges {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<String>,
}

/// A change to the watched folders, sent to the frontend (see `useWatchedFoldersCommand`)
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum WatchFolderCommand {
    #[serde(rename = "addWatchedFolder")]
    Add {
        path: String,
        #[serde(rename = "isEnabled", skip_serializing_if = "Option::is_none")]
        is_enabled: Option<bool>,
        #[serde(rename = "presetIds", skip_serializing_if = "Option::is_none")]
        preset_ids: Option<PresetChanges>,
    },
    #[serde(rename = "updateWatchedFolder")]
    Update {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(rename = "isEnabled", skip_serializing_if = "Option::is_none")]
        is_enabled: Option<bool>,
        #[serde(rename = "presetIds", skip_serializing_if = "Option::is_none")]
        preset_ids: Option<PresetChanges>,
    },
    #[serde(rename = "removeWatchedFolder")]
    Remove {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
}

type PendingRequests = Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>;

fn pending() -> &'static PendingRequests {
    static PENDING: OnceLock<PendingRequests> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

/// Sends a change to a window & waits until it answers with the folders as they are now
pub async fn forward(
    app_handle: &AppHandle,
    mut command: WatchFolderCommand,
) -> Result<Value, String> {
    if let WatchFolderCommand::Add { path, .. } = &mut command {
        match normalized_folder_path(path) {
            Ok(normalized) => *path = normalized,
            Err((code, message)) => {
                return Ok(json!({ "ok": false, "code": code, "message": message }));
            }
        }
    }

    let request_id = nanoid::nanoid!();
    let (sender, mut receiver) = tokio::sync::oneshot::channel();
    {
        let mut requests = pending()
            .lock()
            .map_err(|_| "CompressO could not change its watched folders.".to_string())?;
        requests.insert(request_id.clone(), sender);
    }

    // One window answers for the whole request: sending it to another while this one is still
    // applying it would change the folders twice (e.g. while the tray window is being created)
    let Some(window) = target_window(app_handle) else {
        if let Ok(mut requests) = pending().lock() {
            requests.remove(&request_id);
        }
        return Err(String::from(
            "Open CompressO once, then try again. It has no window to change its watched folders.",
        ));
    };
    let payload = json!({ "requestId": request_id, "command": command });
    let deadline = Instant::now() + ANSWER_TIMEOUT;
    let result = loop {
        if let Err(err) = app_handle.emit_to(
            window,
            CustomEvents::WatchedFoldersCommand.as_ref(),
            &payload,
        ) {
            log::warn!("[watched-folders] Could not ask {}: {}", window, err);
            break Err(
                "CompressO closed the window before changing its watched folders.".to_string(),
            );
        }
        match tokio::time::timeout(RETRY_INTERVAL, &mut receiver).await {
            Ok(Ok(result)) => break Ok(result),
            Ok(Err(_)) => {
                break Err(
                    "CompressO closed the window before changing its watched folders.".to_string(),
                );
            }
            Err(_) if Instant::now() >= deadline => {
                break Err(
                    "CompressO did not answer. Open CompressO once, then try again.".to_string(),
                );
            }
            Err(_) => {}
        }
    };

    if let Ok(mut requests) = pending().lock() {
        requests.remove(&request_id);
    }
    result
}

/// The window that keeps & compresses the watched folders: the menu bar / tray window where there
/// is one, otherwise the main window
fn target_window(app_handle: &AppHandle) -> Option<&'static str> {
    #[cfg(any(target_os = "macos", windows))]
    if app_handle
        .get_webview_window(crate::tray_popover::TRAY_WINDOW_LABEL)
        .is_some()
    {
        return Some(crate::tray_popover::TRAY_WINDOW_LABEL);
    }
    if app_handle.get_webview_window("main").is_some() {
        return Some("main");
    }
    None
}

/// A folder to watch: an existing, readable folder that is not a filesystem root, with a trailing
/// separator removed (the path as the user chose it is kept, not a Windows `\\?\` path)
fn normalized_folder_path(path: &str) -> Result<String, (&'static str, String)> {
    let path = path.trim();
    if path.is_empty() {
        return Err(("invalidRequest", String::from("Give the folder to watch.")));
    }
    let folder = Path::new(path);
    if !folder.is_absolute() {
        return Err((
            "invalidRequest",
            String::from("Use an absolute path for the folder to watch."),
        ));
    }
    if folder.parent().is_none() {
        return Err((
            "rootFolder",
            String::from("Watching a filesystem root is not supported. Choose a folder inside it."),
        ));
    }
    match std::fs::metadata(folder) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => {
            return Err((
                "missingFolder",
                format!("{} is not a folder.", folder.display()),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err((
                "missingFolder",
                format!("The folder {} does not exist.", folder.display()),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err((
                "accessDenied",
                format!(
                    "CompressO cannot read {}. Allow it access in the system's settings.",
                    folder.display()
                ),
            ));
        }
        Err(error) => {
            return Err((
                "invalidRequest",
                format!("CompressO cannot read {}: {}", folder.display(), error),
            ));
        }
    }
    if let Err(error) = std::fs::read_dir(folder) {
        let code = if error.kind() == std::io::ErrorKind::PermissionDenied {
            "accessDenied"
        } else {
            "invalidRequest"
        };
        return Err((
            code,
            format!("CompressO cannot read {}: {}", folder.display(), error),
        ));
    }
    Ok(folder
        .to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .to_string())
}

/// Answers a change asked for by the command line (see `forward`), from the window that applied it
#[tauri::command]
pub fn complete_watched_folders_command(request_id: String, result: Value) {
    let Some(sender) = pending()
        .lock()
        .ok()
        .and_then(|mut requests| requests.remove(&request_id))
    else {
        return;
    };
    let _ = sender.send(result);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_an_existing_folder() {
        let folder = std::env::temp_dir();
        let path = format!("{}{}", folder.display(), std::path::MAIN_SEPARATOR);
        let normalized = normalized_folder_path(&path).unwrap();
        assert_eq!(
            normalized,
            folder.to_string_lossy().trim_end_matches(['/', '\\'])
        );
    }

    #[test]
    fn rejects_a_filesystem_root() {
        #[cfg(unix)]
        assert_eq!(normalized_folder_path("/").unwrap_err().0, "rootFolder");
        #[cfg(windows)]
        assert_eq!(normalized_folder_path("C:\\").unwrap_err().0, "rootFolder");
    }

    #[test]
    fn serializes_the_commands_the_frontend_expects() {
        let command = WatchFolderCommand::Add {
            path: String::from("/Users/me/Movies"),
            is_enabled: Some(false),
            preset_ids: Some(PresetChanges {
                video: Some(String::from("default")),
                image: None,
                audio: None,
            }),
        };
        assert_eq!(
            serde_json::to_value(command).unwrap(),
            json!({
                "type": "addWatchedFolder",
                "path": "/Users/me/Movies",
                "isEnabled": false,
                "presetIds": { "video": "default" },
            })
        );
    }

    #[test]
    fn reads_the_presets_the_command_line_sends() {
        let changes: PresetChanges = serde_json::from_value(json!({
            "image": "web",
            "audio": "default",
        }))
        .unwrap();
        assert_eq!(changes.image.as_deref(), Some("web"));
        assert_eq!(changes.audio.as_deref(), Some("default"));
        assert!(changes.video.is_none());
    }
}
