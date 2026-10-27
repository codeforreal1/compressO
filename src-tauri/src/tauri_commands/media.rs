use crate::core::domain::{
    BatchMediaCompressionProgress, BatchMediaIndividualCompressionResult, CustomEvents,
    ImageCompressionProgress, MediaBatchCompressionResult, MediaCompressionProgress,
    MediaCompressionResult, MediaItemConfig, VideoCompressionProgress,
};
use crate::core::ffmpeg::FFMPEG;
use crate::core::image::ImageCompressor;
use crate::utils::event::EventListenerGuard;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Listener};

/// Batches paused by their id: the media being compressed finishes, the next waits
static PAUSED_BATCHES: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn is_batch_paused(batch_id: &str) -> bool {
    PAUSED_BATCHES
        .lock()
        .map(|batches| batches.iter().any(|id| id == batch_id))
        .unwrap_or(false)
}

fn set_batch_paused_state(batch_id: &str, paused: bool) {
    if let Ok(mut batches) = PAUSED_BATCHES.lock() {
        batches.retain(|id| id != batch_id);
        if paused {
            batches.push(batch_id.to_string());
        }
    }
}

/// Pauses a batch after the media being compressed, or resumes it
#[tauri::command]
pub fn set_batch_paused(batch_id: String, paused: bool) {
    set_batch_paused_state(&batch_id, paused);
}

/// About the size a video comes out at with its settings, in bytes (see
/// `FFMPEG::estimate_video_size`); stopped like a compression, with `estimate_id`
#[tauri::command]
pub async fn estimate_video_size(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    estimate_id: String,
    config: crate::core::domain::VideoCompressionConfig,
    duration: f64,
) -> Result<u64, String> {
    FFMPEG::new(&app)?
        .with_owner_window(window.label())
        .estimate_video_size(&estimate_id, &config, duration)
        .await
}

#[tauri::command]
pub async fn compress_media_batch(
    app: tauri::AppHandle,
    // The compressions belong to the window that started them (e.g. the menu bar's)
    window: tauri::WebviewWindow,
    batch_id: String,
    media: Vec<MediaItemConfig>,
) -> Result<MediaBatchCompressionResult, String> {
    let mut results: std::collections::HashMap<String, MediaCompressionResult> =
        std::collections::HashMap::new();

    // The computer stays awake until the batch is done (or fails, or is cancelled), see
    // `keep_awake` (Settings -> General)
    let _keep_awake = crate::sys::keep_awake::KeepAwake::acquire();

    log::info!("[media] Compressing {} media (batch {})", media.len(), batch_id);

    // Cancelled between two media (or while paused), when no process would see it
    let is_cancelled = Arc::new(AtomicBool::new(false));
    let _cancel_listener = {
        let is_cancelled = is_cancelled.clone();
        let batch_id = batch_id.clone();
        // `listen_any`: the main window sends it to itself
        let event_id = app.listen_any(
            CustomEvents::CancelInProgressCompression.as_ref(),
            move |evt| {
                let is_this_batch = serde_json::from_str::<serde_json::Value>(evt.payload())
                    .ok()
                    .and_then(|payload| payload.get("ids").cloned())
                    .and_then(|ids| ids.as_array().cloned())
                    .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(&batch_id)));
                if is_this_batch {
                    is_cancelled.store(true, Ordering::SeqCst);
                }
            },
        );
        EventListenerGuard::for_app(app.clone(), event_id)
    };

    let result = compress_media_items(
        &app,
        &window,
        &batch_id,
        &media,
        &mut results,
        &is_cancelled,
    )
    .await;
    // A pause left on (e.g. cancelled while paused) is not kept
    set_batch_paused_state(&batch_id, false);
    result?;

    Ok(MediaBatchCompressionResult { results })
}

/// The other outputs of a video compressed to a target size (see `VideoCompressionResult`)
fn result_other_outputs(result: &crate::core::domain::VideoCompressionResult) -> Vec<&str> {
    result
        .other_outputs
        .iter()
        .map(|output| output.file_path.as_str())
        .collect()
}

/// Which lane a media is compressed in (see `compress_media_items`)
#[derive(Clone, Copy, PartialEq, Eq)]
enum Lane {
    Video,
    Audio,
    Image,
}

/// Outputs in an audio format (also from a video, e.g. its sound as mp3)
const AUDIO_OUTPUT_EXTENSIONS: [&str; 6] = ["mp3", "m4a", "wav", "flac", "ogg", "opus"];

fn get_lane(media_item: &MediaItemConfig) -> Lane {
    match &media_item.video_config {
        Some(config) if AUDIO_OUTPUT_EXTENSIONS.contains(&config.convert_to_extension.as_str()) => {
            Lane::Audio
        }
        Some(_) => Lane::Video,
        None => Lane::Image,
    }
}

/// Compresses a batch in three lanes, one for each kind of media: one video, one audio & one image
/// at a time, each lane in the batch's order. Images & audio, which are quick, do not wait for a
/// video, & two media of a kind never compete for the processor. Pausing stops each lane before its
/// next media; cancelling stops them all.
async fn compress_media_items(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    batch_id: &String,
    media: &[MediaItemConfig],
    results: &mut std::collections::HashMap<String, MediaCompressionResult>,
    is_cancelled: &AtomicBool,
) -> Result<(), String> {
    let total_count = media.len();
    let shared_results = Mutex::new(std::mem::take(results));
    let run_lane = |lane: Lane| {
        let shared_results = &shared_results;
        async move {
            for (index, media_item) in media
                .iter()
                .enumerate()
                .filter(|(_, item)| get_lane(item) == lane)
            {
                // Paused: the media being compressed finished, the next waits until resumed
                while is_batch_paused(batch_id) && !is_cancelled.load(Ordering::SeqCst) {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
                if is_cancelled.load(Ordering::SeqCst) {
                    return Err(String::from("CANCELLED"));
                }
                if let Err(error) = compress_media_item(
                    app,
                    window,
                    batch_id,
                    index,
                    total_count,
                    media_item,
                    shared_results,
                )
                .await
                {
                    // The other lanes stop too
                    is_cancelled.store(true, Ordering::SeqCst);
                    return Err(error);
                }
            }
            Ok::<(), String>(())
        }
    };
    let (videos, audio, images) = tokio::join!(
        run_lane(Lane::Video),
        run_lane(Lane::Audio),
        run_lane(Lane::Image)
    );
    *results = shared_results.into_inner().unwrap_or_default();
    videos.and(audio).and(images)
}

/// Compresses one media of a batch; an error only when the batch is cancelled (a failed media is
/// logged & left out of the results)
async fn compress_media_item(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    batch_id: &str,
    index: usize,
    total_count: usize,
    media_item: &MediaItemConfig,
    results: &Mutex<std::collections::HashMap<String, MediaCompressionResult>>,
) -> Result<(), String> {
    let app = app.clone();
    let batch_id = batch_id.to_string();
    let app_clone = app.clone();
    let batch_id_clone = batch_id.clone();

    if let Some(video_config) = &media_item.video_config {
        let video_id = video_config.video_id.clone();
        let video_id_clone_for_listener = video_id.clone();

        // Removed again once this media is done (see `EventListenerGuard`)
        // Progress of the whole app (from any window)
        let _progress_listener = {
            let window = app_clone.clone();
            let event_id = app_clone.listen_any(
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
            EventListenerGuard::for_app(app_clone.clone(), event_id)
        };

        let video_id = &video_config.video_id;

        // In its own task, so a panic while compressing this video only fails this video,
        // instead of ending the batch (and losing the media already compressed)
        let config = video_config.clone();
        let task_app = app.clone();
        let owner_window = window.label().to_string();
        let task_batch_id = batch_id.clone();
        let compression = tokio::spawn(async move {
            // Failing to prepare ffmpeg also only fails this video
            let mut ffmpeg_instance = FFMPEG::new(&task_app)
                .map_err(|e| format!("Failed to create ffmpeg instance: {}", e))?
                .with_owner_window(&owner_window);
            ffmpeg_instance
                .compress_video(
                    &config.video_path,
                    &config.convert_to_extension,
                    config.preset_name.as_deref(),
                    &config.video_id,
                    Some(task_batch_id.as_str()),
                    &config.audio_config,
                    config.quality,
                    config.dimensions,
                    config.fps.as_deref(),
                    config.video_codec.as_deref(),
                    config.transform_history.as_ref().map(|v| v.as_ref()),
                    config.strip_metadata,
                    config.metadata_config.as_ref(),
                    config.custom_thumbnail_path.as_deref(),
                    config.trim_segments.as_ref(),
                    config.subtitles_config.as_ref(),
                    config.speed,
                    config.target_size.as_ref(),
                )
                .await
        })
        .await
        .unwrap_or_else(|e| Err(format!("Compression stopped unexpectedly: {}", e)));

        match compression {
            Ok(result) => {
                log::info!(
                    "[media] Compressed video '{}' ({} bytes)",
                    video_id,
                    result.file_metadata.as_ref().map(|m| m.size).unwrap_or(0)
                );
                // Remembered, so a watched folder never compresses it again
                crate::sys::output_registry::remember(
                    &app,
                    std::path::Path::new(&result.file_path),
                );
                for other in result_other_outputs(&result) {
                    crate::sys::output_registry::remember(&app, std::path::Path::new(other));
                }
                let media_id = result.video_id.clone();
                results.lock().unwrap().insert(
                    media_id.clone(),
                    MediaCompressionResult::Video(result.clone()),
                );

                let app_clone = app.clone();
                let batch_id_clone = batch_id.clone();

                tokio::spawn(async move {
                    {
                        // To the whole app (any window can be compressing)
                        let window = app_clone.clone();
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
        {
            // To the whole app (any window can be compressing)
            let window = app_clone.clone();
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

        // In its own task, like videos (see above)
        let config = image_config.clone();
        let task_app = app.clone();
        let owner_window = window.label().to_string();
        let task_batch_id = batch_id.clone();
        let compression = tokio::spawn(async move {
            let mut image_compressor = ImageCompressor::new(&task_app)
                .map_err(|e| format!("Failed to create image compressor instance: {}", e))?
                .with_owner_window(&owner_window);
            image_compressor
                .compress_image_config(&config, Some(task_batch_id.as_str()))
                .await
        })
        .await
        .unwrap_or_else(|e| Err(format!("Compression stopped unexpectedly: {}", e)));

        match compression {
            Ok(result) => {
                log::info!(
                    "[media] Compressed image '{}' ({} bytes)",
                    image_id,
                    result.file_metadata.as_ref().map(|m| m.size).unwrap_or(0)
                );
                // Remembered, so a watched folder never compresses it again
                crate::sys::output_registry::remember(
                    &app,
                    std::path::Path::new(&result.file_path),
                );
                let media_id = result.image_id.clone();
                results.lock().unwrap().insert(
                    media_id.clone(),
                    MediaCompressionResult::Image(result.clone()),
                );

                // NOTE: this event must be sync and not be within tokio::spawn(...) due to the fact that image compression can be so fast, this event might deliver later and mess up the batch compression index cursor.
                let batch_id_clone = batch_id.clone();
                {
                    // To the whole app (any window can be compressing)
                    let window = app.clone();
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

    Ok(())
}
