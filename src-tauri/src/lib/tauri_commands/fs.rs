use crate::{domain::FileMetadata, fs};

#[tauri::command]
pub async fn get_file_metadata(file_path: &str) -> Result<FileMetadata, String> {
    fs::get_file_metadata(file_path)
}

#[tauri::command]
pub async fn get_image_dimension(image_path: &str) -> Result<(u32, u32), String> {
    fs::get_image_dimension(image_path)
}

#[tauri::command]
pub async fn move_file(from: &str, to: &str) -> Result<(), String> {
    if let Err(err) = fs::copy_file(from, to).await {
        return Err(err.to_string());
    }

    if let Err(err) = fs::delete_file(from).await {
        return Err(err.to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_file(path: &str) -> Result<(), String> {
    if let Err(err) = fs::delete_file(path).await {
        return Err(err.to_string());
    }
    Ok(())
}
