use crate::core::domain::{
    BatchMediaCompressionProgress, BatchMediaIndividualCompressionResult, CustomEvents,
    ImageCompressionProgress, MediaBatchCompressionResult, MediaCompressionProgress,
    MediaCompressionResult, MediaItemConfig, VideoCompressionProgress,
};
use crate::core::ffmpeg::FFMPEG;
use crate::core::image::ImageCompressor;
use crate::utils::event::EventListenerGuard;
use tauri::{Emitter, Listener, Manager};

#[tauri::command]
pub async fn compress_media_batch(
    app: tauri::AppHandle,
    batch_id: String,
    media: Vec<MediaItemConfig>,
) -> Result<MediaBatchCompressionResult, String> {
    let total_count = media.len();

    let mut results: std::collections::HashMap<String, MediaCompressionResult> =
        std::collections::HashMap::new();

    for (index, media_item) in media.iter().enumerate() {
        let app_clone = app.clone();
        let batch_id_clone = batch_id.clone();

        if let Some(video_config) = &media_item.video_config {
            let video_id = video_config.video_id.clone();
            let video_id_clone_for_listener = video_id.clone();

            // Removed again once this media is done (see `EventListenerGuard`)
            let _progress_listener = app_clone.get_webview_window("main").map(|window| {
                let listener_window = window.clone();
                let event_id = listener_window.listen(
                    CustomEvents::VideoCompressionProgress.as_ref(),
                    move |evt| {
                        if let Ok(progress) =
                            serde_json::from_str::<VideoCompressionProgress>(evt.payload())
                        {
                            if progress.video_id == video_id_clone_for_listener {
                                let batch_progress = BatchMediaCompressionProgress {
                                    batch_id: batch_id_clone.to_owned(),
                                    current_index: index,
                                    total_count,
                                    media_progress: progress.into(),
                                };
                                let _ = window.emit(
                                    CustomEvents::BatchMediaCompressionProgress.as_ref(),
                                    batch_progress,
                                );
                            }
                        }
                    },
                );
                EventListenerGuard::new(listener_window, event_id)
            });

            let video_id = &video_config.video_id;
            let video_path = &video_config.video_path;
            let convert_to_extension = &video_config.convert_to_extension;
            let preset_name = video_config.preset_name.as_deref();
            let batch_id_for_compression = Some(batch_id.as_str());
            let audio_config = &video_config.audio_config;
            let quality = video_config.quality;
            let dimensions = video_config.dimensions;
            let fps = video_config.fps.as_deref();
            let video_codec = video_config.video_codec.as_deref();
            let transform_history = video_config.transform_history.as_ref().map(|v| v.as_ref());
            let metadata_config = video_config.metadata_config.as_ref();
            let thumbnail_path = video_config.custom_thumbnail_path.as_deref();
            let trim_segments = video_config.trim_segments.as_ref();
            let subtitles_config = video_config.subtitles_config.as_ref();
            let strip_metadata = video_config.strip_metadata;
            let speed = video_config.speed;

            let mut ffmpeg_instance = FFMPEG::new(&app)
                .map_err(|e| format!("Failed to create ffmpeg instance: {}", e))?;

            match ffmpeg_instance
                .compress_video(
                    video_path,
                    convert_to_extension,
                    preset_name,
                    video_id,
                    batch_id_for_compression,
                    audio_config,
                    quality,
                    dimensions,
                    fps,
                    video_codec,
                    transform_history,
                    strip_metadata,
                    metadata_config,
                    thumbnail_path,
                    trim_segments,
                    subtitles_config,
                    speed,
                )
                .await
            {
                Ok(result) => {
                    let media_id = result.video_id.clone();
                    results.insert(
                        media_id.clone(),
                        MediaCompressionResult::Video(result.clone()),
                    );

                    let app_clone = app.clone();
                    let batch_id_clone = batch_id.clone();

                    tokio::spawn(async move {
                        if let Some(window) = app_clone.get_webview_window("main") {
                            let individual_result = BatchMediaIndividualCompressionResult {
                                batch_id: batch_id_clone,
                                result: MediaCompressionResult::Video(result),
                            };
                            let _ = window.emit(
                                CustomEvents::BatchMediaIndividualCompressionCompletion.as_ref(),
                                individual_result,
                            );
                        }
                    });
                }
                Err(e) => {
                    if e == "CANCELLED" {
                        return Err(String::from("CANCELLED"));
                    }
                    log::error!("Failed to compress video '{}': {}", video_id, e);
                }
            }
        } else if let Some(image_config) = &media_item.image_config {
            let image_id = image_config.image_id.clone();
            let image_id_clone = image_id.clone();

            // Image compression doesn't have any progress % tracking, so we immediately send the current index of the image to let the front-end know where the index cursor is.
            // NOTE: this event must be sync and not be within tokio::spawn(...) due to the fact that image compression can be so fast, this event might deliver later and mess up the batch compression index cursor.
            if let Some(window) = app_clone.get_webview_window("main") {
                let image_compression_progress =
                    MediaCompressionProgress::Image(ImageCompressionProgress {
                        batch_id: batch_id_clone.to_owned(),
                        image_id: image_id_clone,
                        progress: 0.0,
                    });
                let batch_progress = BatchMediaCompressionProgress {
                    batch_id: batch_id_clone.to_owned(),
                    current_index: index,
                    total_count,
                    media_progress: image_compression_progress,
                };
                let _ = window.emit(
                    CustomEvents::BatchMediaCompressionProgress.as_ref(),
                    batch_progress,
                );
            }

            let image_id = &image_config.image_id;
            let image_path = &image_config.image_path;
            let convert_to_extension = image_config.convert_to_extension.as_str();
            let svg_scale_factor = image_config.svg_scale_factor;
            let quality = image_config.quality;
            let strip_metadata = image_config.strip_metadata;
            let is_lossless = image_config.is_lossless;
            let svg_config = image_config.svg_config.clone();
            let dimensions = image_config.dimensions;
            let transform_history = image_config.transform_history.as_ref();

            let mut image_compressor = ImageCompressor::new(&app)
                .map_err(|e| format!("Failed to create image compressor instance: {}", e))?;

            match image_compressor
                .compress_image(
                    image_path,
                    convert_to_extension,
                    svg_scale_factor,
                    is_lossless,
                    quality,
                    image_id,
                    Some(batch_id.as_str()),
                    strip_metadata,
                    svg_config,
                    dimensions,
                    transform_history,
                )
                .await
            {
                Ok(result) => {
                    let media_id = result.image_id.clone();
                    results.insert(
                        media_id.clone(),
                        MediaCompressionResult::Image(result.clone()),
                    );

                    // NOTE: this event must be sync and not be within tokio::spawn(...) due to the fact that image compression can be so fast, this event might deliver later and mess up the batch compression index cursor.
                    let batch_id_clone = batch_id.clone();
                    if let Some(window) = app.get_webview_window("main") {
                        let individual_result = BatchMediaIndividualCompressionResult {
                            batch_id: batch_id_clone,
                            result: MediaCompressionResult::Image(result),
                        };
                        let _ = window.emit(
                            CustomEvents::BatchMediaIndividualCompressionCompletion.as_ref(),
                            individual_result,
                        );
                    }
                }
                Err(e) => {
                    if e == "CANCELLED" {
                        return Err(String::from("CANCELLED"));
                    }
                    log::error!("Failed to compress image '{}': {}", image_id, e);
                }
            }
        }
    }

    Ok(MediaBatchCompressionResult { results })
}
