use std::{
    fs,
    path::{Path, PathBuf},
    time::{self, Duration, SystemTime},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

use crate::core::domain::FileMetadata;

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

/// Get [width, height] of an image (only raster images PNG, JPEG, GIF, BMP, WebP, TIFF, etc.)
pub fn get_image_dimension(image_path: &str) -> Result<(u32, u32), String> {
    if fs::metadata(image_path).is_err() {
        return Err(String::from("Image does not exist in the given path."));
    }

    let image = match image::io::Reader::open(Path::new(image_path)) {
        Ok(reader) => reader,
        Err(err) => return Err(err.to_string()),
    };

    match image.into_dimensions() {
        Ok(dimension) => Ok((dimension.0, dimension.1)),
        Err(err) => Err(err.to_string()),
    }
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

/// Copies file from one path to another path
pub async fn copy_file(from: &str, to: &str) -> std::io::Result<u64> {
    let result = tokio::fs::copy(from, to).await?;
    Ok(result)
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

/// Collects files from a given path with configurable depth.
///
/// # Arguments
/// * `path` - The file or directory path to collect from
/// * `depth` - Optional depth level for directory traversal:
///   - `None`: Recursively collect all files (unlimited depth)
///   - `Some(0)`: Only files in the immediate directory (no subdirectories)
///   - `Some(n)`: Go n levels deep into subdirectories
///
/// # Returns
/// A vector of file paths found at the specified depth
pub fn collect_files(path: &str, depth: Option<u32>) -> std::io::Result<Vec<String>> {
    let metadata = std::fs::metadata(path)?;
    let mut files = Vec::new();

    if metadata.is_file() {
        files.push(path.to_string());
    } else if metadata.is_dir() {
        let entries = std::fs::read_dir(path)?;
        for entry in entries {
            let entry = entry?;
            let entry_path = entry.path();
            let path_str = entry_path.to_string_lossy().to_string();

            if entry_path.is_file() {
                files.push(path_str);
            } else if entry_path.is_dir() {
                match depth {
                    None => {
                        files.extend(collect_files(&path_str, None)?);
                    }
                    Some(0) => {
                        continue;
                    }
                    Some(n) => {
                        files.extend(collect_files(&path_str, Some(n - 1))?);
                    }
                }
            }
        }
    }

    Ok(files)
}
