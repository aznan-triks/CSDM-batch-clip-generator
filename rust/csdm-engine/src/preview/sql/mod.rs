//! SQL stage of the preview: 3.5 `_query_events` and everything it calls (team, headshot,
//! suicide, match-type, map, mod clauses; damages; shots; rounds; shared modifiers; date filter;
//! database post-filters; clutch). Owner: the T3 SQL port.

use super::{Ctx, DemoEvents};
use crate::EngineError;
use csdm_core::Settings;

/// What this stage keeps for the length of one preview (3.5 host attributes it alone reads).
#[derive(Debug, Default)]
pub struct Cache {}

/// `_query_events(cfg)`: every event the database query keeps, per demo, in 3.5 order.
/// `cfg` is a run cfg (`cfg::build_run_cfg`). Fills `cx.host` (checksums, dates, maps).
pub fn query_events(_cx: &mut Ctx, _cfg: &Settings) -> Result<DemoEvents, EngineError> {
    todo!("T3 SQL stage")
}
