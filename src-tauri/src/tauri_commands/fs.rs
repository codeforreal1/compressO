use std::path::{Path, PathBuf};

#[cfg(not(target_os = "linux"))]
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
pub async fn get_image_dimension(app: AppHandle, image_path: &str) -> Result<(u32, u32), String> {
    if crate::core::image_codecs::is_modern(&crate::core::image_codecs::extension(image_path)) {
        // Keep the decoder future out of Tauri's IPC dispatch stack on Windows.
        let path = Box::pin(crate::core::image_codecs::decoded_png(
            &app,
            image_path,
            "main",
            &[],
        ))
        .await?;
        return fs::get_image_dimension(path.to_str().ok_or("Invalid cache path")?);
    }
    fs::get_image_dimension(image_path)
}

#[tauri::command]
pub async fn get_svg_dimension(image_path: &str) -> Result<(u32, u32), String> {
    fs::get_svg_dimension(image_path)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveFileResult {
    pub path: String,
    pub replaced_original: bool,
}

#[tauri::command]
/// Moves a file without ever replacing an existing one: if `to` exists, a numbered name like
/// `clip (1).mp4` is used instead. Returns where the file was saved and whether an original was
/// replaced.
///
/// With `replace_original` (the original of the output), when `to` is in the same folder with
/// the same name (ignoring extension), the original is moved to the Trash & the output is saved in
/// its place (Settings -> Output -> Replace original files). If trashing fails or another file
/// already uses `to`, a numbered name is used instead, so no existing file is lost.
///
/// A failed or interrupted move never leaves a truncated file under the destination name.
pub async fn move_file(
    app_handle: tauri::AppHandle,
    from: &str,
    to: &str,
    replace_original: Option<String>,
) -> Result<MoveFileResult, String> {
    let requested = PathBuf::from(to);
    if let Some(original) = replace_original {
        let original_path = Path::new(&original);
        if should_replace_original(&requested, original_path).await {
            // Not moved at all on an error, so it is saved as usual below
            match replace_file(from, &requested, original_path).await {
                Ok(outcome) => {
                    return Ok(MoveFileResult {
                        path: allow_saved_file(&app_handle, &outcome.path),
                        replaced_original: outcome.replaced_original,
                    })
                }
                Err(err) => log::error!(
                    "[save] Could not move the output beside {}: {}",
                    requested.display(),
                    err
                ),
            }
        }
    }

    let to = fs::get_available_path(&requested, false);
    let parent = to.parent().map(|p| p.to_path_buf()).unwrap_or_default();

    // Destination folders may not exist yet, e.g. when mirroring a dropped folder's structure. Only
    // created when missing: creating an existing folder can fail on some drives (e.g. "Access is
    // denied" for a top-level folder of a network drive), which would fail the save.
    let parent_exists = tokio::fs::metadata(&parent)
        .await
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false);
    if !parent_exists {
        if let Err(err) = tokio::fs::create_dir_all(&parent).await {
            log::error!("[save] Could not create {}: {}", parent.display(), err);
            return Err(err.to_string());
        }
    }

    if let Err(err) = move_into(from, &to).await {
        log::error!(
            "[save] Could not save {} to {}: {}",
            from,
            to.display(),
            err
        );
        return Err(err.to_string());
    }
    Ok(MoveFileResult {
        path: allow_saved_file(&app_handle, &to),
        replaced_original: false,
    })
}

/// Moves `from` to `to`, which must not exist: an instant rename on the same drive, otherwise a copy
/// to a temporary file given the real name once complete (the cached copy is then deleted)
async fn move_into(from: &str, to: &Path) -> std::io::Result<()> {
    if tokio::fs::rename(from, to).await.is_ok() {
        return Ok(());
    }
    let parent = to.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let temp_path = parent.join(format!(
        ".{}.part",
        to.file_name().unwrap_or_default().to_string_lossy()
    ));
    let copy_result = async {
        tokio::fs::copy(from, &temp_path).await?;
        tokio::fs::rename(&temp_path, to).await
    }
    .await;
    if let Err(err) = copy_result {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(err);
    }
    // The output is saved; failing to clean up the cached copy isn't an error
    let _ = fs::delete_file(from).await;
    Ok(())
}

/// Whether `requested` is in the same folder as `original` with the same name (ignoring
/// extension), and `original` is an existing file
async fn should_replace_original(requested: &Path, original: &Path) -> bool {
    let original_exists = tokio::fs::metadata(original)
        .await
        .map(|metadata| metadata.is_file())
        .unwrap_or(false);
    if !original_exists {
        return false;
    }

    let (Some(req_stem), Some(orig_stem)) = (requested.file_stem(), original.file_stem()) else {
        return false;
    };
    let same_stem = if cfg!(target_os = "linux") {
        req_stem == orig_stem
    } else {
        req_stem.to_string_lossy().to_lowercase() == orig_stem.to_string_lossy().to_lowercase()
    };
    if !same_stem {
        return false;
    }

    fn parent_or_dot(path: &Path) -> Option<&Path> {
        path.parent()
            .map(|p| if p.as_os_str().is_empty() { Path::new(".") } else { p })
    }
    let (Some(req_parent), Some(orig_parent)) =
        (parent_or_dot(requested), parent_or_dot(original))
    else {
        return false;
    };
    match (
        tokio::fs::canonicalize(req_parent).await,
        tokio::fs::canonicalize(orig_parent).await,
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

struct ReplaceOutcome {
    path: PathBuf,
    replaced_original: bool,
}

/// Puts the output (`from`) in place of `original`, which goes to the Trash, & returns where the
/// output was saved and whether `original` was trashed. The output is first moved next to it under
/// a hidden name, so the original is only trashed once the output is there; if trashing fails or
/// another file already uses `requested`, the output gets a numbered name instead. An error means
/// the output was not moved.
async fn replace_file(
    from: &str,
    requested: &Path,
    original: &Path,
) -> Result<ReplaceOutcome, String> {
    replace_file_with(from, requested, original, |original_path| async move {
        tokio::task::spawn_blocking(move || move_to_trash(&original_path))
            .await
            .map_err(|e| e.to_string())
            .and_then(|result| result)
    })
    .await
}

async fn replace_file_with<F, Fut>(
    from: &str,
    requested: &Path,
    original: &Path,
    trash_fn: F,
) -> Result<ReplaceOutcome, String>
where
    F: FnOnce(PathBuf) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let parent = requested.parent().ok_or("No parent folder")?;
    let staged = fs::get_available_path(
        &parent.join(format!(
            ".{}.compresso",
            requested.file_name().unwrap_or_default().to_string_lossy()
        )),
        false,
    );
    move_into(from, &staged).await.map_err(|e| e.to_string())?;

    let replaced_original = match trash_fn(original.to_path_buf()).await {
        Ok(()) => true,
        Err(err) => {
            log::error!(
                "[save] Could not move {} to the Trash: {}",
                original.display(),
                err
            );
            false
        }
    };
    let destination = fs::get_available_path(requested, false);
    match tokio::fs::rename(&staged, &destination).await {
        Ok(()) => Ok(ReplaceOutcome {
            path: destination,
            replaced_original,
        }),
        Err(err) => {
            // Still saved, under its hidden name, rather than lost
            log::error!(
                "[save] Could not rename {} to {}: {}",
                staged.display(),
                destination.display(),
                err
            );
            Ok(ReplaceOutcome {
                path: staged,
                replaced_original,
            })
        }
    }
}

fn move_to_trash(path: &Path) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut context = trash::TrashContext::default();
    // Without asking Finder, which would need the Automation permission
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    context.delete(path).map_err(|e| e.to_string())
}

/// Lets the frontend load a saved file (e.g. to preview it), since the asset protocol scope only
/// covers the app data folder by default
fn allow_saved_file(app_handle: &AppHandle, path: &PathBuf) -> String {
    // Remembered, so a watched folder never compresses it again (see `output_registry`)
    crate::sys::output_registry::remember(app_handle, path);
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
pub async fn copy_file_to_clipboard(app: tauri::AppHandle, file_path: &str) -> Result<(), String> {
    // Linux copies through GTK, which keeps handing the files out (see `sys/linux_clipboard.rs`)
    #[cfg(target_os = "linux")]
    {
        let file_path = file_path.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            crate::sys::linux_clipboard::write_files(&app, vec![file_path])
        })
        .await
        .map_err(|err| err.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        let ctx = ClipboardContext::new().map_err(|err| err.to_string())?;
        ctx.set_files(vec![file_path.to_owned()])
            .map_err(|err| err.to_string())?;
        // Not to be picked up as newly copied media
        crate::sys::clipboard_watch::ignore_current_change();
        Ok(())
    }
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

    // Linux copies through GTK, which keeps handing the files out (see `sys/linux_clipboard.rs`)
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            crate::sys::linux_clipboard::write_files(&app, file_paths)
        })
        .await
        .map_err(|err| err.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let ctx = ClipboardContext::new().map_err(|err| err.to_string())?;
        ctx.set_files(file_paths).map_err(|err| err.to_string())?;
        // Not to be picked up as newly copied media
        crate::sys::clipboard_watch::ignore_current_change();
        Ok(())
    }
}

#[tauri::command]
pub async fn read_files_from_clipboard(
    app_handle: tauri::AppHandle,
) -> Result<Vec<CollectedFile>, String> {
    // Linux reads the clipboard through GTK, as the desktop serves it (Wayland or X11)
    #[cfg(target_os = "linux")]
    {
        let app = app_handle.clone();
        let paths = tauri::async_runtime::spawn_blocking(move || {
            crate::sys::linux_clipboard::read_clipboard_media(&app)
        })
        .await
        .map_err(|err| err.to_string())??;
        if paths.is_empty() {
            return Err("No files or images found in clipboard".to_string());
        }
        return allow_asset_scopes(&app_handle, paths);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let ctx = ClipboardContext::new().map_err(|err| err.to_string())?;

        let paths = clipboard_file_paths(&ctx);
        if !paths.is_empty() {
            return allow_asset_scopes(&app_handle, paths);
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
}

/// The files copied to the clipboard (e.g. in a file manager) as paths. macOS & Windows give
/// paths; file URLs (`file:///home/me/My%20Clip.mp4`) are turned into paths too.
#[cfg(not(target_os = "linux"))]
pub fn clipboard_file_paths(ctx: &ClipboardContext) -> Vec<String> {
    ctx.get_files()
        .unwrap_or_default()
        .iter()
        .filter_map(|file| clipboard_entry_to_path(file))
        .collect()
}

/// A path from a clipboard entry: a file URL (`file:///home/me/My%20Clip.mp4`) or a path, without
/// the line break around it. `None` for an empty one.
pub fn clipboard_entry_to_path(entry: &str) -> Option<String> {
    let entry = entry.trim();
    if entry.is_empty() {
        return None;
    }
    Some(
        Url::parse(entry)
            .ok()
            .filter(|url| url.scheme() == "file")
            .and_then(|url| url.to_file_path().ok())
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| entry.to_string()),
    )
}

/// Saves a copied image that is not a file (e.g. an image copied in a browser) as a PNG in the app's
/// assets, so it can be added like a file. Returns its path, or `None` without an image.
#[cfg(not(target_os = "linux"))]
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

    img.save_to_path(&image_path)
        .map_err(|err| err.to_string())?;

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

        let files = collect_files(&path_buf.to_string_lossy())
            .map_err(|err| crate::sys::fs::file_error(&err))?;

        for file in &files {
            let _ = fs_scope.allow_file(&file.path);
            let _ = asset_scope.allow_file(&file.path);
        }

        all_files.extend(files);
    }

    Ok(all_files)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("compresso-fs-{label}-{}", nanoid::nanoid!()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn run_async<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn should_replace_original_matches_same_folder_and_stem_ignoring_extension() {
        let root = TempDir::new("match");
        let other = root.0.join("other");
        std::fs::create_dir_all(&other).unwrap();

        let orig = root.0.join("video.mov");
        let dotted = root.0.join("my.vacation.clip.avi");
        std::fs::write(&orig, b"orig").unwrap();
        std::fs::write(&dotted, b"dotted").unwrap();

        run_async(async {
            // Same folder, same stem, same extension
            assert!(should_replace_original(&root.0.join("video.mov"), &orig).await);
            // Same folder, same stem, different extension (even when destination doesn't exist yet)
            assert!(should_replace_original(&root.0.join("video.mp4"), &orig).await);
            // Multiple dots in stem
            assert!(should_replace_original(&root.0.join("my.vacation.clip.mp4"), &dotted).await);
            assert!(!should_replace_original(&root.0.join("my.vacation.mp4"), &dotted).await);
            // Prefix or different name does not match
            assert!(!should_replace_original(&root.0.join("compressed_video.mp4"), &orig).await);
            // Different folder does not match
            assert!(!should_replace_original(&other.join("video.mp4"), &orig).await);
            // Missing original does not match
            assert!(
                !should_replace_original(&root.0.join("missing.mp4"), &root.0.join("missing.mov"))
                    .await
            );
            // Case-insensitive on macOS/Windows, case-sensitive on Linux
            assert_eq!(
                should_replace_original(&root.0.join("VIDEO.mp4"), &orig).await,
                !cfg!(target_os = "linux")
            );
        });
    }

    #[test]
    fn replace_file_handles_different_extensions_and_existing_targets() {
        let root = TempDir::new("replace");

        run_async(async {
            // 1. Different extension: original is trashed, output takes requested path
            let orig = root.0.join("clip.mov");
            let cached = root.0.join("cache_clip.mp4");
            let requested = root.0.join("clip.mp4");
            std::fs::write(&orig, b"original-mov").unwrap();
            std::fs::write(&cached, b"compressed-mp4").unwrap();

            let outcome = replace_file_with(
                cached.to_str().unwrap(),
                &requested,
                &orig,
                |p| async move {
                    std::fs::remove_file(&p).map_err(|e| e.to_string())
                },
            )
            .await
            .unwrap();
            assert!(outcome.replaced_original);
            assert_eq!(outcome.path, requested);
            assert!(!orig.exists());
            assert_eq!(std::fs::read(&requested).unwrap(), b"compressed-mp4");

            // 2. Different extension when target already exists: unrelated file is never overwritten
            let orig2 = root.0.join("photo.png");
            let existing = root.0.join("photo.jpg");
            let cached2 = root.0.join("cache_photo.jpg");
            std::fs::write(&orig2, b"original-png").unwrap();
            std::fs::write(&existing, b"existing-jpg").unwrap();
            std::fs::write(&cached2, b"compressed-jpg").unwrap();

            let outcome2 = replace_file_with(
                cached2.to_str().unwrap(),
                &existing,
                &orig2,
                |p| async move {
                    std::fs::remove_file(&p).map_err(|e| e.to_string())
                },
            )
            .await
            .unwrap();
            assert!(outcome2.replaced_original);
            assert_eq!(outcome2.path, root.0.join("photo (1).jpg"));
            assert!(!orig2.exists());
            assert_eq!(std::fs::read(&existing).unwrap(), b"existing-jpg");
            assert_eq!(std::fs::read(&outcome2.path).unwrap(), b"compressed-jpg");

            // 3. Trash failure: original is preserved and replaced_original is false
            let orig3 = root.0.join("audio.wav");
            let cached3 = root.0.join("cache_audio.mp3");
            let requested3 = root.0.join("audio.mp3");
            std::fs::write(&orig3, b"original-wav").unwrap();
            std::fs::write(&cached3, b"compressed-mp3").unwrap();

            let outcome3 = replace_file_with(
                cached3.to_str().unwrap(),
                &requested3,
                &orig3,
                |_| async move { Err("trash unavailable".to_string()) },
            )
            .await
            .unwrap();
            assert!(!outcome3.replaced_original);
            assert_eq!(outcome3.path, requested3);
            assert!(orig3.exists());
            assert_eq!(std::fs::read(&requested3).unwrap(), b"compressed-mp3");
        });
    }
}
