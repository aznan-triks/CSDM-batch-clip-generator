//! Reading the run settings the way 3.5 does (`_cfg_num`, `_cfg_bool`, Python truthiness and
//! `str()`), and `build_run_cfg` (the derived event flags every stage reads).

use super::ctx::Ports;
use crate::event::Level;
use csdm_core::migrate::truthy;
use csdm_core::preview::preview;
use csdm_core::settings::def;
use csdm_core::Settings;
use serde_json::{json, Value};

/// Python `str(value)` of a JSON value (`None`, `True`, `3`, `3.5`, text as is).
pub fn py_str(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::String(s) => s.clone(),
        Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => i.to_string(),
            (None, Some(f)) if f.fract() == 0.0 && f.is_finite() && f.abs() < 1e16 => format!("{f:.1}"), // allow-hardcode: Python switches to exponent form at 1e16
            _ => n.to_string(),
        },
        other => other.to_string(),
    }
}

/// `bool(cfg.get(key))`.
pub fn on(cfg: &Settings, key: &str) -> bool {
    cfg.get(key).is_some_and(truthy)
}

/// `cfg.get(key, default)` as a reference to a value (default when absent).
pub fn get<'a>(cfg: &'a Settings, key: &str, default: &'a Value) -> &'a Value {
    cfg.get(key).unwrap_or(default)
}

/// `float(str(raw).strip())`; `None` where Python raises.
pub(crate) fn py_float(raw: &Value) -> Option<f64> {
    let text = match raw {
        Value::Number(_) | Value::String(_) => py_str(raw),
        _ => return None,
    };
    // Rust and Python both read "inf", "infinity", "nan" in any case; Python also allows "1_000".
    text.trim().replace('_', "").parse::<f64>().ok()
}

/// `_cfg_int`: `int(float(str(raw).strip()))`, else a warning and the default; then clamped.
pub fn cfg_int(ports: &dyn Ports, cfg: &Settings, key: &str, default: i64, lo: Option<i64>, hi: Option<i64>) -> i64 {
    let raw = cfg.get(key).cloned().unwrap_or(json!(default));
    let mut val = match py_float(&raw).filter(|f| f.is_finite()) {
        Some(f) => f.trunc() as i64,
        None => {
            ports.log(&format!("  ⚠ cfg '{key}' invalid ({}) — fallback {default}", py_str(&raw)), Level::Warn);
            default
        }
    };
    if let Some(lo) = lo {
        val = val.max(lo);
    }
    if let Some(hi) = hi {
        val = val.min(hi);
    }
    val
}

/// `_cfg_float`: `float(str(raw).strip())`, else a warning and the default; then clamped.
pub fn cfg_float(ports: &dyn Ports, cfg: &Settings, key: &str, default: f64, lo: Option<f64>, hi: Option<f64>) -> f64 {
    let raw = cfg.get(key).cloned().unwrap_or(json!(default));
    let mut val = match py_float(&raw) {
        Some(f) => f,
        None => {
            ports.log(&format!("  ⚠ cfg '{key}' invalid ({}) — fallback {default}", py_str(&raw)), Level::Warn);
            default
        }
    };
    // Python max/min keep the first argument when the other is NaN: max(lo, nan) == lo.
    if let Some(lo) = lo {
        val = if val > lo { val } else { lo };
    }
    if let Some(hi) = hi {
        val = if val < hi { val } else { hi };
    }
    val
}

/// `_cfg_bool`.
pub fn cfg_bool(ports: &dyn Ports, cfg: &Settings, key: &str, default: bool) -> bool {
    let raw = cfg.get(key).cloned().unwrap_or(Value::Bool(default));
    match &raw {
        Value::Bool(b) => return *b,
        Value::Number(n) => return n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => match s.trim().to_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => return true,
            "0" | "false" | "no" | "off" => return false,
            _ => {}
        },
        _ => {}
    }
    ports.log(&format!("  ⚠ cfg '{key}' invalid ({}) — fallback {}", py_str(&raw), if default { "True" } else { "False" }), Level::Warn);
    default
}

/// `_get_sids`: `steam_ids`, else `[steam_id]`, as text.
pub fn sids(cfg: &Settings) -> Vec<String> {
    match cfg.get("steam_ids") {
        Some(Value::Array(a)) if !a.is_empty() => a.iter().map(py_str).collect(),
        _ => match cfg.get("steam_id") {
            Some(v) if truthy(v) => vec![py_str(v)],
            _ => vec![],
        },
    }
}

/// `_split_required_optional`: (★ Must keys, optional keys), each in the given order.
pub fn split_required_optional<'k>(cfg: &Settings, keys: &[&'k str]) -> (Vec<&'k str>, Vec<&'k str>) {
    keys.iter().copied().partition(|k| on(cfg, &format!("{k}_req")))
}

/// Python `a and b` / `a or b` on values (3.5 stores the operand, not a bool).
fn py_and(a: Value, b: Value) -> Value {
    if truthy(&a) { b } else { a }
}
fn py_or(a: Value, b: Value) -> Value {
    if truthy(&a) { a } else { b }
}

/// `derive_event_flags_v2`.
pub fn derive_event_flags(cfg: &Settings) -> Settings {
    let g = |k: &str, d: Value| cfg.get(k).cloned().unwrap_or(d);
    let actor = g("event_actor", Value::Bool(true));
    let target = g("event_target", Value::Bool(false));
    let lethal = g("event_lethal", Value::Bool(true));
    let rounds = matches!(cfg.get("events"), Some(Value::Array(a)) if a.iter().any(|v| v == "Rounds"));
    let mut out = Settings::new();
    out.insert("_events_lethal".into(), py_and(lethal.clone(), py_or(actor.clone(), target.clone())));
    out.insert("_events_non_lethal".into(), g("event_non_lethal", Value::Bool(false)));
    out.insert("_events_other".into(), g("event_other", Value::Bool(false)));
    out.insert("_events_actor".into(), actor.clone());
    out.insert("_events_target".into(), target.clone());
    out.insert("_events_ally".into(), g("event_ally", Value::Bool(false)));
    out.insert("_events_enemy".into(), g("event_enemy", Value::Bool(true)));
    out.insert("_events_rounds".into(), Value::Bool(rounds));
    out.insert("events_kills".into(), py_and(actor, lethal.clone()));
    out.insert("events_deaths".into(), py_and(target, lethal));
    out
}

/// `build_run_cfg`: a copy of `cfg`, the any/all keys fixed to their default, the derived flags.
pub fn build_run_cfg(cfg: &Settings) -> Settings {
    let mut out = cfg.clone();
    for k in preview()["fixed_filter_logic_keys"].as_array().expect("fixed_filter_logic_keys is a list") {
        let k = k.as_str().expect("fixed_filter_logic_keys holds names");
        out.insert(k.into(), def(k).expect("fixed filter-logic key is a setting").default.clone());
    }
    out.extend(derive_event_flags(cfg));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::ctx::NoPorts;

    #[test]
    fn numbers_read_like_python() {
        let cfg: Settings = serde_json::from_value(json!({"a": " 3.9 ", "b": "x", "c": true, "d": 7, "e": "1e3"})).unwrap();
        assert_eq!(cfg_int(&NoPorts, &cfg, "a", 5, None, None), 3);
        assert_eq!(cfg_int(&NoPorts, &cfg, "b", 5, None, None), 5);
        assert_eq!(cfg_int(&NoPorts, &cfg, "c", 5, None, None), 5);
        assert_eq!(cfg_int(&NoPorts, &cfg, "d", 5, Some(8), None), 8);
        assert_eq!(cfg_int(&NoPorts, &cfg, "e", 5, None, None), 1000);
        assert_eq!(cfg_int(&NoPorts, &cfg, "absent", 5, None, None), 5);
        assert!(!cfg_bool(&NoPorts, &cfg, "b", false));
        assert!(cfg_bool(&NoPorts, &cfg, "c", false));
    }

    #[test]
    fn python_str() {
        assert_eq!(py_str(&json!(3.0)), "3.0");
        assert_eq!(py_str(&json!(null)), "None");
        assert_eq!(py_str(&json!(76561198000000000_i64)), "76561198000000000");
    }

    #[test]
    fn flags_keep_the_python_operands() {
        let cfg: Settings = serde_json::from_value(json!({"event_actor": true, "event_lethal": 1, "events": ["Rounds"]})).unwrap();
        let f = derive_event_flags(&cfg);
        assert_eq!(f["_events_lethal"], json!(true));
        assert_eq!(f["events_kills"], json!(1));
        assert_eq!(f["_events_rounds"], json!(true));
    }
}
