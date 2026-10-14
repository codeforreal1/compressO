use std::{
    fs,
    path::{Path, PathBuf},
    time::{self, Duration, SystemTime},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

use crate::core::domain::{CollectedFile, FileMetadata};

/// Create required .compressO directory if not exists.
pub fn setup_app_data_dir(app: &mut tauri::App) -> Result<PathBuf, tauri::Error> {
    let scope = app.fs_scope();
    let app_data_directory = app.path().app_data_dir()?;
    scope.allow_directory(&app_data_directory, true)?;

    Ok(app_data_directory)
}

/// Ensure the assets directory exists
pub fn ensure_assets_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;

    let assets_dir = app_data_dir.join("assets");

    fs::create_dir_all(&assets_dir)
        .map_err(|err| format!("Failed to create assets directory: {}", err))?;

    Ok(assets_dir)
}

/// Empties (or creates) the folder holding the named copies of files put on the clipboard. Only the
/// latest clipboard content is needed, so earlier copies are removed.
pub fn reset_clipboard_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let clipboard_dir = ensure_assets_dir(app_handle)?.join("clipboard");
    if clipboard_dir.exists() {
        fs::remove_dir_all(&clipboard_dir)
            .map_err(|err| format!("Failed to clear clipboard directory: {}", err))?;
    }
    fs::create_dir_all(&clipboard_dir)
        .map_err(|err| format!("Failed to create clipboard directory: {}", err))?;
    Ok(clipboard_dir)
}

/// Makes `file_path` available as `<dir>/<unique folder>/<file_name>` without copying its data (a
/// hard link, or a copy if linking fails). Each file gets its own folder, so equal names in a batch
/// don't clash.
pub fn link_file_with_name(dir: &Path, file_path: &str, file_name: &str) -> Result<PathBuf, String> {
    // Only the name itself, so it can't point outside `dir`
    let file_name = Path::new(file_name)
        .file_name()
        .ok_or_else(|| format!("Invalid file name: {}", file_name))?;

    let target_dir = dir.join(nanoid::nanoid!());
    fs::create_dir_all(&target_dir).map_err(|err| err.to_string())?;
    let target_path = target_dir.join(file_name);

    if fs::hard_link(file_path, &target_path).is_err() {
        fs::copy(file_path, &target_path).map_err(|err| err.to_string())?;
    }
    Ok(target_path)
}

/// Get metadata of a file from it's full path
pub fn get_file_metadata(path: &str) -> Result<FileMetadata, String> {
    let metadata_ref = fs::metadata(path);

    if metadata_ref.is_err() {
        return Err(String::from("File does not exist in the given path."));
    }

    let metadata = metadata_ref.unwrap();
    let file_path = Path::new(path);
    let mut file_type_matcher = infer::Infer::new();
    file_type_matcher.add("video/mp2t", "ts", is_mpeg_ts);
    let mime_type = file_type_matcher.get_from_path(path).unwrap();

    Ok(FileMetadata {
        path: String::from(path),
        file_name: String::from(file_path.file_name().unwrap_or_default().to_str().unwrap()),
        mime_type: match mime_type {
            Some(m) => m.to_string(),
            None => String::from(""),
        },
        extension: String::from(file_path.extension().unwrap_or_default().to_str().unwrap()),
        size: metadata.len(),
    })
}

/// MPEG-TS has no magic number, so detect it by its 0x47 sync byte repeating
/// every 188 bytes (or every 192 bytes for M2TS, after a 4-byte timestamp).
fn is_mpeg_ts(buf: &[u8]) -> bool {
    let has_sync_bytes = |offset: usize, packet_size: usize| {
        (0..3).all(|i| buf.get(offset + i * packet_size) == Some(&0x47))
    };
    has_sync_bytes(0, 188) || has_sync_bytes(4, 192)
}

/// Get [width, height] of an image (only raster images PNG, JPEG, GIF, BMP, WebP, TIFF, etc.), as it
/// is displayed: photos stored sideways with an EXIF orientation are reported upright
pub fn get_image_dimension(image_path: &str) -> Result<(u32, u32), String> {
    if fs::metadata(image_path).is_err() {
        return Err(String::from("Image does not exist in the given path."));
    }

    let image = match image::io::Reader::open(Path::new(image_path)) {
        Ok(reader) => reader,
        Err(err) => return Err(err.to_string()),
    };

    match image.into_dimensions() {
        Ok((width, height)) => Ok(
            if crate::core::orientation::get_image_orientation(image_path)
                .is_some_and(crate::core::orientation::swaps_width_and_height)
            {
                (height, width)
            } else {
                (width, height)
            },
        ),
        Err(err) => get_heif_dimension(image_path).ok_or(err.to_string()),
    }
}

/// Read dimension of AVIF/HEIF images (which the image crate can't decode) from
/// the `ispe` (image spatial extents) property box.
fn get_heif_dimension(image_path: &str) -> Option<(u32, u32)> {
    let data = fs::read(image_path).ok()?;
    let header = &data[..data.len().min(64 * 1024)];
    let box_start = header.windows(4).position(|w| w == b"ispe")?;
    // box type (4) + version & flags (4), followed by u32 width and u32 height
    let dims = header.get(box_start + 8..box_start + 16)?;
    let width = u32::from_be_bytes(dims[0..4].try_into().ok()?);
    let height = u32::from_be_bytes(dims[4..8].try_into().ok()?);
    Some((width, height))
}

// Parse & extract dimension from svg
pub fn get_svg_dimension(svg_path: &str) -> Result<(u32, u32), String> {
    let svg_data = fs::read_to_string(svg_path).map_err(|err| err.to_string())?;
    let opt = usvg::Options::default();
    if let Ok(tree) = usvg::Tree::from_str(&svg_data, &opt) {
        let size = tree.size();
        Ok((size.width() as u32, size.height() as u32))
    } else {
        Err("Could not extract dimension from the given svg".to_string())
    }
}

/// Deletes file from the given path
pub async fn delete_file(path: &str) -> std::io::Result<()> {
    tokio::fs::remove_file(path).await
}

/// Deletes all files that were (now - created) > duration_in_millis
pub async fn delete_stale_files(
    path: &str,
    duration_in_millis: u64,
) -> std::io::Result<Vec<PathBuf>> {
    let mut entries = tokio::fs::read_dir(path).await?;
    let now = SystemTime::now().duration_since(time::UNIX_EPOCH).unwrap();
    let mut deleted_files: Vec<PathBuf> = vec![];
    while let Some(entry) = entries.next_entry().await? {
        let metadata = entry.metadata().await?;
        if metadata.is_file() {
            if let Ok(created_at) = metadata.created() {
                if let Ok(created_at_since_epoch) = created_at.duration_since(time::UNIX_EPOCH) {
                    if (now - created_at_since_epoch) > Duration::from_millis(duration_in_millis) {
                        tokio::fs::remove_file(entry.path()).await?;
                        deleted_files.push(entry.path());
                    }
                }
            }
        }
    }
    Ok(deleted_files)
}

/// First path that doesn't exist yet: `path` itself, then `name (1).ext`, `name (2).ext`, ... (or
/// `name (1)` for folders), so saving never replaces an existing file or folder.
pub fn get_available_path(path: &Path, is_dir: bool) -> PathBuf {
    // `symlink_metadata` also counts broken symlinks as existing
    let exists = |candidate: &Path| fs::symlink_metadata(candidate).is_ok();
    if !exists(path) {
        return path.to_path_buf();
    }

    let parent = path.parent().unwrap_or(Path::new(""));
    let (name, extension) = if is_dir {
        (path.file_name(), None)
    } else {
        (path.file_stem(), path.extension())
    };
    let name = name.unwrap_or_default().to_string_lossy();

    (1..)
        .map(|n| match extension {
            Some(extension) => {
                parent.join(format!("{} ({}).{}", name, n, extension.to_string_lossy()))
            }
            None => parent.join(format!("{} ({})", name, n)),
        })
        .find(|candidate| !exists(candidate))
        .expect("an unused numbered path")
}

/// Collects files from a path, recursing into directories. Each file keeps the folder it was in
/// relative to the given path's parent (a dropped `Vacation` folder gives `Vacation/Day1/...`), so
/// outputs can mirror the original structure. Hidden entries and symlinked directories are skipped.
pub fn collect_files(path: &str) -> std::io::Result<Vec<CollectedFile>> {
    let path = Path::new(path);
    let metadata = std::fs::metadata(path)?;
    let mut files = Vec::new();

    if metadata.is_file() {
        files.push(CollectedFile {
            path: path.to_string_lossy().to_string(),
            relative_dir: String::new(),
        });
    } else if metadata.is_dir() {
        let base = path.parent().unwrap_or(path);
        collect_dir_files(path, base, &mut files)?;
    }

    Ok(files)
}

fn collect_dir_files(
    dir: &Path,
    base: &Path,
    files: &mut Vec<CollectedFile>,
) -> std::io::Result<()> {
    let mut entries = std::fs::read_dir(dir)?
        .filter_map(|entry| entry.ok())
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());

    let relative_dir = dir
        .strip_prefix(base)
        .unwrap_or(Path::new(""))
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/");

    for entry in entries {
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        // `file_type` doesn't follow symlinks, so symlinked folders (possible loops) are skipped
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let entry_path = entry.path();

        if file_type.is_dir() {
            if let Err(err) = collect_dir_files(&entry_path, base, files) {
                log::warn!("[fs] Skipping unreadable folder {:?}: {}", entry_path, err);
            }
        } else if file_type.is_file() || (file_type.is_symlink() && entry_path.is_file()) {
            files.push(CollectedFile {
                path: entry_path.to_string_lossy().to_string(),
                relative_dir: relative_dir.clone(),
            });
        }
    }

    Ok(())
}
