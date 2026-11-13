//! Static registries of 3.5 `csdm/static_data.py`: kill filters, match types,
//! weapons, codecs. Data in `data/registries.json` (exported from 3.5, parity
//! test in `tests/parity.rs`). Add a filter = add an entry there.

use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Deserialize, Debug, Clone)]
pub struct FilterDef {
    pub key: String,
    pub label: String,
    pub badge: String,
    /// "mods" | "dp2" | "db" | "event"
    pub category: String,
    pub tip: String,
    pub sql_cols: Option<Vec<String>>,
    pub dp2_filter: Option<String>,
    pub dp2_apply: Option<String>,
    pub dp2_log: Option<String>,
    pub dp2_result: Option<String>,
    pub dp2_skip: Option<String>,
    pub special: Option<String>,
    pub hide_ui: bool,
    /// Extra settings this filter owns, at their defaults (already in the settings table).
    pub extra_config: Option<Map<String, Value>>,
    pub camera_fn: Option<String>,
    pub applies_to: Vec<String>,
    /// Setting key → (label, unit) for the registry-built rows.
    pub extra_ui: Option<Map<String, Value>>,
    pub untested: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct MatchType { pub db_values: Vec<String>, pub key: String, pub label: String, pub tip: String }

#[derive(Deserialize, Debug, Clone)]
pub struct Resolution { pub label: String, pub width: u32, pub height: u32 }

#[derive(Deserialize, Debug, Clone)]
pub struct Registries {
    pub kill_filters: Vec<FilterDef>,
    pub no_auto_exclude: Vec<String>,
    pub match_types: Vec<MatchType>,
    /// Category → weapon names, in display order (insertion order kept).
    pub weapon_categories: Map<String, Value>,
    pub weapon_category_tips: BTreeMap<String, String>,
    pub weapon_icons: BTreeMap<String, String>,
    pub weapon_lookup: BTreeMap<String, String>,
    pub weapon_substring_fallback: Vec<(String, String)>,
    pub gun_weapons: Vec<String>,
    pub video_codecs: Map<String, Value>,
    pub cpu_video_codecs: Vec<String>,
    pub audio_codecs: Map<String, Value>,
    pub resolutions: Vec<Resolution>,
    pub framerates: Vec<u32>,
    pub perspective_labels: BTreeMap<String, String>,
}

pub fn registries() -> &'static Registries {
    static REG: OnceLock<Registries> = OnceLock::new();
    REG.get_or_init(|| {
        serde_json::from_str(include_str!("../data/registries.json"))
            .expect("csdm-core/data/registries.json does not match the Registries shape")
    })
}

const WEAPON_PREFIX: &str = "weapon_";
const OTHER_CATEGORY: &str = "Other";

/// Weapon category of a CSDM or demoparser weapon name (3.5 `_weapon_category`).
pub fn weapon_category(weapon_name: &str) -> &'static str {
    let r = registries();
    let lower = weapon_name.trim().to_lowercase();
    let key = lower.strip_prefix(WEAPON_PREFIX).unwrap_or(&lower);
    if let Some(c) = r.weapon_lookup.get(key) {
        return c;
    }
    r.weapon_substring_fallback.iter().find(|(sub, _)| key.contains(sub.as_str())).map_or(OTHER_CATEGORY, |(_, c)| c)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::def;

    #[test]
    fn registries_load() {
        let r = registries();
        assert!(!r.kill_filters.is_empty() && !r.match_types.is_empty() && !r.video_codecs.is_empty());
    }

    #[test]
    fn every_filter_key_is_a_setting() {
        // 3.5 derived DEFAULT_CONFIG entries from the registry; the table must hold them all.
        let r = registries();
        for f in &r.kill_filters {
            assert!(def(&f.key).is_some() && def(&format!("{}_req", f.key)).is_some(), "{}", f.key);
            let wants_exclude = !f.hide_ui && !r.no_auto_exclude.contains(&f.key);
            assert_eq!(def(&format!("{}_exclude", f.key)).is_some(), wants_exclude, "{}_exclude", f.key);
            for k in f.extra_config.iter().flat_map(|m| m.keys()) {
                assert!(def(k).is_some(), "{k}");
            }
        }
        for m in &r.match_types {
            assert!(def(&m.key).is_some(), "{}", m.key);
        }
    }

    #[test]
    fn weapon_categories_like_35() {
        assert_eq!(weapon_category("weapon_ak47"), weapon_category("ak47"));
        assert_eq!(weapon_category("Glock-18"), "Pistols");
        assert_eq!(weapon_category("definitely-not-a-weapon"), "Other");
    }
}
