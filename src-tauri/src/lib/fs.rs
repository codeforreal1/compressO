use std::{fs, path::PathBuf};

use tauri::Manager;
use tauri_plugin_fs::FsExt;

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
