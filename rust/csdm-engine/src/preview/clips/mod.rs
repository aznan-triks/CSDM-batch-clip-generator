//! Clips stage of the preview: 3.5 `_build_sequences`, cameras, summary, empty-result funnel,
//! export rows, EDITING cameras, run-input problems, demo list and dates. Owner: the T3 clips port.

use super::{Ctx, DemoEvents};
use crate::EngineError;
use csdm_core::Settings;
use serde_json::Value;

/// What this stage keeps for the length of one preview.
#[derive(Debug, Default)]
pub struct Cache {}

/// One clip sequence (3.5 sequence dict). Filled by the clips port.
#[derive(Debug, Clone, Default)]
pub struct Sequence {}

/// Demo path → its sequences, demos with no event left out (3.5 `_preview_sequences` result).
pub type Sequences = indexmap::IndexMap<String, Vec<Sequence>>;

/// `_preview_sequences(evts, cfg)`.
pub fn preview_sequences(_cx: &mut Ctx, _evts: &DemoEvents, _cfg: &Settings) -> Result<Sequences, EngineError> {
    todo!("T3 clips stage")
}

/// `explain_empty_result(cfg, counts)`: `cfg` is the run cfg, `counts` the caller's funnel.
pub fn explain_empty_result(_cx: &mut Ctx, _cfg: &Settings, _counts: &[(String, usize)]) -> Result<Value, EngineError> {
    todo!("T3 clips stage")
}

/// The `preview_ready` payload's `events`, `sequences`: each demo's events as JSON, each
/// sequence with its events as positions in its demo's list, or `{"copy": event}` when absent.
pub fn payload(_cx: &Ctx, _evts: &DemoEvents, _seqs: &Sequences) -> Value {
    todo!("T3 clips stage")
}
