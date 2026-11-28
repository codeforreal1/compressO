//! RFC 7386 JSON Merge Patch preserving explicit `null` values (which signify "keep original /
//! automatic" in CompressO JSON contracts).

use serde_json::{Map, Value};

pub fn apply_merge_patch(target: &Value, patch: &Value) -> Value {
    let Some(patch_obj) = patch.as_object() else {
        return patch.clone();
    };
    let mut result: Map<String, Value> = match target.as_object() {
        Some(obj) => obj.clone(),
        None => Map::new(),
    };
    for (key, value) in patch_obj {
        if value.is_null() {
            result.insert(key.clone(), Value::Null);
        } else if value.is_object() {
            let base = result.get(key).unwrap_or(&Value::Null);
            result.insert(key.clone(), apply_merge_patch(base, value));
        } else {
            result.insert(key.clone(), value.clone());
        }
    }
    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_patch_preserves_explicit_nulls_and_merges_nested_objects() {
        let base = json!({
            "name": "Web",
            "settings": { "format": "mp4", "video": { "fps": 30, "codec": "h264" } }
        });
        let patch = json!({
            "settings": { "video": { "fps": null } },
            "output": null
        });
        assert_eq!(
            apply_merge_patch(&base, &patch),
            json!({
                "name": "Web",
                "settings": { "format": "mp4", "video": { "fps": null, "codec": "h264" } },
                "output": null
            })
        );
    }
}
