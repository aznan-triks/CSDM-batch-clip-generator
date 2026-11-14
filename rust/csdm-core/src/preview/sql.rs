//! Constants local to the SQL stage of the preview (3.5 `_query_events` and the methods it calls).

/// `_apply_db_postfilters` `_round_key` fallback when a kill has no round number: ~2-minute
/// rounds at 64 tick.
pub const ROUND_TICKS_FALLBACK: i64 = 7680;
/// ACE: distinct victims of the player in one round.
pub const ACE_VICTIMS: usize = 5;
/// `cfg.get(key, default)` defaults and `max(lowest, …)` floors of the database post-filters.
pub const MULTI_KILL_N_DEFAULT: i64 = 3;
pub const MULTI_KILL_N_MIN: i64 = 2;
pub const MULTI_KILL_S_DEFAULT: i64 = 12;
pub const MULTI_KILL_S_MIN: i64 = 1;
pub const BULLY_N_DEFAULT: i64 = 3;
pub const BULLY_N_MIN: i64 = 2;
/// `cfg.get("tickrate", 64)` where the post-filters and the clutch read it.
pub const TICKRATE_DEFAULT: i64 = 64;
/// Weapon names some databases prefix (`_norm_wpn`).
pub const WEAPON_PREFIX: &str = "weapon_";

/// `_detect_clutch_windows_from_kills` fallback round length when a kill has no round number.
pub const CLUTCH_ROUND_S: i64 = 115;
/// Clutch sizes `clutch_1v1` … `clutch_1v5`.
pub const CLUTCH_MAX_OPPONENTS: i64 = 5;
/// `cfg.get("before", 3)` / `cfg.get("after", 5)` in full-clutch mode.
pub const CLUTCH_BEFORE_S_DEFAULT: f64 = 3.0;
pub const CLUTCH_AFTER_S_DEFAULT: f64 = 5.0;

/// `_qe_detect_date_col`: SQL types that carry a match date, then name hints.
pub const DATE_COL_TYPES: [&str; 5] = ["date", "timestamp", "timestamp with time zone", "timestamp without time zone", "timestamptz"];
pub const DATE_COL_HINTS: [&str; 7] = ["played_at", "match_date", "game_date", "start_date", "started_at", "date", "match_timestamp"];
