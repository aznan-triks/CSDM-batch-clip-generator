//! The settings table: one row per key (default, type, owning capability).
//!
//! Replaces 3.5's `DEFAULT_CONFIG` + `capabilities.py`. The data is
//! `data/settings.json`, first exported from 3.5 by `tools/export_reference.py`;
//! `tests/parity.rs` re-runs that export and fails on any drift.

use crate::values::{DP2_THREADS_MAX, DP2_THREADS_MIN, DP2_THREADS_UNKNOWN_CPU};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::sync::OnceLock;

/// Live settings, in table order, same JSON shape as 3.5's `csdm_config.json`.
pub type Settings = Map<String, Value>;

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SettingType { Bool, Int, Float, Text, List, Object }

#[derive(Deserialize, Debug, Clone)]
pub struct SettingDef {
    pub key: String,
    #[serde(rename = "type")]
    pub ty: SettingType,
    pub default: Value,
    /// Id of the capability that owns the key (`Reference::capabilities`).
    pub owner: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Capability {
    pub id: String,
    pub intention: String,
    pub label: String,
    pub level: String,
    /// Engine commands (`csdm_engine::Command::name`) this capability owns.
    pub commands: Vec<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PresetRules {
    pub categories: Map<String, Value>,
    /// Category → keys it saves; `null` = every key (`full`).
    pub keys: Map<String, Value>,
    pub tab_groups: Value,
    pub excluded_keys: Vec<String>,
    pub excluded_prefixes: Vec<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Reference {
    pub settings: Vec<SettingDef>,
    pub capabilities: Vec<Capability>,
    pub intentions: Vec<(String, String)>,
    pub levels: Vec<String>,
    pub ui_sections_version: u32,
    pub presets: PresetRules,
}

/// The embedded table. Invalid data is a build defect, caught by the tests below.
pub fn reference() -> &'static Reference {
    static REF: OnceLock<Reference> = OnceLock::new();
    REF.get_or_init(|| {
        serde_json::from_str(include_str!("../data/settings.json"))
            .expect("csdm-core/data/settings.json does not match the Reference shape")
    })
}

pub fn def(key: &str) -> Option<&'static SettingDef> {
    reference().settings.iter().find(|d| d.key == key)
}

/// Every key at its default. `cpu_count` sets `dp2_threads` the way 3.5 did.
pub fn defaults(cpu_count: Option<usize>) -> Settings {
    let mut s: Settings = reference().settings.iter().map(|d| (d.key.clone(), d.default.clone())).collect();
    let threads = cpu_count.unwrap_or(DP2_THREADS_UNKNOWN_CPU).clamp(DP2_THREADS_MIN, DP2_THREADS_MAX);
    s.insert("dp2_threads".into(), Value::from(threads));
    s
}

/// Tolerant conversion of a stored value to the key's type (research/05 « Types »):
/// `"5432"` → 5432, 3 → 3.0, 5432 → `"5432"` for a text key. `None` = not convertible.
pub fn convert(ty: SettingType, v: &Value) -> Option<Value> {
    match (ty, v) {
        (SettingType::Bool, Value::Bool(_))
        | (SettingType::Text, Value::String(_))
        | (SettingType::List, Value::Array(_))
        | (SettingType::Object, Value::Object(_)) => Some(v.clone()),
        (SettingType::Int, Value::Number(n)) => n.as_i64().map(Value::from).or_else(|| whole(n.as_f64()?)),
        (SettingType::Int, Value::String(s)) => {
            let t = s.trim();
            t.parse::<i64>().ok().map(Value::from).or_else(|| whole(t.parse().ok()?))
        }
        (SettingType::Float, Value::Number(n)) => finite(n.as_f64()?),
        (SettingType::Float, Value::String(s)) => finite(s.trim().parse().ok()?),
        (SettingType::Text, Value::Number(n)) => Some(Value::String(n.to_string())),
        _ => None,
    }
}

fn whole(f: f64) -> Option<Value> {
    (f.is_finite() && f.fract() == 0.0 && f.abs() < i64::MAX as f64).then(|| Value::from(f as i64))
}

fn finite(f: f64) -> Option<Value> {
    f.is_finite().then(|| Value::from(f))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn embedded_table_loads_and_keys_are_unique() {
        let r = reference();
        assert!(!r.settings.is_empty());
        let mut keys: Vec<&str> = r.settings.iter().map(|d| d.key.as_str()).collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), r.settings.len(), "duplicate key in the table");
    }

    #[test]
    fn every_owner_is_a_capability() {
        let r = reference();
        for d in &r.settings {
            assert!(r.capabilities.iter().any(|c| c.id == d.owner), "{} owned by unknown {}", d.key, d.owner);
        }
    }

    #[test]
    fn every_default_has_its_declared_type() {
        for d in &reference().settings {
            assert_eq!(convert(d.ty, &d.default).as_ref(), Some(&d.default), "{}", d.key);
        }
    }

    #[test]
    fn dp2_threads_follow_the_cpu_count() {
        assert_eq!(defaults(None)["dp2_threads"], json!(4));
        assert_eq!(defaults(Some(1))["dp2_threads"], json!(2));
        assert_eq!(defaults(Some(32))["dp2_threads"], json!(8));
    }

    #[test]
    fn conversions_seen_in_real_files() {
        assert_eq!(convert(SettingType::Text, &json!(5432)), Some(json!("5432")));
        assert_eq!(convert(SettingType::Int, &json!("5432")), Some(json!(5432)));
        assert_eq!(convert(SettingType::Float, &json!("1.0")), Some(json!(1.0)));
        assert_eq!(convert(SettingType::Float, &json!(8)), Some(json!(8.0)));
        assert_eq!(convert(SettingType::Int, &json!(60.0)), Some(json!(60)));
        assert_eq!(convert(SettingType::Int, &json!("sixty")), None);
        assert_eq!(convert(SettingType::Int, &json!(1.5)), None);
        assert_eq!(convert(SettingType::Bool, &json!("yes")), None);
        assert_eq!(convert(SettingType::Float, &json!("NaN")), None);
    }
}
