//! CompressO JSON Contract v1 constants, compatibility tables, default contracts,
//! capabilities, and Draft 2020-12 JSON Schema generator.

use serde_json::{json, Value};

pub const CONTRACT_VERSION: u64 = 1;
pub const PRESET_NAME_MAX_LENGTH: usize = 40;
pub const MIN_RESOLUTION_PX: i64 = 2;

pub const MEDIA_TYPES: &[&str] = &["video", "image", "audio"];

pub const VIDEO_CONTAINER_FORMATS: &[&str] = &["mp4", "mov", "mkv", "webm", "avi", "ts", "gif"];
pub const AUDIO_OUTPUT_FORMATS: &[&str] = &["mp3", "m4a", "wav", "flac", "ogg", "opus"];
pub const VIDEO_OUTPUT_FORMATS: &[&str] = &[
    "mp4", "mov", "mkv", "webm", "avi", "ts", "gif", "mp3", "m4a", "wav", "flac", "ogg", "opus",
];
pub const IMAGE_OUTPUT_FORMATS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "svg", "avif", "jxl", "heic", "heif",
];

pub const VIDEO_INPUT_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "mkv", "webm", "avi", "ts", "gif", "m4v", "mts", "m2ts",
];
pub const IMAGE_INPUT_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "jxl", "heic", "heif", "bmp", "tiff",
    "tif",
];
pub const AUDIO_INPUT_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "wav", "flac", "ogg", "opus", "aac", "m4b", "aiff", "aif", "wma", "oga", "mp2",
];

pub const VIDEO_CODEC_NAMES: &[&str] = &["h264", "hevc", "vp9", "av1", "mpeg4"];
pub const AUDIO_CODEC_NAMES: &[&str] = &[
    "aac", "mp3", "opus", "vorbis", "ac3", "alac", "flac", "pcm",
];
pub const RESOLUTION_PRESETS: &[&str] = &["480p", "720p", "1080p", "2k", "4k"];
pub const CROP_ASPECT_RATIOS: &[&str] = &[
    "1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "3:2", "2:3", "21:9",
];
pub const AUDIO_BITRATES: &[i64] = &[64, 96, 128, 160, 192, 256, 320];
pub const ROTATION_VALUES: &[i64] = &[0, 90, 180, 270];
pub const MONO_SOURCES: &[&str] = &["mix", "left", "right"];
pub const SAVE_LOCATIONS: &[&str] = &["sameFolder", "folder", "ask"];
pub const METADATA_TAG_KEYS: &[&str] = &[
    "title",
    "artist",
    "album",
    "year",
    "comment",
    "description",
    "synopsis",
    "genre",
    "copyright",
    "creationTime",
];
pub const THUMBNAIL_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];
pub const SUBTITLE_EXTENSIONS: &[&str] = &["srt"];
pub const ALLOWED_FILE_NAME_TOKENS: &[&str] = &["{name}", "{date}", "{time}", "{preset}"];

pub fn video_codec_to_internal(name: &str) -> Option<&'static str> {
    match name {
        "h264" => Some("libx264"),
        "hevc" => Some("libx265"),
        "vp9" => Some("libvpx-vp9"),
        "av1" => Some("libaom-av1"),
        "mpeg4" => Some("mpeg4"),
        _ => None,
    }
}

pub fn internal_to_video_codec(internal: &str) -> Option<&'static str> {
    match internal {
        "libx264" => Some("h264"),
        "libx265" => Some("hevc"),
        "libvpx-vp9" => Some("vp9"),
        "libaom-av1" | "libsvtav1" => Some("av1"),
        "mpeg4" => Some("mpeg4"),
        _ => None,
    }
}

pub fn audio_codec_to_internal(name: &str) -> Option<&'static str> {
    match name {
        "aac" => Some("aac"),
        "mp3" => Some("libmp3lame"),
        "opus" => Some("libopus"),
        "vorbis" => Some("libvorbis"),
        "ac3" => Some("ac3"),
        "alac" => Some("alac"),
        "flac" => Some("flac"),
        "pcm" => Some("pcm_s16le"),
        _ => None,
    }
}

pub fn internal_to_audio_codec(internal: &str) -> Option<&'static str> {
    match internal {
        "aac" => Some("aac"),
        "libmp3lame" => Some("mp3"),
        "libopus" => Some("opus"),
        "libvorbis" => Some("vorbis"),
        "ac3" => Some("ac3"),
        "alac" => Some("alac"),
        "flac" => Some("flac"),
        "pcm_s16le" => Some("pcm"),
        _ => None,
    }
}

pub fn resolution_preset_pixels(preset: &str) -> Option<i64> {
    match preset {
        "480p" => Some(854),
        "720p" => Some(1280),
        "1080p" => Some(1920),
        "2k" => Some(2560),
        "4k" => Some(3840),
        _ => None,
    }
}

pub fn pixels_to_resolution_preset(px: i64) -> Option<&'static str> {
    match px {
        854 => Some("480p"),
        1280 => Some("720p"),
        1920 => Some("1080p"),
        2560 => Some("2k"),
        3840 => Some("4k"),
        _ => None,
    }
}

pub fn video_codec_containers(public_codec: &str) -> &'static [&'static str] {
    match public_codec {
        "h264" => &["mp4", "mov", "mkv", "avi", "ts"],
        "hevc" => &["mp4", "mov", "mkv", "ts"],
        "vp9" => &["webm", "mkv"],
        "av1" => &["mp4", "mkv", "webm"],
        "mpeg4" => &["mp4", "mov", "mkv", "avi"],
        _ => &[],
    }
}

pub fn audio_codec_containers(public_codec: &str) -> &'static [&'static str] {
    match public_codec {
        "aac" => &["mp4", "mov", "mkv", "ts", "m4a"],
        "mp3" => &["mp4", "mov", "mkv", "avi", "ts", "mp3"],
        "opus" => &["webm", "mkv", "ogg", "opus"],
        "vorbis" => &["webm", "mkv", "ogg"],
        "ac3" => &["mp4", "mov", "mkv", "avi", "ts"],
        "alac" => &["mp4", "mov", "m4a"],
        "flac" => &["mkv", "flac", "ogg"],
        "pcm" => &["mov", "avi", "wav"],
        _ => &[],
    }
}

pub fn is_video_codec_compatible(public_codec: &str, container: &str) -> bool {
    let allowed = video_codec_containers(public_codec);
    allowed.is_empty() || allowed.contains(&container)
}

pub fn is_audio_codec_compatible(public_codec: &str, container: &str) -> bool {
    let allowed = audio_codec_containers(public_codec);
    allowed.is_empty() || allowed.contains(&container)
}

pub fn default_video_contract() -> Value {
    json!({
        "version": CONTRACT_VERSION,
        "mediaType": "video",
        "settings": {
            "format": null,
            "compression": { "mode": "quality", "quality": 50 },
            "speed": null,
            "metadata": { "mode": "strip" },
            "video": {
                "codec": null,
                "resolution": null,
                "fps": null,
                "transform": null,
                "hdr": null,
                "thumbnail": null
            },
            "audio": {
                "volumePercent": 100,
                "codec": null,
                "channels": null,
                "bitrateKbps": null
            },
            "subtitles": null,
            "clips": null
        },
        "output": null
    })
}

pub fn default_image_contract() -> Value {
    json!({
        "version": CONTRACT_VERSION,
        "mediaType": "image",
        "settings": {
            "format": null,
            "compression": { "mode": "quality", "quality": 50 },
            "stripMetadata": true,
            "image": {
                "resolution": null,
                "transform": null,
                "hdr": null
            },
            "svg": {
                "scale": 1,
                "tracing": null
            }
        },
        "output": null
    })
}

pub fn default_audio_contract() -> Value {
    json!({
        "version": CONTRACT_VERSION,
        "mediaType": "audio",
        "settings": {
            "format": null,
            "compression": { "mode": "quality", "quality": 50 },
            "speed": null,
            "metadata": { "mode": "strip" },
            "audio": {
                "volumePercent": 100,
                "codec": null,
                "channels": null,
                "bitrateKbps": null
            }
        },
        "output": null
    })
}

pub fn get_contract_capabilities() -> Value {
    json!({
        "contractVersion": CONTRACT_VERSION,
        "formats": {
            "video": VIDEO_OUTPUT_FORMATS,
            "image": IMAGE_OUTPUT_FORMATS,
            "audio": AUDIO_OUTPUT_FORMATS,
        },
        "resolutions": {
            "original": null,
            "480p": 854,
            "720p": 1280,
            "1080p": 1920,
            "2k": 2560,
            "4k": 3840,
        },
        "cropAspectRatios": CROP_ASPECT_RATIOS,
        "videoCodecs": {
            "h264": video_codec_containers("h264"),
            "hevc": video_codec_containers("hevc"),
            "vp9": video_codec_containers("vp9"),
            "av1": video_codec_containers("av1"),
            "mpeg4": video_codec_containers("mpeg4"),
        },
        "audioCodecs": {
            "aac": audio_codec_containers("aac"),
            "mp3": audio_codec_containers("mp3"),
            "opus": audio_codec_containers("opus"),
            "vorbis": audio_codec_containers("vorbis"),
            "ac3": audio_codec_containers("ac3"),
            "alac": audio_codec_containers("alac"),
            "flac": audio_codec_containers("flac"),
            "pcm": audio_codec_containers("pcm"),
        },
        "audioBitratesKbps": AUDIO_BITRATES,
        "limits": {
            "presetNameMaxLength": PRESET_NAME_MAX_LENGTH,
            "quality": { "min": 1, "max": 100 },
            "videoTargetSizeMB": { "min": 1, "max": 10000, "default": 10 },
            "imageTargetSizeMB": { "min": 0.01, "max": 100, "default": 0.5 },
            "audioTargetSizeMB": { "min": 0.001, "max": 10000, "default": 10 },
            "resolutionMinPx": MIN_RESOLUTION_PX,
            "fps": { "min": 1, "max": 60 },
            "speed": { "min": 0.25, "max": 4 },
            "volumePercent": { "min": 0, "max": 200 },
            "hdrIntensity": { "min": 1, "max": 8 },
            "clipsCount": { "min": 2, "max": 1440 },
            "clipsDurationSeconds": { "min": 1, "max": 86400 },
            "svgScale": { "min": 1, "max": 8 },
            "svgTracing": {
                "filterSpeckle": { "min": 0, "max": 128, "default": 4 },
                "colorPrecision": { "min": 1, "max": 8, "default": 6 },
                "layerDifference": { "min": 0, "max": 128, "default": 16 },
                "cornerThreshold": { "min": 0, "max": 180, "default": 60 },
                "lengthThreshold": { "min": 0, "max": 10, "default": 4 },
                "spliceThreshold": { "min": 0, "max": 180, "default": 45 },
            },
        },
        "fileNameTokens": ALLOWED_FILE_NAME_TOKENS,
        "defaults": {
            "video": default_video_contract(),
            "image": default_image_contract(),
            "audio": default_audio_contract(),
        },
    })
}

fn nullable(schema: Value) -> Value {
    json!({ "anyOf": [schema, { "type": "null" }] })
}

fn resolution_schema() -> Value {
    json!({
        "description": "Longer side target: null keeps original size, or use a preset name (480p..4k) or an even pixel integer >= 2.",
        "anyOf": [
            { "type": "string", "enum": RESOLUTION_PRESETS },
            { "type": "integer", "minimum": MIN_RESOLUTION_PX, "multipleOf": 2 },
            { "type": "null" },
        ]
    })
}

fn transform_schema() -> Value {
    nullable(json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["rotate", "flipHorizontal", "flipVertical", "crop"],
        "properties": {
            "rotate": { "type": "integer", "enum": ROTATION_VALUES },
            "flipHorizontal": { "type": "boolean" },
            "flipVertical": { "type": "boolean" },
            "crop": nullable(json!({ "type": "string", "enum": CROP_ASPECT_RATIOS })),
        }
    }))
}

fn hdr_schema() -> Value {
    json!({
        "description": "null keeps original dynamic range.",
        "anyOf": [
            {
                "type": "object",
                "additionalProperties": false,
                "required": ["mode", "intensity"],
                "properties": {
                    "mode": { "const": "boost" },
                    "intensity": { "type": "number", "minimum": 1, "maximum": 8 },
                }
            },
            {
                "type": "object",
                "additionalProperties": false,
                "required": ["mode"],
                "properties": { "mode": { "const": "remove" } }
            },
            { "type": "null" }
        ]
    })
}

fn audio_settings_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "volumePercent": { "type": "number", "minimum": 0, "maximum": 200 },
            "codec": nullable(json!({ "type": "string", "enum": AUDIO_CODEC_NAMES })),
            "channels": {
                "anyOf": [
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["layout", "source"],
                        "properties": {
                            "layout": { "const": "mono" },
                            "source": { "type": "string", "enum": MONO_SOURCES }
                        }
                    },
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["layout", "swapChannels"],
                        "properties": {
                            "layout": { "const": "stereo" },
                            "swapChannels": { "type": "boolean" }
                        }
                    },
                    { "type": "null" }
                ]
            },
            "bitrateKbps": nullable(json!({ "type": "integer", "enum": AUDIO_BITRATES })),
        }
    })
}

fn metadata_schema(one_shot: bool) -> Value {
    let mut keep_props = serde_json::Map::new();
    keep_props.insert(String::from("mode"), json!({ "const": "keep" }));
    if one_shot {
        let mut tag_props = serde_json::Map::new();
        for &key in METADATA_TAG_KEYS {
            tag_props.insert(key.to_string(), nullable(json!({ "type": "string" })));
        }
        keep_props.insert(
            String::from("set"),
            json!({
                "anyOf": [
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "x-compresso-scope": "oneShot",
                        "description": "One-shot compression only (single file or batch). Rejected when saving a preset.",
                        "properties": tag_props,
                    },
                    { "type": "null" }
                ],
                "x-compresso-scope": "oneShot",
                "description": "One-shot compression only (single file or batch). Writes metadata tags; rejected when saving a preset."
            }),
        );
    }
    json!({
        "oneOf": [
            {
                "type": "object",
                "additionalProperties": false,
                "required": ["mode"],
                "properties": { "mode": { "const": "strip" } }
            },
            {
                "type": "object",
                "additionalProperties": false,
                "required": ["mode"],
                "properties": keep_props
            }
        ]
    })
}

fn output_schema() -> Value {
    nullable(json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["saveTo", "fileNameTemplate"],
        "properties": {
            "saveTo": { "type": "string", "enum": SAVE_LOCATIONS },
            "folder": nullable(json!({
                "type": "string",
                "description": "Absolute folder path, required when saveTo is \"folder\"."
            })),
            "fileNameTemplate": {
                "type": "string",
                "description": "Tokens: {name}, {date}, {time}, {preset}. Empty string keeps original file names."
            }
        }
    }))
}

pub fn get_contract_json_schema(media_type: &str, one_shot: bool) -> Value {
    let base_props = |mt: &str| {
        json!({
            "$schema": { "type": "string" },
            "version": { "const": CONTRACT_VERSION },
            "mediaType": { "const": mt },
            "name": {
                "type": "string",
                "maxLength": PRESET_NAME_MAX_LENGTH,
                "description": "Preset name (required when saving a preset; optional in one-shot compression)."
            },
            "output": output_schema(),
        })
    };

    match media_type {
        "image" => {
            let mut root_props = base_props("image").as_object().unwrap().clone();
            root_props.insert(
                String::from("settings"),
                json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "format": nullable(json!({ "type": "string", "enum": IMAGE_OUTPUT_FORMATS })),
                        "compression": {
                            "oneOf": [
                                {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": ["mode", "quality"],
                                    "properties": {
                                        "mode": { "const": "quality" },
                                        "quality": { "type": "number", "minimum": 1, "maximum": 100 }
                                    }
                                },
                                {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": ["mode"],
                                    "properties": { "mode": { "const": "lossless" } }
                                },
                                {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": ["mode", "targetSizeMB"],
                                    "properties": {
                                        "mode": { "const": "targetSize" },
                                        "targetSizeMB": { "type": "number", "minimum": 0.01, "maximum": 100 }
                                    }
                                }
                            ]
                        },
                        "stripMetadata": { "type": "boolean" },
                        "image": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "resolution": resolution_schema(),
                                "transform": transform_schema(),
                                "hdr": hdr_schema(),
                            }
                        },
                        "svg": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "scale": { "type": "integer", "minimum": 1, "maximum": 8 },
                                "tracing": nullable(json!({
                                    "type": "object",
                                    "additionalProperties": false,
                                    "properties": {
                                        "filterSpeckle": { "type": "integer", "minimum": 0, "maximum": 128 },
                                        "colorPrecision": { "type": "integer", "minimum": 1, "maximum": 8 },
                                        "layerDifference": { "type": "integer", "minimum": 0, "maximum": 128 },
                                        "cornerThreshold": { "type": "integer", "minimum": 0, "maximum": 180 },
                                        "lengthThreshold": { "type": "number", "minimum": 0, "maximum": 10 },
                                        "spliceThreshold": { "type": "integer", "minimum": 0, "maximum": 180 },
                                        "blackAndWhite": { "type": "boolean" },
                                    }
                                }))
                            }
                        }
                    }
                }),
            );
            json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "CompressO Image Contract (v1)",
                "type": "object",
                "additionalProperties": false,
                "required": ["version", "mediaType"],
                "properties": root_props,
            })
        }
        "audio" => {
            let mut root_props = base_props("audio").as_object().unwrap().clone();
            root_props.insert(
                String::from("settings"),
                json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "format": nullable(json!({ "type": "string", "enum": AUDIO_OUTPUT_FORMATS })),
                        "compression": {
                            "oneOf": [
                                {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": ["mode", "quality"],
                                    "properties": {
                                        "mode": { "const": "quality" },
                                        "quality": { "type": "number", "minimum": 1, "maximum": 100 }
                                    }
                                },
                                {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": ["mode", "targetSizeMB"],
                                    "properties": {
                                        "mode": { "const": "targetSize" },
                                        "targetSizeMB": { "type": "number", "minimum": 0.001, "maximum": 10000 }
                                    }
                                }
                            ]
                        },
                        "speed": nullable(json!({ "type": "number", "minimum": 0.25, "maximum": 4 })),
                        "metadata": metadata_schema(one_shot),
                        "audio": audio_settings_schema(),
                    }
                }),
            );
            json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "CompressO Audio Contract (v1)",
                "type": "object",
                "additionalProperties": false,
                "required": ["version", "mediaType"],
                "properties": root_props,
            })
        }
        _ => {
            let mut video_props = json!({
                "codec": nullable(json!({ "type": "string", "enum": VIDEO_CODEC_NAMES })),
                "resolution": resolution_schema(),
                "fps": nullable(json!({ "type": "integer", "minimum": 1, "maximum": 60 })),
                "transform": transform_schema(),
                "hdr": hdr_schema(),
            })
            .as_object()
            .unwrap()
            .clone();
            if one_shot {
                video_props.insert(
                    String::from("thumbnail"),
                    json!({
                        "anyOf": [
                            { "type": "string", "minLength": 1, "description": "Absolute path to a png, jpg, jpeg, or webp cover image." },
                            { "type": "null" }
                        ],
                        "x-compresso-scope": "oneShot",
                        "description": "One-shot compression only (single file or batch). Rejected when saving a preset."
                    }),
                );
            }
            let mut settings_props = json!({
                "format": nullable(json!({ "type": "string", "enum": VIDEO_OUTPUT_FORMATS })),
                "compression": {
                    "oneOf": [
                        {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["mode", "quality"],
                            "properties": {
                                "mode": { "const": "quality" },
                                "quality": { "type": "number", "minimum": 1, "maximum": 100 }
                            }
                        },
                        {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["mode", "targetSizeMB"],
                            "properties": {
                                "mode": { "const": "targetSize" },
                                "targetSizeMB": { "type": "number", "minimum": 1, "maximum": 10000 }
                            }
                        },
                        {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["mode"],
                            "properties": { "mode": { "const": "none" } }
                        }
                    ]
                },
                "speed": nullable(json!({ "type": "number", "minimum": 0.25, "maximum": 4 })),
                "metadata": metadata_schema(one_shot),
                "video": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": video_props,
                },
                "audio": audio_settings_schema(),
                "clips": {
                    "anyOf": [
                        {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["mode", "count"],
                            "properties": {
                                "mode": { "const": "count" },
                                "count": { "type": "integer", "minimum": 2, "maximum": 1440 }
                            }
                        },
                        {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["mode", "seconds"],
                            "properties": {
                                "mode": { "const": "duration" },
                                "seconds": { "type": "number", "minimum": 1, "maximum": 86400 }
                            }
                        },
                        { "type": "null" }
                    ]
                }
            })
            .as_object()
            .unwrap()
            .clone();
            if one_shot {
                settings_props.insert(
                    String::from("subtitles"),
                    json!({
                        "anyOf": [
                            {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["preserveExisting", "tracks"],
                                "properties": {
                                    "preserveExisting": { "type": "boolean" },
                                    "tracks": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": false,
                                            "required": ["path"],
                                            "properties": {
                                                "path": { "type": "string", "minLength": 1, "description": "Absolute path to an .srt subtitle file." },
                                                "language": { "type": "string", "minLength": 1 },
                                                "title": nullable(json!({ "type": "string" })),
                                            }
                                        }
                                    }
                                }
                            },
                            { "type": "null" }
                        ],
                        "x-compresso-scope": "oneShot",
                        "description": "One-shot compression only (single file or batch). Rejected when saving a preset."
                    }),
                );
            }
            let mut root_props = base_props("video").as_object().unwrap().clone();
            root_props.insert(
                String::from("settings"),
                json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": settings_props,
                }),
            );
            json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "CompressO Video Contract (v1)",
                "type": "object",
                "additionalProperties": false,
                "required": ["version", "mediaType"],
                "properties": root_props,
            })
        }
    }
}
