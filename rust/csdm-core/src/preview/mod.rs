//! Fixed tables and constants of the preview chain (T3).
//!
//! `data/preview.json` is exported from 3.5 by `tools/export_preview_reference.py` (never edited by
//! hand; parity test `tests/parity.rs`). Values local to a 3.5 method live as named constants in the
//! submodule of the engine part that uses them.

pub mod clips;
pub mod dp2;
pub mod sql;

use serde_json::Value;
use std::sync::OnceLock;

/// Where a demo the bundled parser cannot read sends the user (`DemoError::user_message`); 3.5
/// asked for `pip install -U demoparser2` instead, which an end user of 5.x cannot do.
pub const RELEASES_URL: &str = "https://github.com/aznan-triks/CSDM-batch-clip-generator/releases";

/// Demo dates (3.5 `_read_demo_date_from_info`, `_format_demo_date`, `_demo_sort_key`).
/// `.info` protobuf field holding the match time, and the smallest value taken as one (2001).
pub const INFO_MATCHTIME_FIELD: u64 = 2;
pub const INFO_MIN_MATCHTIME: u64 = 1_000_000_000;
/// A database date number above this is milliseconds.
pub const MS_TIMESTAMP_ABOVE: i64 = 4_000_000_000;
pub const MS_PER_S: i64 = 1000;
pub const UNKNOWN_DATE: &str = "??-??-????";
/// Formats tried on a database date given as text (each on the text cut to the format's length).
pub const DATE_FALLBACK_FORMATS: [&str; 5] = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"];
pub const DATE_SORT_FORMATS: [&str; 3] = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"];
/// The two ways a host sends `date_from` / `date_to` (Electron field, Tkinter window).
pub const DISPLAY_DATE_FORMATS: [&str; 2] = ["%d-%m-%Y", "%Y-%m-%d"];
/// `date_to` includes its whole day.
pub const DAY_LAST_SECOND: (u32, u32, u32) = (23, 59, 59);

/// The whole table, as exported (`preview()["mate_pov"]["eye_height"]`).
pub fn preview() -> &'static Value {
    static TABLE: OnceLock<Value> = OnceLock::new();
    TABLE.get_or_init(|| {
        // The file is compiled in: a bad export fails the first test that reads it.
        serde_json::from_str(include_str!("../../data/preview.json")).expect("data/preview.json is valid JSON")
    })
}
