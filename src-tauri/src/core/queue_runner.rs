//! Headless, WebView-independent runner for the unified `drop_queue` (dropped items, clipboard
//! items, watched folders, CLI jobs, and MCP jobs). Runs three concurrent lanes (`video`, `audio`,
//! `image`) using `core::settings`, `core::presets`, `core::planning`, `core::contract`, and the
//! window-optional `core` encoders (`compress_media_batch_headless`, `FFPROBE`, `FFMPEG`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use nanoid::nanoid;
use serde_json::{json, Value};
use tauri::{AppHandle, Listener};
use tokio::sync::Mutex as AsyncMutex;

use crate::core::contract::{spec, translate};
use crate::core::domain::{
    AudioChannelConfig, AudioConfig, BatchMediaCompressionProgress, CustomEvents,
    ImageCompressionConfig, ImageTargetSize, MediaCompressionProgress, MediaCompressionResult,
    MediaItemConfig, MediaMetadataConfig, MediaTransformHistory, MonoSource, SubtitleConfig,
    SubtitlesConfig, SvgConfig, TargetSize, VideoClipsConfig, VideoCompressionConfig,
    VideoTrimSegment,
};
use crate::core::ffmpeg::FFMPEG;
use crate::core::ffprobe::FFPROBE;
use crate::core::image_dynamic_range::{
    inspect_source, DynamicRange, ImageDynamicRangeConfig, ImageDynamicRangeInfo,
    ImageDynamicRangeMode, MAX_BOOST_INTENSITY,
};
use crate::core::planning::{
    self, apply_file_name_template, get_transforms_for_media,
    plan_audio_target_size, plan_video_target_size, preset_name_for_template, resolve_preset_choice_id,
    resolve_preset_output, supports_image_target_size, PortableFlip, PortableTransform,
    ResolvedPresetOutput, VideoTargetSizeInput,
};
use crate::core::presets::{PresetsStoreData, StoredPreset};
use crate::core::settings::{DomainSettings, SaveLocation};
use crate::sys::fs::{
    ensure_assets_dir, get_file_metadata, get_image_dimension, get_svg_dimension,
    PERMISSION_DENIED_ERROR,
};
use crate::sys::history::{self, HistoryEntry};
use crate::tauri_commands::compression_status::is_compressing;
use crate::tauri_commands::drop_queue::{
    self, DropQueueItem, DropQueueItemStatus, DropQueueItemUpdate,
};
use crate::tauri_commands::fs::{copy_files_to_clipboard, get_available_path, move_file, ClipboardFile};
use crate::tauri_commands::media::compress_media_batch_headless;
use crate::utils::event::EventListenerGuard;

const VIDEO_WRITABLE_EXTENSIONS: [&str; 7] = ["mp4", "mov", "mkv", "webm", "avi", "ts", "gif"];
const AUDIO_OUTPUT_EXTENSIONS: [&str; 6] = ["mp3", "m4a", "wav", "flac", "ogg", "opus"];
const INPUT_AUDIO_EXTENSIONS: [&str; 13] = [
    "mp3", "m4a", "wav", "flac", "ogg", "opus", "aac", "m4b", "aiff", "aif", "wma", "oga", "mp2",
];
const INPUT_IMAGE_EXTENSIONS: [&str; 13] = [
    "png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "jxl", "heic", "heif", "bmp", "tiff",
    "tif",
];
const IMAGE_INPUT_ONLY_EXTENSIONS: [&str; 3] = ["bmp", "tiff", "tif"];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Lane {
    Video,
    Audio,
    Image,
}

const LANES: [Lane; 3] = [Lane::Video, Lane::Audio, Lane::Image];

static IS_RUNNING: AtomicBool = AtomicBool::new(false);
static IS_RUN_REQUESTED: AtomicBool = AtomicBool::new(false);
static QUALITY_ESTIMATES: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
static TOP_FOLDERS: OnceLock<AsyncMutex<HashMap<String, String>>> = OnceLock::new();

fn quality_estimates() -> &'static Mutex<HashMap<String, u64>> {
    QUALITY_ESTIMATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn top_folders_cache() -> &'static AsyncMutex<HashMap<String, String>> {
    TOP_FOLDERS.get_or_init(|| AsyncMutex::new(HashMap::new()))
}

fn extension_lower(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

fn lane_for_path(path: &str) -> Lane {
    let ext = extension_lower(path);
    if INPUT_AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        Lane::Audio
    } else if INPUT_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        Lane::Image
    } else {
        Lane::Video
    }
}

fn is_audio_output_ext(ext: &str) -> bool {
    AUDIO_OUTPUT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

fn get_audio_file_output_extension(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "mp3" => "mp3",
        "m4a" => "m4a",
        "wav" => "wav",
        "flac" => "flac",
        "ogg" => "ogg",
        "opus" => "opus",
        "aac" | "m4b" => "m4a",
        "aiff" | "aif" => "wav",
        "oga" => "ogg",
        _ => "mp3",
    }
}

fn audio_bitrate_for_quality(quality: u16) -> u32 {
    if quality <= 20 {
        64
    } else if quality <= 40 {
        96
    } else if quality <= 60 {
        128
    } else if quality <= 80 {
        192
    } else {
        256
    }
}

fn get_output_video_container(convert_to: &str, source_ext: &str) -> String {
    let ext = if convert_to == "-" || convert_to.is_empty() {
        source_ext
    } else {
        convert_to
    };
    match ext.to_ascii_lowercase().as_str() {
        "m4v" => String::from("mp4"),
        "mts" | "m2ts" => String::from("ts"),
        other => other.to_string(),
    }
}

fn get_output_file_name(original_name: &str, _source_ext: &str, output_ext: Option<&str>) -> String {
    match output_ext.filter(|ext| !ext.is_empty()) {
        Some(ext) => {
            let (stem, _) = planning::split_file_name(original_name);
            format!("{stem}.{ext}")
        }
        None => original_name.to_string(),
    }
}

fn parse_duration_ms(text: &str) -> f64 {
    let parts: Vec<&str> = text.trim().split(':').collect();
    let mut seconds = 0.0;
    for part in parts {
        let Ok(val) = part.parse::<f64>() else {
            return 0.0;
        };
        seconds = seconds * 60.0 + val;
    }
    seconds * 1000.0
}

/// Starts or schedules the headless queue runner whenever waiting items exist.
pub fn ensure_started(app_handle: &AppHandle) {
    if IS_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        IS_RUN_REQUESTED.store(true, Ordering::SeqCst);
        return;
    }
    IS_RUN_REQUESTED.store(false, Ordering::SeqCst);
    let app = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        run_queue_loop(app.clone()).await;
        IS_RUNNING.store(false, Ordering::SeqCst);
        if IS_RUN_REQUESTED.swap(false, Ordering::SeqCst)
            || (drop_queue::has_waiting_items(&app) && !drop_queue::is_drop_queue_paused())
        {
            ensure_started(&app);
        }
    });
}

async fn run_queue_loop(app_handle: AppHandle) {
    // Reset items left marked as compressing (e.g. if a previous run was interrupted).
    for item in drop_queue::get_drop_queue(app_handle.clone()) {
        if item.status == DropQueueItemStatus::Compressing {
            drop_queue::update_item(
                &app_handle,
                &item.id,
                DropQueueItemUpdate {
                    status: Some(DropQueueItemStatus::Waiting),
                    progress: Some(0.0),
                    ..Default::default()
                },
            );
        }
    }

    let is_paused = Arc::new(AtomicBool::new(false));
    let has_compressed = Arc::new(AtomicBool::new(false));
    let compressed_ids = Arc::new(Mutex::new(Vec::<String>::new()));
    let active_lanes = Arc::new(AtomicUsize::new(0));

    let run_lane = |lane: Lane| {
        let app_handle = app_handle.clone();
        let is_paused = is_paused.clone();
        let has_compressed = has_compressed.clone();
        let compressed_ids = compressed_ids.clone();
        let active_lanes = active_lanes.clone();
        async move {
            let max_concurrent = if lane == Lane::Image {
                crate::core::cpu_limit::image_lane_concurrency()
            } else {
                1
            };
            let mut in_flight = tokio::task::JoinSet::new();

            loop {
                active_lanes.fetch_add(1, Ordering::SeqCst);
                let mut processed = false;
                let mut exit_lane = false;

                if drop_queue::is_drop_queue_paused() {
                    is_paused.store(true, Ordering::SeqCst);
                    exit_lane = true;
                } else {
                    while is_compressing(&app_handle) && !drop_queue::is_drop_queue_paused() {
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                    if drop_queue::is_drop_queue_paused() {
                        is_paused.store(true, Ordering::SeqCst);
                        exit_lane = true;
                    } else {
                        while in_flight.len() < max_concurrent && !drop_queue::is_drop_queue_paused()
                        {
                            let mut candidates: Vec<DropQueueItem> =
                                drop_queue::get_drop_queue(app_handle.clone())
                                    .into_iter()
                                    .filter(|item| {
                                        item.status == DropQueueItemStatus::Waiting
                                            && lane_for_path(&item.path) == lane
                                    })
                                    .collect();
                            candidates.sort_by_key(|item| {
                                (item.watch_folder_id.is_some(), item.queue_order)
                            });

                            let Some(next) = candidates.into_iter().next() else {
                                break;
                            };
                            processed = true;
                            // Claim immediately before spawning so concurrent workers pick distinct items.
                            drop_queue::update_item(
                                &app_handle,
                                &next.id,
                                DropQueueItemUpdate {
                                    status: Some(DropQueueItemStatus::Compressing),
                                    progress: Some(0.0),
                                    ..Default::default()
                                },
                            );
                            if let Ok(mut ids) = compressed_ids.lock() {
                                ids.push(next.id.clone());
                            }
                            let app = app_handle.clone();
                            in_flight.spawn(async move { compress_queue_item(&app, &next).await });
                        }
                    }
                }

                if let Some(joined) = in_flight.join_next().await {
                    processed = true;
                    if joined.unwrap_or(false) {
                        has_compressed.store(true, Ordering::SeqCst);
                    }
                }

                let remaining_active = active_lanes.fetch_sub(1, Ordering::SeqCst) - 1;
                if exit_lane {
                    while let Some(joined) = in_flight.join_next().await {
                        if joined.unwrap_or(false) {
                            has_compressed.store(true, Ordering::SeqCst);
                        }
                    }
                    return;
                }
                if !processed && in_flight.is_empty() {
                    if remaining_active == 0 || is_paused.load(Ordering::SeqCst) {
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(350)).await;
                }
            }
        }
    };

    tokio::join!(
        run_lane(LANES[0]),
        run_lane(LANES[1]),
        run_lane(LANES[2]),
    );

    if !is_paused.load(Ordering::SeqCst) {
        let ids = compressed_ids
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();
        let was_stopped = drop_queue::get_drop_queue(app_handle.clone())
            .iter()
            .any(|item| item.status == DropQueueItemStatus::Cancelled && ids.contains(&item.id));
        if !was_stopped && has_compressed.load(Ordering::SeqCst) {
            let settings = crate::core::settings::get(&app_handle);
            if settings.play_completion_sound {
                crate::tauri_commands::sound::play_completion_sound();
            }
        }
    }
}

struct PreparedQueueItem {
    media_config: MediaItemConfig,
    original_name: String,
    source_extension: String,
    original_size: u64,
    output_duration_ms: f64,
    media_type: &'static str,
    preset_id: String,
    preset_output: ResolvedPresetOutput,
    preset_name: Option<String>,
    contract: Value,
}

fn effective_queue_contract(
    explicit_contract: Option<&Value>,
    preset: Option<&StoredPreset>,
    media_type: &str,
    cli_ext: Option<&str>,
) -> Value {
    let mut contract = explicit_contract.cloned().unwrap_or_else(|| match preset {
        Some(preset) => translate::preset_to_contract(preset),
        None => translate::preset_to_contract(&translate::standard_preset(media_type)),
    });
    if let Some(ext) = cli_ext.filter(|ext| !ext.is_empty()) {
        if let Some(settings_obj) = contract.get_mut("settings").and_then(|v| v.as_object_mut()) {
            settings_obj.insert(String::from("format"), Value::String(ext.to_string()));
        }
    }
    contract
}

fn queue_contract<'a>(item: &'a DropQueueItem, media_type: &str) -> Option<&'a Value> {
    item.cli_job.as_ref().and_then(|job| match media_type {
        "video" => job.contracts.video.as_ref(),
        "image" => job.contracts.image.as_ref(),
        "audio" => job.contracts.audio.as_ref(),
        _ => None,
    })
}

fn queue_preset_id(
    item: &DropQueueItem,
    media_type: &str,
    settings: &DomainSettings,
    presets: &PresetsStoreData,
) -> String {
    if let Some(job) = &item.cli_job {
        let choice = match media_type {
            "video" => job.preset_ids.video.as_deref(),
            "image" => job.preset_ids.image.as_deref(),
            "audio" => job.preset_ids.audio.as_deref(),
            _ => None,
        };
        return resolve_preset_choice_id(choice, media_type, presets);
    }
    if let Some(folder_id) = &item.watch_folder_id {
        let choice = settings
            .watched_folders
            .iter()
            .find(|f| &f.id == folder_id)
            .and_then(|f| f.preset_ids.as_ref())
            .and_then(|pids| match media_type {
                "video" => pids.video.as_deref(),
                "image" => pids.image.as_deref(),
                "audio" => pids.audio.as_deref(),
                _ => None,
            });
        return resolve_preset_choice_id(choice, media_type, presets);
    }
    let choice = match media_type {
        "video" => Some(settings.drop_zone_video_preset_id.as_str()),
        "image" => Some(settings.drop_zone_image_preset_id.as_str()),
        "audio" => Some(settings.drop_zone_audio_preset_id.as_str()),
        _ => None,
    };
    resolve_preset_choice_id(choice, media_type, presets)
}

fn parse_portable_transform(value: &Value) -> Option<PortableTransform> {
    let obj = value.as_object()?;
    let rotate = obj.get("rotate").and_then(|v| v.as_i64()).unwrap_or(0);
    let flip = obj.get("flip").and_then(|v| v.as_object());
    let horizontal = flip
        .and_then(|f| f.get("horizontal"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let vertical = flip
        .and_then(|f| f.get("vertical"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let aspect_ratio = obj
        .get("aspectRatio")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Some(PortableTransform {
        rotate,
        flip: PortableFlip {
            horizontal,
            vertical,
        },
        aspect_ratio,
    })
}

fn transformed_dimensions(
    dims: (f64, f64),
    history: Option<&[crate::core::domain::MediaTransform]>,
) -> (f64, f64) {
    let Some(actions) = history else {
        return dims;
    };
    let mut is_quarter_turned = false;
    let mut straighten = 0.0f64;
    let mut crop: Option<(f64, f64)> = None;
    for action in actions {
        match action {
            crate::core::domain::MediaTransform::Rotate { value }
                if value.rem_euclid(180) == 90 =>
            {
                is_quarter_turned = !is_quarter_turned;
            }
            crate::core::domain::MediaTransform::Straighten { value } => {
                straighten = *value;
            }
            crate::core::domain::MediaTransform::Crop { value } => {
                crop = Some((value.width, value.height));
            }
            _ => {}
        }
    }
    if let Some(cropped) = crop {
        return cropped;
    }
    let turned = if is_quarter_turned {
        (dims.1, dims.0)
    } else {
        dims
    };
    if straighten.abs() <= f64::EPSILON {
        return turned;
    }
    let rad = straighten.abs().to_radians();
    let w = turned.0 * rad.cos() + turned.1 * rad.sin();
    let h = turned.0 * rad.sin() + turned.1 * rad.cos();
    (w.round(), h.round())
}

fn longer_side_dimensions(dims: (f64, f64), longer_side: f64) -> Option<(f64, f64)> {
    let (w, h) = dims;
    if longer_side <= 0.0 || w <= 0.0 || h <= 0.0 {
        return None;
    }
    let orig = w.max(h);
    let scale = longer_side / orig;
    let to_even = |val: f64| ((val / 2.0).round() * 2.0).max(2.0);
    Some((to_even(w * scale), to_even(h * scale)))
}

fn parse_dynamic_range(value: Option<&Value>) -> Option<ImageDynamicRangeConfig> {
    let obj = value.and_then(|v| v.as_object())?;
    let mode = match obj.get("mode").and_then(|v| v.as_str()) {
        Some("boost") => ImageDynamicRangeMode::Boost,
        Some("sdr") => ImageDynamicRangeMode::Sdr,
        _ => ImageDynamicRangeMode::Original,
    };
    let intensity = obj
        .get("intensity")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(2.0);
    Some(ImageDynamicRangeConfig { mode, intensity })
}

fn image_dynamic_range_operation(
    config: Option<&ImageDynamicRangeConfig>,
    info: Option<&ImageDynamicRangeInfo>,
    output: &str,
) -> Option<ImageDynamicRangeConfig> {
    let info = info.filter(|i| i.supported)?;
    let config = config?;
    let supports_boost = matches!(output, "png" | "jxl")
        || (info.supports_hdr_jpeg && matches!(output, "jpg" | "jpeg"));
    if config.mode == ImageDynamicRangeMode::Boost && !supports_boost {
        return None;
    }
    if (info.dynamic_range == DynamicRange::Sdr && config.mode == ImageDynamicRangeMode::Boost)
        || (info.dynamic_range == DynamicRange::Hdr && config.mode == ImageDynamicRangeMode::Sdr)
    {
        let intensity = if config.intensity.is_finite() {
            config.intensity.clamp(1.0, MAX_BOOST_INTENSITY)
        } else {
            2.0
        };
        return Some(ImageDynamicRangeConfig {
            mode: config.mode,
            intensity,
        });
    }
    None
}

fn is_hdr_jpeg_output(
    output: &str,
    op: Option<&ImageDynamicRangeConfig>,
    info: Option<&ImageDynamicRangeInfo>,
) -> bool {
    matches!(output, "jpg" | "jpeg")
        && info.is_some_and(|i| {
            i.supports_hdr_jpeg
                && (op.is_some_and(|o| o.mode == ImageDynamicRangeMode::Boost)
                    || (i.supported
                        && i.dynamic_range == DynamicRange::Hdr
                        && op.is_none_or(|o| o.mode != ImageDynamicRangeMode::Sdr)))
        })
}

fn is_hdr_png_output(
    output: &str,
    op: Option<&ImageDynamicRangeConfig>,
    info: Option<&ImageDynamicRangeInfo>,
) -> bool {
    output == "png"
        && (op.is_some_and(|o| o.mode == ImageDynamicRangeMode::Boost)
            || info.is_some_and(|i| {
                i.dynamic_range == DynamicRange::Hdr
                    && op.is_none_or(|o| o.mode != ImageDynamicRangeMode::Sdr)
            }))
}

fn parse_audio_config_fields(
    preset_settings: Option<&Value>,
    has_audio: Option<bool>,
    container: Option<&str>,
) -> (AudioConfig, bool) {
    let skip_all_audio = has_audio == Some(false);
    let audio_val = preset_settings.and_then(|s| s.get("audioConfig"));
    let custom_codec_enabled = !skip_all_audio
        && preset_settings
            .and_then(|s| s.get("shouldEnableCustomAudioCodec"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
    let mut audio_codec = if custom_codec_enabled {
        audio_val
            .and_then(|a| a.get("audioCodec"))
            .and_then(|v| v.as_str())
            .filter(|s| *s != "-" && !s.is_empty())
            .map(str::to_string)
    } else {
        None
    };
    let mut audio_codec_skipped = false;
    if let (Some(cont), Some(codec)) = (container, audio_codec.as_deref()) {
        if let Some(public_codec) = spec::internal_to_audio_codec(codec) {
            if !spec::is_audio_codec_compatible(public_codec, cont) {
                audio_codec = None;
                audio_codec_skipped = true;
            }
        }
    }

    let volume = if skip_all_audio {
        100
    } else {
        audio_val
            .and_then(|a| a.get("volume"))
            .and_then(|v| v.as_u64())
            .unwrap_or(100) as u16
    };

    let custom_channel = !skip_all_audio
        && preset_settings
            .and_then(|s| s.get("shouldEnableCustomChannel"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
    let channel_config = if custom_channel && volume != 0 {
        audio_val
            .and_then(|a| a.get("audioChannelConfig"))
            .and_then(|v| v.as_object())
            .map(|ch| AudioChannelConfig {
                channel_layout: ch
                    .get("channelLayout")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                mono_source: ch.get("monoSource").and_then(|m| m.as_object()).map(|m| MonoSource {
                    left: m.get("left").and_then(|v| v.as_bool()).unwrap_or(true),
                    right: m.get("right").and_then(|v| v.as_bool()).unwrap_or(true),
                }),
                stereo_swap_channels: ch.get("stereoSwapChannels").and_then(|v| v.as_bool()),
            })
    } else {
        None
    };

    let custom_bitrate = !skip_all_audio
        && preset_settings
            .and_then(|s| s.get("shouldEnableCustomBitrate"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
    let bitrate = if custom_bitrate && volume != 0 {
        audio_val
            .and_then(|a| a.get("bitrate"))
            .and_then(|v| v.as_u64())
            .map(|b| b as u32)
    } else {
        None
    };

    (
        AudioConfig {
            volume,
            audio_channel_config: channel_config,
            bitrate,
            audio_codec,
            selected_audio_tracks: None,
            external_audio_paths: None,
        },
        audio_codec_skipped,
    )
}

fn parse_one_shot_metadata_and_assets(
    contract: &Value,
    strip_metadata: &mut bool,
    metadata_config: &mut Option<MediaMetadataConfig>,
    custom_thumbnail_path: &mut Option<String>,
    should_enable_custom_thumbnail: &mut Option<bool>,
    subtitles_config: &mut Option<SubtitlesConfig>,
) {
    let settings = &contract["settings"];
    if settings["metadata"]["mode"].as_str() == Some("keep") {
        if let Some(set) = settings["metadata"]["set"].as_object() {
            *strip_metadata = false;
            let opt_str = |key: &str| {
                set.get(key)
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            };
            *metadata_config = Some(MediaMetadataConfig {
                title: opt_str("title"),
                artist: opt_str("artist"),
                album: opt_str("album"),
                year: opt_str("year"),
                comment: opt_str("comment"),
                description: opt_str("description"),
                synopsis: opt_str("synopsis"),
                genre: opt_str("genre"),
                copyright: opt_str("copyright"),
                creation_time: opt_str("creationTime"),
            });
        }
    }

    if contract["mediaType"].as_str() == Some("video") {
        if let Some(thumb) = settings["video"]["thumbnail"]
            .as_str()
            .filter(|s| !s.is_empty())
        {
            *should_enable_custom_thumbnail = Some(true);
            *custom_thumbnail_path = Some(thumb.to_string());
        }
        if let Some(subs) = settings["subtitles"].as_object() {
            let preserve_existing = subs.get("preserveExisting").and_then(|v| v.as_bool());
            let tracks: Vec<SubtitleConfig> = subs
                .get("tracks")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|track| {
                            let path = track.get("path")?.as_str()?.to_string();
                            let file_name = Path::new(&path)
                                .file_name()
                                .and_then(|n| n.to_str())
                                .map(str::to_string);
                            Some(SubtitleConfig {
                                subtitle_path: Some(path),
                                language: track
                                    .get("language")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("und")
                                    .to_string(),
                                title: track
                                    .get("title")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string),
                                file_name,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            if !tracks.is_empty() || preserve_existing == Some(true) {
                *subtitles_config = Some(SubtitlesConfig {
                    should_enable_subtitles: Some(!tracks.is_empty()),
                    preserve_existing_subtitles: preserve_existing,
                    subtitles: tracks,
                });
            }
        }
    }
}

async fn prepare_queue_item(
    app_handle: &AppHandle,
    item: &DropQueueItem,
    settings: &DomainSettings,
    presets: &PresetsStoreData,
) -> Result<PreparedQueueItem, String> {
    let metadata = get_file_metadata(&item.path)?;
    let source_ext = extension_lower(&metadata.file_name);
    let hw_accel = item
        .cli_job
        .as_ref()
        .and_then(|j| j.use_hardware_acceleration)
        .unwrap_or(settings.use_hardware_acceleration);
    let retry_cpu = item
        .cli_job
        .as_ref()
        .and_then(|j| j.reach_target_sizes_without_acceleration)
        .unwrap_or(settings.retry_target_size_on_cpu);
    let cpu_threads = item.cli_job.as_ref().and_then(|j| j.cpu_threads);
    let cli_ext = item
        .cli_job
        .as_ref()
        .and_then(|j| j.convert_to_extension.as_deref())
        .map(str::to_ascii_lowercase);

    if INPUT_AUDIO_EXTENSIONS.contains(&source_ext.as_str()) {
        return prepare_audio_item(
            app_handle,
            item,
            settings,
            presets,
            &metadata,
            &source_ext,
            hw_accel,
            cpu_threads,
            cli_ext.as_deref(),
        )
        .await;
    }

    if metadata.mime_type.starts_with("video") {
        return prepare_video_item(
            app_handle,
            item,
            settings,
            presets,
            &metadata,
            &source_ext,
            hw_accel,
            retry_cpu,
            cpu_threads,
            cli_ext.as_deref(),
        )
        .await;
    }

    prepare_image_item(
        app_handle,
        item,
        settings,
        presets,
        &metadata,
        &source_ext,
        cli_ext.as_deref(),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn prepare_audio_item(
    app_handle: &AppHandle,
    item: &DropQueueItem,
    settings: &DomainSettings,
    presets: &PresetsStoreData,
    metadata: &crate::core::domain::FileMetadata,
    source_ext: &str,
    hw_accel: bool,
    cpu_threads: Option<usize>,
    cli_ext: Option<&str>,
) -> Result<PreparedQueueItem, String> {
    let contract = queue_contract(item, "audio").cloned();
    let preset_id = if contract.is_some() {
        String::from("cli-contract")
    } else {
        queue_preset_id(item, "audio", settings, presets)
    };
    let preset: Option<StoredPreset> = if let Some(c) = &contract {
        Some(translate::contract_to_preset(String::from("cli-contract"), c))
    } else if preset_id != "standard" {
        presets.presets.iter().find(|p| p.id == preset_id).cloned()
    } else {
        None
    };

    let mut probe = FFPROBE::new(app_handle)?;
    let basic_info = probe.get_video_basic_info(&item.path).await.ok();
    let duration = basic_info.as_ref().and_then(|i| i.duration);

    let psettings = preset.as_ref().map(|p| &p.settings);
    let mut output_ext = cli_ext
        .map(str::to_string)
        .or_else(|| {
            psettings
                .and_then(|s| s.get("convertToExtension"))
                .and_then(|v| v.as_str())
                .filter(|s| *s != "-")
                .map(str::to_string)
        })
        .unwrap_or_else(|| get_audio_file_output_extension(source_ext).to_string());
    if !is_audio_output_ext(&output_ext) {
        output_ext = get_audio_file_output_extension(source_ext).to_string();
    }

    let quality = psettings
        .and_then(|s| s.get("quality"))
        .and_then(|v| v.as_u64())
        .unwrap_or(50) as u16;
    let should_use_target_size = psettings
        .and_then(|s| s.get("shouldUseTargetSize"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let target_size_mb = psettings
        .and_then(|s| s.get("targetSizeInMB"))
        .and_then(|v| v.as_f64())
        .unwrap_or(10.0);
    let speed = if psettings
        .and_then(|s| s.get("shouldEnableCustomSpeed"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        psettings
            .and_then(|s| s.get("customSpeed"))
            .and_then(|v| v.as_f64())
            .filter(|v| (*v - 1.0).abs() > f64::EPSILON)
            .map(|v| v as f32)
    } else {
        None
    };
    let mut strip_metadata = psettings
        .and_then(|s| s.get("shouldStripMetadata"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let (mut audio_config, _) = parse_audio_config_fields(psettings, None, Some(&output_ext));
    let mut metadata_config = None;
    let mut unused_thumb = None;
    let mut unused_thumb_flag = None;
    let mut unused_subs = None;
    if let Some(c) = &contract {
        parse_one_shot_metadata_and_assets(
            c,
            &mut strip_metadata,
            &mut metadata_config,
            &mut unused_thumb,
            &mut unused_thumb_flag,
            &mut unused_subs,
        );
    }

    let mut output_duration_ms = duration.unwrap_or(0.0) * 1000.0;
    if let Some(spd) = speed {
        output_duration_ms /= (spd as f64).clamp(0.25, 4.0);
    }

    let target_size = if should_use_target_size {
        if !planning::supports_audio_target_size(&output_ext, audio_config.audio_codec.as_deref()) {
            return Err(String::from("Target size is not supported for lossless audio."));
        }
        let streams = probe.get_audio_streams(&item.path).await.ok();
        let stream = streams.as_ref().and_then(|s| s.first());
        let sample_rate = stream.and_then(|s| s.sample_rate.parse::<u32>().ok());
        let channels = if audio_config
            .audio_channel_config
            .as_ref()
            .and_then(|c| c.channel_layout.as_deref())
            == Some("mono")
        {
            Some(1)
        } else {
            stream.and_then(|s| s.channels.parse::<u32>().ok())
        };
        let plan = plan_audio_target_size(
            target_size_mb,
            output_duration_ms / 1000.0,
            &output_ext,
            audio_config.audio_codec.as_deref(),
            sample_rate,
            channels,
        )
        .ok_or_else(|| String::from("Audio duration is unknown for target size."))?;
        if plan.is_too_small {
            return Err(format!(
                "Target size is too small (minimum {:.1} MB).",
                plan.minimum_size_in_mb
            ));
        }
        if audio_config.volume != 0 {
            audio_config.bitrate = Some(plan.bitrate);
        }
        Some(TargetSize {
            size_in_bytes: plan.size_in_bytes,
            video_bitrate: 0,
            audio_bitrate: Some(plan.bitrate),
            retry_on_cpu: false,
            quality_first: false,
        })
    } else {
        if audio_config.bitrate.is_none() && audio_config.volume != 0 {
            audio_config.bitrate = Some(audio_bitrate_for_quality(quality));
        }
        None
    };

    let (preset_output, preset_name) = resolve_output_for_item(&preset, &preset_id, contract.as_ref(), settings, presets);

    Ok(PreparedQueueItem {
        media_config: MediaItemConfig {
            video_config: Some(VideoCompressionConfig {
                video_id: item.id.clone(),
                video_path: item.path.clone(),
                convert_to_extension: output_ext,
                preset_name: Some(String::from("ironclad")),
                audio_config,
                quality,
                dimensions: None,
                fps: None,
                video_codec: None,
                transform_history: None,
                strip_metadata: Some(strip_metadata),
                metadata_config,
                custom_thumbnail_path: None,
                should_enable_custom_thumbnail: None,
                trim_segments: None::<Vec<VideoTrimSegment>>,
                subtitles_config: None,
                speed,
                target_size,
                dynamic_range: None,
                use_hardware_acceleration: Some(hw_accel),
                cpu_threads,
                clips: None,
            }),
            image_config: None,
        },
        original_name: metadata.file_name.clone(),
        source_extension: source_ext.to_string(),
        original_size: metadata.size,
        output_duration_ms,
        media_type: "audio",
        preset_id,
        preset_output,
        preset_name,
        contract: effective_queue_contract(contract.as_ref(), preset.as_ref(), "audio", cli_ext),
    })
}

#[allow(clippy::too_many_arguments)]
async fn prepare_video_item(
    app_handle: &AppHandle,
    item: &DropQueueItem,
    settings: &DomainSettings,
    presets: &PresetsStoreData,
    metadata: &crate::core::domain::FileMetadata,
    source_ext: &str,
    hw_accel: bool,
    retry_cpu: bool,
    cpu_threads: Option<usize>,
    cli_ext: Option<&str>,
) -> Result<PreparedQueueItem, String> {
    let contract = queue_contract(item, "video").cloned();
    let preset_id = if contract.is_some() {
        String::from("cli-contract")
    } else {
        queue_preset_id(item, "video", settings, presets)
    };
    let preset: Option<StoredPreset> = if let Some(c) = &contract {
        Some(translate::contract_to_preset(String::from("cli-contract"), c))
    } else if preset_id != "standard" {
        presets.presets.iter().find(|p| p.id == preset_id).cloned()
    } else {
        None
    };

    let mut probe = FFPROBE::new(app_handle)?;
    let basic_info = probe.get_video_basic_info(&item.path).await?;
    let dims = basic_info
        .dimensions
        .filter(|(w, h)| w.is_finite() && h.is_finite() && *w > 0.0 && *h > 0.0);
    let source_fps = basic_info.fps.map(|f| f as f64);
    let duration = basic_info.duration;

    let has_audio = if preset.is_some() || contract.is_some() {
        probe
            .get_audio_streams(&item.path)
            .await
            .ok()
            .map(|streams| !streams.is_empty())
    } else {
        None
    };

    let psettings = preset.as_ref().map(|p| &p.settings);
    let mut convert_to_ext = cli_ext
        .map(str::to_string)
        .or_else(|| {
            psettings
                .and_then(|s| s.get("convertToExtension"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| String::from("-"));

    if has_audio == Some(false) && is_audio_output_ext(&convert_to_ext) {
        convert_to_ext = String::from("-");
    }
    if convert_to_ext == "-" {
        if VIDEO_WRITABLE_EXTENSIONS.contains(&source_ext) {
            convert_to_ext = source_ext.to_string();
        } else {
            convert_to_ext = source_ext.to_string();
        }
    }
    let container = get_output_video_container(&convert_to_ext, source_ext);

    let should_disable_compression = psettings
        .and_then(|s| s.get("shouldDisableCompression"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let quality = psettings
        .and_then(|s| s.get("quality"))
        .and_then(|v| v.as_u64())
        .unwrap_or(50) as u16;
    let should_use_target_size = psettings
        .and_then(|s| s.get("shouldUseTargetSize"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let target_size_mb = psettings
        .and_then(|s| s.get("targetSizeInMB"))
        .and_then(|v| v.as_f64())
        .unwrap_or(10.0);

    let mut video_codec = if psettings
        .and_then(|s| s.get("shouldEnableCustomVideoCodec"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        psettings
            .and_then(|s| s.get("customVideoCodec"))
            .and_then(|v| v.as_str())
            .filter(|s| *s != "-" && !s.is_empty())
            .map(str::to_string)
    } else {
        None
    };
    if let Some(codec) = video_codec.as_deref() {
        if let Some(public) = spec::internal_to_video_codec(codec) {
            if !spec::is_video_codec_compatible(public, &container) {
                video_codec = None;
            }
        }
    }

    let custom_fps = if psettings
        .and_then(|s| s.get("shouldEnableCustomFPS"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        psettings
            .and_then(|s| s.get("customFPS"))
            .and_then(|v| v.as_u64())
            .map(|f| f as f64)
    } else {
        None
    };

    let speed = if psettings
        .and_then(|s| s.get("shouldEnableCustomSpeed"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        psettings
            .and_then(|s| s.get("customSpeed"))
            .and_then(|v| v.as_f64())
            .filter(|v| (*v - 1.0).abs() > f64::EPSILON)
            .map(|v| v as f32)
    } else {
        None
    };

    let mut strip_metadata = psettings
        .and_then(|s| s.get("shouldStripMetadata"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let dynamic_range = parse_dynamic_range(psettings.and_then(|s| s.get("dynamicRange")));

    let transform_history: Option<MediaTransformHistory> = if !is_audio_output_ext(&convert_to_ext) {
        psettings
            .and_then(|s| s.get("transform"))
            .and_then(parse_portable_transform)
            .and_then(|portable| {
                let (w, h) = dims?;
                get_transforms_for_media(&portable, w, h).map(|resolved| resolved.transform_history)
            })
    } else {
        None
    };

    let preset_resolution = psettings
        .and_then(|s| s.get("resolution"))
        .and_then(|v| v.as_f64())
        .filter(|r| *r > 0.0);
    let out_dims_after_transform =
        dims.map(|d| transformed_dimensions(d, transform_history.as_deref()));
    let mut final_dimensions = preset_resolution
        .and_then(|res| out_dims_after_transform.and_then(|d| longer_side_dimensions(d, res)));

    let (mut audio_config, _) = parse_audio_config_fields(psettings, has_audio, Some(&container));

    let mut metadata_config = None;
    let mut custom_thumbnail_path = None;
    let mut should_enable_custom_thumbnail = None;
    let mut subtitles_config = None;
    if let Some(c) = &contract {
        parse_one_shot_metadata_and_assets(
            c,
            &mut strip_metadata,
            &mut metadata_config,
            &mut custom_thumbnail_path,
            &mut should_enable_custom_thumbnail,
            &mut subtitles_config,
        );
    }

    let mut output_duration_ms = duration.unwrap_or(0.0) * 1000.0;
    if let Some(spd) = speed {
        output_duration_ms /= (spd as f64).clamp(0.25, 4.0);
    }
    if convert_to_ext == "gif" {
        output_duration_ms *= 2.0;
    }

    let clips = if psettings
        .and_then(|s| s.get("shouldEnableClips"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        && convert_to_ext != "gif"
        && !is_audio_output_ext(&convert_to_ext)
    {
        let mode = psettings
            .and_then(|s| s.get("clipsMode"))
            .and_then(|v| v.as_str())
            .unwrap_or("count");
        let clip_duration = if mode == "count" {
            let count = psettings
                .and_then(|s| s.get("clipCount"))
                .and_then(|v| v.as_u64())
                .unwrap_or(2)
                .max(2) as f64;
            (output_duration_ms / 1000.0) / count
        } else {
            psettings
                .and_then(|s| s.get("clipLengthInSeconds"))
                .and_then(|v| v.as_f64())
                .unwrap_or(60.0)
        };
        if clip_duration >= 1.0 && (output_duration_ms / 1000.0) > clip_duration {
            Some(VideoClipsConfig {
                duration_seconds: clip_duration,
            })
        } else {
            None
        }
    } else {
        None
    };

    let mut final_fps = custom_fps.map(|f| (f.round() as u32).to_string());
    let mut target_size: Option<TargetSize> = None;

    if should_use_target_size && convert_to_ext != "gif" {
        if is_audio_output_ext(&convert_to_ext) {
            if !planning::supports_audio_target_size(
                &convert_to_ext,
                audio_config.audio_codec.as_deref(),
            ) {
                return Err(String::from("Target size is not supported for lossless audio."));
            }
            let streams = probe.get_audio_streams(&item.path).await.ok();
            let stream = streams.as_ref().and_then(|s| s.first());
            let sample_rate = stream.and_then(|s| s.sample_rate.parse::<u32>().ok());
            let channels = if audio_config
                .audio_channel_config
                .as_ref()
                .and_then(|c| c.channel_layout.as_deref())
                == Some("mono")
            {
                Some(1)
            } else {
                stream.and_then(|s| s.channels.parse::<u32>().ok())
            };
            let plan = plan_audio_target_size(
                target_size_mb,
                output_duration_ms / 1000.0,
                &convert_to_ext,
                audio_config.audio_codec.as_deref(),
                sample_rate,
                channels,
            )
            .ok_or_else(|| String::from("Audio duration is unknown for target size."))?;
            if plan.is_too_small {
                return Err(format!(
                    "Target size is too small (minimum {:.1} MB).",
                    plan.minimum_size_in_mb
                ));
            }
            if audio_config.volume != 0 {
                audio_config.bitrate = Some(plan.bitrate);
            }
            target_size = Some(TargetSize {
                size_in_bytes: plan.size_in_bytes,
                video_bitrate: 0,
                audio_bitrate: Some(plan.bitrate),
                retry_on_cpu: false,
                quality_first: false,
            });
        } else if let (Some(dur), Some(base_dims)) = (duration.filter(|d| *d > 0.0), out_dims_after_transform) {
            let plan_dims = final_dimensions.unwrap_or(base_dims);
            let plan_fps = match custom_fps {
                Some(cf) => Some(source_fps.map_or(cf, |sf| cf.min(sf))),
                None => source_fps,
            };
            let plan_codec = video_codec.clone().or_else(|| {
                if container == "webm" {
                    Some(String::from("libvpx-vp9"))
                } else {
                    None
                }
            });
            let track_count = if audio_config.volume == 0 {
                0
            } else if has_audio == Some(false) {
                0
            } else {
                1
            };
            let quality_cfg = VideoCompressionConfig {
                video_id: item.id.clone(),
                video_path: item.path.clone(),
                convert_to_extension: convert_to_ext.clone(),
                preset_name: Some(String::from("ironclad")),
                audio_config: audio_config.clone(),
                quality,
                dimensions: final_dimensions,
                fps: final_fps.clone(),
                video_codec: video_codec.clone(),
                transform_history: transform_history.clone(),
                strip_metadata: Some(strip_metadata),
                metadata_config: metadata_config.clone(),
                custom_thumbnail_path: custom_thumbnail_path.clone(),
                should_enable_custom_thumbnail,
                trim_segments: None,
                subtitles_config: subtitles_config.clone(),
                speed,
                target_size: None,
                dynamic_range: dynamic_range.clone(),
                use_hardware_acceleration: Some(hw_accel),
                cpu_threads,
                clips: None,
            };
            let est_size = estimate_quality_size_cached(
                app_handle,
                &quality_cfg,
                dur,
                hw_accel,
                cpu_threads,
            )
            .await;

            let plan = plan_video_target_size(&VideoTargetSizeInput {
                target_size_in_mb: target_size_mb,
                duration_in_seconds: output_duration_ms / 1000.0,
                width: plan_dims.0,
                height: plan_dims.1,
                fps: plan_fps,
                source_size_in_bytes: Some(metadata.size),
                source_duration_in_seconds: Some(dur),
                audio_track_count: track_count,
                audio_bitrate: audio_config.bitrate,
                video_codec: plan_codec,
                quality_size_in_bytes: est_size,
            });
            if !plan.fits_at_quality {
                if plan.is_resolution_lowered {
                    final_dimensions = Some((plan.dimensions[0] as f64, plan.dimensions[1] as f64));
                }
                if let Some(fps_val) = plan.fps {
                    final_fps = Some((fps_val.round() as u32).to_string());
                }
                if audio_config.volume != 0 {
                    if let Some(ab) = plan.audio_bitrate {
                        audio_config.bitrate = Some(ab);
                    }
                }
            }
            target_size = Some(TargetSize {
                size_in_bytes: plan.size_in_bytes,
                video_bitrate: plan.video_bitrate,
                audio_bitrate: None,
                retry_on_cpu: hw_accel && retry_cpu,
                quality_first: plan.fits_at_quality,
            });
        }
    }

    let (effective_preset_name, effective_quality) =
        if target_size.is_some() || !should_disable_compression {
            (Some(String::from("ironclad")), quality)
        } else {
            (None, 101)
        };

    let (preset_output, preset_name) =
        resolve_output_for_item(&preset, &preset_id, contract.as_ref(), settings, presets);

    Ok(PreparedQueueItem {
        media_config: MediaItemConfig {
            video_config: Some(VideoCompressionConfig {
                video_id: item.id.clone(),
                video_path: item.path.clone(),
                convert_to_extension: convert_to_ext,
                preset_name: effective_preset_name,
                audio_config,
                quality: effective_quality,
                dimensions: final_dimensions,
                fps: final_fps,
                video_codec,
                transform_history,
                strip_metadata: Some(strip_metadata),
                metadata_config,
                custom_thumbnail_path,
                should_enable_custom_thumbnail,
                trim_segments: None,
                subtitles_config,
                speed,
                target_size,
                dynamic_range,
                use_hardware_acceleration: Some(hw_accel),
                cpu_threads,
                clips,
            }),
            image_config: None,
        },
        original_name: metadata.file_name.clone(),
        source_extension: source_ext.to_string(),
        original_size: metadata.size,
        output_duration_ms,
        media_type: "video",
        preset_id,
        preset_output,
        preset_name,
        contract: effective_queue_contract(contract.as_ref(), preset.as_ref(), "video", cli_ext),
    })
}

async fn prepare_image_item(
    app_handle: &AppHandle,
    item: &DropQueueItem,
    settings: &DomainSettings,
    presets: &PresetsStoreData,
    metadata: &crate::core::domain::FileMetadata,
    source_ext: &str,
    cli_ext: Option<&str>,
) -> Result<PreparedQueueItem, String> {
    if crate::core::image_info::ImageInfo::is_animated_webp(&item.path) {
        return Err(String::from("Animated WebP images are not supported."));
    }
    let contract = queue_contract(item, "image").cloned();
    let preset_id = if contract.is_some() {
        String::from("cli-contract")
    } else {
        queue_preset_id(item, "image", settings, presets)
    };
    let preset: Option<StoredPreset> = if let Some(c) = &contract {
        Some(translate::contract_to_preset(String::from("cli-contract"), c))
    } else if preset_id != "standard" {
        presets.presets.iter().find(|p| p.id == preset_id).cloned()
    } else {
        None
    };

    let dims = if source_ext == "svg" {
        get_svg_dimension(&item.path).ok()
    } else {
        get_image_dimension(&item.path).ok()
    }
    .filter(|(w, h)| *w > 0 && *h > 0)
    .map(|(w, h)| (w as f64, h as f64));

    let dynamic_range_info = Box::pin(inspect_source(app_handle, &item.path, None, &[]))
        .await
        .ok()
        .map(|(info, _)| info);

    let psettings = preset.as_ref().map(|p| &p.settings);
    let mut convert_to_ext = cli_ext
        .map(str::to_string)
        .or_else(|| {
            psettings
                .and_then(|s| s.get("convertToExtension"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| String::from("-"));

    if source_ext == "gif" {
        convert_to_ext = String::from("-");
    } else if IMAGE_INPUT_ONLY_EXTENSIONS.contains(&source_ext) && convert_to_ext == "-" {
        convert_to_ext = String::from("png");
    }

    let image_output = if convert_to_ext == "-" {
        source_ext.to_string()
    } else {
        convert_to_ext.clone()
    };

    let requested_dr = parse_dynamic_range(psettings.and_then(|s| s.get("dynamicRange")));
    let image_op =
        image_dynamic_range_operation(requested_dr.as_ref(), dynamic_range_info.as_ref(), &image_output);

    let transform_history: Option<MediaTransformHistory> =
        if source_ext != "svg" && image_output != "svg" {
            psettings
                .and_then(|s| s.get("transform"))
                .and_then(parse_portable_transform)
                .and_then(|portable| {
                    let (w, h) = dims?;
                    get_transforms_for_media(&portable, w, h)
                        .map(|resolved| resolved.transform_history)
                })
        } else {
            None
        };

    let dims_after_transform =
        dims.map(|d| transformed_dimensions(d, transform_history.as_deref()));
    let preset_resolution = psettings
        .and_then(|s| s.get("resolution"))
        .and_then(|v| v.as_f64())
        .filter(|r| *r > 0.0);
    let output_dimensions = if source_ext != "svg" && image_output != "svg" {
        preset_resolution.and_then(|res| {
            dims_after_transform.and_then(|d| longer_side_dimensions(d, res))
        })
    } else {
        None
    };

    let preset_lossless = psettings
        .and_then(|s| s.get("isLossless"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let image_is_lossless = (preset_lossless
        && !is_hdr_jpeg_output(&image_output, image_op.as_ref(), dynamic_range_info.as_ref()))
        || is_hdr_png_output(&image_output, image_op.as_ref(), dynamic_range_info.as_ref());
    let quality = if image_is_lossless {
        100
    } else {
        psettings
            .and_then(|s| s.get("quality"))
            .and_then(|v| v.as_u64())
            .unwrap_or(50) as u8
    };
    let strip_metadata = psettings
        .and_then(|s| s.get("shouldStripMetadata"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let svg_scale_factor = psettings
        .and_then(|s| s.get("svgScaleFactor"))
        .and_then(|v| v.as_f64())
        .map(|v| v as f32);
    let svg_config = if psettings
        .and_then(|s| s.get("shouldEnableAdvancedSvgSetting"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        psettings
            .and_then(|s| s.get("svgConfig"))
            .and_then(|v| serde_json::from_value::<SvgConfig>(v.clone()).ok())
    } else {
        None
    };

    let should_use_target_size = psettings
        .and_then(|s| s.get("shouldUseTargetSize"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let target_size = if should_use_target_size
        && supports_image_target_size(Some(source_ext), Some(&convert_to_ext))
    {
        let kb = psettings
            .and_then(|s| s.get("targetSizeInKB"))
            .and_then(|v| v.as_f64())
            .unwrap_or(500.0);
        Some(ImageTargetSize {
            size_in_bytes: (kb * 1000.0).round() as u64,
            dimensions: output_dimensions.or(dims_after_transform),
        })
    } else {
        None
    };

    let (preset_output, preset_name) =
        resolve_output_for_item(&preset, &preset_id, contract.as_ref(), settings, presets);

    Ok(PreparedQueueItem {
        media_config: MediaItemConfig {
            video_config: None,
            image_config: Some(ImageCompressionConfig {
                hdr_jpeg_base_path: None,
                dynamic_range: image_op,
                image_id: item.id.clone(),
                image_path: item.path.clone(),
                convert_to_extension: image_output,
                svg_scale_factor,
                is_lossless: Some(image_is_lossless),
                quality,
                strip_metadata: Some(strip_metadata),
                svg_config,
                dimensions: output_dimensions,
                transform_history,
                target_size,
            }),
        },
        original_name: metadata.file_name.clone(),
        source_extension: source_ext.to_string(),
        original_size: metadata.size,
        output_duration_ms: 0.0,
        media_type: "image",
        preset_id,
        preset_output,
        preset_name,
        contract: effective_queue_contract(contract.as_ref(), preset.as_ref(), "image", cli_ext),
    })
}

fn resolve_output_for_item(
    preset: &Option<StoredPreset>,
    preset_id: &str,
    contract: Option<&Value>,
    settings: &DomainSettings,
    presets: &PresetsStoreData,
) -> (ResolvedPresetOutput, Option<String>) {
    if let Some(c) = contract {
        let mut fake_presets = presets.clone();
        if let Some(p) = preset {
            fake_presets.presets.push(p.clone());
        }
        let resolved = resolve_preset_output(Some(preset_id), &fake_presets, settings);
        let name = c["name"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Custom contract")
            .to_string();
        (resolved, Some(name))
    } else {
        let resolved = resolve_preset_output(Some(preset_id), presets, settings);
        (resolved, None)
    }
}

async fn estimate_quality_size_cached(
    app_handle: &AppHandle,
    config: &VideoCompressionConfig,
    duration: f64,
    hw_accel: bool,
    cpu_threads: Option<usize>,
) -> Option<u64> {
    let mut key_val = serde_json::to_value(config).ok()?;
    if let Some(obj) = key_val.as_object_mut() {
        obj.remove("videoId");
        obj.insert(String::from("useHardwareAcceleration"), json!(hw_accel));
    }
    let key = key_val.to_string();
    if let Ok(cache) = quality_estimates().lock() {
        if let Some(&cached) = cache.get(&key) {
            return Some(cached);
        }
    }
    let mut ffmpeg = FFMPEG::new(app_handle)
        .ok()?
        .with_hardware_acceleration(Some(hw_accel))
        .with_cpu_thread_limit(cpu_threads);
    let est = ffmpeg
        .estimate_video_size(&format!("estimate-{}", nanoid!()), config, duration)
        .await
        .ok()?;
    if let Ok(mut cache) = quality_estimates().lock() {
        if cache.len() > 256 {
            cache.clear();
        }
        cache.insert(key, est);
    }
    Some(est)
}

#[derive(Clone)]
struct OutputFileEntry {
    path: String,
    size: u64,
    file_name: String,
}

enum SaveOutcome {
    Saved {
        saved_paths: Vec<String>,
        replaced_original: bool,
    },
    SkippedLarger,
    NoSaveLocation,
    Failed,
}

async fn save_queue_outputs(
    app_handle: &AppHandle,
    item: &DropQueueItem,
    prepared: &PreparedQueueItem,
    outputs: &[OutputFileEntry],
    output_size: u64,
    settings: &DomainSettings,
    presets: &PresetsStoreData,
) -> SaveOutcome {
    let cli_job = item.cli_job.as_ref();
    let save_larger_outputs = cli_job
        .and_then(|j| j.skip_larger_outputs)
        .map(|skip| !skip)
        .unwrap_or(settings.save_larger_outputs);

    let cli_output_folder = cli_job
        .and_then(|j| j.output_folder.as_deref())
        .filter(|s| !s.is_empty());
    let save_location = if cli_output_folder.is_some() {
        SaveLocation::FixedFolder
    } else {
        prepared.preset_output.save_location
    };
    let save_folder = cli_output_folder
        .map(str::to_string)
        .or_else(|| prepared.preset_output.save_folder.clone());

    let output_template = if let Some(tpl) = cli_job.and_then(|j| j.file_name_template.as_deref()) {
        planning::sanitize_file_name_part(tpl)
    } else if let Some(prefix) = cli_job.and_then(|j| j.file_name_prefix.as_deref()) {
        planning::migrate_prefix_to_template(Some(&planning::sanitize_file_name_part(prefix)))
    } else {
        prepared.preset_output.file_name_template.clone()
    };

    let auto_savable = save_location == SaveLocation::SameFolder
        || (save_location == SaveLocation::FixedFolder
            && save_folder.as_deref().is_some_and(|f| !f.is_empty()));
    if !auto_savable {
        return SaveOutcome::NoSaveLocation;
    }

    let preserve_folder_structure = cli_job
        .and_then(|j| j.preserve_folder_structure)
        .unwrap_or(settings.preserve_folder_structure);
    let replace_original_files = cli_job
        .and_then(|j| j.replace_original_files)
        .unwrap_or(settings.replace_original_files);

    if !save_larger_outputs && prepared.original_size > 0 && output_size > prepared.original_size {
        return SaveOutcome::SkippedLarger;
    }
    if outputs.is_empty() {
        return SaveOutcome::Failed;
    }

    let is_fixed_folder = save_location == SaveLocation::FixedFolder;
    let base_dir = if is_fixed_folder {
        save_folder.unwrap_or_default()
    } else {
        Path::new(&item.path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    };

    let mut destination_dir = PathBuf::from(&base_dir);
    if is_fixed_folder && preserve_folder_structure && !item.relative_dir.is_empty() {
        let mut parts = item.relative_dir.split('/');
        let top_folder = parts.next().unwrap_or("");
        if !top_folder.is_empty() {
            let key = format!("{}\n{}\n{}", item.group_id, base_dir, top_folder);
            let mut cache = top_folders_cache().lock().await;
            let dest_top = if let Some(existing) = cache.get(&key) {
                existing.clone()
            } else {
                let candidate = PathBuf::from(&base_dir)
                    .join(top_folder)
                    .to_string_lossy()
                    .to_string();
                let Ok(avail) = get_available_path(&candidate, true).await else {
                    return SaveOutcome::Failed;
                };
                if cache.len() > 256 {
                    cache.clear();
                }
                cache.insert(key, avail.clone());
                avail
            };
            drop(cache);
            let mut path = PathBuf::from(dest_top);
            for sub in parts {
                if !sub.is_empty() {
                    path.push(sub);
                }
            }
            destination_dir = path;
        }
    }

    let exact_file_name = if cli_output_folder.is_some() && outputs.len() == 1 {
        cli_job
            .and_then(|j| j.output_file_name.as_deref())
            .filter(|s| !s.is_empty())
    } else {
        None
    };

    let template_preset_name = prepared
        .preset_name
        .clone()
        .unwrap_or_else(|| preset_name_for_template(Some(&prepared.preset_id), presets));

    let mut saved_paths = Vec::with_capacity(outputs.len());
    let mut replaced_original = false;
    for file in outputs {
        let file_name = match exact_file_name {
            Some(exact) => exact.to_string(),
            None => apply_file_name_template(
                &file.file_name,
                Some(&output_template),
                Some(&template_preset_name),
            ),
        };
        let target_path = destination_dir.join(&file_name);
        let replace_arg = if replace_original_files {
            Some(item.path.clone())
        } else {
            None
        };
        match move_file(
            app_handle.clone(),
            &file.path,
            &target_path.to_string_lossy(),
            replace_arg,
        )
        .await
        {
            Ok(moved) => {
                saved_paths.push(moved.path);
                if moved.replaced_original {
                    replaced_original = true;
                }
            }
            Err(_) => {
                if is_fixed_folder {
                    return SaveOutcome::Failed;
                }
                let Ok(assets) = ensure_assets_dir(app_handle) else {
                    return SaveOutcome::Failed;
                };
                let fallback = assets.join(&file_name);
                let Ok(moved) = move_file(
                    app_handle.clone(),
                    &file.path,
                    &fallback.to_string_lossy(),
                    None,
                )
                .await
                else {
                    return SaveOutcome::Failed;
                };
                saved_paths.push(moved.path);
            }
        }
    }

    SaveOutcome::Saved {
        saved_paths,
        replaced_original,
    }
}

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

async fn compress_queue_item(app_handle: &AppHandle, item: &DropQueueItem) -> bool {
    drop_queue::update_item(
        app_handle,
        &item.id,
        DropQueueItemUpdate {
            status: Some(DropQueueItemStatus::Compressing),
            progress: Some(0.0),
            ..Default::default()
        },
    );

    let settings = crate::core::settings::get(app_handle);
    let presets = crate::core::presets::get(app_handle);

    let prepared = match prepare_queue_item(app_handle, item, &settings, &presets).await {
        Ok(prep) => prep,
        Err(err) => {
            log::error!("[drop-queue] Could not prepare {}: {}", item.path, err);
            let is_denied = err.starts_with(PERMISSION_DENIED_ERROR);
            drop_queue::update_item(
                app_handle,
                &item.id,
                DropQueueItemUpdate {
                    status: Some(DropQueueItemStatus::Failed),
                    message: Some(if is_denied {
                        String::from("CompressO isn't allowed to read this file.")
                    } else {
                        String::from("The media could not be compressed.")
                    }),
                    is_access_denied: Some(is_denied),
                    reason: Some(String::from(if is_denied {
                        "accessDenied"
                    } else {
                        "compressFailed"
                    })),
                    error: Some(err),
                    ..Default::default()
                },
            );
            return false;
        }
    };

    if !drop_queue::is_item_compressing(app_handle, &item.id) {
        return false;
    }

    drop_queue::update_item(
        app_handle,
        &item.id,
        DropQueueItemUpdate {
            original_size: Some(prepared.original_size),
            ..Default::default()
        },
    );

    let _progress_guard = {
        let app = app_handle.clone();
        let item_id = item.id.clone();
        let output_duration_ms = prepared.output_duration_ms;
        let last_progress = AtomicUsize::new(0);
        let event_id = app_handle.listen_any(
            CustomEvents::BatchMediaCompressionProgress.as_ref(),
            move |evt| {
                let Ok(payload) =
                    serde_json::from_str::<BatchMediaCompressionProgress>(evt.payload())
                else {
                    return;
                };
                if payload.batch_id != item_id {
                    return;
                }
                let raw_pct = match payload.media_progress {
                    MediaCompressionProgress::Video(v) => {
                        if output_duration_ms > 0.0 {
                            (parse_duration_ms(&v.current_duration) * 100.0) / output_duration_ms
                        } else {
                            0.0
                        }
                    }
                    MediaCompressionProgress::Image(img) => img.progress as f64,
                };
                let rounded = raw_pct.clamp(0.0, 99.0).floor() as usize;
                let prev = last_progress.load(Ordering::Relaxed);
                if rounded > prev
                    && last_progress
                        .compare_exchange(prev, rounded, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                {
                    drop_queue::update_item(
                        &app,
                        &item_id,
                        DropQueueItemUpdate {
                            progress: Some(rounded as f64),
                            ..Default::default()
                        },
                    );
                }
            },
        );
        EventListenerGuard::for_app(app_handle.clone(), event_id)
    };

    let result = match compress_media_batch_headless(
        app_handle,
        item.id.clone(),
        vec![prepared.media_config.clone()],
    )
    .await
    {
        Ok(batch_res) => batch_res.results.get(&item.id).cloned(),
        Err(err) => {
            if err == "CANCELLED" {
                return false;
            }
            log::error!("[drop-queue] Compression failed for {}: {}", item.path, err);
            None
        }
    };

    drop(_progress_guard);

    let Some(result) = result else {
        let is_denied = false;
        drop_queue::update_item(
            app_handle,
            &item.id,
            DropQueueItemUpdate {
                status: Some(DropQueueItemStatus::Failed),
                message: Some(String::from("The media could not be compressed.")),
                is_access_denied: Some(is_denied),
                reason: Some(String::from("compressFailed")),
                error: Some(String::from("Compression produced no output.")),
                ..Default::default()
            },
        );
        return false;
    };

    let (output_meta, clips): (_, Vec<_>) = match &result {
        MediaCompressionResult::Video(v) => (v.file_metadata.as_ref(), v.clips.clone()),
        MediaCompressionResult::Image(i) => (i.file_metadata.as_ref(), Vec::new()),
    };

    let Some(output_meta) = output_meta else {
        drop_queue::update_item(
            app_handle,
            &item.id,
            DropQueueItemUpdate {
                status: Some(DropQueueItemStatus::Failed),
                message: Some(String::from("The media could not be compressed.")),
                reason: Some(String::from("compressFailed")),
                error: Some(String::from("No output metadata.")),
                ..Default::default()
            },
        );
        return false;
    };

    let original_stem = planning::split_file_name(&prepared.original_name).0;
    let output_files: Vec<OutputFileEntry> = if !clips.is_empty() {
        clips
            .iter()
            .map(|clip| {
                let meta = clip.file_metadata.as_ref();
                let ext = meta.map(|m| m.extension.as_str()).unwrap_or("");
                let name = if original_stem.is_empty() {
                    format!(
                        "Clip {}{}",
                        clip.index,
                        if ext.is_empty() {
                            String::new()
                        } else {
                            format!(".{ext}")
                        }
                    )
                } else {
                    format!(
                        "{original_stem} - Clip {}{}",
                        clip.index,
                        if ext.is_empty() {
                            String::new()
                        } else {
                            format!(".{ext}")
                        }
                    )
                };
                OutputFileEntry {
                    path: meta
                        .map(|m| m.path.clone())
                        .unwrap_or_else(|| clip.file_path.clone()),
                    size: meta.map(|m| m.size).unwrap_or(0),
                    file_name: name,
                }
            })
            .collect()
    } else {
        vec![OutputFileEntry {
            path: output_meta.path.clone(),
            size: output_meta.size,
            file_name: get_output_file_name(
                &prepared.original_name,
                &prepared.source_extension,
                Some(&output_meta.extension),
            ),
        }]
    };
    let output_size: u64 = output_files.iter().map(|f| f.size).sum();

    if !drop_queue::is_item_compressing(app_handle, &item.id) {
        for file in &output_files {
            let _ = std::fs::remove_file(&file.path);
        }
        return false;
    }

    let save_outcome = save_queue_outputs(
        app_handle,
        item,
        &prepared,
        &output_files,
        output_size,
        &settings,
        &presets,
    )
    .await;

    let saved_paths_for_history = match &save_outcome {
        SaveOutcome::Saved { saved_paths, .. } => saved_paths.clone(),
        _ => Vec::new(),
    };

    let completed_at = now_epoch_ms();
    let history_source = if item.cli_job.is_some() {
        "commandLine"
    } else if item.watch_folder_name.is_some() {
        "watchedFolder"
    } else {
        "dropZone"
    };
    let folder_name = if item.relative_dir.is_empty() {
        None
    } else {
        item.relative_dir
            .split('/')
            .next()
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let history_preset_name = prepared.preset_name.clone().or_else(|| {
        if prepared.preset_id == "standard" {
            None
        } else {
            presets
                .presets
                .iter()
                .find(|p| p.id == prepared.preset_id)
                .map(|p| p.name.clone())
        }
    });

    if !clips.is_empty() {
        let entries: Vec<HistoryEntry> = clips
            .iter()
            .enumerate()
            .map(|(index, clip)| HistoryEntry {
                id: format!("{}:clip-{}:{}", item.id, clip.index, completed_at),
                completed_at,
                media_type: String::from("video"),
                source: String::from(history_source),
                watch_folder_name: item.watch_folder_name.clone(),
                group_id: Some(item.group_id.clone()),
                folder_name: folder_name.clone(),
                relative_dir: if item.relative_dir.is_empty() {
                    None
                } else {
                    Some(item.relative_dir.clone())
                },
                original_path: item.path.clone(),
                original_size: if clip.index == 1 {
                    Some(prepared.original_size)
                } else {
                    None
                },
                output_path: saved_paths_for_history.get(index).cloned(),
                output_size: clip.file_metadata.as_ref().map(|m| m.size),
                preset_name: history_preset_name.clone(),
                contract: Some(prepared.contract.clone()),
            })
            .collect();
        history::add_entries(app_handle, entries);
    } else {
        history::add_entries(
            app_handle,
            vec![HistoryEntry {
                id: format!("{}:{}", item.id, completed_at),
                completed_at,
                media_type: String::from(prepared.media_type),
                source: String::from(history_source),
                watch_folder_name: item.watch_folder_name.clone(),
                group_id: Some(item.group_id.clone()),
                folder_name,
                relative_dir: if item.relative_dir.is_empty() {
                    None
                } else {
                    Some(item.relative_dir.clone())
                },
                original_path: item.path.clone(),
                original_size: Some(prepared.original_size),
                output_path: saved_paths_for_history.first().cloned(),
                output_size: Some(output_meta.size),
                preset_name: history_preset_name,
                contract: Some(prepared.contract.clone()),
            }],
        );
    }

    match save_outcome {
        SaveOutcome::Saved {
            saved_paths,
            replaced_original,
        } => {
            drop_queue::update_item(
                app_handle,
                &item.id,
                DropQueueItemUpdate {
                    status: Some(DropQueueItemStatus::Done),
                    progress: Some(100.0),
                    output_size: Some(output_size),
                    clip_count: Some(clips.len()),
                    saved_path: saved_paths.first().cloned(),
                    replaced_original: Some(replaced_original),
                    output_paths: Some(Vec::new()),
                    ..Default::default()
                },
            );
            if settings.copy_output_to_clipboard && item.cli_job.is_none() && !saved_paths.is_empty()
            {
                let clipboard_files = saved_paths
                    .into_iter()
                    .map(|path| ClipboardFile {
                        path,
                        file_name: None,
                    })
                    .collect();
                let _ = copy_files_to_clipboard(app_handle.clone(), clipboard_files).await;
            }
        }
        SaveOutcome::SkippedLarger => {
            if item.cli_job.is_some() {
                for file in &output_files {
                    let _ = std::fs::remove_file(&file.path);
                }
            }
            drop_queue::update_item(
                app_handle,
                &item.id,
                DropQueueItemUpdate {
                    status: Some(DropQueueItemStatus::Done),
                    progress: Some(100.0),
                    output_size: Some(output_size),
                    clip_count: Some(clips.len()),
                    output_paths: Some(if item.cli_job.is_some() {
                        Vec::new()
                    } else {
                        output_files.into_iter().map(|f| f.path).collect()
                    }),
                    message: Some(String::from("Not saved, as it is larger than the original.")),
                    reason: Some(String::from("larger")),
                    ..Default::default()
                },
            );
        }
        SaveOutcome::NoSaveLocation => {
            drop_queue::update_item(
                app_handle,
                &item.id,
                DropQueueItemUpdate {
                    status: Some(DropQueueItemStatus::Failed),
                    output_size: Some(output_size),
                    clip_count: Some(clips.len()),
                    output_paths: Some(output_files.into_iter().map(|f| f.path).collect()),
                    message: Some(String::from("Choose a save location for its preset, in Settings.")),
                    needs_save_location: Some(true),
                    reason: Some(String::from("noSaveLocation")),
                    ..Default::default()
                },
            );
        }
        SaveOutcome::Failed => {
            drop_queue::update_item(
                app_handle,
                &item.id,
                DropQueueItemUpdate {
                    status: Some(DropQueueItemStatus::Failed),
                    output_size: Some(output_size),
                    clip_count: Some(clips.len()),
                    output_paths: Some(output_files.into_iter().map(|f| f.path).collect()),
                    message: Some(String::from("The compressed media could not be saved.")),
                    needs_save_location: Some(false),
                    reason: Some(String::from("saveFailed")),
                    ..Default::default()
                },
            );
        }
    }

    item.cli_job.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lane_classification_matches_media_types() {
        assert_eq!(lane_for_path("/tmp/song.mp3"), Lane::Audio);
        assert_eq!(lane_for_path("/tmp/voice.AAC"), Lane::Audio);
        assert_eq!(lane_for_path("/tmp/photo.HEIC"), Lane::Image);
        assert_eq!(lane_for_path("/tmp/vector.svg"), Lane::Image);
        assert_eq!(lane_for_path("/tmp/clip.mp4"), Lane::Video);
        assert_eq!(lane_for_path("/tmp/recording.M4V"), Lane::Video);
    }

    #[test]
    fn duration_parser_handles_ffmpeg_timestamps() {
        assert_eq!(parse_duration_ms("00:01:30.500"), 90_500.0);
        assert_eq!(parse_duration_ms("02:10"), 130_000.0);
        assert_eq!(parse_duration_ms("bad"), 0.0);
    }

    #[test]
    fn output_file_name_replaces_extension() {
        assert_eq!(
            get_output_file_name("holiday.mov", "mov", Some("mp4")),
            "holiday.mp4"
        );
        assert_eq!(get_output_file_name("readme", "", None), "readme");
    }
}
