//! Bidirectional translation between public CompressO JSON contracts (`version: 1`) and
//! internal `StoredPreset` settings + English summary generation (`CliPreset`).

use serde_json::{json, Map, Value};

use crate::core::contract::spec::*;
use crate::core::planning;
use crate::core::presets::{DefaultPresetIds, StoredPreset};
use crate::core::settings::DomainSettings;

fn contract_to_resolution(resolution: &Value) -> Value {
    if resolution.is_null() {
        return Value::Null;
    }
    if let Some(preset) = resolution.as_str() {
        return resolution_preset_pixels(preset)
            .map(|px| json!(px))
            .unwrap_or(Value::Null);
    }
    if let Some(px) = resolution.as_i64() {
        return json!(px);
    }
    resolution.clone()
}

fn resolution_to_contract(longer_side: &Value) -> Value {
    let Some(px) = longer_side.as_i64().filter(|&n| n > 0) else {
        return Value::Null;
    };
    match pixels_to_resolution_preset(px) {
        Some(name) => Value::String(name.to_string()),
        None => json!(px),
    }
}

fn contract_to_transform(transform: &Value) -> Value {
    let Some(obj) = transform.as_object() else {
        return Value::Null;
    };
    let rotate = obj.get("rotate").and_then(|v| v.as_i64()).unwrap_or(0);
    let fh = obj
        .get("flipHorizontal")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let fv = obj
        .get("flipVertical")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let crop = obj.get("crop").cloned().unwrap_or(Value::Null);
    if rotate == 0 && !fh && !fv && crop.is_null() {
        return Value::Null;
    }
    json!({
        "rotate": rotate,
        "flip": { "horizontal": fh, "vertical": fv },
        "aspectRatio": crop,
    })
}

fn transform_to_contract(transform: &Value) -> Value {
    let Some(obj) = transform.as_object() else {
        return Value::Null;
    };
    let raw_rotate = obj.get("rotate").and_then(|v| v.as_i64()).unwrap_or(0);
    let rotate = raw_rotate.rem_euclid(360);
    let flip = obj.get("flip").and_then(|v| v.as_object());
    let fh = flip
        .and_then(|f| f.get("horizontal"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let fv = flip
        .and_then(|f| f.get("vertical"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let crop = obj.get("aspectRatio").cloned().unwrap_or(Value::Null);
    if rotate == 0 && !fh && !fv && crop.is_null() {
        return Value::Null;
    }
    json!({
        "rotate": rotate,
        "flipHorizontal": fh,
        "flipVertical": fv,
        "crop": crop,
    })
}

fn contract_to_hdr(hdr: &Value) -> Value {
    if hdr.is_null() {
        return json!({ "mode": "original", "intensity": 2 });
    }
    match hdr.get("mode").and_then(|v| v.as_str()) {
        Some("remove") => json!({ "mode": "sdr", "intensity": 2 }),
        Some("boost") => json!({
            "mode": "boost",
            "intensity": hdr.get("intensity").cloned().unwrap_or_else(|| json!(2)),
        }),
        _ => json!({ "mode": "original", "intensity": 2 }),
    }
}

fn hdr_to_contract(dynamic_range: &Value) -> Value {
    let Some(obj) = dynamic_range.as_object() else {
        return Value::Null;
    };
    match obj.get("mode").and_then(|v| v.as_str()) {
        Some("sdr") => json!({ "mode": "remove" }),
        Some("boost") => json!({
            "mode": "boost",
            "intensity": obj.get("intensity").cloned().unwrap_or_else(|| json!(2)),
        }),
        _ => Value::Null,
    }
}

fn contract_to_audio_fields(audio: &Value) -> Map<String, Value> {
    let codec = audio.get("codec").and_then(|v| v.as_str());
    let bitrate = audio.get("bitrateKbps").cloned().unwrap_or(Value::Null);
    let (has_channel, channel_config) = match audio.get("channels").and_then(|v| v.as_object()) {
        None => (false, Value::Null),
        Some(ch) => match ch.get("layout").and_then(|v| v.as_str()) {
            Some("mono") => {
                let source = ch.get("source").and_then(|v| v.as_str()).unwrap_or("mix");
                let mono_source = match source {
                    "left" => json!({ "left": true, "right": false }),
                    "right" => json!({ "left": false, "right": true }),
                    _ => json!({ "left": true, "right": true }),
                };
                (
                    true,
                    json!({ "channelLayout": "mono", "monoSource": mono_source }),
                )
            }
            _ => (
                true,
                json!({
                    "channelLayout": "stereo",
                    "stereoSwapChannels": ch.get("swapChannels").and_then(|v| v.as_bool()).unwrap_or(false),
                }),
            ),
        },
    };

    let mut out = Map::new();
    out.insert(
        String::from("shouldEnableCustomAudioCodec"),
        Value::Bool(codec.is_some()),
    );
    out.insert(
        String::from("shouldEnableCustomChannel"),
        Value::Bool(has_channel),
    );
    out.insert(
        String::from("shouldEnableCustomBitrate"),
        Value::Bool(!bitrate.is_null()),
    );
    out.insert(
        String::from("audioConfig"),
        json!({
            "volume": audio.get("volumePercent").cloned().unwrap_or_else(|| json!(100)),
            "audioCodec": codec.and_then(audio_codec_to_internal).unwrap_or("-"),
            "audioChannelConfig": channel_config,
            "bitrate": bitrate,
        }),
    );
    out
}

fn audio_settings_to_contract(settings: &Value) -> Value {
    let audio_cfg = settings.get("audioConfig");
    let custom_codec = settings
        .get("shouldEnableCustomAudioCodec")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let internal_codec = if custom_codec {
        audio_cfg
            .and_then(|a| a.get("audioCodec"))
            .and_then(|v| v.as_str())
    } else {
        None
    };
    let codec = internal_codec
        .filter(|s| *s != "-")
        .and_then(internal_to_audio_codec)
        .map(|s| Value::String(s.to_string()))
        .unwrap_or(Value::Null);

    let custom_bitrate = settings
        .get("shouldEnableCustomBitrate")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let bitrate_kbps = if custom_bitrate {
        audio_cfg
            .and_then(|a| a.get("bitrate"))
            .and_then(|v| v.as_i64())
            .filter(|b| AUDIO_BITRATES.contains(b))
            .map(|b| json!(b))
            .unwrap_or(Value::Null)
    } else {
        Value::Null
    };

    let custom_ch = settings
        .get("shouldEnableCustomChannel")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let channels = if custom_ch {
        match audio_cfg
            .and_then(|a| a.get("audioChannelConfig"))
            .and_then(|v| v.as_object())
        {
            Some(ch) => match ch.get("channelLayout").and_then(|v| v.as_str()) {
                Some("mono") => {
                    let mono_source = ch.get("monoSource").and_then(|v| v.as_object());
                    let left = mono_source
                        .and_then(|m| m.get("left"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    let right = mono_source
                        .and_then(|m| m.get("right"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    let source = if left && !right {
                        "left"
                    } else if !left && right {
                        "right"
                    } else {
                        "mix"
                    };
                    json!({ "layout": "mono", "source": source })
                }
                Some("stereo") => json!({
                    "layout": "stereo",
                    "swapChannels": ch.get("stereoSwapChannels").and_then(|v| v.as_bool()).unwrap_or(false),
                }),
                _ => Value::Null,
            },
            None => Value::Null,
        }
    } else {
        Value::Null
    };

    json!({
        "volumePercent": audio_cfg.and_then(|a| a.get("volume")).cloned().unwrap_or_else(|| json!(100)),
        "codec": codec,
        "channels": channels,
        "bitrateKbps": bitrate_kbps,
    })
}

pub fn contract_output_to_preset_output(output: &Value) -> Option<Value> {
    let obj = output.as_object()?;
    let save_to = obj.get("saveTo").and_then(|v| v.as_str()).unwrap_or("sameFolder");
    let save_location = if save_to == "folder" {
        "fixedFolder"
    } else {
        save_to
    };
    let template = obj
        .get("fileNameTemplate")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let save_folder = if save_location == "fixedFolder" {
        obj.get("folder").cloned().unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    Some(json!({
        "saveLocation": save_location,
        "saveFolder": save_folder,
        "fileNameTemplate": template,
        "filePrefix": planning::get_legacy_prefix_from_template(template),
    }))
}

pub fn preset_output_to_contract_output(output: Option<&Value>) -> Value {
    let Some(obj) = output.and_then(|v| v.as_object()) else {
        return Value::Null;
    };
    let save_loc = obj
        .get("saveLocation")
        .and_then(|v| v.as_str())
        .unwrap_or("sameFolder");
    let save_to = if save_loc == "fixedFolder" {
        "folder"
    } else {
        save_loc
    };
    let template = obj
        .get("fileNameTemplate")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| {
            planning::migrate_prefix_to_template(obj.get("filePrefix").and_then(|v| v.as_str()))
        });
    json!({
        "saveTo": save_to,
        "folder": if save_to == "folder" { obj.get("saveFolder").cloned().unwrap_or(Value::Null) } else { Value::Null },
        "fileNameTemplate": template,
    })
}

pub fn contract_to_preset(id: String, contract: &Value) -> StoredPreset {
    let media_type = contract["mediaType"].as_str().unwrap_or("video").to_string();
    let name = contract["name"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Preset")
        .to_string();
    let output = contract_output_to_preset_output(&contract["output"]);
    let settings = &contract["settings"];

    let internal_settings = match media_type.as_str() {
        "image" => {
            let comp_mode = settings["compression"]["mode"].as_str().unwrap_or("quality");
            let quality = if comp_mode == "quality" {
                settings["compression"]["quality"].clone()
            } else {
                json!(50)
            };
            let target_kb = if comp_mode == "targetSize" {
                let mb = settings["compression"]["targetSizeMB"]
                    .as_f64()
                    .unwrap_or(0.5);
                json!((mb * 1000.0).round() as i64)
            } else {
                json!(500)
            };
            let tracing = &settings["svg"]["tracing"];
            let svg_config = if let Some(tr) = tracing.as_object() {
                json!({
                    "filterSpeckle": tr.get("filterSpeckle").cloned().unwrap_or_else(|| json!(4)),
                    "colorPrecision": tr.get("colorPrecision").cloned().unwrap_or_else(|| json!(6)),
                    "layerDifference": tr.get("layerDifference").cloned().unwrap_or_else(|| json!(16)),
                    "cornerThreshold": tr.get("cornerThreshold").cloned().unwrap_or_else(|| json!(60)),
                    "lengthThreshold": tr.get("lengthThreshold").cloned().unwrap_or_else(|| json!(4)),
                    "spliceThreshold": tr.get("spliceThreshold").cloned().unwrap_or_else(|| json!(45)),
                    "isBw": tr.get("blackAndWhite").and_then(|v| v.as_bool()).unwrap_or(false),
                })
            } else {
                json!({
                    "filterSpeckle": 4,
                    "colorPrecision": 6,
                    "layerDifference": 16,
                    "cornerThreshold": 60,
                    "lengthThreshold": 4,
                    "spliceThreshold": 45,
                    "isBw": false,
                })
            };
            json!({
                "dynamicRange": contract_to_hdr(&settings["image"]["hdr"]),
                "convertToExtension": settings["format"].as_str().unwrap_or("-"),
                "isLossless": comp_mode == "lossless",
                "quality": quality,
                "shouldUseTargetSize": comp_mode == "targetSize",
                "targetSizeInKB": target_kb,
                "shouldStripMetadata": settings["stripMetadata"].as_bool().unwrap_or(true),
                "svgScaleFactor": settings["svg"]["scale"].clone(),
                "shouldEnableAdvancedSvgSetting": !tracing.is_null(),
                "svgConfig": svg_config,
                "resolution": contract_to_resolution(&settings["image"]["resolution"]),
                "transform": contract_to_transform(&settings["image"]["transform"]),
            })
        }
        "audio" => {
            let comp_mode = settings["compression"]["mode"].as_str().unwrap_or("quality");
            let quality = if comp_mode == "quality" {
                settings["compression"]["quality"].clone()
            } else {
                json!(50)
            };
            let target_mb = if comp_mode == "targetSize" {
                settings["compression"]["targetSizeMB"].clone()
            } else {
                json!(10)
            };
            let mut map = contract_to_audio_fields(&settings["audio"]);
            map.insert(
                String::from("shouldUseTargetSize"),
                Value::Bool(comp_mode == "targetSize"),
            );
            map.insert(String::from("targetSizeInMB"), target_mb);
            map.insert(
                String::from("convertToExtension"),
                Value::String(settings["format"].as_str().unwrap_or("-").to_string()),
            );
            map.insert(String::from("quality"), quality);
            map.insert(
                String::from("shouldEnableCustomSpeed"),
                Value::Bool(!settings["speed"].is_null()),
            );
            if !settings["speed"].is_null() {
                map.insert(String::from("customSpeed"), settings["speed"].clone());
            }
            map.insert(
                String::from("shouldStripMetadata"),
                Value::Bool(settings["metadata"]["mode"].as_str() != Some("keep")),
            );
            Value::Object(map)
        }
        _ => {
            let comp_mode = settings["compression"]["mode"].as_str().unwrap_or("quality");
            let quality = if comp_mode == "quality" {
                settings["compression"]["quality"].clone()
            } else {
                json!(50)
            };
            let target_mb = if comp_mode == "targetSize" {
                settings["compression"]["targetSizeMB"].clone()
            } else {
                json!(10)
            };
            let vcodec = settings["video"]["codec"].as_str();
            let clips = &settings["clips"];
            let mut map = contract_to_audio_fields(&settings["audio"]);
            map.insert(
                String::from("convertToExtension"),
                Value::String(settings["format"].as_str().unwrap_or("-").to_string()),
            );
            map.insert(
                String::from("shouldDisableCompression"),
                Value::Bool(comp_mode == "none"),
            );
            map.insert(String::from("quality"), quality);
            map.insert(
                String::from("shouldUseTargetSize"),
                Value::Bool(comp_mode == "targetSize"),
            );
            map.insert(String::from("targetSizeInMB"), target_mb);
            map.insert(
                String::from("shouldEnableCustomVideoCodec"),
                Value::Bool(vcodec.is_some()),
            );
            if let Some(internal) = vcodec.and_then(video_codec_to_internal) {
                map.insert(
                    String::from("customVideoCodec"),
                    Value::String(internal.to_string()),
                );
            }
            map.insert(
                String::from("shouldEnableCustomFPS"),
                Value::Bool(!settings["video"]["fps"].is_null()),
            );
            if !settings["video"]["fps"].is_null() {
                map.insert(String::from("customFPS"), settings["video"]["fps"].clone());
            }
            map.insert(
                String::from("shouldEnableCustomSpeed"),
                Value::Bool(!settings["speed"].is_null()),
            );
            if !settings["speed"].is_null() {
                map.insert(String::from("customSpeed"), settings["speed"].clone());
            }
            map.insert(
                String::from("shouldStripMetadata"),
                Value::Bool(settings["metadata"]["mode"].as_str() != Some("keep")),
            );
            map.insert(
                String::from("dynamicRange"),
                contract_to_hdr(&settings["video"]["hdr"]),
            );
            map.insert(
                String::from("shouldEnableClips"),
                Value::Bool(!clips.is_null()),
            );
            map.insert(
                String::from("clipsMode"),
                Value::String(
                    if clips["mode"].as_str() == Some("duration") {
                        "time"
                    } else {
                        "count"
                    }
                    .to_string(),
                ),
            );
            map.insert(
                String::from("clipLengthInSeconds"),
                if clips["mode"].as_str() == Some("duration") {
                    clips["seconds"].clone()
                } else {
                    json!(60)
                },
            );
            map.insert(
                String::from("clipCount"),
                if clips["mode"].as_str() == Some("count") {
                    clips["count"].clone()
                } else {
                    json!(2)
                },
            );
            map.insert(
                String::from("resolution"),
                contract_to_resolution(&settings["video"]["resolution"]),
            );
            map.insert(
                String::from("transform"),
                contract_to_transform(&settings["video"]["transform"]),
            );
            Value::Object(map)
        }
    };

    StoredPreset {
        id,
        name,
        media_type,
        settings: internal_settings,
        output,
        revision: None,
        updated_at: None,
    }
}

pub fn preset_to_contract(preset: &StoredPreset) -> Value {
    let s = &preset.settings;
    let output = preset_output_to_contract_output(preset.output.as_ref());
    let format = match s.get("convertToExtension").and_then(|v| v.as_str()) {
        None | Some("-") | Some("") => Value::Null,
        Some(ext) => Value::String(ext.to_string()),
    };

    let mut root = Map::new();
    root.insert(String::from("version"), json!(CONTRACT_VERSION));
    root.insert(
        String::from("mediaType"),
        Value::String(preset.media_type.clone()),
    );
    if !preset.name.is_empty() {
        root.insert(String::from("name"), Value::String(preset.name.clone()));
    }

    let contract_settings = match preset.media_type.as_str() {
        "image" => {
            let compression = if s.get("shouldUseTargetSize").and_then(|v| v.as_bool()).unwrap_or(false) {
                let kb = s.get("targetSizeInKB").and_then(|v| v.as_f64()).unwrap_or(500.0);
                json!({ "mode": "targetSize", "targetSizeMB": kb / 1000.0 })
            } else if s.get("isLossless").and_then(|v| v.as_bool()).unwrap_or(false) {
                json!({ "mode": "lossless" })
            } else {
                json!({ "mode": "quality", "quality": s.get("quality").cloned().unwrap_or_else(|| json!(50)) })
            };
            let tracing = if s.get("shouldEnableAdvancedSvgSetting").and_then(|v| v.as_bool()).unwrap_or(false) {
                if let Some(cfg) = s.get("svgConfig").and_then(|v| v.as_object()) {
                    json!({
                        "filterSpeckle": cfg.get("filterSpeckle").cloned().unwrap_or_else(|| json!(4)),
                        "colorPrecision": cfg.get("colorPrecision").cloned().unwrap_or_else(|| json!(6)),
                        "layerDifference": cfg.get("layerDifference").cloned().unwrap_or_else(|| json!(16)),
                        "cornerThreshold": cfg.get("cornerThreshold").cloned().unwrap_or_else(|| json!(60)),
                        "lengthThreshold": cfg.get("lengthThreshold").cloned().unwrap_or_else(|| json!(4)),
                        "spliceThreshold": cfg.get("spliceThreshold").cloned().unwrap_or_else(|| json!(45)),
                        "blackAndWhite": cfg.get("isBw").and_then(|v| v.as_bool()).unwrap_or(false),
                    })
                } else {
                    Value::Null
                }
            } else {
                Value::Null
            };
            json!({
                "format": format,
                "compression": compression,
                "stripMetadata": s.get("shouldStripMetadata").and_then(|v| v.as_bool()).unwrap_or(true),
                "image": {
                    "resolution": resolution_to_contract(s.get("resolution").unwrap_or(&Value::Null)),
                    "transform": transform_to_contract(s.get("transform").unwrap_or(&Value::Null)),
                    "hdr": hdr_to_contract(s.get("dynamicRange").unwrap_or(&Value::Null)),
                },
                "svg": {
                    "scale": s.get("svgScaleFactor").cloned().unwrap_or_else(|| json!(1)),
                    "tracing": tracing,
                }
            })
        }
        "audio" => {
            let compression = if s.get("shouldUseTargetSize").and_then(|v| v.as_bool()).unwrap_or(false) {
                json!({
                    "mode": "targetSize",
                    "targetSizeMB": s.get("targetSizeInMB").cloned().unwrap_or_else(|| json!(10)),
                })
            } else {
                json!({
                    "mode": "quality",
                    "quality": s.get("quality").cloned().unwrap_or_else(|| json!(50)),
                })
            };
            let speed = if s.get("shouldEnableCustomSpeed").and_then(|v| v.as_bool()).unwrap_or(false) {
                s.get("customSpeed").cloned().unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            let metadata_mode = if s.get("shouldStripMetadata").and_then(|v| v.as_bool()) == Some(false) {
                "keep"
            } else {
                "strip"
            };
            json!({
                "format": format,
                "compression": compression,
                "speed": speed,
                "metadata": { "mode": metadata_mode },
                "audio": audio_settings_to_contract(s),
            })
        }
        _ => {
            let compression = if s.get("shouldUseTargetSize").and_then(|v| v.as_bool()).unwrap_or(false) {
                json!({
                    "mode": "targetSize",
                    "targetSizeMB": s.get("targetSizeInMB").cloned().unwrap_or_else(|| json!(10)),
                })
            } else if s.get("shouldDisableCompression").and_then(|v| v.as_bool()).unwrap_or(false) {
                json!({ "mode": "none" })
            } else {
                json!({
                    "mode": "quality",
                    "quality": s.get("quality").cloned().unwrap_or_else(|| json!(50)),
                })
            };
            let codec = if s.get("shouldEnableCustomVideoCodec").and_then(|v| v.as_bool()).unwrap_or(false) {
                s.get("customVideoCodec")
                    .and_then(|v| v.as_str())
                    .and_then(internal_to_video_codec)
                    .map(|c| Value::String(c.to_string()))
                    .unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            let fps = if s.get("shouldEnableCustomFPS").and_then(|v| v.as_bool()).unwrap_or(false) {
                s.get("customFPS").cloned().unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            let speed = if s.get("shouldEnableCustomSpeed").and_then(|v| v.as_bool()).unwrap_or(false) {
                s.get("customSpeed").cloned().unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            let metadata_mode = if s.get("shouldStripMetadata").and_then(|v| v.as_bool()) == Some(false) {
                "keep"
            } else {
                "strip"
            };
            let clips = if s.get("shouldEnableClips").and_then(|v| v.as_bool()).unwrap_or(false) {
                if s.get("clipsMode").and_then(|v| v.as_str()) == Some("time") {
                    json!({
                        "mode": "duration",
                        "seconds": s.get("clipLengthInSeconds").cloned().unwrap_or_else(|| json!(60)),
                    })
                } else {
                    json!({
                        "mode": "count",
                        "count": s.get("clipCount").cloned().unwrap_or_else(|| json!(2)),
                    })
                }
            } else {
                Value::Null
            };
            json!({
                "format": format,
                "compression": compression,
                "speed": speed,
                "metadata": { "mode": metadata_mode },
                "video": {
                    "codec": codec,
                    "resolution": resolution_to_contract(s.get("resolution").unwrap_or(&Value::Null)),
                    "fps": fps,
                    "transform": transform_to_contract(s.get("transform").unwrap_or(&Value::Null)),
                    "hdr": hdr_to_contract(s.get("dynamicRange").unwrap_or(&Value::Null)),
                },
                "audio": audio_settings_to_contract(s),
                "clips": clips,
            })
        }
    };

    root.insert(String::from("settings"), contract_settings);
    root.insert(String::from("output"), output);
    Value::Object(root)
}

pub fn describe_contract_english(contract: &Value) -> Vec<String> {
    let media_type = contract["mediaType"].as_str().unwrap_or("video");
    let s = &contract["settings"];
    let mut lines = Vec::new();

    let fmt = s["format"]
        .as_str()
        .map(|f| f.to_ascii_uppercase())
        .unwrap_or_else(|| String::from("Same format"));
    lines.push(fmt);

    match media_type {
        "image" => {
            match s["compression"]["mode"].as_str() {
                Some("targetSize") => {
                    let mb = s["compression"]["targetSizeMB"].as_f64().unwrap_or(0.5);
                    let kb = (mb * 1000.0).round();
                    if kb >= 1000.0 {
                        let size_mb = kb / 1000.0;
                        if (size_mb - size_mb.round()).abs() < f64::EPSILON {
                            lines.push(format!("Target size {} MB", size_mb as i64));
                        } else {
                            lines.push(format!("Target size {size_mb:.1} MB"));
                        }
                    } else {
                        lines.push(format!("Target size {} KB", kb as i64));
                    }
                }
                Some("lossless") => lines.push(String::from("Lossless")),
                _ => lines.push(format!("Quality {}%", s["compression"]["quality"])),
            }
            if let Some(res) = s["image"]["resolution"].as_str() {
                lines.push(res.to_string());
            } else if let Some(px) = s["image"]["resolution"].as_i64() {
                lines.push(format!("{px}px"));
            }
            if !s["image"]["transform"].is_null() {
                lines.push(String::from("Transformed"));
            }
            if s["stripMetadata"].as_bool().unwrap_or(true) {
                lines.push(String::from("Metadata removed"));
            } else {
                lines.push(String::from("Metadata kept"));
            }
        }
        "audio" => {
            match s["compression"]["mode"].as_str() {
                Some("targetSize") => {
                    lines.push(format!("Target size {} MB", s["compression"]["targetSizeMB"]));
                }
                _ => {
                    if let Some(kbps) = s["audio"]["bitrateKbps"].as_i64() {
                        lines.push(format!("{kbps} kbps"));
                    } else {
                        lines.push(format!("Quality {}%", s["compression"]["quality"]));
                    }
                }
            }
            if let Some(speed) = s["speed"].as_f64() {
                lines.push(format!("{speed}x speed"));
            }
            if let Some(codec) = s["audio"]["codec"].as_str() {
                lines.push(codec.to_ascii_uppercase());
            }
            if s["metadata"]["mode"].as_str() == Some("keep") {
                lines.push(String::from("Metadata kept"));
            } else {
                lines.push(String::from("Metadata removed"));
            }
        }
        _ => {
            match s["compression"]["mode"].as_str() {
                Some("targetSize") => {
                    lines.push(format!("Target size {} MB", s["compression"]["targetSizeMB"]));
                }
                Some("none") => lines.push(String::from("Lossless")),
                _ => lines.push(format!("Quality {}%", s["compression"]["quality"])),
            }
            if let Some(codec) = s["video"]["codec"].as_str() {
                lines.push(codec.to_ascii_uppercase());
            }
            if let Some(res) = s["video"]["resolution"].as_str() {
                lines.push(res.to_string());
            } else if let Some(px) = s["video"]["resolution"].as_i64() {
                lines.push(format!("{px}px"));
            }
            if let Some(fps) = s["video"]["fps"].as_i64() {
                lines.push(format!("{fps} fps"));
            }
            if let Some(clips) = s["clips"].as_object() {
                if clips.get("mode").and_then(|v| v.as_str()) == Some("duration") {
                    lines.push(String::from("Timed clips"));
                } else {
                    let count = clips.get("count").and_then(|v| v.as_i64()).unwrap_or(2);
                    lines.push(format!("{count} clips"));
                }
            }
            if let Some(speed) = s["speed"].as_f64() {
                lines.push(format!("{speed}x speed"));
            }
            if s["metadata"]["mode"].as_str() == Some("keep") {
                lines.push(String::from("Metadata kept"));
            } else {
                lines.push(String::from("Metadata removed"));
            }
        }
    }
    lines
}

pub fn standard_preset(media_type: &str) -> StoredPreset {
    let mut def = match media_type {
        "image" => default_image_contract(),
        "audio" => default_audio_contract(),
        _ => default_video_contract(),
    };
    if let Some(obj) = def.as_object_mut() {
        obj.insert(String::from("name"), Value::String(String::from("Standard")));
    }
    let mut preset = contract_to_preset(String::from("standard"), &def);
    preset.name = String::from("Standard");
    preset.output = None;
    preset
}

pub fn to_preset_view(
    preset: &StoredPreset,
    defaults: &DefaultPresetIds,
    domain: &DomainSettings,
) -> Value {
    let name = if preset.id == "standard" {
        "Standard"
    } else {
        preset.name.as_str()
    };
    let is_default = match preset.media_type.as_str() {
        "image" => defaults.image == preset.id,
        "audio" => defaults.audio == preset.id,
        _ => defaults.video == preset.id,
    };
    let output = match &preset.output {
        Some(out) if !out.is_null() => out.clone(),
        _ => serde_json::to_value(planning::standard_output(domain)).unwrap_or(Value::Null),
    };
    let mut contract = preset_to_contract(preset);
    if let Some(obj) = contract.as_object_mut() {
        obj.insert(String::from("name"), Value::String(name.to_string()));
    }
    let summary = describe_contract_english(&contract);
    let mut view = json!({
        "id": preset.id,
        "name": name,
        "mediaType": preset.media_type,
        "isDefault": is_default,
        "revision": preset.revision.unwrap_or(1),
        "output": output,
        "summary": summary,
        "contract": contract,
    });
    if let Some(updated_at) = &preset.updated_at {
        view.as_object_mut()
            .unwrap()
            .insert(String::from("updatedAt"), Value::String(updated_at.clone()));
    }
    view
}
