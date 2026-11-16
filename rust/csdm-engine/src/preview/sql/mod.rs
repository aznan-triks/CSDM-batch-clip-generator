//! SQL stage of the preview: 3.5 `_query_events` and everything it calls (team, headshot,
//! suicide, match-type, map, mod clauses; damages; shots; rounds; shared modifiers; date filter;
//! database post-filters; clutch). Owner: the T3 SQL port.
//!
//! Per-filter behaviour comes from the registry (`sql_cols`, category) and `preview()["filters"]`;
//! what neither says lives in one table indexed by key ([`behaviour::BEHAVIOURS`]).

mod behaviour;
pub(crate) mod clauses;
mod clutch;
mod modifiers;
mod nonkill;
mod postfilters;
mod query;

use super::{cfg, dates, Ctx, DemoEvents};
use crate::EngineError;
use csdm_core::Settings;
use csdm_db::{DbValue, Query, Row};
use serde_json::Value;
use std::collections::BTreeSet;

/// What this stage keeps for the length of one preview (3.5 host attributes it alone reads).
#[derive(Debug, Default)]
pub struct Cache {
    /// `_warned_missing_mods`: the last missing-modifier set warned about (warn once per set).
    warned_missing_mods: BTreeSet<String>,
}

/// `_query_events(cfg)`: every event the database query keeps, per demo, in 3.5 order.
/// `cfg` is a run cfg (`cfg::build_run_cfg`). Fills `cx.host` (checksums, dates, maps).
pub fn query_events(cx: &mut Ctx, cfg: &Settings) -> Result<DemoEvents, EngineError> {
    let sids = cfg::sids(cfg);
    if sids.is_empty() {
        return Ok(DemoEvents::new());
    }
    let (ts_from, ts_to) = dates::epoch_bounds(cfg);
    let mut results = DemoEvents::new();
    if !query::kills_and_rounds(cx, cfg, &sids, &mut results)? {
        return Ok(DemoEvents::new());
    }
    nonkill::damages(cx, cfg, &sids, &mut results)?;
    nonkill::shots(cx, cfg, &sids, &mut results)?;
    modifiers::apply_shared(cx, cfg, &results);

    // The database date column often holds the import date, not the match date (3.5).
    if ts_from.is_some() || ts_to.is_some() {
        let demos: Vec<String> = results.keys().cloned().collect();
        for dp in demos {
            let keep = match dates::demo_ts(cx, &dp) {
                None => false,
                Some(ts) => !(ts_from.is_some_and(|f| ts < f as f64) || ts_to.is_some_and(|t| ts > t as f64)),
            };
            if !keep {
                results.shift_remove(&dp);
            }
        }
    }

    let mut results = postfilters::apply(cx, cfg, results, &sids)?;

    if cfg::on(cfg, "clutch_enabled") && !results.is_empty() {
        match clutch::windows_for(cx, &results, &sids, cfg)? {
            Some(windows) => results = clutch::apply_windows(cx, &results, &sids, cfg, &windows)?,
            None => cx.log("  ⚠ Clutch: no clutch data (clutches table or kills) — clutch filter skipped.", crate::event::Level::Warn),
        }
    }
    Ok(results)
}

/// A database cell as the Python value psycopg2 hands back, stored on an event.
fn val(v: &DbValue) -> Value {
    match v {
        DbValue::Null => Value::Null,
        DbValue::Bool(b) => Value::Bool(*b),
        DbValue::Int(i) => Value::from(*i),
        DbValue::Float(f) => serde_json::Number::from_f64(*f).map_or(Value::Null, Value::Number),
        // shortcut: a Decimal never reaches an event in 3.5 (the reference could not encode one).
        DbValue::Numeric(d) => d.to_string().parse::<f64>().ok().and_then(serde_json::Number::from_f64).map_or(Value::Null, Value::Number),
        DbValue::Text(s) => Value::String(s.clone()),
        other => Value::String(other.py_str()),
    }
}

/// Python `int(cell)` on a database value; 3.5 raised (preview failed) where this errs.
fn int_db(v: &DbValue, what: &str) -> Result<i64, EngineError> {
    let n = match v {
        DbValue::Int(i) => Some(*i),
        DbValue::Bool(b) => Some(i64::from(*b)),
        DbValue::Float(f) if f.is_finite() => Some(f.trunc() as i64),
        DbValue::Numeric(d) => d.trunc().to_string().parse().ok(),
        DbValue::Text(s) => s.trim().replace('_', "").parse().ok(),
        _ => None,
    };
    n.ok_or_else(|| EngineError::User(format!("The database holds an unexpected {what} ({}): the preview cannot use it.", v.py_str())))
}

/// Python `int(value)` on a setting; 3.5 raised (preview failed) where this errs.
fn int_cfg(cfg: &Settings, key: &str, default: i64) -> Result<i64, EngineError> {
    let v = cfg.get(key).cloned().unwrap_or(Value::from(default));
    let n = match &v {
        Value::Bool(b) => Some(i64::from(*b)),
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f.trunc() as i64)),
        Value::String(s) => s.trim().replace('_', "").parse().ok(),
        _ => None,
    };
    n.ok_or_else(|| bad_setting(key, &v))
}

/// Python `float(value)` on a setting; 3.5 raised (preview failed) where this errs.
fn float_cfg(cfg: &Settings, key: &str, default: f64) -> Result<f64, EngineError> {
    let v = cfg.get(key).cloned().unwrap_or(Value::from(default));
    let n = match &v {
        Value::Bool(b) => Some(f64::from(u8::from(*b))),
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().replace('_', "").parse().ok(),
        _ => None,
    };
    n.ok_or_else(|| bad_setting(key, &v))
}

fn bad_setting(key: &str, v: &Value) -> EngineError {
    EngineError::User(format!("The setting '{key}' holds {} which is not a number: fix it, then preview again.", cfg::py_str(v)))
}

/// `cfg.get(key, default)` compared to text: a non-text value equals no text (`None`).
fn text_setting<'a>(cfg: &'a Settings, key: &str, default: &'a str) -> Option<&'a str> {
    match cfg.get(key) {
        None => Some(default),
        Some(v) => v.as_str(),
    }
}

/// 3.5 `_num`: `float(v)`, `None` when absent or not a number.
fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Bool(b) => Some(f64::from(u8::from(*b))),
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().replace('_', "").parse().ok(),
        _ => None,
    }
}

/// A setting value sent as a query parameter (psycopg2 adapts the Python value).
fn param(v: &Value) -> DbValue {
    match v {
        Value::Null => DbValue::Null,
        Value::Bool(b) => DbValue::Bool(*b),
        Value::Number(n) => n.as_i64().map_or_else(|| DbValue::Float(n.as_f64().unwrap_or_default()), DbValue::Int),
        Value::String(s) => DbValue::text(s.clone()),
        other => DbValue::text(other.to_string()),
    }
}

/// `{alias}."id"` tie-breaker after the tick when the table has an `id` (T3 Conception, row 23).
fn tie(cx: &Ctx, table: &str, alias: &str) -> String {
    if cx.disc.columns(table).iter().any(|c| c == "id") {
        format!(r#",{alias}."id""#)
    } else {
        String::new()
    }
}

/// Runs a statement written with 3.5's `%s` markers, numbered `$1…$n` in text order.
fn run(cx: &mut Ctx, sql: &str, params: Vec<DbValue>) -> Result<Vec<Row>, EngineError> {
    let mut out = String::with_capacity(sql.len());
    let mut n = 0;
    let mut rest = sql;
    while let Some(i) = rest.find("%s") {
        n += 1;
        out.push_str(&rest[..i]);
        out.push_str(&format!("${n}"));
        rest = &rest[i + 2..];
    }
    out.push_str(rest);
    assert_eq!(n, params.len(), "every %s marker has its parameter");
    Ok(cx.db.run(&Query::new(out, params))?)
}

/// `",".join(["%s"] * n)`.
fn marks(n: usize) -> String {
    vec!["%s"; n].join(",")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn python_numbers() {
        assert_eq!(num(Some(&json!(" 3 "))), Some(3.0));
        assert_eq!(num(Some(&json!(true))), Some(1.0));
        assert_eq!(num(Some(&json!("x"))), None);
        assert_eq!(num(None), None);
        let cfg: Settings = serde_json::from_value(json!({"a": "4", "b": 3.9, "c": "3.5", "d": [1]})).unwrap();
        assert_eq!(int_cfg(&cfg, "a", 0).unwrap(), 4);
        assert_eq!(int_cfg(&cfg, "b", 0).unwrap(), 3);
        assert!(int_cfg(&cfg, "c", 0).is_err(), "int('3.5') raises in Python");
        assert_eq!(int_cfg(&cfg, "absent", 7).unwrap(), 7);
        assert_eq!(float_cfg(&cfg, "c", 0.0).unwrap(), 3.5);
        assert!(float_cfg(&cfg, "d", 0.0).is_err());
        assert_eq!(int_db(&DbValue::Float(5.7), "tick").unwrap(), 5);
    }

    #[test]
    fn cells_keep_their_python_type() {
        assert_eq!(val(&DbValue::Int(3)), json!(3));
        assert_eq!(val(&DbValue::Float(3.0)), json!(3.0));
        assert_eq!(val(&DbValue::Null), Value::Null);
        assert_eq!(param(&json!("ak47")), DbValue::text("ak47"));
    }
}
