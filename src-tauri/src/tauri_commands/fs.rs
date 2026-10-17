use std::path::PathBuf;

use clipboard_rs::{common::RustImage, Clipboard, ClipboardContext};
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_fs::FsExt;

use crate::core::{
    domain::{CollectedFile, FileMetadata},
    ffmpeg,
};
use crate::sys::fs::{self, collect_files};

#[tauri::command]
pub async fn get_file_metadata(file_path: &str) -> Result<FileMetadata, String> {
    fs::get_file_metadata(file_path)
}

#[tauri::command]
pub async fn get_image_dimension(image_path: &str) -> Result<(u32, u32), String> {
    fs::get_image_dimension(image_path)
}

#[tauri::command]
pub async fn get_svg_dimension(image_path: &str) -> Result<(u32, u32), String> {
    fs::get_svg_dimension(image_path)
}

#[tauri::command]
/// Moves a file without ever replacing an existing one: if `to` exists, a numbered name like
/// `clip (1).mp4` is used instead. Returns the path the file was saved to.
///
/// A failed or interrupted move never leaves a truncated file under the destination name.
pub async fn move_file(
    app_handle: tauri::AppHandle,
    from: &str,
    to: &str,
) -> Result<String, String> {
    let to = fs::get_available_path(&PathBuf::from(to), false);
    let parent = to.parent().map(|p| p.to_path_buf()).unwrap_or_default();

    // Destination folders may not exist yet, e.g. when mirroring a dropped folder's structure
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|err| err.to_string())?;

    // Same drive: an instant, atomic rename
    if tokio::fs::rename(from, &to).await.is_ok() {
        return Ok(allow_saved_file(&app_handle, &to));
    }

    // Different drive: copy to a temporary file first and only give it the real name once complete
    let temp_path = parent.join(format!(
        ".{}.part",
        to.file_name().unwrap_or_default().to_string_lossy()
    ));
    let copy_result = async {
        tokio::fs::copy(from, &temp_path).await?;
        tokio::fs::rename(&temp_path, &to).await
    }
    .await;
    if let Err(err) = copy_result {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(err.to_string());
    }

    // The output is saved; failing to clean up the cached copy isn't an error
    let _ = fs::delete_file(from).await;

    Ok(allow_saved_file(&app_handle, &to))
}

/// Lets the frontend load a saved file (e.g. to preview it), since the asset protocol scope only
/// covers the app data folder by default
fn allow_saved_file(app_handle: &AppHandle, path: &PathBuf) -> String {
    let _ = app_handle.fs_scope().allow_file(path);
    let _ = app_handle.asset_protocol_scope().allow_file(path);
    path.to_string_lossy().to_string()
}

/// First unused path for `path`, numbering it (`name (1)`) if it already exists
#[tauri::command]
pub async fn get_available_path(path: &str, is_dir: bool) -> Result<String, String> {
    Ok(fs::get_available_path(&PathBuf::from(path), is_dir)
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub async fn delete_file(path: &str) -> Result<(), String> {
    if let Err(err) = fs::delete_file(path).await {
        return Err(err.to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_cache(app: tauri::AppHandle) -> Result<(), String> {
    let ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    if let Err(err) = fs::delete_stale_files(&ffmpeg.get_asset_dir(), 0).await {
        return Err(err.to_string());
    }
    fs::reset_clipboard_dir(&app)?;
    Ok(())
}

#[tauri::command]
pub async fn copy_file_to_clipboard(_: tauri::AppHandle, file_path: &str) -> Result<(), String> {
    let ctx = ClipboardContext::new().map_err(|err| err.to_string())?;
    ctx.set_files(vec![file_path.to_owned()])
        .map_err(|err| err.to_string())?;
    // Not to be picked up as newly copied media
    #[cfg(any(target_os = "macos", windows))]
    crate::sys::clipboard_watch::ignore_current_change();
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFile {
    path: String,
    /// Name the file should be pasted with. Unsaved outputs live in the cache under generated
    /// names, so they're exposed under this name instead (the original file is kept as is).
    file_name: Option<String>,
}

/// Copies several files to the clipboard at once (e.g. all outputs of a batch)
#[tauri::command]
pub async fn copy_files_to_clipboard(
    app: tauri::AppHandle,
    files: Vec<ClipboardFile>,
) -> Result<(), String> {
    let clipboard_dir = fs::reset_clipboard_dir(&app)?;

    let mut file_paths = Vec::with_capacity(files.len());
    for file in files {
        match file.file_name {
            Some(file_name) => {
                let named_path = fs::link_file_with_name(&clipboard_dir, &file.path, &file_name)?;
                file_paths.push(named_path.to_string_lossy().to_string());
            }
            None => file_paths.push(file.path),
        }
    }

    let ctx = ClipboardContext::new().map_err(|err| err.to_string())?;
    ctx.set_files(file_paths).map_err(|err| err.to_string())?;
    // Not to be picked up as newly copied media
    #[cfg(any(target_os = "macos", windows))]
    crate::sys::clipboard_watch::ignore_current_change();
    Ok(())
}

#[tauri::command]
pub async fn read_files_from_clipboard(
    app_handle: tauri::AppHandle,
) -> Result<Vec<CollectedFile>, String> {
    let ctx = ClipboardContext::new().map_err(|err| err.to_string())?;

    let files_result = ctx.get_files();

    if let Ok(paths) = files_result {
        if !paths.is_empty() {
            return Ok(allow_asset_scopes(&app_handle, paths)?);
        }
    }

    // If no files found, try to get image from clipboard
    if let Some(image_path) = save_clipboard_image(&app_handle, &ctx)? {
        return Ok(vec![CollectedFile {
            path: image_path,
            relative_dir: String::new(),
        }]);
    }

    Err("No files or images found in clipboard".to_string())
}

/// Saves a copied image that is not a file (e.g. an image copied in a browser) as a PNG in the app's
/// assets, so it can be added like a file. Returns its path, or `None` without an image.
pub fn save_clipboard_image(
    app_handle: &AppHandle,
    ctx: &ClipboardContext,
) -> Result<Option<String>, String> {
    let Ok(img) = ctx.get_image() else {
        return Ok(None);
    };
    let assets_dir = fs::ensure_assets_dir(app_handle)?;

    let filename = format!("{}.png", nanoid::nanoid!());
    let image_path = assets_dir.join(&filename);
    let image_path = image_path.to_str().ok_or("Invalid image path")?.to_string();

    img.save_to_path(&image_path).map_err(|err| err.to_string())?;

    let fs_scope = app_handle.fs_scope();
    let asset_scope = app_handle.asset_protocol_scope();
    let _ = fs_scope.allow_file(&image_path);
    let _ = asset_scope.allow_file(&image_path);

    Ok(Some(image_path))
}

#[tauri::command]
pub async fn read_files_from_paths(
    app_handle: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<CollectedFile>, String> {
    Ok(allow_asset_scopes(&app_handle, paths)?)
}

/// Allow asset scopes to all the files within paths, recursing into folders
///
/// # Arguments
/// * `paths` - The file or directory paths to allow scopes
///
/// # Returns
/// The files where asset scopes are applied, with their folder relative to the given path. See
/// `@src-tauri/src/sys/fs.rs#collect_files`.
pub fn allow_asset_scopes(
    app_handle: &AppHandle,
    paths: Vec<String>,
) -> Result<Vec<CollectedFile>, String> {
    let fs_scope = app_handle.fs_scope();
    let asset_scope = app_handle.asset_protocol_scope();

    let mut all_files = Vec::new();

    for path in &paths {
        let path_buf: PathBuf = if path.starts_with("file://") {
            Url::parse(path)
                .map_err(|e| e.to_string())?
                .to_file_path()
                .map_err(|_| "Invalid file URL".to_string())?
        } else {
            PathBuf::from(path)
        };

        let files = collect_files(path_buf.to_str().unwrap()).map_err(|err| err.to_string())?;

        for file in &files {
            let _ = fs_scope.allow_file(&file.path);
            let _ = asset_scope.allow_file(&file.path);
        }

        all_files.extend(files);
    }

    Ok(all_files)
}
