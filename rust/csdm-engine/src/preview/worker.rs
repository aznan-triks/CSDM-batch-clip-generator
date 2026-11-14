//! 3.5 `_preview_worker`: the stages in order, the funnel an empty preview explains, the summary,
//! and the `preview_ready` payload. Cancellation is checked between stages, as 3.5: a cancelled
//! preview shows nothing at all.

use super::clips::{self, LastPreview};
use super::{dp2, event, sql, Ctx};
use crate::event::{Level, StateName};
use crate::EngineError;
use csdm_core::Settings;
use serde_json::{json, Map, Value};
use std::time::Instant;

/// Funnel labels (3.5 text, shown by the empty-result explanation).
const FUNNEL_QUERY: &str = "database query";
const FUNNEL_DP2: &str = "Kill Filters checked in the demo files";
const FUNNEL_GATE: &str = "★ Must / optional filter rules";

/// A finished preview: the payload sent as `preview_ready`, and what later commands read.
pub struct Outcome {
    pub payload: Value,
    pub last: LastPreview,
}

/// Runs one preview on `cx` (fresh per preview). `None` when cancelled or failed: the failure is
/// already in the console, its detail in the journal (`Ports::trace`).
pub fn run_preview(cx: &mut Ctx, cfg: &Settings) -> Option<Outcome> {
    cx.ports.state(StateName::PreviewStarted, Value::Null);
    cx.ports.state(StateName::ButtonsBusy, Value::Null);
    let outcome = match stages(cx, cfg) {
        Ok(Some(o)) => {
            cx.ports.state(StateName::PreviewReady, o.payload.clone());
            Some(o)
        }
        Ok(None) => None,
        Err(e) => {
            cx.ports.trace(&format!("computing the preview: {e:?}"));
            cx.log(&format!("✗ Preview failed: {}", e.user_message()), Level::Err);
            cx.ports.state(StateName::Summary, json!({"text": "  Preview failed — see the console.", "level": "err"}));
            None
        }
    };
    cx.ports.state(StateName::Buttons, json!({"stop": false, "stop_label": "⏸ Stop"}));
    // No batch run exists in this build (T4): the busy state always ends here.
    cx.ports.state(StateName::ButtonsIdle, Value::Null);
    outcome
}

fn secs(t: Instant) -> f64 {
    t.elapsed().as_secs_f64()
}

fn stages(cx: &mut Ctx, cfg: &Settings) -> Result<Option<Outcome>, EngineError> {
    let total = Instant::now();
    let t = Instant::now();
    let evts = sql::query_events(cx, cfg)?;
    let t_query = secs(t);
    if cx.cancelled() {
        return Ok(None);
    }
    let mut funnel = vec![(FUNNEL_QUERY.to_string(), event::count(&evts))];
    let t = Instant::now();
    let demos: Vec<String> = evts.keys().cloned().collect();
    dp2::preparse(cx, cfg, &demos)?;
    let t_preparse = secs(t);
    if cx.cancelled() {
        return Ok(None);
    }
    let t = Instant::now();
    let evts = dp2::apply_filters(cx, evts, cfg)?;
    funnel.push((FUNNEL_DP2.to_string(), event::count(&evts)));
    let evts = dp2::apply_global_gate(cx, evts, cfg)?;
    funnel.push((FUNNEL_GATE.to_string(), event::count(&evts)));
    let t_filters = secs(t);
    // 3.5 cameras read the in-demo names straight from `_dp2_cache`; here the clips stage reads
    // them from the host cache, filled from the demo-file stage's view.
    for dp in evts.keys() {
        if let Some(names) = cx.dp2.demo_names(dp) {
            let names = names.clone();
            cx.host.demo_names.insert(dp.clone(), names);
        }
    }
    let t = Instant::now();
    let seqs = clips::preview_sequences(cx, &evts, cfg)?;
    let t_seq = secs(t);
    if cx.cancelled() {
        return Ok(None);
    }
    let timings = json!({"query": t_query, "preparse": t_preparse, "filters": t_filters, "seqs": t_seq, "total": secs(total)});
    let (nb_clips, total_sec, avg_sec) = clips::sequence_totals(&seqs, clips::whole(cfg, "tickrate", None)?);
    let mut empty_reason = Value::Null;
    if nb_clips > 0 {
        let nb_demos = seqs.values().filter(|s| !s.is_empty()).count();
        let mut summary = Map::new();
        summary.insert("text".into(), clips::fmt_summary(nb_demos, nb_clips, total_sec, avg_sec).into());
        summary.insert("level".into(), "ok".into());
        if let Value::Object(counts) = clips::summary_counts(nb_demos, nb_clips, total_sec, avg_sec) {
            summary.extend(counts);
        }
        cx.ports.state(StateName::Summary, Value::Object(summary));
    } else {
        empty_reason = clips::explain_empty_result(cx, cfg, &funnel)?;
    }
    if cx.cancelled() {
        return Ok(None);
    }
    let mut payload = clips::payload(cx, &evts, &seqs);
    let body = payload.as_object_mut().expect("payload is an object");
    body.insert("cfg".into(), Value::Object(cfg.clone()));
    body.insert("timings".into(), timings);
    body.insert("empty_reason".into(), empty_reason);
    let last = LastPreview::new(cx, seqs, cfg);
    Ok(Some(Outcome { payload, last }))
}
