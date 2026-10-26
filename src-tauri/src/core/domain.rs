use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use strum::{AsRefStr, EnumProperty};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum MediaTransform {
    Crop {
        value: MediaTransformCrop,
    },
    Rotate {
        value: i64, // Angle in degrees
    },
    Flip {
        value: MediaTransformFlip,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaTransformCrop {
    pub top: f64,
    pub left: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaTransformFlip {
    pub horizontal: bool,
    pub vertical: bool,
}

pub type MediaTransformHistory = Vec<MediaTransform>;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoTrimSegment {
    pub start: f64,
    pub end: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoCompressionResult {
    pub video_id: String,
    pub file_name: String,
    pub file_path: String,
    pub file_metadata: Option<FileMetadata>,
    /// The other outputs made for a target size (each attempt), any of which can be used instead
    #[serde(default)]
    pub other_outputs: Vec<OutputOption>,
}

/// An output a video can be saved as instead (see `VideoCompressionResult::other_outputs`)
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OutputOption {
    pub file_path: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub file_name: String,
    pub mime_type: String,
    pub extension: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoCompressionProgress {
    pub video_id: String,
    pub batch_id: String,
    pub current_duration: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoThumbnail {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
}

#[derive(Clone, AsRefStr)]
pub enum CustomEvents {
    VideoCompressionProgress,
    CancelInProgressCompression,
    BatchVideoCompressionProgress,
    BatchVideoIndividualCompressionCompletion,
    ImageCompressionProgress,
    BatchImageCompressionProgress,
    BatchImageIndividualCompressionCompletion,
    BatchMediaCompressionProgress,
    BatchMediaIndividualCompressionCompletion,
}

#[derive(EnumProperty)]
pub enum TauriEvents {
    #[strum(props(key = "tauri://destroyed"))]
    Destroyed,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelInProgressCompressionPayload {
    pub ids: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub duration: Option<f64>,
    pub dimensions: Option<(f64, f64)>,
    pub fps: Option<f32>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCompressionResult {
    pub results: HashMap<String, VideoCompressionResult>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchVideoCompressionProgress {
    pub batch_id: String,
    pub current_index: usize,
    pub total_count: usize,
    pub video_progress: VideoCompressionProgress,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchVideoIndividualCompressionResult {
    pub batch_id: String,
    pub result: VideoCompressionResult,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoCompressionConfig {
    pub video_id: String,
    pub video_path: String,
    pub convert_to_extension: String,
    pub preset_name: Option<String>,
    pub audio_config: AudioConfig,
    pub quality: u16,
    pub dimensions: Option<(f64, f64)>,
    pub fps: Option<String>,
    pub video_codec: Option<String>,
    pub transform_history: Option<MediaTransformHistory>,
    pub strip_metadata: Option<bool>,
    pub metadata_config: Option<MediaMetadataConfig>,
    pub custom_thumbnail_path: Option<String>,
    pub should_enable_custom_thumbnail: Option<bool>,
    pub trim_segments: Option<Vec<VideoTrimSegment>>,
    pub subtitles_config: Option<SubtitlesConfig>,
    pub speed: Option<f32>,
    /// Compresses to (just under) a file size instead of a quality, see `TargetSize`
    pub target_size: Option<TargetSize>,
}

/// A file size a video is compressed to: the video is encoded at an average bitrate worked out by
/// the frontend (from the size, the output's duration & the audio's share), then encoded again at a
/// lower bitrate when it still came out larger
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TargetSize {
    pub size_in_bytes: u64,
    /// The video's average bitrate, in kbit/s
    pub video_bitrate: u32,
    /// Encodes again (when the size was missed) on the CPU, not the graphics card
    #[serde(default)]
    pub retry_on_cpu: bool,
    /// Encoded at its quality first (its estimated size fits), & at the bitrate only when that
    /// came out larger
    #[serde(default)]
    pub quality_first: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaMetadataConfig {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<String>,
    pub comment: Option<String>,
    pub description: Option<String>,
    pub synopsis: Option<String>,
    pub genre: Option<String>,
    pub copyright: Option<String>,
    pub creation_time: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleConfig {
    pub subtitle_path: Option<String>,
    pub language: String,
    pub title: Option<String>,
    pub file_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitlesConfig {
    pub subtitles: Vec<SubtitleConfig>,
    pub should_enable_subtitles: Option<bool>,
    pub preserve_existing_subtitles: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MonoSource {
    pub left: bool,
    pub right: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioChannelConfig {
    pub channel_layout: Option<String>,
    pub mono_source: Option<MonoSource>,
    pub stereo_swap_channels: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
    pub volume: u16,
    pub audio_channel_config: Option<AudioChannelConfig>,
    pub bitrate: Option<u32>,
    pub audio_codec: Option<String>,
    pub selected_audio_tracks: Option<Vec<usize>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub codec: String,
    pub codec_long_name: String,
    pub profile: String,
    pub codec_type: String,

    pub width: u32,
    pub height: u32,
    pub coded_width: u32,
    pub coded_height: u32,

    pub r_frame_rate: String,
    pub avg_frame_rate: String,

    pub pix_fmt: String,
    pub color_space: Option<String>,
    pub color_range: Option<String>,
    pub color_primaries: Option<String>,
    pub color_transfer: Option<String>,
    pub chroma_location: Option<String>,

    pub bit_rate: Option<String>,
    pub duration: Option<String>,

    pub nb_frames: Option<String>,
    pub refs: Option<u32>,

    pub gop_size: Option<u32>,
    pub level: Option<u32>,

    pub field_order: String,
    pub time_base: String,
    pub rotation: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub codec: String,
    pub codec_long_name: String,
    pub codec_type: String,
    pub profile: Option<String>,

    pub channels: String,
    pub channel_layout: String,

    pub sample_rate: String,
    pub sample_fmt: Option<String>,
    pub bits_per_sample: Option<u32>,

    pub bit_rate: Option<String>,
    pub duration: Option<String>,

    pub language: Option<String>,

    pub tags: Option<Vec<(String, String)>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStream {
    pub index: u32,
    pub codec: String,
    pub codec_long_name: String,
    pub codec_type: String,
    pub language: Option<String>,
    pub title: Option<String>,
    pub disposition: Disposition,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Disposition {
    pub default: bool,
    pub forced: bool,
    pub attached_pic: bool,
    pub comment: bool,
    pub karaoke: bool,
    pub lyrics: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: u64,
    pub time_base: String,
    pub start: f64,
    pub end: f64,
    pub title: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInfo {
    pub filename: String,
    pub format_name: String,
    pub format_long_name: String,
    pub duration: Option<f64>,
    pub size: u64,
    pub bit_rate: Option<u64>,
    pub nb_streams: u32,
    pub tags: Option<Vec<(String, String)>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub is_update_available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub enum ImageContainer {
    Png,
    Jpeg,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgConfig {
    pub filter_speckle: Option<usize>,
    pub color_precision: Option<i32>,
    pub layer_difference: Option<i32>,
    pub corner_threshold: Option<i32>,
    pub length_threshold: Option<f64>,
    pub splice_threshold: Option<i32>,
    pub is_bw: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageCompressionProgress {
    pub image_id: String,
    pub batch_id: String,
    pub progress: f32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageCompressionResult {
    pub image_id: String,
    pub file_name: String,
    pub file_path: String,
    pub file_metadata: Option<FileMetadata>,
    /// Compressed to a target size (see `ImageTargetSize`): whether the output fits within it
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_target_size_reached: Option<bool>,
}

/// Compressing an image to a file size (e.g. 500 KB for a form) instead of a quality: the highest
/// quality that fits, at smaller dimensions when even the lowest quality is larger (see
/// `ImageCompressor::compress_image_to_size`)
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageTargetSize {
    /// The size the output is kept within, in bytes
    pub size_in_bytes: u64,
    /// The image's size before it is lowered to fit: its custom dimensions, or its size after its
    /// transforms (when unknown, only its quality is lowered)
    #[serde(default)]
    pub dimensions: Option<(f64, f64)>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageCompressionConfig {
    pub image_id: String,
    pub image_path: String,
    pub convert_to_extension: String,
    pub svg_scale_factor: Option<f32>, // 1-8
    pub is_lossless: Option<bool>,
    pub quality: u8, // 1-100
    pub strip_metadata: Option<bool>,
    pub svg_config: Option<SvgConfig>,
    pub dimensions: Option<(f64, f64)>,
    pub transform_history: Option<MediaTransformHistory>,
    /// Compressed to fit within a size instead of at `quality` (not for SVGs & GIFs)
    #[serde(default)]
    pub target_size: Option<ImageTargetSize>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchCompressionResult {
    pub results: std::collections::HashMap<String, ImageCompressionResult>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchImageCompressionProgress {
    pub batch_id: String,
    pub current_index: usize,
    pub total_count: usize,
    pub image_progress: ImageCompressionProgress,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchIndividualCompressionResult {
    pub batch_id: String,
    pub result: ImageCompressionResult,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaItemConfig {
    pub video_config: Option<VideoCompressionConfig>,
    pub image_config: Option<ImageCompressionConfig>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "mediaType", rename_all = "lowercase")]
pub enum MediaCompressionProgress {
    Video(VideoCompressionProgress),
    Image(ImageCompressionProgress),
}

impl From<VideoCompressionProgress> for MediaCompressionProgress {
    fn from(progress: VideoCompressionProgress) -> Self {
        MediaCompressionProgress::Video(progress)
    }
}

impl From<ImageCompressionProgress> for MediaCompressionProgress {
    fn from(progress: ImageCompressionProgress) -> Self {
        MediaCompressionProgress::Image(progress)
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchMediaCompressionProgress {
    pub batch_id: String,
    pub current_index: usize,
    pub total_count: usize,
    pub media_progress: MediaCompressionProgress,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchMediaIndividualCompressionResult {
    pub batch_id: String,
    pub result: MediaCompressionResult,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "mediaType", rename_all = "lowercase")]
pub enum MediaCompressionResult {
    Video(VideoCompressionResult),
    Image(ImageCompressionResult),
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaBatchCompressionResult {
    pub results: HashMap<String, MediaCompressionResult>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageBasicInfo {
    pub filename: String,
    pub format: String,
    pub format_long_name: String,
    pub mime_type: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
    pub aspect_ratio: String,
    pub orientation: Option<u32>,
    pub dpi: Option<(u32, u32)>, // (x, y)
    pub megapixels: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageColorInfo {
    pub color_type: String,
    pub bit_depth: u8,
    pub has_alpha: bool,
    pub color_space: Option<String>,
    pub pixel_format: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExifTag {
    pub key: String,
    pub value: String,
    pub category: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExifInfo {
    pub tags: Vec<ExifTag>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub software: Option<String>,
    pub date_time_original: Option<String>,
    pub date_time_digitized: Option<String>,
    pub copyright: Option<String>,
    pub artist: Option<String>,
    pub gps_coordinates: Option<(f64, f64)>, // (latitude, longitude)
    pub lens_model: Option<String>,
    pub iso: Option<u32>,
    pub exposure_time: Option<String>,
    pub f_number: Option<String>,
    pub focal_length: Option<String>,
    pub flash: Option<String>,
}

/// A file collected from a dropped/pasted path, with the folder it was in so outputs can mirror the
/// original structure
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CollectedFile {
    pub path: String,
    /// Folder of the file relative to the dropped path's parent, `/` separated (e.g. `Vacation/Day1`
    /// for a dropped `Vacation` folder). Empty for files that were dropped directly.
    pub relative_dir: String,
}
