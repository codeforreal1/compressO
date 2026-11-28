//! Validator and normalizer for CompressO JSON Contract v1 (video, image, audio).
//! Mirrors `src/contract/validate.ts` with identical field paths, error codes, warnings,
//! and preset-vs-oneShot restrictions.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::core::contract::spec::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValidationMode {
    Preset,
    OneShot,
}

impl ValidationMode {
    pub fn parse(raw: Option<&str>) -> Self {
        match raw {
            Some("preset") => Self::Preset,
            _ => Self::OneShot,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub path: String,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed: Option<Vec<Value>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract: Option<Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}

fn add_error(
    errors: &mut Vec<ValidationIssue>,
    path: impl Into<String>,
    code: &str,
    message: impl Into<String>,
    allowed: Option<Vec<Value>>,
) {
    errors.push(ValidationIssue {
        path: path.into(),
        code: code.to_string(),
        message: message.into(),
        allowed,
    });
}

fn add_warning(
    warnings: &mut Vec<ValidationIssue>,
    path: impl Into<String>,
    code: &str,
    message: impl Into<String>,
) {
    warnings.push(ValidationIssue {
        path: path.into(),
        code: code.to_string(),
        message: message.into(),
        allowed: None,
    });
}

fn allowed_strs(items: &[&str]) -> Option<Vec<Value>> {
    Some(items.iter().map(|s| Value::String((*s).to_string())).collect())
}

fn allowed_ints(items: &[i64]) -> Option<Vec<Value>> {
    Some(items.iter().map(|n| json!(n)).collect())
}

fn reject_unknown_keys(
    obj: &Map<String, Value>,
    allowed_keys: &[&str],
    base_path: &str,
    errors: &mut Vec<ValidationIssue>,
) {
    let allowed: HashSet<&str> = allowed_keys.iter().copied().collect();
    for key in obj.keys() {
        if !allowed.contains(key.as_str()) {
            add_error(
                errors,
                format!("{base_path}/{key}"),
                "unknownField",
                format!("Unknown field \"{key}\"."),
                allowed_strs(allowed_keys),
            );
        }
    }
}

fn is_absolute_path(path: &str) -> bool {
    if path.starts_with('/') || path.starts_with("\\\\") {
        return true;
    }
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn extension_lower(path: &str) -> String {
    let base = path.rsplit(['/', '\\']).next().unwrap_or("");
    match base.rfind('.') {
        Some(dot) if dot > 0 && dot + 1 < base.len() => base[dot + 1..].to_ascii_lowercase(),
        _ => String::new(),
    }
}

fn as_finite_f64(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite())
}

fn as_exact_i64(value: &Value) -> Option<i64> {
    if let Some(i) = value.as_i64() {
        return Some(i);
    }
    if let Some(u) = value.as_u64() {
        return i64::try_from(u).ok();
    }
    value
        .as_f64()
        .filter(|f| f.is_finite() && f.fract() == 0.0 && *f >= i64::MIN as f64 && *f <= i64::MAX as f64)
        .map(|f| f as i64)
}

fn normalize_number_value(n: f64) -> Value {
    if n.fract() == 0.0 && n >= i64::MIN as f64 && n <= i64::MAX as f64 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

fn validate_number_range(
    value: &Value,
    min: f64,
    max: f64,
    path: &str,
    integer: bool,
    errors: &mut Vec<ValidationIssue>,
) -> Option<Value> {
    if integer {
        let Some(n) = as_exact_i64(value) else {
            add_error(
                errors,
                path,
                "invalidType",
                format!("Expected an integer between {min} and {max}."),
                None,
            );
            return None;
        };
        let nf = n as f64;
        if nf < min || nf > max {
            add_error(
                errors,
                path,
                "outOfRange",
                format!("Value {n} must be between {min} and {max}."),
                None,
            );
            return None;
        }
        return Some(json!(n));
    }

    let Some(n) = as_finite_f64(value) else {
        add_error(
            errors,
            path,
            "invalidType",
            format!("Expected a number between {min} and {max}."),
            None,
        );
        return None;
    };
    if n < min || n > max {
        add_error(
            errors,
            path,
            "outOfRange",
            format!("Value {} must be between {min} and {max}.", normalize_number_value(n)),
            None,
        );
        return None;
    }
    Some(normalize_number_value(n))
}

fn validate_str_enum<'a>(
    value: &Value,
    allowed: &[&'a str],
    path: &str,
    errors: &mut Vec<ValidationIssue>,
) -> Option<&'a str> {
    if let Some(s) = value.as_str() {
        if let Some(&matched) = allowed.iter().find(|&&item| item == s) {
            return Some(matched);
        }
    }
    add_error(
        errors,
        path,
        "invalidValue",
        format!("Invalid value {value}."),
        allowed_strs(allowed),
    );
    None
}

fn validate_i64_enum(
    value: &Value,
    allowed: &[i64],
    path: &str,
    errors: &mut Vec<ValidationIssue>,
) -> Option<i64> {
    if let Some(n) = as_exact_i64(value) {
        if allowed.contains(&n) {
            return Some(n);
        }
    }
    add_error(
        errors,
        path,
        "invalidValue",
        format!("Invalid value {value}."),
        allowed_ints(allowed),
    );
    None
}

fn validate_resolution(
    value: Option<&Value>,
    fallback: Value,
    path: &str,
    errors: &mut Vec<ValidationIssue>,
) -> Value {
    let Some(val) = value else {
        return fallback;
    };
    if val.is_null() {
        return Value::Null;
    }
    if val.is_string() {
        return validate_str_enum(val, RESOLUTION_PRESETS, path, errors)
            .map(|s| Value::String(s.to_string()))
            .unwrap_or(fallback);
    }
    if as_finite_f64(val).is_some() {
        let Some(px) = as_exact_i64(val) else {
            add_error(
                errors,
                path,
                "outOfRange",
                format!("Pixel resolution must be an integer >= {MIN_RESOLUTION_PX}."),
                None,
            );
            return fallback;
        };
        if px < MIN_RESOLUTION_PX {
            add_error(
                errors,
                path,
                "outOfRange",
                format!("Pixel resolution must be an integer >= {MIN_RESOLUTION_PX}."),
                None,
            );
            return fallback;
        }
        if px % 2 != 0 {
            add_error(
                errors,
                path,
                "invalidResolution",
                "Pixel resolution must be an even integer.",
                None,
            );
            return fallback;
        }
        return json!(px);
    }
    add_error(
        errors,
        path,
        "invalidType",
        "Resolution must be null, a preset (\"480p\"..\"4k\"), or an even integer.",
        allowed_strs(RESOLUTION_PRESETS),
    );
    fallback
}

fn validate_transform(
    value: Option<&Value>,
    fallback: Value,
    path: &str,
    errors: &mut Vec<ValidationIssue>,
) -> Value {
    let Some(val) = value else {
        return fallback;
    };
    if val.is_null() {
        return Value::Null;
    }
    let Some(obj) = val.as_object() else {
        add_error(
            errors,
            path,
            "invalidType",
            "transform must be an object or null.",
            None,
        );
        return fallback;
    };
    reject_unknown_keys(
        obj,
        &["rotate", "flipHorizontal", "flipVertical", "crop"],
        path,
        errors,
    );
    let rotate = match obj.get("rotate") {
        None => 0,
        Some(v) => validate_i64_enum(v, ROTATION_VALUES, &format!("{path}/rotate"), errors)
            .unwrap_or(0),
    };
    let mut flip_horizontal = false;
    if let Some(v) = obj.get("flipHorizontal") {
        match v.as_bool() {
            Some(b) => flip_horizontal = b,
            None => add_error(
                errors,
                format!("{path}/flipHorizontal"),
                "invalidType",
                "Expected a boolean.",
                None,
            ),
        }
    }
    let mut flip_vertical = false;
    if let Some(v) = obj.get("flipVertical") {
        match v.as_bool() {
            Some(b) => flip_vertical = b,
            None => add_error(
                errors,
                format!("{path}/flipVertical"),
                "invalidType",
                "Expected a boolean.",
                None,
            ),
        }
    }
    let crop = match obj.get("crop") {
        Some(v) if !v.is_null() => {
            validate_str_enum(v, CROP_ASPECT_RATIOS, &format!("{path}/crop"), errors)
                .map(|s| Value::String(s.to_string()))
                .unwrap_or(Value::Null)
        }
        _ => Value::Null,
    };
    if rotate == 0 && !flip_horizontal && !flip_vertical && crop.is_null() {
        return Value::Null;
    }
    json!({
        "rotate": rotate,
        "flipHorizontal": flip_horizontal,
        "flipVertical": flip_vertical,
        "crop": crop,
    })
}

fn validate_hdr(
    value: Option<&Value>,
    fallback: Value,
    path: &str,
    errors: &mut Vec<ValidationIssue>,
) -> Value {
    let Some(val) = value else {
        return fallback;
    };
    if val.is_null() {
        return Value::Null;
    }
    let Some(obj) = val.as_object() else {
        add_error(errors, path, "invalidType", "hdr must be an object or null.", None);
        return fallback;
    };
    match obj.get("mode").and_then(|v| v.as_str()) {
        Some("remove") => {
            reject_unknown_keys(obj, &["mode"], path, errors);
            json!({ "mode": "remove" })
        }
        Some("boost") => {
            reject_unknown_keys(obj, &["mode", "intensity"], path, errors);
            let intensity = match obj.get("intensity") {
                None => json!(2),
                Some(v) => validate_number_range(v, 1.0, 8.0, &format!("{path}/intensity"), false, errors)
                    .unwrap_or_else(|| json!(2)),
            };
            json!({ "mode": "boost", "intensity": intensity })
        }
        _ => {
            add_error(
                errors,
                format!("{path}/mode"),
                "invalidValue",
                "hdr.mode must be \"boost\" or \"remove\".",
                allowed_strs(&["boost", "remove"]),
            );
            fallback
        }
    }
}

fn validate_audio_settings(
    value: Option<&Value>,
    fallback: &Value,
    path: &str,
    errors: &mut Vec<ValidationIssue>,
) -> Value {
    let Some(val) = value else {
        return fallback.clone();
    };
    let Some(obj) = val.as_object() else {
        add_error(errors, path, "invalidType", "audio must be an object.", None);
        return fallback.clone();
    };
    reject_unknown_keys(
        obj,
        &["volumePercent", "codec", "channels", "bitrateKbps"],
        path,
        errors,
    );

    let volume_percent = match obj.get("volumePercent") {
        None => fallback["volumePercent"].clone(),
        Some(v) => validate_number_range(
            v,
            0.0,
            200.0,
            &format!("{path}/volumePercent"),
            false,
            errors,
        )
        .unwrap_or_else(|| fallback["volumePercent"].clone()),
    };
    let codec = match obj.get("codec") {
        None => fallback["codec"].clone(),
        Some(v) if v.is_null() => Value::Null,
        Some(v) => validate_str_enum(v, AUDIO_CODEC_NAMES, &format!("{path}/codec"), errors)
            .map(|s| Value::String(s.to_string()))
            .unwrap_or(Value::Null),
    };
    let mut channels = fallback["channels"].clone();
    if let Some(ch_val) = obj.get("channels") {
        if ch_val.is_null() {
            channels = Value::Null;
        } else if let Some(ch_obj) = ch_val.as_object() {
            let ch_path = format!("{path}/channels");
            match ch_obj.get("layout").and_then(|v| v.as_str()) {
                Some("mono") => {
                    reject_unknown_keys(ch_obj, &["layout", "source"], &ch_path, errors);
                    let source = match ch_obj.get("source") {
                        None => "mix",
                        Some(v) => validate_str_enum(
                            v,
                            MONO_SOURCES,
                            &format!("{ch_path}/source"),
                            errors,
                        )
                        .unwrap_or("mix"),
                    };
                    channels = json!({ "layout": "mono", "source": source });
                }
                Some("stereo") => {
                    reject_unknown_keys(ch_obj, &["layout", "swapChannels"], &ch_path, errors);
                    let mut swap = false;
                    if let Some(v) = ch_obj.get("swapChannels") {
                        match v.as_bool() {
                            Some(b) => swap = b,
                            None => add_error(
                                errors,
                                format!("{ch_path}/swapChannels"),
                                "invalidType",
                                "Expected a boolean.",
                                None,
                            ),
                        }
                    }
                    channels = json!({ "layout": "stereo", "swapChannels": swap });
                }
                _ => add_error(
                    errors,
                    format!("{ch_path}/layout"),
                    "invalidValue",
                    "channels.layout must be \"mono\" or \"stereo\".",
                    allowed_strs(&["mono", "stereo"]),
                ),
            }
        } else {
            add_error(
                errors,
                format!("{path}/channels"),
                "invalidType",
                "channels must be an object or null.",
                None,
            );
        }
    }
    let bitrate_kbps = match obj.get("bitrateKbps") {
        None => fallback["bitrateKbps"].clone(),
        Some(v) if v.is_null() => Value::Null,
        Some(v) => validate_i64_enum(v, AUDIO_BITRATES, &format!("{path}/bitrateKbps"), errors)
            .map(|n| json!(n))
            .unwrap_or(Value::Null),
    };
    json!({
        "volumePercent": volume_percent,
        "codec": codec,
        "channels": channels,
        "bitrateKbps": bitrate_kbps,
    })
}

fn validate_metadata(
    value: Option<&Value>,
    mode: ValidationMode,
    path: &str,
    errors: &mut Vec<ValidationIssue>,
) -> Value {
    let Some(val) = value else {
        return json!({ "mode": "strip" });
    };
    let Some(obj) = val.as_object() else {
        add_error(errors, path, "invalidType", "metadata must be an object.", None);
        return json!({ "mode": "strip" });
    };
    match obj.get("mode").and_then(|v| v.as_str()) {
        Some("strip") => {
            reject_unknown_keys(obj, &["mode", "set"], path, errors);
            if obj.get("set").is_some_and(|v| !v.is_null()) {
                add_error(
                    errors,
                    format!("{path}/set"),
                    "metadataSetRequiresKeep",
                    "metadata.set cannot be used when metadata.mode is \"strip\".",
                    None,
                );
            }
            json!({ "mode": "strip" })
        }
        Some("keep") => {
            reject_unknown_keys(obj, &["mode", "set"], path, errors);
            let Some(set_val) = obj.get("set").filter(|v| !v.is_null()) else {
                return json!({ "mode": "keep" });
            };
            let Some(set_obj) = set_val.as_object() else {
                add_error(
                    errors,
                    format!("{path}/set"),
                    "invalidType",
                    "metadata.set must be an object or null.",
                    None,
                );
                return json!({ "mode": "keep" });
            };
            reject_unknown_keys(set_obj, METADATA_TAG_KEYS, &format!("{path}/set"), errors);
            let mut tags = Map::new();
            let mut has_any = false;
            for &key in METADATA_TAG_KEYS {
                let Some(raw) = set_obj.get(key) else {
                    continue;
                };
                if raw.is_null() {
                    tags.insert(key.to_string(), Value::Null);
                    continue;
                }
                let Some(s) = raw.as_str() else {
                    add_error(
                        errors,
                        format!("{path}/set/{key}"),
                        "invalidType",
                        "Expected a string or null.",
                        None,
                    );
                    continue;
                };
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    tags.insert(key.to_string(), Value::String(trimmed.to_string()));
                    has_any = true;
                } else {
                    tags.insert(key.to_string(), Value::Null);
                }
            }
            if has_any && mode == ValidationMode::Preset {
                add_error(
                    errors,
                    format!("{path}/set"),
                    "presetDisallowedField",
                    "Metadata tag values (metadata.set) are one-shot only (single file or batch) and cannot be saved in presets. Use --contract for one-shot compression or omit metadata.set.",
                    None,
                );
            }
            if has_any {
                json!({ "mode": "keep", "set": Value::Object(tags) })
            } else {
                json!({ "mode": "keep" })
            }
        }
        _ => {
            add_error(
                errors,
                format!("{path}/mode"),
                "invalidValue",
                "metadata.mode must be \"strip\" or \"keep\".",
                allowed_strs(&["strip", "keep"]),
            );
            json!({ "mode": "strip" })
        }
    }
}

fn validate_subtitles(
    value: Option<&Value>,
    mode: ValidationMode,
    path: &str,
    errors: &mut Vec<ValidationIssue>,
) -> Value {
    let Some(val) = value.filter(|v| !v.is_null()) else {
        return Value::Null;
    };
    let Some(obj) = val.as_object() else {
        add_error(
            errors,
            path,
            "invalidType",
            "subtitles must be an object or null.",
            None,
        );
        return Value::Null;
    };
    reject_unknown_keys(obj, &["preserveExisting", "tracks"], path, errors);
    let mut preserve_existing = false;
    if let Some(v) = obj.get("preserveExisting") {
        match v.as_bool() {
            Some(b) => preserve_existing = b,
            None => add_error(
                errors,
                format!("{path}/preserveExisting"),
                "invalidType",
                "Expected a boolean.",
                None,
            ),
        }
    }
    let mut tracks: Vec<Value> = Vec::new();
    if let Some(raw_tracks) = obj.get("tracks") {
        let Some(arr) = raw_tracks.as_array() else {
            add_error(
                errors,
                format!("{path}/tracks"),
                "invalidType",
                "tracks must be an array.",
                None,
            );
            return Value::Null;
        };
        for (idx, entry) in arr.iter().enumerate() {
            let track_path = format!("{path}/tracks/{idx}");
            let Some(entry_obj) = entry.as_object() else {
                add_error(
                    errors,
                    track_path,
                    "invalidType",
                    "Subtitle track must be an object.",
                    None,
                );
                continue;
            };
            reject_unknown_keys(entry_obj, &["path", "language", "title"], &track_path, errors);
            let Some(raw_path) = entry_obj.get("path").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) else {
                add_error(
                    errors,
                    format!("{track_path}/path"),
                    "required",
                    "Subtitle track path is required.",
                    None,
                );
                continue;
            };
            if !is_absolute_path(raw_path) {
                add_error(
                    errors,
                    format!("{track_path}/path"),
                    "relativePath",
                    "Subtitle track path must be an absolute path.",
                    None,
                );
            } else {
                let ext = extension_lower(raw_path);
                if !SUBTITLE_EXTENSIONS.contains(&ext.as_str()) {
                    add_error(
                        errors,
                        format!("{track_path}/path"),
                        "unsupportedExtension",
                        format!("Unsupported subtitle extension \".{ext}\"."),
                        allowed_strs(SUBTITLE_EXTENSIONS),
                    );
                }
            }
            let mut language = String::from("und");
            if let Some(lang_val) = entry_obj.get("language") {
                match lang_val.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                    Some(l) => language = l.to_string(),
                    None => add_error(
                        errors,
                        format!("{track_path}/language"),
                        "invalidType",
                        "language must be a non-empty string.",
                        None,
                    ),
                }
            }
            let mut title = Value::Null;
            if let Some(title_val) = entry_obj.get("title").filter(|v| !v.is_null()) {
                match title_val.as_str() {
                    Some(t) => {
                        let trimmed = t.trim();
                        if !trimmed.is_empty() {
                            title = Value::String(trimmed.to_string());
                        }
                    }
                    None => add_error(
                        errors,
                        format!("{track_path}/title"),
                        "invalidType",
                        "title must be a string or null.",
                        None,
                    ),
                }
            }
            tracks.push(json!({
                "path": raw_path,
                "language": language,
                "title": title,
            }));
        }
    }
    if !preserve_existing && tracks.is_empty() {
        return Value::Null;
    }
    if mode == ValidationMode::Preset {
        add_error(
            errors,
            path,
            "presetDisallowedField",
            "Subtitles are one-shot only (single file or batch) and cannot be saved in presets. Use --contract for one-shot compression or omit settings.subtitles.",
            None,
        );
    }
    json!({
        "preserveExisting": preserve_existing,
        "tracks": tracks,
    })
}

fn validate_output(
    value: Option<&Value>,
    path: &str,
    errors: &mut Vec<ValidationIssue>,
    warnings: &mut Vec<ValidationIssue>,
) -> Value {
    let Some(val) = value.filter(|v| !v.is_null()) else {
        return Value::Null;
    };
    let Some(obj) = val.as_object() else {
        add_error(errors, path, "invalidType", "output must be an object or null.", None);
        return Value::Null;
    };
    reject_unknown_keys(obj, &["saveTo", "folder", "fileNameTemplate"], path, errors);
    let save_to = match obj.get("saveTo") {
        Some(v) => validate_str_enum(v, SAVE_LOCATIONS, &format!("{path}/saveTo"), errors)
            .unwrap_or("sameFolder"),
        None => {
            add_error(
                errors,
                format!("{path}/saveTo"),
                "invalidValue",
                "Invalid value undefined.",
                allowed_strs(SAVE_LOCATIONS),
            );
            "sameFolder"
        }
    };

    let mut folder: Option<String> = None;
    if let Some(f_val) = obj.get("folder").filter(|v| !v.is_null()) {
        match f_val.as_str() {
            Some(s) => {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    folder = Some(trimmed.to_string());
                }
            }
            None => add_error(
                errors,
                format!("{path}/folder"),
                "invalidType",
                "folder must be a string or null.",
                None,
            ),
        }
    }
    if save_to == "folder" {
        match &folder {
            None => add_error(
                errors,
                format!("{path}/folder"),
                "required",
                "output.folder is required when saveTo is \"folder\".",
                None,
            ),
            Some(f) if !is_absolute_path(f) => add_error(
                errors,
                format!("{path}/folder"),
                "relativePath",
                "output.folder must be an absolute path.",
                None,
            ),
            _ => {}
        }
    }
    if save_to == "ask" {
        add_warning(
            warnings,
            format!("{path}/saveTo"),
            "requiresOutputOption",
            "saveTo \"ask\" cannot auto-save in watched folders or CLI without --output.",
        );
    }

    let mut template = String::from("compressO-{name}");
    if let Some(t_val) = obj.get("fileNameTemplate") {
        match t_val.as_str() {
            Some(s) => {
                if s.chars().any(|c| {
                    matches!(
                        c,
                        '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\u{0000}'..='\u{001f}'
                    )
                }) {
                    add_error(
                        errors,
                        format!("{path}/fileNameTemplate"),
                        "invalidCharacters",
                        "fileNameTemplate contains characters not allowed in file names.",
                        None,
                    );
                }
                let mut rest = s;
                while let Some(open) = rest.find('{') {
                    let after = &rest[open..];
                    let Some(close) = after.find('}') else {
                        break;
                    };
                    let token = &after[..=close];
                    let lower = token.to_ascii_lowercase();
                    if !ALLOWED_FILE_NAME_TOKENS.contains(&lower.as_str()) {
                        add_error(
                            errors,
                            format!("{path}/fileNameTemplate"),
                            "invalidTemplateToken",
                            format!("Unknown file name template token \"{token}\"."),
                            allowed_strs(ALLOWED_FILE_NAME_TOKENS),
                        );
                    }
                    rest = &after[close + 1..];
                }
                template = s.to_string();
            }
            None => add_error(
                errors,
                format!("{path}/fileNameTemplate"),
                "invalidType",
                "fileNameTemplate must be a string.",
                None,
            ),
        }
    }

    json!({
        "saveTo": save_to,
        "folder": if save_to == "folder" { folder.map(Value::String).unwrap_or(Value::Null) } else { Value::Null },
        "fileNameTemplate": template,
    })
}

fn validate_video_settings(
    raw_settings: Option<&Value>,
    mode: ValidationMode,
    errors: &mut Vec<ValidationIssue>,
    warnings: &mut Vec<ValidationIssue>,
) -> Value {
    let defaults = default_video_contract()["settings"].clone();
    let Some(raw_val) = raw_settings else {
        let mut out = defaults;
        if mode == ValidationMode::Preset {
            if let Some(v) = out.get_mut("video").and_then(|v| v.as_object_mut()) {
                v.remove("thumbnail");
            }
            if let Some(s) = out.as_object_mut() {
                s.remove("subtitles");
            }
        }
        return out;
    };
    let Some(raw) = raw_val.as_object() else {
        add_error(errors, "/settings", "invalidType", "settings must be an object.", None);
        return defaults;
    };
    reject_unknown_keys(
        raw,
        &[
            "format",
            "compression",
            "speed",
            "metadata",
            "video",
            "audio",
            "subtitles",
            "clips",
        ],
        "/settings",
        errors,
    );

    let format = match raw.get("format") {
        None => defaults["format"].clone(),
        Some(v) if v.is_null() => Value::Null,
        Some(v) => validate_str_enum(v, VIDEO_OUTPUT_FORMATS, "/settings/format", errors)
            .map(|s| Value::String(s.to_string()))
            .unwrap_or(Value::Null),
    };

    let mut compression = defaults["compression"].clone();
    if let Some(raw_comp) = raw.get("compression") {
        if let Some(comp_obj) = raw_comp.as_object() {
            match comp_obj.get("mode").and_then(|v| v.as_str()) {
                Some("quality") => {
                    reject_unknown_keys(comp_obj, &["mode", "quality"], "/settings/compression", errors);
                    let q = match comp_obj.get("quality") {
                        None => json!(50),
                        Some(v) => validate_number_range(
                            v,
                            1.0,
                            100.0,
                            "/settings/compression/quality",
                            false,
                            errors,
                        )
                        .unwrap_or_else(|| json!(50)),
                    };
                    compression = json!({ "mode": "quality", "quality": q });
                }
                Some("targetSize") => {
                    reject_unknown_keys(
                        comp_obj,
                        &["mode", "targetSizeMB"],
                        "/settings/compression",
                        errors,
                    );
                    let mb = match comp_obj.get("targetSizeMB") {
                        None => json!(10),
                        Some(v) => validate_number_range(
                            v,
                            1.0,
                            10000.0,
                            "/settings/compression/targetSizeMB",
                            false,
                            errors,
                        )
                        .unwrap_or_else(|| json!(10)),
                    };
                    compression = json!({ "mode": "targetSize", "targetSizeMB": mb });
                }
                Some("none") => {
                    reject_unknown_keys(comp_obj, &["mode"], "/settings/compression", errors);
                    compression = json!({ "mode": "none" });
                }
                _ => add_error(
                    errors,
                    "/settings/compression/mode",
                    "invalidValue",
                    "compression.mode must be \"quality\", \"targetSize\", or \"none\".",
                    allowed_strs(&["quality", "targetSize", "none"]),
                ),
            }
        } else {
            add_error(
                errors,
                "/settings/compression",
                "invalidType",
                "compression must be an object.",
                None,
            );
        }
    }

    let speed = match raw.get("speed") {
        None => defaults["speed"].clone(),
        Some(v) if v.is_null() => Value::Null,
        Some(v) => validate_number_range(v, 0.25, 4.0, "/settings/speed", false, errors)
            .unwrap_or(Value::Null),
    };

    let metadata = validate_metadata(raw.get("metadata"), mode, "/settings/metadata", errors);

    let v_def = &defaults["video"];
    let mut video_codec = Value::Null;
    let mut resolution = Value::Null;
    let mut fps = Value::Null;
    let mut transform = Value::Null;
    let mut hdr = Value::Null;
    let mut thumbnail = Value::Null;

    if let Some(raw_video) = raw.get("video") {
        if let Some(v_obj) = raw_video.as_object() {
            reject_unknown_keys(
                v_obj,
                &["codec", "resolution", "fps", "transform", "hdr", "thumbnail"],
                "/settings/video",
                errors,
            );
            video_codec = match v_obj.get("codec") {
                Some(v) if !v.is_null() => {
                    validate_str_enum(v, VIDEO_CODEC_NAMES, "/settings/video/codec", errors)
                        .map(|s| Value::String(s.to_string()))
                        .unwrap_or(Value::Null)
                }
                _ => Value::Null,
            };
            resolution = validate_resolution(
                v_obj.get("resolution"),
                v_def["resolution"].clone(),
                "/settings/video/resolution",
                errors,
            );
            fps = match v_obj.get("fps") {
                Some(v) if !v.is_null() => {
                    validate_number_range(v, 1.0, 60.0, "/settings/video/fps", true, errors)
                        .unwrap_or(Value::Null)
                }
                _ => Value::Null,
            };
            transform = validate_transform(
                v_obj.get("transform"),
                v_def["transform"].clone(),
                "/settings/video/transform",
                errors,
            );
            hdr = validate_hdr(
                v_obj.get("hdr"),
                v_def["hdr"].clone(),
                "/settings/video/hdr",
                errors,
            );
            if let Some(t_val) = v_obj.get("thumbnail").filter(|v| !v.is_null()) {
                match t_val.as_str() {
                    Some(raw_str) => {
                        let trimmed = raw_str.trim();
                        if trimmed.is_empty() {
                            add_error(
                                errors,
                                "/settings/video/thumbnail",
                                "invalidValue",
                                "thumbnail path cannot be empty (use null for none).",
                                None,
                            );
                        } else {
                            if mode == ValidationMode::Preset {
                                add_error(
                                    errors,
                                    "/settings/video/thumbnail",
                                    "presetDisallowedField",
                                    "Custom thumbnail is one-shot only (single file or batch) and cannot be saved in presets. Use --contract for one-shot compression or set settings.video.thumbnail to null.",
                                    None,
                                );
                            }
                            if !is_absolute_path(trimmed) {
                                add_error(
                                    errors,
                                    "/settings/video/thumbnail",
                                    "relativePath",
                                    "thumbnail must be an absolute file path.",
                                    None,
                                );
                            } else {
                                let ext = extension_lower(trimmed);
                                if !THUMBNAIL_EXTENSIONS.contains(&ext.as_str()) {
                                    add_error(
                                        errors,
                                        "/settings/video/thumbnail",
                                        "unsupportedExtension",
                                        format!("Unsupported thumbnail extension \".{ext}\"."),
                                        allowed_strs(THUMBNAIL_EXTENSIONS),
                                    );
                                }
                            }
                            thumbnail = Value::String(trimmed.to_string());
                        }
                    }
                    None => add_error(
                        errors,
                        "/settings/video/thumbnail",
                        "invalidType",
                        "thumbnail must be a string or null.",
                        None,
                    ),
                }
            }
        } else {
            add_error(
                errors,
                "/settings/video",
                "invalidType",
                "settings.video must be an object.",
                None,
            );
        }
    }

    let audio = validate_audio_settings(raw.get("audio"), &defaults["audio"], "/settings/audio", errors);
    let subtitles = validate_subtitles(raw.get("subtitles"), mode, "/settings/subtitles", errors);

    let mut clips = Value::Null;
    if let Some(raw_clips) = raw.get("clips").filter(|v| !v.is_null()) {
        if let Some(c_obj) = raw_clips.as_object() {
            match c_obj.get("mode").and_then(|v| v.as_str()) {
                Some("count") => {
                    reject_unknown_keys(c_obj, &["mode", "count"], "/settings/clips", errors);
                    let count = match c_obj.get("count") {
                        None => json!(2),
                        Some(v) => validate_number_range(
                            v,
                            2.0,
                            1440.0,
                            "/settings/clips/count",
                            true,
                            errors,
                        )
                        .unwrap_or_else(|| json!(2)),
                    };
                    clips = json!({ "mode": "count", "count": count });
                }
                Some("duration") => {
                    reject_unknown_keys(c_obj, &["mode", "seconds"], "/settings/clips", errors);
                    let seconds = match c_obj.get("seconds") {
                        None => json!(60),
                        Some(v) => validate_number_range(
                            v,
                            1.0,
                            86400.0,
                            "/settings/clips/seconds",
                            false,
                            errors,
                        )
                        .unwrap_or_else(|| json!(60)),
                    };
                    clips = json!({ "mode": "duration", "seconds": seconds });
                }
                _ => add_error(
                    errors,
                    "/settings/clips/mode",
                    "invalidValue",
                    "clips.mode must be \"count\" or \"duration\".",
                    allowed_strs(&["count", "duration"]),
                ),
            }
        } else {
            add_error(
                errors,
                "/settings/clips",
                "invalidType",
                "clips must be an object or null.",
                None,
            );
        }
    }

    // Cross-field rules
    let fmt_str = format.as_str();
    let comp_mode = compression["mode"].as_str().unwrap_or("");
    let audio_codec = audio["codec"].as_str();
    let audio_vol = as_finite_f64(&audio["volumePercent"]).unwrap_or(100.0);
    let is_audio_fmt = fmt_str.is_some_and(|f| AUDIO_OUTPUT_FORMATS.contains(&f));

    if fmt_str == Some("gif") {
        if comp_mode == "targetSize" {
            add_error(
                errors,
                "/settings/compression",
                "targetSizeNotSupportedForGif",
                "Target size compression is not supported for GIF output.",
                None,
            );
        }
        if !clips.is_null() {
            add_error(
                errors,
                "/settings/clips",
                "clipsNotSupportedForGif",
                "Splitting into clips is not supported for GIF output.",
                None,
            );
        }
        if (audio_vol - 100.0).abs() > f64::EPSILON
            || audio_codec.is_some()
            || !audio["channels"].is_null()
            || !audio["bitrateKbps"].is_null()
        {
            add_error(
                errors,
                "/settings/audio",
                "audioNotSupportedForGif",
                "Audio settings are not supported for GIF output.",
                None,
            );
        }
        if !thumbnail.is_null() {
            add_error(
                errors,
                "/settings/video/thumbnail",
                "thumbnailNotSupportedForFormat",
                "Custom thumbnail is not supported for GIF output.",
                None,
            );
        }
        if !subtitles.is_null() {
            add_error(
                errors,
                "/settings/subtitles",
                "subtitlesNotSupportedForFormat",
                "Subtitles are not supported for GIF output.",
                None,
            );
        }
    } else if is_audio_fmt {
        let fmt = fmt_str.unwrap();
        if comp_mode == "none" {
            add_error(
                errors,
                "/settings/compression",
                "noneCompressionNotSupportedForAudioFormat",
                "compression.mode \"none\" is not supported when extracting audio.",
                None,
            );
        }
        if let Some(ac) = audio_codec {
            if !is_audio_codec_compatible(ac, fmt) {
                add_error(
                    errors,
                    "/settings/audio/codec",
                    "incompatibleCodec",
                    format!("Audio codec \"{ac}\" is not compatible with \"{fmt}\"."),
                    None,
                );
            }
        }
        if !video_codec.is_null()
            || !resolution.is_null()
            || !fps.is_null()
            || !transform.is_null()
            || !hdr.is_null()
            || !thumbnail.is_null()
            || !subtitles.is_null()
            || !clips.is_null()
        {
            add_warning(
                warnings,
                "/settings/video",
                "ignoredForAudioFormat",
                format!("Video-only settings (video.*, subtitles, clips) are ignored when format is \"{fmt}\"."),
            );
        }
    } else if let Some(fmt) = fmt_str {
        if let Some(vc) = video_codec.as_str() {
            if !is_video_codec_compatible(vc, fmt) {
                add_error(
                    errors,
                    "/settings/video/codec",
                    "incompatibleCodec",
                    format!("Video codec \"{vc}\" is not compatible with \"{fmt}\"."),
                    None,
                );
            }
        }
        if let Some(ac) = audio_codec {
            if !is_audio_codec_compatible(ac, fmt) {
                add_error(
                    errors,
                    "/settings/audio/codec",
                    "incompatibleCodec",
                    format!("Audio codec \"{ac}\" is not compatible with \"{fmt}\"."),
                    None,
                );
            }
        }
        if !thumbnail.is_null() && matches!(fmt, "webm" | "ts") {
            add_error(
                errors,
                "/settings/video/thumbnail",
                "thumbnailNotSupportedForFormat",
                format!("Custom thumbnail is not supported for \"{fmt}\" output."),
                None,
            );
        }
    } else if !video_codec.is_null() || audio_codec.is_some() {
        add_warning(
            warnings,
            "/settings/format",
            "codecMayBeSkipped",
            "When format is null (same as input), a chosen codec is skipped for incompatible input containers.",
        );
    }

    let mut video_out = json!({
        "codec": video_codec,
        "resolution": resolution,
        "fps": fps,
        "transform": transform,
        "hdr": hdr,
    });
    if mode == ValidationMode::OneShot {
        video_out
            .as_object_mut()
            .unwrap()
            .insert(String::from("thumbnail"), thumbnail);
    }

    let mut settings_out = json!({
        "format": format,
        "compression": compression,
        "speed": speed,
        "metadata": metadata,
        "video": video_out,
        "audio": audio,
        "clips": clips,
    });
    if mode == ValidationMode::OneShot {
        settings_out
            .as_object_mut()
            .unwrap()
            .insert(String::from("subtitles"), subtitles);
    }
    settings_out
}

fn validate_image_settings(
    raw_settings: Option<&Value>,
    errors: &mut Vec<ValidationIssue>,
    warnings: &mut Vec<ValidationIssue>,
) -> Value {
    let defaults = default_image_contract()["settings"].clone();
    let Some(raw_val) = raw_settings else {
        return defaults;
    };
    let Some(raw) = raw_val.as_object() else {
        add_error(errors, "/settings", "invalidType", "settings must be an object.", None);
        return defaults;
    };
    reject_unknown_keys(
        raw,
        &["format", "compression", "stripMetadata", "image", "svg"],
        "/settings",
        errors,
    );

    let format = match raw.get("format") {
        None => defaults["format"].clone(),
        Some(v) if v.is_null() => Value::Null,
        Some(v) => validate_str_enum(v, IMAGE_OUTPUT_FORMATS, "/settings/format", errors)
            .map(|s| Value::String(s.to_string()))
            .unwrap_or(Value::Null),
    };

    let mut compression = defaults["compression"].clone();
    if let Some(raw_comp) = raw.get("compression") {
        if let Some(comp_obj) = raw_comp.as_object() {
            match comp_obj.get("mode").and_then(|v| v.as_str()) {
                Some("quality") => {
                    reject_unknown_keys(comp_obj, &["mode", "quality"], "/settings/compression", errors);
                    let q = match comp_obj.get("quality") {
                        None => json!(50),
                        Some(v) => validate_number_range(
                            v,
                            1.0,
                            100.0,
                            "/settings/compression/quality",
                            false,
                            errors,
                        )
                        .unwrap_or_else(|| json!(50)),
                    };
                    compression = json!({ "mode": "quality", "quality": q });
                }
                Some("lossless") => {
                    reject_unknown_keys(comp_obj, &["mode"], "/settings/compression", errors);
                    compression = json!({ "mode": "lossless" });
                }
                Some("targetSize") => {
                    reject_unknown_keys(
                        comp_obj,
                        &["mode", "targetSizeMB"],
                        "/settings/compression",
                        errors,
                    );
                    let mb = match comp_obj.get("targetSizeMB") {
                        None => json!(0.5),
                        Some(v) => validate_number_range(
                            v,
                            0.01,
                            100.0,
                            "/settings/compression/targetSizeMB",
                            false,
                            errors,
                        )
                        .unwrap_or_else(|| json!(0.5)),
                    };
                    compression = json!({ "mode": "targetSize", "targetSizeMB": mb });
                }
                _ => add_error(
                    errors,
                    "/settings/compression/mode",
                    "invalidValue",
                    "compression.mode must be \"quality\", \"lossless\", or \"targetSize\".",
                    allowed_strs(&["quality", "lossless", "targetSize"]),
                ),
            }
        } else {
            add_error(
                errors,
                "/settings/compression",
                "invalidType",
                "compression must be an object.",
                None,
            );
        }
    }

    let mut strip_metadata = true;
    if let Some(v) = raw.get("stripMetadata") {
        match v.as_bool() {
            Some(b) => strip_metadata = b,
            None => add_error(
                errors,
                "/settings/stripMetadata",
                "invalidType",
                "stripMetadata must be a boolean.",
                None,
            ),
        }
    }

    let mut image = defaults["image"].clone();
    if let Some(raw_img) = raw.get("image") {
        if let Some(img_obj) = raw_img.as_object() {
            reject_unknown_keys(
                img_obj,
                &["resolution", "transform", "hdr"],
                "/settings/image",
                errors,
            );
            image = json!({
                "resolution": validate_resolution(
                    img_obj.get("resolution"),
                    Value::Null,
                    "/settings/image/resolution",
                    errors,
                ),
                "transform": validate_transform(
                    img_obj.get("transform"),
                    Value::Null,
                    "/settings/image/transform",
                    errors,
                ),
                "hdr": validate_hdr(
                    img_obj.get("hdr"),
                    Value::Null,
                    "/settings/image/hdr",
                    errors,
                ),
            });
        } else {
            add_error(
                errors,
                "/settings/image",
                "invalidType",
                "settings.image must be an object.",
                None,
            );
        }
    }

    let mut svg = defaults["svg"].clone();
    if let Some(raw_svg) = raw.get("svg") {
        if let Some(svg_obj) = raw_svg.as_object() {
            reject_unknown_keys(svg_obj, &["scale", "tracing"], "/settings/svg", errors);
            let scale = match svg_obj.get("scale") {
                None => json!(1),
                Some(v) => validate_number_range(v, 1.0, 8.0, "/settings/svg/scale", true, errors)
                    .unwrap_or_else(|| json!(1)),
            };
            let mut tracing = Value::Null;
            if let Some(raw_tr) = svg_obj.get("tracing").filter(|v| !v.is_null()) {
                if let Some(tr_obj) = raw_tr.as_object() {
                    reject_unknown_keys(
                        tr_obj,
                        &[
                            "filterSpeckle",
                            "colorPrecision",
                            "layerDifference",
                            "cornerThreshold",
                            "lengthThreshold",
                            "spliceThreshold",
                            "blackAndWhite",
                        ],
                        "/settings/svg/tracing",
                        errors,
                    );
                    let mut int_field = |key: &str, min: f64, max: f64, def: i64| -> Value {
                        match tr_obj.get(key) {
                            None => json!(def),
                            Some(v) => validate_number_range(
                                v,
                                min,
                                max,
                                &format!("/settings/svg/tracing/{key}"),
                                true,
                                errors,
                            )
                            .unwrap_or_else(|| json!(def)),
                        }
                    };
                    let filter_speckle = int_field("filterSpeckle", 0.0, 128.0, 4);
                    let color_precision = int_field("colorPrecision", 1.0, 8.0, 6);
                    let layer_difference = int_field("layerDifference", 0.0, 128.0, 16);
                    let corner_threshold = int_field("cornerThreshold", 0.0, 180.0, 60);
                    let splice_threshold = int_field("spliceThreshold", 0.0, 180.0, 45);
                    let length_threshold = match tr_obj.get("lengthThreshold") {
                        None => json!(4),
                        Some(v) => validate_number_range(
                            v,
                            0.0,
                            10.0,
                            "/settings/svg/tracing/lengthThreshold",
                            false,
                            errors,
                        )
                        .unwrap_or_else(|| json!(4)),
                    };
                    let mut bw = false;
                    if let Some(v) = tr_obj.get("blackAndWhite") {
                        match v.as_bool() {
                            Some(b) => bw = b,
                            None => add_error(
                                errors,
                                "/settings/svg/tracing/blackAndWhite",
                                "invalidType",
                                "Expected a boolean.",
                                None,
                            ),
                        }
                    }
                    tracing = json!({
                        "filterSpeckle": filter_speckle,
                        "colorPrecision": color_precision,
                        "layerDifference": layer_difference,
                        "cornerThreshold": corner_threshold,
                        "lengthThreshold": length_threshold,
                        "spliceThreshold": splice_threshold,
                        "blackAndWhite": bw,
                    });
                } else {
                    add_error(
                        errors,
                        "/settings/svg/tracing",
                        "invalidType",
                        "svg.tracing must be an object or null.",
                        None,
                    );
                }
            }
            svg = json!({ "scale": scale, "tracing": tracing });
        } else {
            add_error(
                errors,
                "/settings/svg",
                "invalidType",
                "settings.svg must be an object.",
                None,
            );
        }
    }

    if format.as_str() == Some("svg") {
        if compression["mode"].as_str() == Some("targetSize") {
            add_error(
                errors,
                "/settings/compression",
                "targetSizeNotSupportedForSvg",
                "Target size compression is not supported for SVG output.",
                None,
            );
        }
        if !image["resolution"].is_null() || !image["transform"].is_null() {
            add_warning(
                warnings,
                "/settings/image",
                "ignoredForSvg",
                "Resolution and transform are ignored for SVG output (use svg.scale instead).",
            );
        }
    }

    json!({
        "format": format,
        "compression": compression,
        "stripMetadata": strip_metadata,
        "image": image,
        "svg": svg,
    })
}

fn validate_audio_only_settings(
    raw_settings: Option<&Value>,
    mode: ValidationMode,
    errors: &mut Vec<ValidationIssue>,
    warnings: &mut Vec<ValidationIssue>,
) -> Value {
    let defaults = default_audio_contract()["settings"].clone();
    let Some(raw_val) = raw_settings else {
        return defaults;
    };
    let Some(raw) = raw_val.as_object() else {
        add_error(errors, "/settings", "invalidType", "settings must be an object.", None);
        return defaults;
    };
    reject_unknown_keys(
        raw,
        &["format", "compression", "speed", "metadata", "audio"],
        "/settings",
        errors,
    );

    let format = match raw.get("format") {
        None => defaults["format"].clone(),
        Some(v) if v.is_null() => Value::Null,
        Some(v) => validate_str_enum(v, AUDIO_OUTPUT_FORMATS, "/settings/format", errors)
            .map(|s| Value::String(s.to_string()))
            .unwrap_or(Value::Null),
    };

    let mut compression = defaults["compression"].clone();
    if let Some(raw_comp) = raw.get("compression") {
        if let Some(comp_obj) = raw_comp.as_object() {
            match comp_obj.get("mode").and_then(|v| v.as_str()) {
                Some("quality") => {
                    reject_unknown_keys(comp_obj, &["mode", "quality"], "/settings/compression", errors);
                    let q = match comp_obj.get("quality") {
                        None => json!(50),
                        Some(v) => validate_number_range(
                            v,
                            1.0,
                            100.0,
                            "/settings/compression/quality",
                            false,
                            errors,
                        )
                        .unwrap_or_else(|| json!(50)),
                    };
                    compression = json!({ "mode": "quality", "quality": q });
                }
                Some("targetSize") => {
                    reject_unknown_keys(
                        comp_obj,
                        &["mode", "targetSizeMB"],
                        "/settings/compression",
                        errors,
                    );
                    let mb = match comp_obj.get("targetSizeMB") {
                        None => json!(10),
                        Some(v) => validate_number_range(
                            v,
                            0.001,
                            10000.0,
                            "/settings/compression/targetSizeMB",
                            false,
                            errors,
                        )
                        .unwrap_or_else(|| json!(10)),
                    };
                    compression = json!({ "mode": "targetSize", "targetSizeMB": mb });
                }
                _ => add_error(
                    errors,
                    "/settings/compression/mode",
                    "invalidValue",
                    "compression.mode must be \"quality\" or \"targetSize\".",
                    allowed_strs(&["quality", "targetSize"]),
                ),
            }
        } else {
            add_error(
                errors,
                "/settings/compression",
                "invalidType",
                "compression must be an object.",
                None,
            );
        }
    }

    let speed = match raw.get("speed") {
        None => defaults["speed"].clone(),
        Some(v) if v.is_null() => Value::Null,
        Some(v) => validate_number_range(v, 0.25, 4.0, "/settings/speed", false, errors)
            .unwrap_or(Value::Null),
    };
    let metadata = validate_metadata(raw.get("metadata"), mode, "/settings/metadata", errors);
    let audio = validate_audio_settings(raw.get("audio"), &defaults["audio"], "/settings/audio", errors);

    if let (Some(fmt), Some(ac)) = (format.as_str(), audio["codec"].as_str()) {
        if !is_audio_codec_compatible(ac, fmt) {
            add_error(
                errors,
                "/settings/audio/codec",
                "incompatibleCodec",
                format!("Audio codec \"{ac}\" is not compatible with \"{fmt}\"."),
                None,
            );
        }
    } else if format.is_null() && audio["codec"].is_string() {
        add_warning(
            warnings,
            "/settings/format",
            "codecMayBeSkipped",
            "When format is null (same as input), a chosen audio codec is skipped for incompatible input formats.",
        );
    }

    json!({
        "format": format,
        "compression": compression,
        "speed": speed,
        "metadata": metadata,
        "audio": audio,
    })
}

pub fn validate_and_normalize_contract(
    input: &Value,
    mode: ValidationMode,
    require_name: bool,
) -> ValidationResult {
    let mut errors: Vec<ValidationIssue> = Vec::new();
    let mut warnings: Vec<ValidationIssue> = Vec::new();

    let Some(obj) = input.as_object() else {
        add_error(&mut errors, "", "invalidType", "Contract must be a JSON object.", None);
        return ValidationResult {
            ok: false,
            contract: None,
            errors,
            warnings,
        };
    };

    reject_unknown_keys(
        obj,
        &["$schema", "version", "mediaType", "name", "settings", "output"],
        "",
        &mut errors,
    );

    if let Some(schema) = obj.get("$schema") {
        if !schema.is_string() {
            add_error(
                &mut errors,
                "/$schema",
                "invalidType",
                "$schema must be a string.",
                None,
            );
        }
    }

    if obj.get("version").and_then(as_exact_i64) != Some(CONTRACT_VERSION as i64) {
        let ver_display = obj.get("version").cloned().unwrap_or(Value::Null);
        add_error(
            &mut errors,
            "/version",
            "unsupportedVersion",
            format!("Unsupported contract version {ver_display}. Expected {CONTRACT_VERSION}."),
            allowed_ints(&[CONTRACT_VERSION as i64]),
        );
    }

    let media_type = match obj.get("mediaType") {
        Some(v) => validate_str_enum(v, MEDIA_TYPES, "/mediaType", &mut errors),
        None => {
            add_error(
                &mut errors,
                "/mediaType",
                "invalidValue",
                "Invalid value undefined.",
                allowed_strs(MEDIA_TYPES),
            );
            None
        }
    };

    let mut name: Option<String> = None;
    if let Some(raw_name) = obj.get("name").filter(|v| !v.is_null()) {
        match raw_name.as_str() {
            Some(s) => {
                let trimmed = s.trim();
                if trimmed.chars().count() > PRESET_NAME_MAX_LENGTH {
                    add_error(
                        &mut errors,
                        "/name",
                        "tooLong",
                        format!("Preset name must be at most {PRESET_NAME_MAX_LENGTH} characters."),
                        None,
                    );
                } else if !trimmed.is_empty() {
                    name = Some(trimmed.to_string());
                }
            }
            None => add_error(
                &mut errors,
                "/name",
                "invalidType",
                "name must be a string.",
                None,
            ),
        }
    }

    if require_name {
        match &name {
            None => add_error(
                &mut errors,
                "/name",
                "required",
                "Preset name is required.",
                None,
            ),
            Some(n) if n.eq_ignore_ascii_case("standard") => add_error(
                &mut errors,
                "/name",
                "reservedName",
                "\"Standard\" is a built-in preset name and cannot be used.",
                None,
            ),
            _ => {}
        }
    }

    let output = validate_output(obj.get("output"), "/output", &mut errors, &mut warnings);
    let mt = media_type.unwrap_or("video");
    let settings = match mt {
        "image" => validate_image_settings(obj.get("settings"), &mut errors, &mut warnings),
        "audio" => validate_audio_only_settings(obj.get("settings"), mode, &mut errors, &mut warnings),
        _ => validate_video_settings(obj.get("settings"), mode, &mut errors, &mut warnings),
    };

    if !errors.is_empty() {
        return ValidationResult {
            ok: false,
            contract: None,
            errors,
            warnings,
        };
    }

    let mut out = Map::new();
    if let Some(schema) = obj.get("$schema").and_then(|v| v.as_str()) {
        out.insert(String::from("$schema"), Value::String(schema.to_string()));
    }
    out.insert(String::from("version"), json!(CONTRACT_VERSION));
    out.insert(String::from("mediaType"), Value::String(mt.to_string()));
    if let Some(n) = name {
        out.insert(String::from("name"), Value::String(n));
    }
    out.insert(String::from("settings"), settings);
    out.insert(String::from("output"), output);

    ValidationResult {
        ok: true,
        contract: Some(Value::Object(out)),
        errors,
        warnings,
    }
}
