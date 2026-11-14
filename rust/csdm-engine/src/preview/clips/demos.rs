//! The demo picker's list (3.5 `list_all_demos`, `_describe_demo`, `_check_demo_compat`,
//! `_demo_picker_fmt_name` / `_date` / `_map`).

use crate::preview::dates::{demo_sort_key, demo_ts, local, seconds, strptime_prefix};
use crate::preview::Ctx;
use crate::EngineError;
use chrono::{Local, NaiveDate};
use csdm_core::preview::clips::{DEMO_BREAK_CUTOFF_FORMAT, MATCH_KEY_COLS, PICKER_DATE_FORMAT, PICKER_NAME_ELLIPSIS, PICKER_NAME_MAX_CHARS, PICKER_NAME_TAIL_CHARS, PICKER_UNKNOWN_DATE};
use csdm_core::preview::{preview, DATE_SORT_FORMATS};
use csdm_db::reads::{all_demos, basename};
use csdm_db::DbValue;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

/// `_check_demo_compat`: (status, break, tip) from the demo's own date against the CS2 updates
/// that broke older demos (most recent first).
fn demo_compat(cx: &mut Ctx, demo_path: &str) -> (&'static str, Value, Value) {
    let Some(ts) = demo_ts(cx, demo_path) else {
        let status = if Path::new(demo_path).is_file() { "ok" } else { "missing" };
        return (status, Value::Null, Value::Null);
    };
    let Some(when) = local(ts as i64).map(|d| d.naive_local()) else {
        return ("ok", Value::Null, Value::Null);
    };
    for brk in preview()["cs2_demo_breaks"].as_array().expect("cs2_demo_breaks") {
        let cutoff = NaiveDate::parse_from_str(brk["cutoff"].as_str().expect("a cutoff"), DEMO_BREAK_CUTOFF_FORMAT).expect("a cutoff date");
        if when < cutoff.and_hms_opt(0, 0, 0).expect("midnight") {
            return ("warn", brk["label"].clone(), brk["tip"].clone());
        }
    }
    ("ok", Value::Null, Value::Null)
}

/// `_demo_picker_fmt_name`: long file names keep their end after an ellipsis.
fn picker_name(demo_path: &str) -> String {
    let name = basename(demo_path);
    let n = name.chars().count();
    if n > PICKER_NAME_MAX_CHARS {
        return format!("{PICKER_NAME_ELLIPSIS}{}", name.chars().skip(n - PICKER_NAME_TAIL_CHARS).collect::<String>());
    }
    name.to_string()
}

/// `_demo_picker_fmt_date`: "dd-mm-yyyy hh:mm" from the demo date, else from the database date.
fn picker_date(cx: &mut Ctx, demo_path: &str) -> String {
    if let Some(d) = demo_ts(cx, demo_path).and_then(|ts| local(ts as i64)) {
        return d.format(PICKER_DATE_FORMAT).to_string();
    }
    let Some(raw) = cx.host.demo_dates.get(demo_path) else {
        return PICKER_UNKNOWN_DATE.into();
    };
    let shown = match raw {
        DbValue::Timestamp(t) => Some(t.format(PICKER_DATE_FORMAT).to_string()),
        // psycopg2 hands an aware datetime in the session time zone: local here (as `dates.rs`).
        DbValue::TimestampTz(t) => Some(t.with_timezone(&Local).format(PICKER_DATE_FORMAT).to_string()),
        DbValue::Date(d) => d.and_hms_opt(0, 0, 0).map(|d| d.format(PICKER_DATE_FORMAT).to_string()),
        DbValue::Int(t) => local(seconds(*t)).map(|d| d.format(PICKER_DATE_FORMAT).to_string()),
        DbValue::Float(f) => local(seconds(f.trunc() as i64)).map(|d| d.format(PICKER_DATE_FORMAT).to_string()),
        other => {
            let s = other.py_str();
            DATE_SORT_FORMATS.iter().find_map(|fmt| strptime_prefix(s.trim(), fmt)).map(|d| d.format(PICKER_DATE_FORMAT).to_string())
        }
    };
    shown.unwrap_or_else(|| PICKER_UNKNOWN_DATE.into())
}

/// `_demo_picker_fmt_map`: the map name without its `de_` / `cs_` / `ar_` prefix.
fn picker_map(cx: &Ctx, demo_path: &str) -> String {
    let m = cx.host.demo_maps.get(demo_path).map_or("", String::as_str);
    for pfx in preview()["map_name_prefixes"].as_array().expect("map_name_prefixes").iter().filter_map(Value::as_str) {
        if m.get(..pfx.len()).is_some_and(|head| head.eq_ignore_ascii_case(pfx)) {
            return m[pfx.len()..].to_string();
        }
    }
    m.to_string()
}

/// `_describe_demo`: one picker row.
fn describe_demo(cx: &mut Ctx, demo_path: &str) -> Value {
    let (status, brk, tip) = demo_compat(cx, demo_path);
    json!({
        "path": demo_path,
        "name": picker_name(demo_path),
        "date": picker_date(cx, demo_path),
        "map": picker_map(cx, demo_path),
        "compat": {"status": status, "break": brk, "tip": tip},
    })
}

/// `list_all_demos`: every demo a match row points to, oldest known date first, as picker rows.
/// Fills the host caches (checksum, date, map) the way 3.5 does, first value kept.
pub fn list_all_demos(cx: &mut Ctx) -> Result<Vec<Value>, EngineError> {
    if cx.disc.schema.is_empty() {
        return Err(EngineError::User("Connect to the database before loading the demo list.".into()));
    }
    let Some(query) = all_demos(cx.disc) else {
        return Ok(Vec::new());
    };
    let rows = cx.db.run(&query)?;
    let has_key = cx.disc.find_col("matches", &MATCH_KEY_COLS).is_some();
    let has_date = cx.disc.date_col.is_some();
    let has_map = cx.disc.map_col.is_some();
    let mut paths: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for row in rows {
        let Some(dp) = row.first().filter(|v| v.is_truthy()).map(DbValue::py_str) else { continue };
        if !seen.insert(dp.clone()) {
            continue;
        }
        let mut idx = 1;
        let cellat = |i: usize| row.get(i).filter(|v| v.is_truthy());
        if has_key {
            if let Some(chk) = cellat(idx) {
                cx.host.demo_checksums.entry(dp.clone()).or_insert_with(|| chk.clone());
            }
            idx += 1;
        }
        if has_date {
            if let Some(date) = cellat(idx) {
                cx.host.demo_dates.entry(dp.clone()).or_insert_with(|| date.clone());
            }
            idx += 1;
        }
        if has_map {
            if let Some(map) = cellat(idx) {
                cx.host.demo_maps.entry(dp.clone()).or_insert_with(|| map.py_str().trim().to_string());
            }
        }
        paths.push(dp);
    }
    let mut keyed: Vec<((u8, f64), String)> = paths.into_iter().map(|dp| (demo_sort_key(cx, &dp), dp)).collect();
    keyed.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("demo sort keys are numbers"));
    Ok(keyed.into_iter().map(|(_, dp)| describe_demo(cx, &dp)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_names_keep_their_end() {
        let long = format!("C:\\demos\\{}.dem", "a".repeat(50));
        let shown = picker_name(&long);
        assert_eq!(shown.chars().count(), 44);
        assert!(shown.starts_with('…') && shown.ends_with("aaa.dem"));
        assert_eq!(picker_name("D:/x/short.dem"), "short.dem");
    }
}
