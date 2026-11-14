//! Demo dates: 3.5 `_read_demo_date_from_info`, `_ts_from_demo_path`, `_get_demo_ts`,
//! `_format_demo_date`, `_demo_sort_key`. Owner: the T3 clips port (read by the SQL date filter).

use crate::preview::Ctx;

/// `_get_demo_ts(path)`: `.info` match time, else the file's modification time (seconds); `None`
/// when neither is known. Cached in `cx.host.ts`.
pub fn demo_ts(_cx: &mut Ctx, _path: &str) -> Option<f64> {
    todo!("T3 clips stage")
}
