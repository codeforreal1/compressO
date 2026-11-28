//! Central CompressO JSON Contract v1 engine (`core::contract`): schema generation,
//! validation/normalization, RFC 7386 merge-patch, contract↔preset translation, preset CRUD
//! over `presets.json`, and `CliSettings` snapshot synthesis.

pub mod patch;
pub mod spec;
pub mod translate;
pub mod validate;

use serde_json::{json, Value};
use tauri::AppHandle;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::core::presets::{self, PresetsStoreData, StoredPreset};
use crate::core::settings::{self, DomainSettings};
use crate::core::contract::spec::*;
use crate::core::contract::validate::{validate_and_normalize_contract, ValidationIssue, ValidationMode};

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}

fn error_json(code: &str, message: impl Into<String>, errors: Option<&[ValidationIssue]>) -> Value {
    let mut obj = json!({
        "ok": false,
        "code": code,
        "message": message.into(),
    });
    if let Some(errs) = errors {
        if !errs.is_empty() {
            obj.as_object_mut()
                .unwrap()
                .insert(String::from("errors"), json!(errs));
        }
    }
    obj
}

fn format_validation_errors(errors: &[ValidationIssue]) -> String {
    errors
        .iter()
        .map(|e| {
            let p = if e.path.is_empty() { "/" } else { e.path.as_str() };
            format!("{p}: {}", e.message)
        })
        .collect::<Vec<_>>()
        .join("; ")
}

enum ResolvedRef<'a> {
    Standard,
    Custom(usize, &'a StoredPreset),
}

fn resolve_preset_ref<'a>(
    presets_list: &'a [StoredPreset],
    raw_ref: &str,
    media_type: Option<&str>,
) -> Result<ResolvedRef<'a>, Value> {
    let trimmed = raw_ref.trim();
    if trimmed.is_empty() {
        return Err(error_json(
            "invalidRequest",
            "Preset id or name is required.",
            None,
        ));
    }
    if trimmed.eq_ignore_ascii_case("standard") {
        return Ok(ResolvedRef::Standard);
    }

    let pool: Vec<(usize, &StoredPreset)> = presets_list
        .iter()
        .enumerate()
        .filter(|(_, p)| media_type.is_none_or(|mt| p.media_type == mt))
        .collect();

    if let Some((idx, preset)) = pool.iter().find(|(_, p)| p.id == trimmed) {
        return Ok(ResolvedRef::Custom(*idx, preset));
    }

    let lower = trimmed.to_ascii_lowercase();
    let by_name: Vec<(usize, &StoredPreset)> = pool
        .into_iter()
        .filter(|(_, p)| p.name.to_ascii_lowercase() == lower)
        .collect();

    if by_name.len() == 1 {
        let (idx, preset) = by_name[0];
        return Ok(ResolvedRef::Custom(idx, preset));
    }
    if by_name.len() > 1 {
        let types: Vec<&str> = by_name.iter().map(|(_, p)| p.media_type.as_str()).collect();
        return Err(error_json(
            "ambiguousPreset",
            format!(
                "Multiple media types have a preset named \"{trimmed}\". Specify mediaType ({}).",
                types.join(", ")
            ),
            None,
        ));
    }

    let msg = match media_type {
        Some(mt) => format!("There is no {mt} preset named or with id \"{trimmed}\"."),
        None => format!("There is no preset named or with id \"{trimmed}\"."),
    };
    Err(error_json("unknownPreset", msg, None))
}

fn available_preset_name(presets_list: &[StoredPreset], base: &str, media_type: &str) -> String {
    let lower_taken: Vec<String> = presets_list
        .iter()
        .filter(|p| p.media_type == media_type)
        .map(|p| p.name.to_ascii_lowercase())
        .chain(std::iter::once(String::from("standard")))
        .collect();
    if !lower_taken.iter().any(|n| n == &base.to_ascii_lowercase()) {
        return base.to_string();
    }
    let mut count = 2usize;
    loop {
        let candidate = format!("{base} ({count})");
        if !lower_taken
            .iter()
            .any(|n| n == &candidate.to_ascii_lowercase())
        {
            return candidate;
        }
        count += 1;
    }
}

pub fn validate_contract_value(
    contract: &Value,
    mode: Option<&str>,
    require_name: Option<bool>,
) -> Value {
    let res = validate_and_normalize_contract(
        contract,
        ValidationMode::parse(mode),
        require_name.unwrap_or(false),
    );
    if !res.ok {
        return json!({
            "ok": false,
            "code": "invalidContract",
            "message": format_validation_errors(&res.errors),
            "errors": res.errors,
            "warnings": res.warnings,
        });
    }
    json!({
        "ok": true,
        "contract": res.contract,
        "warnings": res.warnings,
    })
}

pub fn get_preset(
    app_handle: &AppHandle,
    id_or_name: &str,
    media_type: Option<&str>,
) -> Value {
    let data = presets::get(app_handle);
    let domain = settings::get(app_handle);
    match resolve_preset_ref(&data.presets, id_or_name, media_type) {
        Err(err) => err,
        Ok(ResolvedRef::Standard) => {
            let Some(mt) = media_type else {
                return error_json(
                    "ambiguousPreset",
                    "Multiple media types have a \"Standard\" preset. Specify mediaType (video, image, audio).",
                    None,
                );
            };
            let std_preset = translate::standard_preset(mt);
            json!({
                "ok": true,
                "preset": translate::to_preset_view(&std_preset, &data.default_preset_ids, &domain),
            })
        }
        Ok(ResolvedRef::Custom(_, preset)) => json!({
            "ok": true,
            "preset": translate::to_preset_view(preset, &data.default_preset_ids, &domain),
        }),
    }
}

pub fn create_preset(
    app_handle: &AppHandle,
    raw_contract: &Value,
    on_conflict: Option<&str>,
) -> Result<Value, String> {
    let conflict = on_conflict.unwrap_or("error");
    let validated = validate_and_normalize_contract(raw_contract, ValidationMode::Preset, true);
    if !validated.ok {
        return Ok(error_json(
            "invalidContract",
            format_validation_errors(&validated.errors),
            Some(&validated.errors),
        ));
    }
    let contract = validated.contract.unwrap();
    let media_type = contract["mediaType"].as_str().unwrap_or("video").to_string();
    let wanted_name = contract["name"].as_str().unwrap_or("Preset").to_string();

    let mut data = presets::get(app_handle);
    let domain = settings::get(app_handle);
    let existing_idx = data.presets.iter().position(|p| {
        p.media_type == media_type && p.name.eq_ignore_ascii_case(&wanted_name)
    });

    let now = now_iso();
    let (preset_view, created, replaced, renamed) = if let Some(idx) = existing_idx {
        match conflict {
            "error" => {
                let existing_name = &data.presets[idx].name;
                return Ok(error_json(
                    "presetExists",
                    format!("A {media_type} preset named \"{existing_name}\" already exists."),
                    None,
                ));
            }
            "replace" => {
                let existing = &data.presets[idx];
                let mut updated = translate::contract_to_preset(existing.id.clone(), &contract);
                updated.revision = Some(existing.revision.unwrap_or(1) + 1);
                updated.updated_at = Some(now);
                let view = translate::to_preset_view(&updated, &data.default_preset_ids, &domain);
                data.presets[idx] = updated;
                (view, false, true, false)
            }
            _ => {
                let final_name = available_preset_name(&data.presets, &wanted_name, &media_type);
                let mut renamed_contract = contract;
                renamed_contract
                    .as_object_mut()
                    .unwrap()
                    .insert(String::from("name"), Value::String(final_name));
                let mut created_preset =
                    translate::contract_to_preset(nanoid::nanoid!(10), &renamed_contract);
                created_preset.revision = Some(1);
                created_preset.updated_at = Some(now);
                let view =
                    translate::to_preset_view(&created_preset, &data.default_preset_ids, &domain);
                data.presets.push(created_preset);
                (view, true, false, true)
            }
        }
    } else {
        let mut created_preset = translate::contract_to_preset(nanoid::nanoid!(10), &contract);
        created_preset.revision = Some(1);
        created_preset.updated_at = Some(now);
        let view = translate::to_preset_view(&created_preset, &data.default_preset_ids, &domain);
        data.presets.push(created_preset);
        (view, true, false, false)
    };

    let saved = presets::save(app_handle, data)?;
    sync_cli_settings_from_core(app_handle, &saved, &domain);

    Ok(json!({
        "ok": true,
        "preset": preset_view,
        "warnings": validated.warnings,
        "created": created,
        "replaced": replaced,
        "renamed": renamed,
    }))
}

pub fn update_preset(
    app_handle: &AppHandle,
    id_or_name: &str,
    patch_or_contract: &Value,
    media_type: Option<&str>,
    replace: Option<bool>,
    if_revision: Option<u64>,
) -> Result<Value, String> {
    let mut data = presets::get(app_handle);
    let domain = settings::get(app_handle);

    let (idx, existing) = match resolve_preset_ref(&data.presets, id_or_name, media_type) {
        Err(err) => return Ok(err),
        Ok(ResolvedRef::Standard) => {
            return Ok(error_json(
                "standardPresetReadOnly",
                "The built-in Standard preset cannot be modified.",
                None,
            ));
        }
        Ok(ResolvedRef::Custom(idx, preset)) => (idx, preset.clone()),
    };

    let current_revision = existing.revision.unwrap_or(1);
    if let Some(expected_rev) = if_revision {
        if expected_rev != current_revision {
            return Ok(error_json(
                "revisionConflict",
                format!(
                    "Preset \"{}\" is at revision {current_revision}, not {expected_rev}.",
                    existing.name
                ),
                None,
            ));
        }
    }

    let current_contract = translate::preset_to_contract(&existing);
    let candidate = if replace.unwrap_or(false) {
        patch_or_contract.clone()
    } else {
        if !patch_or_contract.is_object() {
            return Ok(error_json(
                "invalidContract",
                "Patch must be a JSON object.",
                None,
            ));
        }
        patch::apply_merge_patch(&current_contract, patch_or_contract)
    };

    if let Some(candidate_mt) = candidate.get("mediaType").and_then(|v| v.as_str()) {
        if candidate_mt != existing.media_type {
            return Ok(error_json(
                "mediaTypeMismatch",
                format!(
                    "Cannot change preset mediaType from \"{}\" to \"{candidate_mt}\".",
                    existing.media_type
                ),
                None,
            ));
        }
    }

    let validated = validate_and_normalize_contract(&candidate, ValidationMode::Preset, true);
    if !validated.ok {
        return Ok(error_json(
            "invalidContract",
            format_validation_errors(&validated.errors),
            Some(&validated.errors),
        ));
    }

    let next_contract = validated.contract.unwrap();
    let next_name = next_contract["name"].as_str().unwrap_or("");
    if let Some(clash) = data.presets.iter().enumerate().find_map(|(i, p)| {
        (i != idx
            && p.media_type == existing.media_type
            && p.name.eq_ignore_ascii_case(next_name))
        .then_some(p)
    }) {
        return Ok(error_json(
            "presetExists",
            format!(
                "A {} preset named \"{}\" already exists.",
                existing.media_type, clash.name
            ),
            None,
        ));
    }

    let mut updated = translate::contract_to_preset(existing.id.clone(), &next_contract);
    updated.revision = Some(current_revision + 1);
    updated.updated_at = Some(now_iso());
    let view = translate::to_preset_view(&updated, &data.default_preset_ids, &domain);
    data.presets[idx] = updated;

    let saved = presets::save(app_handle, data)?;
    sync_cli_settings_from_core(app_handle, &saved, &domain);

    Ok(json!({
        "ok": true,
        "preset": view,
        "warnings": validated.warnings,
    }))
}

pub fn delete_preset(
    app_handle: &AppHandle,
    id_or_name: &str,
    media_type: Option<&str>,
) -> Result<Value, String> {
    let mut data = presets::get(app_handle);
    let domain = settings::get(app_handle);

    let target = match resolve_preset_ref(&data.presets, id_or_name, media_type) {
        Err(err) => return Ok(err),
        Ok(ResolvedRef::Standard) => {
            return Ok(error_json(
                "standardPresetReadOnly",
                "The built-in Standard preset cannot be deleted.",
                None,
            ));
        }
        Ok(ResolvedRef::Custom(_, preset)) => preset.clone(),
    };

    data.presets.retain(|p| p.id != target.id);
    let mut reset = false;
    let default_slot = match target.media_type.as_str() {
        "image" => &mut data.default_preset_ids.image,
        "audio" => &mut data.default_preset_ids.audio,
        _ => &mut data.default_preset_ids.video,
    };
    if *default_slot == target.id {
        *default_slot = String::from("standard");
        reset = true;
    }

    let affected: Vec<Value> = domain
        .watched_folders
        .iter()
        .filter(|folder| {
            let pid = folder.preset_ids.as_ref().and_then(|pids| match target.media_type.as_str() {
                "image" => pids.image.as_deref(),
                "audio" => pids.audio.as_deref(),
                _ => pids.video.as_deref(),
            });
            pid == Some(target.id.as_str())
        })
        .map(|folder| json!({ "id": folder.id, "path": folder.path }))
        .collect();

    let saved = presets::save(app_handle, data)?;
    sync_cli_settings_from_core(app_handle, &saved, &domain);

    Ok(json!({
        "ok": true,
        "deletedId": target.id,
        "deletedName": target.name,
        "mediaType": target.media_type,
        "defaultResetToStandard": reset,
        "affectedWatchedFolders": affected,
    }))
}

pub fn set_default_preset(
    app_handle: &AppHandle,
    id_or_name: &str,
    media_type: &str,
) -> Result<Value, String> {
    if !MEDIA_TYPES.contains(&media_type) {
        return Ok(error_json(
            "invalidRequest",
            format!("Invalid mediaType \"{media_type}\". Use video, image, or audio."),
            None,
        ));
    }
    let mut data = presets::get(app_handle);
    let domain = settings::get(app_handle);

    let (default_id, preset_name) = match resolve_preset_ref(&data.presets, id_or_name, Some(media_type)) {
        Err(err) => return Ok(err),
        Ok(ResolvedRef::Standard) => (String::from("standard"), String::from("Standard")),
        Ok(ResolvedRef::Custom(_, preset)) => (preset.id.clone(), preset.name.clone()),
    };

    match media_type {
        "image" => data.default_preset_ids.image = default_id.clone(),
        "audio" => data.default_preset_ids.audio = default_id.clone(),
        _ => data.default_preset_ids.video = default_id.clone(),
    }

    let saved = presets::save(app_handle, data)?;
    sync_cli_settings_from_core(app_handle, &saved, &domain);

    Ok(json!({
        "ok": true,
        "mediaType": media_type,
        "defaultPresetId": default_id,
        "presetName": preset_name,
    }))
}

/// Builds the full `CliSettings` document directly in Rust from `presets.json`, `settings.json`,
/// and `core::contract::spec`, so `cli-settings.json` stays accurate without a WebView.
fn cli_settings_metadata() -> [(&'static str, Value); 5] {
    [
        ("schemaVersion", json!(1)),
        (
            "extensions",
            json!({
                "video": VIDEO_INPUT_EXTENSIONS,
                "image": IMAGE_INPUT_EXTENSIONS,
                "audio": AUDIO_INPUT_EXTENSIONS,
            }),
        ),
        (
            "outputExtensions",
            json!({
                "video": VIDEO_OUTPUT_FORMATS,
                "image": IMAGE_OUTPUT_FORMATS,
                "audio": AUDIO_OUTPUT_FORMATS,
            }),
        ),
        (
            "contractSchemas",
            json!({
                "video": get_contract_json_schema("video", true),
                "image": get_contract_json_schema("image", true),
                "audio": get_contract_json_schema("audio", true),
            }),
        ),
        ("contractCapabilities", get_contract_capabilities()),
    ]
}

/// Ensures an older `cli-settings.json` (e.g. from 4.x before `outputExtensions` or contract
/// metadata existed) has current format/schema metadata while keeping its presets & output prefs.
pub fn upgrade_legacy_cli_settings(doc: &mut Value) -> bool {
    let Some(root) = doc.as_object_mut() else {
        return false;
    };
    let is_current = root.get("schemaVersion").and_then(|v| v.as_u64()) == Some(1)
        && root
            .get("outputExtensions")
            .and_then(|v| v.as_object())
            .is_some_and(|m| !m.is_empty())
        && root.get("contractSchemas").is_some_and(|v| v.is_object())
        && root
            .get("contractCapabilities")
            .is_some_and(|v| v.is_object());
    if is_current {
        return false;
    }
    for (key, value) in cli_settings_metadata() {
        root.insert(String::from(key), value);
    }
    true
}

pub fn build_cli_settings_json(data: &PresetsStoreData, domain: &DomainSettings) -> Value {
    let mut all_presets = Vec::new();
    for &mt in MEDIA_TYPES {
        let std_preset = translate::standard_preset(mt);
        all_presets.push(translate::to_preset_view(
            &std_preset,
            &data.default_preset_ids,
            domain,
        ));
        for preset in data.presets.iter().filter(|p| p.media_type == mt) {
            all_presets.push(translate::to_preset_view(
                preset,
                &data.default_preset_ids,
                domain,
            ));
        }
    }

    let watched: Vec<Value> = domain
        .watched_folders
        .iter()
        .map(|folder| {
            let pids = folder.preset_ids.as_ref();
            json!({
                "id": folder.id,
                "path": folder.path,
                "isEnabled": folder.is_enabled,
                "presetIds": {
                    "video": pids.and_then(|p| p.video.as_deref()).unwrap_or("default"),
                    "image": pids.and_then(|p| p.image.as_deref()).unwrap_or("default"),
                    "audio": pids.and_then(|p| p.audio.as_deref()).unwrap_or("default"),
                }
            })
        })
        .collect();

    let mut doc = json!({
        "presets": all_presets,
        "defaultPresetIds": data.default_preset_ids,
        "output": {
            "skipLargerOutputs": !domain.save_larger_outputs,
            "preserveFolderStructure": domain.preserve_folder_structure,
            "replaceOriginalFiles": domain.replace_original_files,
            "useHardwareAcceleration": domain.use_hardware_acceleration,
            "reachTargetSizesWithoutAcceleration": domain.retry_target_size_on_cpu,
        },
        "watchedFolders": watched,
        "showMenuBarIcon": domain.show_menu_bar_icon,
    });
    if let Some(root) = doc.as_object_mut() {
        for (key, value) in cli_settings_metadata() {
            root.insert(String::from(key), value);
        }
    }
    doc
}

pub fn sync_cli_settings_from_core(
    app_handle: &AppHandle,
    data: &PresetsStoreData,
    domain: &DomainSettings,
) {
    let doc = build_cli_settings_json(data, domain);
    crate::sys::cli_settings::sync_cli_settings(app_handle.clone(), doc);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_default_contracts_through_preset_translation() {
        for (mt, def) in [
            ("video", default_video_contract()),
            ("image", default_image_contract()),
            ("audio", default_audio_contract()),
        ] {
            let mut input = def.clone();
            input
                .as_object_mut()
                .unwrap()
                .insert(String::from("name"), Value::String(String::from("My Preset")));
            let validated = validate_and_normalize_contract(&input, ValidationMode::Preset, true);
            assert!(validated.ok, "{mt} failed: {:?}", validated.errors);
            let normalized = validated.contract.unwrap();
            let preset = translate::contract_to_preset(String::from("p1"), &normalized);
            let back = translate::preset_to_contract(&preset);
            assert_eq!(back, normalized, "{mt} round-trip mismatch");
        }
    }

    #[test]
    fn round_trips_custom_video_contract() {
        let input = json!({
            "version": 1,
            "mediaType": "video",
            "name": "Web 720p",
            "settings": {
                "format": "mp4",
                "compression": { "mode": "targetSize", "targetSizeMB": 25 },
                "speed": 1.5,
                "metadata": { "mode": "keep" },
                "video": {
                    "codec": "h264",
                    "resolution": "720p",
                    "fps": 30,
                    "transform": {
                        "rotate": 90,
                        "flipHorizontal": true,
                        "flipVertical": false,
                        "crop": "16:9"
                    },
                    "hdr": { "mode": "remove" }
                },
                "audio": {
                    "volumePercent": 120,
                    "codec": "aac",
                    "channels": { "layout": "mono", "source": "left" },
                    "bitrateKbps": 96
                },
                "clips": { "mode": "count", "count": 4 }
            },
            "output": {
                "saveTo": "folder",
                "folder": "/tmp/compresso-out",
                "fileNameTemplate": "{name}_{preset}"
            }
        });
        let validated = validate_and_normalize_contract(&input, ValidationMode::Preset, true);
        assert!(validated.ok, "errors: {:?}", validated.errors);
        let normalized = validated.contract.unwrap();
        let preset = translate::contract_to_preset(String::from("v1"), &normalized);
        assert_eq!(translate::preset_to_contract(&preset), normalized);
    }

    #[test]
    fn enforces_one_shot_vs_preset_and_cross_field_rules() {
        let one_shot_only = json!({
            "version": 1,
            "mediaType": "video",
            "name": "Bad Preset",
            "settings": {
                "metadata": { "mode": "keep", "set": { "title": "Hello" } },
                "video": { "thumbnail": "/tmp/cover.png" },
                "subtitles": {
                    "preserveExisting": false,
                    "tracks": [{ "path": "/tmp/sub.srt", "language": "en" }]
                }
            }
        });
        let preset_res =
            validate_and_normalize_contract(&one_shot_only, ValidationMode::Preset, true);
        assert!(!preset_res.ok);
        let codes: Vec<&str> = preset_res.errors.iter().map(|e| e.code.as_str()).collect();
        assert!(codes.iter().filter(|c| **c == "presetDisallowedField").count() == 3);

        let one_shot_res =
            validate_and_normalize_contract(&one_shot_only, ValidationMode::OneShot, false);
        assert!(one_shot_res.ok, "unexpected errors: {:?}", one_shot_res.errors);

        let gif_err = validate_and_normalize_contract(
            &json!({
                "version": 1,
                "mediaType": "video",
                "settings": {
                    "format": "gif",
                    "compression": { "mode": "targetSize", "targetSizeMB": 5 },
                    "clips": { "mode": "count", "count": 2 }
                }
            }),
            ValidationMode::OneShot,
            false,
        );
        assert!(!gif_err.ok);
        assert!(gif_err
            .errors
            .iter()
            .any(|e| e.code == "targetSizeNotSupportedForGif"));
        assert!(gif_err
            .errors
            .iter()
            .any(|e| e.code == "clipsNotSupportedForGif"));
    }

    #[test]
    fn rejects_odd_pixel_resolution_and_incompatible_codec() {
        let odd = validate_and_normalize_contract(
            &json!({
                "version": 1,
                "mediaType": "video",
                "settings": { "video": { "resolution": 721 } }
            }),
            ValidationMode::OneShot,
            false,
        );
        assert!(!odd.ok);
        assert_eq!(odd.errors[0].code, "invalidResolution");

        let incompat = validate_and_normalize_contract(
            &json!({
                "version": 1,
                "mediaType": "video",
                "settings": { "format": "mp4", "video": { "codec": "vp9" } }
            }),
            ValidationMode::OneShot,
            false,
        );
        assert!(!incompat.ok);
        assert_eq!(incompat.errors[0].code, "incompatibleCodec");
    }

    #[test]
    fn synthesizes_cli_settings_json_headlessly() {
        let data = PresetsStoreData::default();
        let domain = DomainSettings::default();
        let cli = build_cli_settings_json(&data, &domain);
        assert_eq!(cli["presets"].as_array().unwrap().len(), 3);
        assert!(cli["contractCapabilities"]["formats"]["video"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "mp4"));
    }

    #[test]
    fn upgrades_legacy_cli_settings_without_clobbering_presets() {
        let mut legacy = json!({
            "defaultPresetIds": {
                "video": "custom-vid",
                "image": "standard",
                "audio": "standard"
            },
            "extensions": { "video": ["mp4"] },
            "output": { "skipLargerOutputs": false },
            "presets": [
                { "id": "custom-vid", "name": "My Video", "mediaType": "video" }
            ]
        });
        assert!(upgrade_legacy_cli_settings(&mut legacy));
        assert_eq!(legacy["schemaVersion"], 1);
        assert_eq!(legacy["defaultPresetIds"]["video"], "custom-vid");
        assert_eq!(legacy["presets"][0]["id"], "custom-vid");
        assert!(legacy["outputExtensions"]["video"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "mp4"));
        assert!(legacy["contractSchemas"]["video"].is_object());
        assert!(legacy["contractCapabilities"]["formats"]["video"].is_array());
        assert!(!upgrade_legacy_cli_settings(&mut legacy));
    }
}
