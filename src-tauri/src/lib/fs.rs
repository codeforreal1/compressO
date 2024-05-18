use std::{
    fs,
    path::{Path, PathBuf},
    time::{self, Duration, SystemTime},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

use crate::domain::FileMetadata;

/// Create required .compressO directory if not exists.
pub fn setup_app_data_dir(app: &mut tauri::App) -> Result<PathBuf, tauri::Error> {
    let scope = app.fs_scope();
    let app_data_directory = app.path().app_data_dir()?;
    scope.allow_directory(&app_data_directory, true);

    // Create assets directory required for ffmpeg
    fs::create_dir_all(format!(
        "{}/assets",
        &app_data_directory.display().to_string()
    ))?;

    Ok(app_data_directory)
}

/// Get metadata of a file from it's full path
pub fn get_file_metadata(path: &str) -> Result<FileMetadata, String> {
    let metadata_ref = fs::metadata(path);

    if metadata_ref.is_err() {
        return Err(String::from("File does not exist in the given path."));
    }

    let metadata = metadata_ref.unwrap();
    let file_path = Path::new(path);
    let mime_type = infer::get_from_path(path).unwrap();

    return Ok(FileMetadata {
        path: String::from(path),
        file_name: String::from(file_path.file_name().unwrap().to_str().unwrap()),
        mime_type: match mime_type {
            Some(m) => m.to_string(),
            None => String::from(""),
        },
        extension: String::from(file_path.extension().unwrap().to_str().unwrap()),
        size: metadata.len(),
    });
}

/// Get [width, height] of an image
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
