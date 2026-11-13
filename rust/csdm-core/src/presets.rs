//! Presets: what a preset may carry, and the stored shapes of 3.5
//! (`config.py::preset_excludes`, `normalize_presets`, `preset_payload`).

use crate::error::CoreError;
use crate::migrate::{migrate_legacy_filter_keys, teamkills_sides};
use crate::settings::reference;
use serde_json::{json, Map, Value};

const FULL_CATEGORY: &str = "full";

/// Whether `key` is personal or machine state a preset never carries
/// (database credentials included: old presets held the password in clear).
pub fn excludes(key: &str) -> bool {
    let rules = &reference().presets;
    rules.excluded_keys.iter().any(|k| k == key) || rules.excluded_prefixes.iter().any(|p| key.starts_with(p.as_str()))
}

/// A stored preset's categories, old format (`type`) or new (`cats`).
pub fn categories(preset: &Map<String, Value>) -> Value {
    match preset.get("cats") {
        Some(c) if crate::migrate::truthy(c) => c.clone(),
        _ => json!([preset.get("type").cloned().unwrap_or_else(|| json!(FULL_CATEGORY))]),
    }
}

/// The presets file as the app keeps it: `cats` always present, personal keys
/// stripped, retired filter keys rewritten, `selected_clips` kept as stored.
pub fn normalize(presets: &Value) -> Result<Map<String, Value>, CoreError> {
    let shape = |what: String| CoreError::InvalidShape { what, expected: "an object" };
    let Value::Object(presets) = presets else { return Err(shape("the presets file".into())) };
    let mut out = Map::new();
    for (name, preset) in presets {
        let Value::Object(preset) = preset else { return Err(shape(format!("preset \"{name}\""))) };
        let data = match preset.get("data") {
            None => Map::new(),
            Some(Value::Object(d)) => d.clone(),
            Some(_) => return Err(shape(format!("the data of preset \"{name}\""))),
        };
        let mut data: Map<String, Value> = data.into_iter().filter(|(k, _)| !excludes(k)).collect();
        migrate_legacy_filter_keys(&mut data);
        let mut entry = Map::new();
        entry.insert("cats".into(), categories(preset));
        entry.insert("data".into(), Value::Object(data));
        if let Some(clips) = preset.get("selected_clips") {
            entry.insert("selected_clips".into(), clips.clone());
        }
        out.insert(name.clone(), Value::Object(entry));
    }
    Ok(out)
}

/// What loading a preset applies (3.5 `preset_payload`): its data, the keys it
/// really stored (`None` = full preset, every key), its clip selection.
pub fn payload(preset: &Map<String, Value>) -> (Map<String, Value>, Option<Vec<String>>, Option<Value>) {
    let mut data: Map<String, Value> = match preset.get("data") {
        Some(Value::Object(d)) => d.iter().filter(|(k, _)| !excludes(k)).map(|(k, v)| (k.clone(), v.clone())).collect(),
        _ => Map::new(),
    };
    if let (Some(id), false) = (data.get("steam_id").cloned(), data.contains_key("steam_ids")) {
        let ids = if crate::migrate::truthy(&id) { json!([id]) } else { json!([]) };
        data.insert("steam_ids".into(), ids);
    }
    if !data.contains_key("event_ally") && !data.contains_key("event_enemy") {
        if let Some((ally, enemy)) = data.get("teamkills_mode").and_then(Value::as_str).and_then(teamkills_sides) {
            data.insert("event_ally".into(), json!(ally));
            data.insert("event_enemy".into(), json!(enemy));
        }
    }
    let keys = keys_for(&categories(preset)).map(|ks| ks.into_iter().filter(|k| data.contains_key(k)).collect());
    (data, keys, preset.get("selected_clips").cloned())
}

/// Keys a preset of these categories covers; `None` = every key (3.5 `preset_keys_for`).
pub fn keys_for(cats: &Value) -> Option<Vec<String>> {
    let cats: Vec<&str> = cats.as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    if cats.contains(&FULL_CATEGORY) {
        return None;
    }
    let mut keys: Vec<String> = Vec::new();
    for cat in cats {
        for k in reference().presets.keys.get(cat).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
            if !keys.iter().any(|x| x == k) {
                keys.push(k.to_string());
            }
        }
    }
    Some(keys)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_and_personal_keys_never_survive() {
        for k in ["pg_pass", "pg_host", "pg_user", "pg_port", "pg_db", "csdm_exe", "config_dir", "saved_players", "ui_sections", "theme_bg"] {
            assert!(excludes(k), "{k}");
        }
        assert!(!excludes("before"));
        let stored = json!({"old": {"type": "full", "data": {"pg_pass": "x", "before": 4, "kill_mod_no_trois_shot": true}}});
        let n = normalize(&stored).unwrap();
        assert_eq!(n["old"], json!({"cats": ["full"], "data": {"before": 4, "kill_mod_trois_shot_exclude": true}}));
    }

    #[test]
    fn unreadable_shapes_fail_explicitly() {
        assert!(normalize(&json!([])).is_err());
        assert!(normalize(&json!({"p": 3})).is_err());
        assert!(normalize(&json!({"p": {"data": []}})).is_err());
    }

    #[test]
    fn payload_like_35() {
        let p = json!({"cats": ["players", "timing"], "data": {"steam_id": "7", "before": 1, "pg_pass": "x", "teamkills_mode": "only"}});
        let (data, keys, clips) = payload(p.as_object().unwrap());
        assert_eq!(data["steam_ids"], json!(["7"]));
        assert_eq!((&data["event_ally"], &data["event_enemy"]), (&json!(true), &json!(false)));
        assert!(!data.contains_key("pg_pass"));
        assert_eq!(keys, Some(vec!["steam_id".to_string(), "steam_ids".into(), "before".into()]));
        assert_eq!(clips, None);
        let full = json!({"type": "full", "data": {}});
        assert_eq!(payload(full.as_object().unwrap()).1, None);
    }
}
