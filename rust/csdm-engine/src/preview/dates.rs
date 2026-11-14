//! Demo dates (3.5 `_read_demo_date_from_info`, `_ts_from_demo_path`, `_get_demo_ts`,
//! `_format_demo_date`, `_demo_sort_key`, `_qe_epoch_bounds`). Dates are local time, as 3.5
//! `datetime.fromtimestamp` / `strptime(...).timestamp()`.

use super::Ctx;
use crate::event::Level;
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
use csdm_core::preview::{DATE_FALLBACK_FORMATS, DATE_SORT_FORMATS, DAY_LAST_SECOND, DISPLAY_DATE_FORMATS, INFO_MATCHTIME_FIELD, INFO_MIN_MATCHTIME, MS_PER_S, MS_TIMESTAMP_ABOVE, UNKNOWN_DATE};
use csdm_core::Settings;
use csdm_db::DbValue;
use serde_json::Value;
use std::path::Path;

/// Protobuf wire types `_read_demo_date_from_info` walks (format invariants).
const WIRE_VARINT: u64 = 0;
const WIRE_FIXED64: u64 = 1;
const WIRE_LEN: u64 = 2;
const WIRE_FIXED32: u64 = 5;
const FIXED64_LEN: usize = 8;
const FIXED32_LEN: usize = 4;
const VARINT_MORE: u8 = 0x80;
const VARINT_BITS: u8 = 0x7F;
const VARINT_SHIFT: u32 = 7;
const TAG_FIELD_SHIFT: u32 = 3;
const TAG_WIRE_MASK: u64 = 0x07;
/// The date the clip list and the export show.
const SHOWN_DATE: &str = "%d %m %Y";

fn varint(data: &[u8], i: &mut usize) -> u64 {
    let (mut val, mut shift) = (0u64, 0u32);
    while *i < data.len() {
        let b = data[*i];
        *i += 1;
        if shift < u64::BITS {
            val |= u64::from(b & VARINT_BITS) << shift;
        }
        shift += VARINT_SHIFT;
        if b & VARINT_MORE == 0 {
            break;
        }
    }
    val
}

/// The match time a CS2 `.info` file holds (minimal protobuf walk, no dependency).
fn matchtime_in(data: &[u8]) -> Option<i64> {
    let mut i = 0;
    while i < data.len() {
        let tag = varint(data, &mut i);
        let (field, wire) = (tag >> TAG_FIELD_SHIFT, tag & TAG_WIRE_MASK);
        match wire {
            WIRE_VARINT => {
                let val = varint(data, &mut i);
                if field == INFO_MATCHTIME_FIELD && val > INFO_MIN_MATCHTIME {
                    return i64::try_from(val).ok();
                }
            }
            WIRE_LEN => {
                let len = varint(data, &mut i);
                i = i.saturating_add(usize::try_from(len).unwrap_or(usize::MAX));
            }
            WIRE_FIXED64 => i += FIXED64_LEN,
            WIRE_FIXED32 => i += FIXED32_LEN,
            _ => break,
        }
    }
    None
}

/// `_read_demo_date_from_info`: `<demo>.info`, else `<demo>.dem.info`. 3.5 swallowed a read error;
/// here it is logged and the caller falls back to the file date, as 3.5 did.
fn info_matchtime(ports: &dyn super::Ports, demo_path: &str) -> Option<i64> {
    let beside = Path::new(demo_path).with_extension("info");
    let appended = format!("{demo_path}.info");
    let info = [beside.as_path(), Path::new(&appended)].into_iter().find(|p| p.exists())?;
    match std::fs::read(info) {
        Ok(data) => matchtime_in(&data),
        Err(e) => {
            ports.log(&format!("  ⚠ Could not read {}: {e} — the demo's file date is used instead.", info.display()), Level::Warn);
            None
        }
    }
}

/// `_ts_from_demo_path`: the file's modification time, whole seconds.
fn file_ts(demo_path: &str) -> Option<i64> {
    let meta = std::fs::metadata(demo_path).ok().filter(|m| m.is_file())?;
    let since = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(since.as_secs()).ok()
}

/// `_get_demo_ts`: `.info` match time, else the file date; cached for the preview.
pub fn demo_ts(cx: &mut Ctx, demo_path: &str) -> Option<f64> {
    if let Some(ts) = cx.host.ts.get(demo_path) {
        return *ts;
    }
    let ts = info_matchtime(cx.ports, demo_path).or_else(|| file_ts(demo_path)).map(|t| t as f64);
    cx.host.ts.insert(demo_path.to_string(), ts);
    ts
}

fn local(ts: i64) -> Option<DateTime<Local>> {
    Local.timestamp_opt(ts, 0).earliest()
}

/// Seconds from a number that may be milliseconds (3.5 rule).
fn seconds(t: i64) -> i64 {
    if t > MS_TIMESTAMP_ABOVE { t.div_euclid(MS_PER_S) } else { t }
}

/// Python `datetime.strptime(s[:len(fmt)], fmt)` for the formats 3.5 tries.
fn strptime_prefix(s: &str, fmt: &str) -> Option<NaiveDateTime> {
    let head: String = s.chars().take(fmt.chars().count()).collect();
    NaiveDateTime::parse_from_str(&head, fmt)
        .ok()
        .or_else(|| NaiveDate::parse_from_str(&head, fmt).ok().and_then(|d| d.and_hms_opt(0, 0, 0)))
}

/// `_format_demo_date`: "dd mm yyyy" from the demo date, else from the database date.
pub fn format_demo_date(cx: &mut Ctx, demo_path: &str) -> String {
    if let Some(d) = demo_ts(cx, demo_path).and_then(|ts| local(ts as i64)) {
        return d.format(SHOWN_DATE).to_string();
    }
    let Some(raw) = cx.host.demo_dates.get(demo_path) else {
        return UNKNOWN_DATE.into();
    };
    let shown = match raw {
        DbValue::Timestamp(t) => Some(t.format(SHOWN_DATE).to_string()),
        // psycopg2 hands an aware datetime in the session time zone: local here.
        DbValue::TimestampTz(t) => Some(t.with_timezone(&Local).format(SHOWN_DATE).to_string()),
        DbValue::Date(d) => Some(d.format(SHOWN_DATE).to_string()),
        DbValue::Int(t) => local(seconds(*t)).map(|d| d.format(SHOWN_DATE).to_string()),
        DbValue::Float(f) => local(seconds(f.trunc() as i64)).map(|d| d.format(SHOWN_DATE).to_string()),
        other => {
            let s = other.py_str();
            let s = s.trim();
            DATE_FALLBACK_FORMATS.iter().find_map(|fmt| strptime_prefix(s, fmt)).map(|d| d.format(SHOWN_DATE).to_string())
        }
    };
    shown.unwrap_or_else(|| UNKNOWN_DATE.into())
}

/// `_demo_sort_key`: `(0, timestamp)` when the date is known, else `(1, 0)`; a database date it
/// parses is stored back as seconds (3.5 normalises in place).
pub fn demo_sort_key(cx: &mut Ctx, demo_path: &str) -> (u8, f64) {
    if let Some(ts) = demo_ts(cx, demo_path) {
        return (0, ts);
    }
    let Some(raw) = cx.host.demo_dates.get(demo_path).cloned() else {
        return (1, 0.0);
    };
    let parsed = match &raw {
        DbValue::Int(t) => return (0, seconds(*t) as f64),
        DbValue::Float(f) => return (0, seconds(f.trunc() as i64) as f64),
        DbValue::Timestamp(t) => Local.from_local_datetime(t).earliest().map(|d| d.timestamp()),
        DbValue::TimestampTz(t) => Some(t.timestamp()),
        // A date has no `.timestamp()` in Python: its text goes through the formats below.
        other => {
            let s = other.py_str();
            let s = s.trim();
            DATE_SORT_FORMATS
                .iter()
                .find_map(|fmt| strptime_prefix(s, fmt))
                .and_then(|d| Local.from_local_datetime(&d).earliest())
                .map(|d| d.timestamp())
        }
    };
    match parsed {
        Some(t) => {
            cx.host.demo_dates.insert(demo_path.to_string(), DbValue::Int(t));
            (0, t as f64)
        }
        None => (1, 0.0),
    }
}

/// `display_to_iso`: "dd-mm-yyyy" or "yyyy-mm-dd" → the date; anything else → none.
fn display_date(v: Option<&Value>) -> Option<NaiveDate> {
    let s = v?.as_str()?.trim();
    DISPLAY_DATE_FORMATS.iter().find_map(|fmt| NaiveDate::parse_from_str(s, fmt).ok())
}

/// `_qe_epoch_bounds`: local-time seconds of `date_from` 00:00:00 and `date_to` 23:59:59.
pub fn epoch_bounds(cfg: &Settings) -> (Option<i64>, Option<i64>) {
    let at = |d: NaiveDate, (h, m, s): (u32, u32, u32)| {
        d.and_hms_opt(h, m, s).and_then(|t| Local.from_local_datetime(&t).earliest()).map(|t| t.timestamp())
    };
    (
        display_date(cfg.get("date_from")).and_then(|d| at(d, (0, 0, 0))),
        display_date(cfg.get("date_to")).and_then(|d| at(d, DAY_LAST_SECOND)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_matchtime_is_field_two() {
        // field 1 varint 7, field 3 length-delimited "ab", field 2 varint 1_700_000_000
        let mut data = vec![0x08, 0x07, 0x1a, 0x02, b'a', b'b', 0x10];
        let mut v: u64 = 1_700_000_000;
        while v >= 0x80 {
            data.push((v as u8 & 0x7F) | 0x80);
            v >>= 7;
        }
        data.push(v as u8);
        assert_eq!(matchtime_in(&data), Some(1_700_000_000));
        assert_eq!(matchtime_in(&[0x10, 0x05]), None, "small values are not match times");
    }

    #[test]
    fn text_dates_are_cut_to_the_format_length_like_3_5() {
        // 3.5 slices the text to len(fmt): a full timestamp never parses.
        assert!(strptime_prefix("2024-01-02 10:11:12", "%Y-%m-%d %H:%M:%S").is_none());
        assert!(strptime_prefix("1/2/2024", "%d/%m/%Y").is_some());
    }

    #[test]
    fn display_dates() {
        assert_eq!(display_date(Some(&Value::from("02-01-2024"))), NaiveDate::from_ymd_opt(2024, 1, 2));
        assert_eq!(display_date(Some(&Value::from("2024-01-02"))), NaiveDate::from_ymd_opt(2024, 1, 2));
        assert_eq!(display_date(Some(&Value::from("x"))), None);
    }
}
