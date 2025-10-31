use serde::{Deserialize, Serialize};
use strum::{AsRefStr, EnumProperty};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionResult {
    pub file_name: String,
    pub file_path: String,
}

#[derive(Serialize, Deserialize)]
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
    pub file_name: String,
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
}

#[derive(EnumProperty)]
pub enum TauriEvents {
    #[strum(props(key = "tauri://destroyed"))]
    Destroyed,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelInProgressCompressionPayload {
    pub video_id: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub duration: Option<String>,
    pub dimensions: Option<(u32, u32)>,
    pub fps: Option<f32>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCoordinates {
    pub top: u32,
    pub left: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFlip {
    pub horizontal: bool,
    pub vertical: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTransforms {
    pub coordinates: VideoCoordinates,
    pub rotate: i32,
    pub flip: VideoFlip,
}
