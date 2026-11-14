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

/// The whole table, as exported (`preview()["mate_pov"]["eye_height"]`).
pub fn preview() -> &'static Value {
    static TABLE: OnceLock<Value> = OnceLock::new();
    TABLE.get_or_init(|| {
        // The file is compiled in: a bad export fails the first test that reads it.
        serde_json::from_str(include_str!("../../data/preview.json")).expect("data/preview.json is valid JSON")
    })
}
