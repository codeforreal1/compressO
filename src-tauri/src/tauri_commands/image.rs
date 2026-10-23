use std::path::PathBuf;

use crate::core::{
    domain::{
        ExifInfo, ImageBasicInfo, ImageBatchCompressionResult, ImageColorInfo,
        ImageCompressionConfig, ImageDimensions,
    },
    image,
    image_info::ImageInfo,
};
use crate::sys::fs::delete_stale_files;

#[tauri::command]
pub async fn compress_images_batch(
    app: tauri::AppHandle,
    batch_id: &str,
    images: Vec<ImageCompressionConfig>,
) -> Result<ImageBatchCompressionResult, String> {
    let mut image_compressor = image::ImageCompressor::new(&app)?;

    if let Ok(files) = delete_stale_files(
        image_compressor.get_asset_dir().as_str(),
        24 * 60 * 60 * 1000,
    )
    .await
    {
        log::debug!(
            "[main] Stale files deleted. Number of deleted files = {}",
            files.len()
        )
    };

    image_compressor
        .compress_images_batch(batch_id, images)
        .await
        .map(|result| Ok(result))
        .unwrap_or_else(|err| Err(err))
}
#[tauri::command]
pub async fn convert_svg_to_png(
    app: tauri::AppHandle,
    image_path: &str,
    image_id: &str,
) -> Result<String, String> {
    let image_compressor = image::ImageCompressor::new(&app)?;

    let output_filename = format!("{}.png", image_id);
    let output_path: PathBuf = [
        image_compressor.get_asset_dir(),
        output_filename.to_string(),
    ]
    .iter()
    .collect();

    let output_path_str = &*output_path.to_string_lossy();

    let _ = image_compressor.convert_svg_to_raster_img(
        &image_path,
        output_path_str,
        "png",
        Some(1.0),
    )?;
    Ok(output_path_str.to_string())
}

#[tauri::command]
pub async fn get_image_basic_info(image_path: &str) -> Result<ImageBasicInfo, String> {
    ImageInfo::get_basic_info(image_path)
}

#[tauri::command]
pub async fn get_image_dimensions(
    app: tauri::AppHandle,
    image_path: &str,
) -> Result<ImageDimensions, String> {
    if crate::core::image_codecs::is_modern(&crate::core::image_codecs::extension(image_path)) {
        let path = crate::core::image_codecs::decoded_png(&app, image_path, "main", &[]).await?;
        return ImageInfo::get_dimensions(path.to_str().ok_or("Invalid cache path")?);
    }
    ImageInfo::get_dimensions(image_path)
}

#[tauri::command]
pub async fn get_image_color_info(
    app: tauri::AppHandle,
    image_path: &str,
) -> Result<ImageColorInfo, String> {
    if crate::core::image_codecs::is_modern(&crate::core::image_codecs::extension(image_path)) {
        let path = crate::core::image_codecs::decoded_png(&app, image_path, "main", &[]).await?;
        return ImageInfo::get_color_info(path.to_str().ok_or("Invalid cache path")?);
    }
    ImageInfo::get_color_info(image_path)
}

#[tauri::command]
pub async fn prepare_image_preview(
    app: tauri::AppHandle,
    image_path: &str,
) -> Result<String, String> {
    crate::core::image_codecs::decoded_png(&app, image_path, "main", &[])
        .await
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn get_exif_info(image_path: &str) -> Result<ExifInfo, String> {
    ImageInfo::get_exif_info(image_path)
}
