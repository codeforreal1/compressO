use std::fs;
use std::path::PathBuf;

use tauri::api::path::cache_dir;

/**
Create cache directory if not exists.
 */

// TODO: Do not allow compressing the same file that is in the cache directory
pub fn create_cache_dir() -> Result<PathBuf, String> {
    let cache_dir = match cache_dir() {
        Some(path) => path,
        None => {
            return Err(String::from("No cache directory found"));
        }
    };
    let full_path: PathBuf = [cache_dir, PathBuf::from("compressorx")].iter().collect();
    if !full_path.is_dir() {
        if let Err(err) = fs::create_dir(&full_path) {
            return Err(err.to_string());
        }
    }
    Ok(full_path)
}