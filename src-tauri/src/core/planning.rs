//! Shared compression planning utilities in `core`: file naming templates, video/image/audio
//! target-size math, portable transform expansion, and preset output resolution. Used by CLI/MCP,
//! watched folders, and the UI so behavior stays identical across headless and GUI paths.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use time::OffsetDateTime;

use crate::core::domain::{
    MediaTransform, MediaTransformCrop, MediaTransformFlip, MediaTransformHistory,
};
use crate::core::presets::{self, PresetsStoreData};
use crate::core::settings::{DomainSettings, SaveLocation, StoredWatchedFolder};

pub const DEFAULT_FILE_NAME_TEMPLATE: &str = "compressO-{name}";

/// Removes characters that aren't allowed in file names
pub fn sanitize_file_name_part(value: &str) -> String {
    value
        .chars()
        .filter(|&c| {
            !matches!(
                c,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\u{0000}'..='\u{001f}'
            )
        })
        .collect()
}

pub fn migrate_prefix_to_template(prefix: Option<&str>) -> String {
    match prefix {
        None => String::from(DEFAULT_FILE_NAME_TEMPLATE),
        Some("") => String::new(),
        Some(p) => format!("{p}{{name}}"),
    }
}

pub fn get_legacy_prefix_from_template(template: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)^([^{}]*)\{name\}$").unwrap());
    re.captures(template)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default()
}

pub fn split_file_name(file_name: &str) -> (String, String) {
    if let Some(last_dot) = file_name.rfind('.') {
        if last_dot > 0 && last_dot < file_name.len() - 1 {
            return (
                file_name[..last_dot].to_string(),
                file_name[last_dot + 1..].to_string(),
            );
        }
    }
    (file_name.to_string(), String::new())
}

pub fn apply_file_name_template_at(
    file_name: &str,
    template: Option<&str>,
    preset_name: Option<&str>,
    date_str: &str,
    time_str: &str,
) -> String {
    if file_name.is_empty() {
        return String::new();
    }
    let (stem, extension) = split_file_name(file_name);
    let raw_template = template.unwrap_or("");
    let pattern = if raw_template.trim().is_empty() {
        "{name}"
    } else {
        raw_template
    };
    let clean_preset = sanitize_file_name_part(preset_name.unwrap_or("Standard"))
        .trim()
        .to_string();
    let preset_token = if clean_preset.is_empty() {
        String::from("Standard")
    } else {
        clean_preset
    };

    static TOKEN_RE: OnceLock<Regex> = OnceLock::new();
    let re = TOKEN_RE.get_or_init(|| Regex::new(r"(?i)\{(name|date|time|preset)\}").unwrap());

    let mut rendered = String::with_capacity(pattern.len() + stem.len());
    let mut last_end = 0;
    for caps in re.captures_iter(pattern) {
        let Some(full) = caps.get(0) else { continue };
        rendered.push_str(&pattern[last_end..full.start()]);
        let key = caps.get(1).map(|m| m.as_str().to_ascii_lowercase());
        match key.as_deref() {
            Some("name") => rendered.push_str(&stem),
            Some("date") => rendered.push_str(date_str),
            Some("time") => rendered.push_str(time_str),
            Some("preset") => rendered.push_str(&preset_token),
            _ => {}
        }
        last_end = full.end();
    }
    rendered.push_str(&pattern[last_end..]);

    let cleaned_stem = sanitize_file_name_part(&rendered)
        .trim_end_matches(['.', ' '])
        .trim()
        .to_string();
    let final_stem = if cleaned_stem.is_empty() {
        stem
    } else {
        cleaned_stem
    };
    if extension.is_empty() {
        final_stem
    } else {
        format!("{final_stem}.{extension}")
    }
}

pub fn apply_file_name_template(
    file_name: &str,
    template: Option<&str>,
    preset_name: Option<&str>,
) -> String {
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let date_str = format!(
        "{:04}-{:02}-{:02}",
        now.year(),
        u8::from(now.month()),
        now.day()
    );
    let time_str = format!("{:02}-{:02}-{:02}", now.hour(), now.minute(), now.second());
    apply_file_name_template_at(file_name, template, preset_name, &date_str, &time_str)
}

// ---------------------------------------------------------------------------
// Video, Image, and Audio Target-Size Planning
// ---------------------------------------------------------------------------

pub const BYTES_PER_MB: f64 = 1_000_000.0;
const SIZE_MARGIN: f64 = 0.95;
const MIN_VIDEO_BITRATE: i64 = 100;
const QUALITY_BITS_SHARE: f64 = 0.6;
const LOWEST_BITS_PER_PIXEL: f64 = 0.002;
const QUALITY_FIT_MARGIN: f64 = 1.1;
const RESOLUTION_STEPS: [f64; 8] = [2160.0, 1440.0, 1080.0, 720.0, 540.0, 480.0, 360.0, 240.0];
const FRAME_RATE_STEPS: [f64; 2] = [30.0, 24.0];

fn min_bits_per_pixel(codec: Option<&str>) -> f64 {
    match codec.unwrap_or("") {
        "libx264" => 0.05,
        "libx265" => 0.035,
        "libvpx-vp9" => 0.04,
        "libaom-av1" | "libsvtav1" => 0.03,
        _ => 0.05,
    }
}

fn to_even(value: f64) -> u32 {
    ((value / 2.0).round() * 2.0).max(2.0) as u32
}

fn default_audio_bitrate(total_bitrate: f64) -> u32 {
    if total_bitrate >= 2000.0 {
        128
    } else if total_bitrate >= 800.0 {
        96
    } else if total_bitrate >= 300.0 {
        64
    } else {
        48
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoTargetSizeInput {
    #[serde(rename = "targetSizeInMB")]
    pub target_size_in_mb: f64,
    pub duration_in_seconds: f64,
    pub width: f64,
    pub height: f64,
    pub fps: Option<f64>,
    pub source_size_in_bytes: Option<u64>,
    pub source_duration_in_seconds: Option<f64>,
    pub audio_track_count: usize,
    pub audio_bitrate: Option<u32>,
    pub video_codec: Option<String>,
    pub quality_size_in_bytes: Option<u64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoTargetSizePlan {
    pub is_reachable: bool,
    #[serde(rename = "minimumSizeInMB")]
    pub minimum_size_in_mb: f64,
    pub video_bitrate: u32,
    pub audio_bitrate: Option<u32>,
    pub dimensions: [u32; 2],
    pub is_resolution_lowered: bool,
    pub fps: Option<f64>,
    pub size_in_bytes: u64,
    pub fits_at_quality: bool,
}

pub fn plan_video_target_size(input: &VideoTargetSizeInput) -> VideoTargetSizePlan {
    let duration = input.duration_in_seconds.max(0.1);
    let size_in_bytes = (input.target_size_in_mb * BYTES_PER_MB).floor().max(0.0) as u64;
    let total_bitrate = (size_in_bytes as f64 * SIZE_MARGIN * 8.0) / 1000.0 / duration;

    let audio_bitrate = if input.audio_track_count > 0 {
        Some(
            input
                .audio_bitrate
                .unwrap_or_else(|| default_audio_bitrate(total_bitrate)),
        )
    } else {
        None
    };
    let audio_share = (audio_bitrate.unwrap_or(0) as f64) * (input.audio_track_count as f64);

    let mut video_bitrate = (total_bitrate - audio_share).floor() as i64;
    if let (Some(src_size), Some(src_dur)) =
        (input.source_size_in_bytes, input.source_duration_in_seconds)
    {
        if src_size > 0 && src_dur > 0.0 {
            let source_bitrate = (src_size as f64 * 8.0) / 1000.0 / src_dur.max(0.1);
            video_bitrate = video_bitrate.min(source_bitrate.floor() as i64);
        }
    }
    let is_reachable = video_bitrate >= MIN_VIDEO_BITRATE;
    let video_bitrate_clamped = video_bitrate.max(MIN_VIDEO_BITRATE) as f64;

    let minimum_size_in_mb = ((((MIN_VIDEO_BITRATE as f64 + audio_share) * 1000.0 * duration)
        / 8.0
        / SIZE_MARGIN
        / BYTES_PER_MB)
        * 10.0)
        .ceil()
        / 10.0;

    let width = input.width.max(2.0);
    let height = input.height.max(2.0);
    let source_fps = input.fps.filter(|fps| *fps > 0.0).unwrap_or(30.0);

    let codec_bpp = min_bits_per_pixel(input.video_codec.as_deref());
    let quality_video_bitrate = input
        .quality_size_in_bytes
        .filter(|b| *b > 0)
        .map(|bytes| (bytes as f64 * 8.0) / 1000.0 / duration - audio_share);
    let min_bpp = match quality_video_bitrate {
        Some(qvb) if qvb > 0.0 => codec_bpp.min(
            (((qvb * 1000.0) / (width * height * source_fps)) * QUALITY_BITS_SHARE)
                .max(LOWEST_BITS_PER_PIXEL),
        ),
        _ => codec_bpp,
    };

    let shorter_side = width.min(height);
    let base_size = [to_even(width), to_even(height)];
    let mut sizes = vec![base_size];
    for step in RESOLUTION_STEPS {
        if step < shorter_side {
            let scale = step / shorter_side;
            sizes.push([to_even(width * scale), to_even(height * scale)]);
        }
    }
    let mut frame_rates = vec![source_fps];
    for step in FRAME_RATE_STEPS {
        if step < source_fps {
            frame_rates.push(step);
        }
    }

    let fits = |size: [u32; 2], fps: f64| -> bool {
        (video_bitrate_clamped * 1000.0) / (f64::from(size[0]) * f64::from(size[1]) * fps)
            >= min_bpp
    };

    let mut chosen_size = *sizes.last().unwrap();
    let mut chosen_fps = *frame_rates.last().unwrap();
    'search: for &size in &sizes {
        for &fps in &frame_rates {
            if fits(size, fps) {
                chosen_size = size;
                chosen_fps = fps;
                break 'search;
            }
        }
    }

    VideoTargetSizePlan {
        is_reachable,
        minimum_size_in_mb,
        video_bitrate: video_bitrate_clamped as u32,
        audio_bitrate,
        dimensions: chosen_size,
        is_resolution_lowered: chosen_size != sizes[0],
        fps: (chosen_fps != source_fps).then_some(chosen_fps),
        size_in_bytes,
        fits_at_quality: input
            .quality_size_in_bytes
            .is_some_and(|q| (q as f64) <= (size_in_bytes as f64) * QUALITY_FIT_MARGIN),
    }
}

pub const MAX_AUDIO_TARGET_SIZE_IN_MB: f64 = 10_000.0;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTargetSizePlan {
    pub size_in_bytes: u64,
    pub bitrate: u32,
    #[serde(rename = "minimumSizeInMB")]
    pub minimum_size_in_mb: f64,
    pub is_too_small: bool,
}

pub fn supports_audio_target_size(extension: &str, codec: Option<&str>) -> bool {
    let allowed: &[&str] = match extension {
        "mp3" => &["libmp3lame"],
        "m4a" => &["aac"],
        "ogg" => &["libvorbis", "libopus"],
        "opus" => &["libopus"],
        _ => return false,
    };
    match codec {
        None | Some("") | Some("-") => true,
        Some(c) => allowed.contains(&c),
    }
}

pub fn get_vorbis_target_settings(sample_rate: Option<u32>, channels: Option<u32>) -> (u32, u32, u32) {
    const RATES: [u32; 9] = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
    let wanted = sample_rate.unwrap_or(48000);
    let rate = RATES
        .iter()
        .copied()
        .min_by_key(|&v| v.abs_diff(wanted))
        .unwrap_or(48000);
    let count = channels.filter(|&c| c > 0).unwrap_or(2);
    let minimum = if rate <= 8000 {
        8 * count
    } else if rate <= 24000 {
        16 * count
    } else if count == 1 {
        32
    } else {
        24 * count
    };
    let maximum_per_channel = if rate <= 8000 {
        32
    } else if rate <= 12000 {
        48
    } else if rate <= 16000 {
        96
    } else if rate <= 24000 {
        64
    } else if rate <= 32000 {
        160
    } else {
        192
    };
    let maximum = minimum.max((maximum_per_channel * count).min(256));
    (rate, minimum, maximum)
}

pub fn plan_audio_target_size(
    target_size_in_mb: f64,
    duration_in_seconds: f64,
    extension: &str,
    codec: Option<&str>,
    sample_rate: Option<u32>,
    channels: Option<u32>,
) -> Option<AudioTargetSizePlan> {
    if !supports_audio_target_size(extension, codec)
        || !target_size_in_mb.is_finite()
        || target_size_in_mb <= 0.0
        || target_size_in_mb > MAX_AUDIO_TARGET_SIZE_IN_MB
        || !duration_in_seconds.is_finite()
        || duration_in_seconds <= 0.0
    {
        return None;
    }

    let vorbis = if extension == "ogg" && codec != Some("libopus") {
        Some(get_vorbis_target_settings(sample_rate, channels))
    } else {
        None
    };
    let minimum_bitrate = vorbis.map(|(_, min, _)| min).unwrap_or(8);
    let maximum_bitrate = vorbis
        .map(|(_, _, max)| max)
        .unwrap_or(if extension == "mp3" { 320 } else { 256 });
    let size_in_bytes = (target_size_in_mb * BYTES_PER_MB).floor().max(0.0) as u64;
    let overhead = 4096.0;
    let available_bitrate =
        (((size_in_bytes as f64 * 0.97 - overhead) * 8.0) / duration_in_seconds / 1000.0).floor();
    let minimum_size_in_mb =
        ((f64::from(minimum_bitrate) * 1000.0 * duration_in_seconds) / 8.0 + overhead)
            / 0.97
            / BYTES_PER_MB;

    let clamped = (available_bitrate as i64)
        .max(i64::from(minimum_bitrate))
        .min(i64::from(maximum_bitrate)) as u32;

    Some(AudioTargetSizePlan {
        size_in_bytes,
        bitrate: clamped,
        minimum_size_in_mb,
        is_too_small: available_bitrate < f64::from(minimum_bitrate),
    })
}

pub fn supports_image_target_size(extension: Option<&str>, convert_to_extension: Option<&str>) -> bool {
    let output = match convert_to_extension {
        None | Some("") | Some("-") => extension.unwrap_or(""),
        Some(ext) => ext,
    };
    let is_unsupported = |val: &str| matches!(val.to_ascii_lowercase().as_str(), "svg" | "gif");
    !is_unsupported(extension.unwrap_or("")) && !is_unsupported(output)
}

// ---------------------------------------------------------------------------
// Portable Transform Expansion (rotation + flip + aspect ratio crop)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortableFlip {
    #[serde(default)]
    pub horizontal: bool,
    #[serde(default)]
    pub vertical: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortableTransform {
    #[serde(default)]
    pub rotate: i64,
    #[serde(default)]
    pub flip: PortableFlip,
    #[serde(default)]
    pub aspect_ratio: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaTransformsOutput {
    pub crop: MediaTransformCrop,
    pub rotate: i64,
    pub flip: MediaTransformFlip,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMediaTransforms {
    pub transforms: MediaTransformsOutput,
    pub transform_history: MediaTransformHistory,
}

fn crop_ratio_pair(aspect_ratio: &str) -> Option<(f64, f64)> {
    match aspect_ratio {
        "1:1" => Some((1.0, 1.0)),
        "16:9" => Some((16.0, 9.0)),
        "9:16" => Some((9.0, 16.0)),
        "4:3" => Some((4.0, 3.0)),
        "3:4" => Some((3.0, 4.0)),
        "4:5" => Some((4.0, 5.0)),
        "5:4" => Some((5.0, 4.0)),
        "3:2" => Some((3.0, 2.0)),
        "2:3" => Some((2.0, 3.0)),
        "21:9" => Some((21.0, 9.0)),
        _ => None,
    }
}

pub fn normalize_rotation(rotate: i64) -> i64 {
    let quarters = (rotate as f64 / 90.0).round() as i64;
    quarters.rem_euclid(4) * 90
}

pub fn get_aspect_ratio_crop(width: f64, height: f64, aspect_ratio: &str) -> MediaTransformCrop {
    let Some((rw, rh)) = crop_ratio_pair(aspect_ratio) else {
        return MediaTransformCrop {
            left: 0.0,
            top: 0.0,
            width,
            height,
        };
    };
    let ratio = rw / rh;
    let crop_w = width.min((height * ratio).round());
    let crop_h = height.min((crop_w / ratio).round());
    MediaTransformCrop {
        left: ((width - crop_w) / 2.0).round(),
        top: ((height - crop_h) / 2.0).round(),
        width: crop_w,
        height: crop_h,
    }
}

pub fn get_transforms_for_media(
    portable: &PortableTransform,
    width: f64,
    height: f64,
) -> Option<ResolvedMediaTransforms> {
    let rotate = normalize_rotation(portable.rotate);
    let flip = MediaTransformFlip {
        horizontal: portable.flip.horizontal,
        vertical: portable.flip.vertical,
    };
    let (rot_w, rot_h) = if rotate.rem_euclid(180) == 90 {
        (height, width)
    } else {
        (width, height)
    };
    let full_crop = MediaTransformCrop {
        left: 0.0,
        top: 0.0,
        width: rot_w,
        height: rot_h,
    };
    let crop = match portable.aspect_ratio.as_deref() {
        Some(ratio) if crop_ratio_pair(ratio).is_some() => get_aspect_ratio_crop(rot_w, rot_h, ratio),
        _ => full_crop,
    };

    let mut history: Vec<MediaTransform> = Vec::new();
    if rotate != 0 {
        history.push(MediaTransform::Rotate { value: rotate });
    }
    if flip.horizontal || flip.vertical {
        history.push(MediaTransform::Flip { value: flip.clone() });
    }
    if (crop.width - rot_w).abs() > f64::EPSILON || (crop.height - rot_h).abs() > f64::EPSILON {
        history.push(MediaTransform::Crop { value: crop.clone() });
    }
    if history.is_empty() {
        return None;
    }

    let editor_flip = if rotate.rem_euclid(180) == 90 {
        MediaTransformFlip {
            horizontal: flip.vertical,
            vertical: flip.horizontal,
        }
    } else {
        flip
    };
    Some(ResolvedMediaTransforms {
        transforms: MediaTransformsOutput {
            crop,
            rotate,
            flip: editor_flip,
        },
        transform_history: history,
    })
}

// ---------------------------------------------------------------------------
// Preset Output & Watched Folder Save Resolution
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPresetOutput {
    pub save_location: SaveLocation,
    pub save_folder: Option<String>,
    pub file_name_template: String,
    pub file_prefix: String,
}

impl ResolvedPresetOutput {
    pub fn saves_automatically(&self) -> bool {
        self.save_location == SaveLocation::SameFolder
            || (self.save_location == SaveLocation::FixedFolder
                && self
                    .save_folder
                    .as_deref()
                    .is_some_and(|folder| !folder.is_empty()))
    }
}

pub fn standard_output(settings: &DomainSettings) -> ResolvedPresetOutput {
    ResolvedPresetOutput {
        save_location: settings.save_location,
        save_folder: settings.save_folder.clone(),
        file_name_template: settings.output_file_name_template.clone(),
        file_prefix: get_legacy_prefix_from_template(&settings.output_file_name_template),
    }
}

pub fn resolve_preset_output(
    preset_id: Option<&str>,
    presets_data: &PresetsStoreData,
    settings: &DomainSettings,
) -> ResolvedPresetOutput {
    let found = preset_id.and_then(|id| presets_data.presets.iter().find(|p| p.id == id));
    if let Some(preset) = found {
        if let Some(output_val) = &preset.output {
            if let Some(obj) = output_val.as_object() {
                let save_location = match obj.get("saveLocation").and_then(|v| v.as_str()) {
                    Some("ask") => SaveLocation::Ask,
                    Some("fixedFolder") => SaveLocation::FixedFolder,
                    _ => SaveLocation::SameFolder,
                };
                let save_folder = obj
                    .get("saveFolder")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let template = obj
                    .get("fileNameTemplate")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| {
                        let legacy = obj.get("filePrefix").and_then(|v| v.as_str());
                        migrate_prefix_to_template(legacy)
                    });
                return ResolvedPresetOutput {
                    save_location,
                    save_folder,
                    file_prefix: get_legacy_prefix_from_template(&template),
                    file_name_template: template,
                };
            }
        }
    }
    standard_output(settings)
}

pub fn resolve_preset_choice_id(
    choice_id: Option<&str>,
    media_type: &str,
    presets_data: &PresetsStoreData,
) -> String {
    let default_id = match media_type {
        "video" => &presets_data.default_preset_ids.video,
        "image" => &presets_data.default_preset_ids.image,
        "audio" => &presets_data.default_preset_ids.audio,
        _ => "standard",
    };
    match choice_id {
        Some("standard") => String::from("standard"),
        Some(id)
            if presets_data
                .presets
                .iter()
                .any(|p| p.id == id && p.media_type == media_type) =>
        {
            id.to_string()
        }
        _ => default_id.to_string(),
    }
}

pub fn can_watched_folder_save(
    folder: &StoredWatchedFolder,
    presets_data: &PresetsStoreData,
    settings: &DomainSettings,
) -> bool {
    let pids = folder.preset_ids.as_ref();
    [
        ("video", pids.and_then(|p| p.video.as_deref())),
        ("image", pids.and_then(|p| p.image.as_deref())),
        ("audio", pids.and_then(|p| p.audio.as_deref())),
    ]
    .into_iter()
    .all(|(media_type, choice)| {
        let resolved_id = resolve_preset_choice_id(choice, media_type, presets_data);
        resolve_preset_output(Some(&resolved_id), presets_data, settings).saves_automatically()
    })
}

pub fn preset_name_for_template(
    preset_id: Option<&str>,
    presets_data: &PresetsStoreData,
) -> String {
    let Some(id) = preset_id else {
        return String::from("Standard");
    };
    if id == "standard" {
        return String::from("Standard");
    }
    presets::get_name_by_id(presets_data, id).unwrap_or_else(|| String::from("Standard"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_template_matches_frontend_rules() {
        assert_eq!(
            apply_file_name_template_at(
                "vacation.mp4",
                Some(DEFAULT_FILE_NAME_TEMPLATE),
                None,
                "2026-11-26",
                "09-05-03",
            ),
            "compressO-vacation.mp4"
        );
        assert_eq!(
            apply_file_name_template_at(
                "my.clip.mp4",
                Some("{name}_{date}_{time}_{preset}"),
                Some("Web / 1080p"),
                "2026-11-26",
                "09-05-03",
            ),
            "my.clip_2026-11-26_09-05-03_Web  1080p.mp4"
        );
        assert_eq!(
            apply_file_name_template_at(
                "literal_{date}.png",
                Some("{name}_out"),
                None,
                "2026-11-26",
                "09-05-03",
            ),
            "literal_{date}_out.png"
        );
        assert_eq!(
            apply_file_name_template_at(
                "clip.mov",
                Some("///..."),
                None,
                "2026-11-26",
                "09-05-03",
            ),
            "clip.mov"
        );
        assert_eq!(
            split_file_name(".hidden"),
            (String::from(".hidden"), String::new())
        );
    }

    #[test]
    fn video_target_size_plan_computes_bitrate_and_steps_down() {
        let plan = plan_video_target_size(&VideoTargetSizeInput {
            target_size_in_mb: 10.0,
            duration_in_seconds: 120.0,
            width: 1920.0,
            height: 1080.0,
            fps: Some(60.0),
            source_size_in_bytes: None,
            source_duration_in_seconds: None,
            audio_track_count: 1,
            audio_bitrate: None,
            video_codec: Some(String::from("libx264")),
            quality_size_in_bytes: None,
        });
        assert!(plan.is_reachable);
        assert!(plan.is_resolution_lowered);
        assert_eq!(plan.audio_bitrate, Some(64));
        assert!(plan.video_bitrate > 500 && plan.video_bitrate < 700);
    }

    #[test]
    fn audio_target_size_plan_matches_vorbis_and_mp3_limits() {
        assert!(supports_audio_target_size("mp3", None));
        assert!(!supports_audio_target_size("flac", None));
        assert!(!supports_audio_target_size("mp3", Some("aac")));

        let plan = plan_audio_target_size(1.0, 60.0, "mp3", None, None, None).unwrap();
        assert_eq!(plan.size_in_bytes, 1_000_000);
        assert!(!plan.is_too_small);
        assert!(plan.bitrate >= 120 && plan.bitrate <= 135);

        let tiny = plan_audio_target_size(0.01, 600.0, "ogg", Some("libvorbis"), Some(48000), Some(2)).unwrap();
        assert!(tiny.is_too_small);
        assert_eq!(tiny.bitrate, 48);
    }

    #[test]
    fn portable_transform_squares_and_rotates() {
        let resolved = get_transforms_for_media(
            &PortableTransform {
                rotate: 90,
                flip: PortableFlip {
                    horizontal: true,
                    vertical: false,
                },
                aspect_ratio: Some(String::from("1:1")),
            },
            1920.0,
            1080.0,
        )
        .unwrap();
        assert_eq!(resolved.transforms.rotate, 90);
        assert_eq!(resolved.transforms.crop.width, 1080.0);
        assert_eq!(resolved.transforms.crop.height, 1080.0);
        assert!(resolved.transforms.flip.vertical);
        assert!(!resolved.transforms.flip.horizontal);
    }
}
