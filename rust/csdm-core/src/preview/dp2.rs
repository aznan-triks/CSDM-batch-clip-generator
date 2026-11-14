//! Constants local to the demo-file stage of the preview (3.5 `_dp2_parse_demo`, dp2 filters, Mate POV).
//! The tables 3.5 exported (`dp2_tick_window`, `spray_*`, `trois_shot_thresholds`, `mate_pov`,
//! `high_velocity`, `flick`, `savior`, `tick_match_window`) are read from `preview()`.

/// The kill filter that runs alone when it is on (3.5 `_apply_dp2_filters_to_events`, TROIS TAP).
pub const EXCLUSIVE_FILTER: &str = "kill_mod_trois_tap";
/// `_preparse_dp2`: `min(8, dp2_threads)` parse threads.
pub const DP2_MAX_THREADS: i64 = 8;
/// `_preparse_dp2`: one progress state every this many parsed demos, and on the last one.
pub const PREPARSE_PROGRESS_EVERY: usize = 5;
/// `progress_bar` (3.5 `core_utils`): number of blocks and their glyphs.
pub const PROGRESS_BAR_WIDTH: usize = 12;
pub const PROGRESS_BAR_FULL: &str = "▰";
pub const PROGRESS_BAR_EMPTY: &str = "▱";
/// demoparser weapon names start with this; CSDM weapon names do not.
pub const DP2_WEAPON_PREFIX: &str = "weapon_";
/// `_high_velocity_filter`: `max(1.0, kill_mod_high_vel_thr)`.
pub const HIGH_VEL_THR_MIN: f64 = 1.0;
/// `_flick_filter`: `max(1.0, kill_mod_flick_deg)`.
pub const FLICK_DEG_MIN: f64 = 1.0;
/// `_one_tap_filter`: `max(0.5, kill_mod_one_tap_s)` seconds.
pub const ONE_TAP_S_MIN: f64 = 0.5;
/// `_trois_shot_filter`: a scoped auto-sniper shot faster than this (u/s) is lucky.
pub const TROIS_SHOT_MOVING_VEL: f64 = 100.0;
/// Mate POV: dp2 keys shown in the "victim not found" line.
pub const MATE_POV_KEYS_SHOWN: usize = 8;
