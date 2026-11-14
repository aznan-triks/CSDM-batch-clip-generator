//! Demo-file stage of the preview: 3.5 `_preparse_dp2`, `_dp2_parse_demo`, the dp2 filters,
//! Mate POV and the ★ / optional / excluded gate. Owner: the T3 demo-file port.

use super::{Ctx, DemoEvents};
use crate::EngineError;
use csdm_core::Settings;

/// Parsed demo sections, kept across previews (keyed by path, size, modification time, section).
/// Shared by the engine's threads. A preview sees only the sections it asked for (T3 Conception).
#[derive(Debug, Default)]
pub struct DemoStore {}

/// What this stage keeps for the length of one preview (3.5 `_dp2_cache` view, positions, ...).
#[derive(Debug, Default)]
pub struct Cache {}

/// `_preparse_dp2(cfg, demo_paths)`.
pub fn preparse(_cx: &mut Ctx, _cfg: &Settings, _demo_paths: &[String]) -> Result<(), EngineError> {
    todo!("T3 demo-file stage")
}

/// `_apply_dp2_filters_to_events(evts, cfg)`.
pub fn apply_filters(_cx: &mut Ctx, _evts: DemoEvents, _cfg: &Settings) -> Result<DemoEvents, EngineError> {
    todo!("T3 demo-file stage")
}

/// `_apply_global_filter_gate_dict(evts, cfg)`.
pub fn apply_global_gate(_cx: &mut Ctx, _evts: DemoEvents, _cfg: &Settings) -> Result<DemoEvents, EngineError> {
    todo!("T3 demo-file stage")
}
