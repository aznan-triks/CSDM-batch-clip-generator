//! Clips stage of the preview: 3.5 `_build_sequences`, cameras, summary, empty-result funnel,
//! export rows, EDITING cameras, run-input problems, demo list and filter tables.
//!
//! 3.5 kept the last preview on the host between commands (`_last_preview_result`); here it is a
//! [`LastPreview`] the engine holds and hands to the commands that read it.

mod cameras;
mod demos;
mod describe;
mod edits;
mod empty;
mod export;
mod inputs;
mod sequences;

pub use cameras::{camera_players, camera_segments, CameraPlayers};
pub use demos::list_all_demos;
pub use describe::describe_filters;
pub use edits::{apply_clip_edits, edited_clip_cameras, event_key, normalize_clip_selection, preset_clip_selection, ClipEntry};
pub use empty::explain_empty_result_with;
pub use export::{clip_row, preview_clip_rows, preview_export, render_preview, ExportMeta};
pub use inputs::run_inputs_problem;
pub use sequences::{build_sequences, calc_summary, effective_before, fmt_summary, hms, player_str, sequence_totals, summary_counts};

use super::dates::{demo_sort_key, format_demo_date};
use super::event::{self, Arena, EventId};
use super::{cfg, sql, Ctx, DemoEvents};
use crate::EngineError;
use csdm_core::Settings;
use csdm_db::Discovery;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// What this stage keeps for the length of one preview: nothing, every value it needs is computed
/// from the events and the host caches.
#[derive(Debug, Default)]
pub struct Cache {}

/// One camera span of a clip (3.5 `camera_segments` entry).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Segment {
    pub from_tick: i64,
    pub to_tick: i64,
    pub steam_id: String,
    pub name: String,
}

impl Segment {
    pub fn to_json(&self) -> Value {
        json!({"from_tick": self.from_tick, "to_tick": self.to_tick, "steam_id": self.steam_id, "name": self.name})
    }
}

/// One clip sequence (3.5 sequence dict). `event_types` only when 3.5 sets it (merged windows);
/// `event_keys` / `camera_segments` are filled by [`preview_sequences`].
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Sequence {
    pub start_tick: i64,
    pub end_tick: i64,
    pub events: Vec<EventId>,
    pub event_type: String,
    pub event_types: Option<Vec<String>>,
    pub event_keys: Vec<String>,
    pub camera_segments: Vec<Segment>,
}

/// Demo path → its sequences, demos with no event left out (3.5 `_preview_sequences` result).
pub type Sequences = indexmap::IndexMap<String, Vec<Sequence>>;

/// Python `int(v)` on a JSON value (`None` where Python raises).
pub(crate) fn py_int(v: &Value) -> Option<i64> {
    match v {
        Value::Bool(b) => Some(i64::from(*b)),
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f.trunc() as i64)),
        Value::String(s) => s.trim().replace('_', "").parse().ok(),
        _ => None,
    }
}

/// A name lookup for one demo's cameras: the name read in the demo, else the database's, else "".
pub(crate) fn names_for<'a>(demo_names: Option<&'a HashMap<String, String>>, player_names: &'a HashMap<&'a str, &'a str>) -> impl Fn(&str) -> String + 'a {
    move |sid| {
        demo_names
            .and_then(|n| n.get(sid))
            .filter(|n| !n.is_empty())
            .cloned()
            .unwrap_or_else(|| player_names.get(sid).map_or_else(String::new, |n| n.to_string()))
    }
}

pub(crate) fn player_names(disc: &Discovery) -> HashMap<&str, &str> {
    // Python dict semantics: the last write of a key wins (`Dict` keeps one entry per key anyway).
    disc.names.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
}

/// `_preview_sequences(evts, cfg)`: each demo's sequences, with the `event_keys` and
/// `camera_segments` the EDITING tab needs.
pub fn preview_sequences(cx: &mut Ctx, evts: &DemoEvents, cfg: &Settings) -> Result<Sequences, EngineError> {
    let players = camera_players(cfg);
    let tickrate = sequences::whole(cfg, "tickrate", None)?;
    let (before, after) = (effective_before(cfg)?, sequences::whole(cfg, "after", None)?);
    let db_names = player_names(cx.disc);
    let mut out = Sequences::new();
    for (dp, events) in evts {
        if events.is_empty() {
            continue;
        }
        let names = names_for(cx.host.demo_names.get(dp), &db_names);
        let mut seqs = build_sequences(&cx.arena, events, tickrate, before, after);
        for seq in &mut seqs {
            seq.event_keys = seq.events.iter().map(|&id| event_key(cx.arena.get(id))).collect();
            seq.camera_segments = camera_segments(&cx.arena, seq, cfg, &players, &names)?;
        }
        out.insert(dp.clone(), seqs);
    }
    Ok(out)
}

/// `explain_empty_result(cfg, counts)`: `cfg` is the run cfg, `counts` the caller's funnel. An empty
/// database query is split into its stages, each counted by the SQL stage.
pub fn explain_empty_result(cx: &mut Ctx, cfg: &Settings, counts: &[(String, usize)]) -> Result<Value, EngineError> {
    let ports = cx.ports;
    explain_empty_result_with(ports, cfg, counts, &mut |raw| Ok(event::count(&sql::query_events(cx, &cfg::build_run_cfg(raw))?)))
}

/// The `preview_ready` payload's `events`, `sequences`: each demo's events as JSON, each
/// sequence with its events as positions in its demo's list, or `{"copy": event}` when absent.
pub fn payload(cx: &Ctx, evts: &DemoEvents, seqs: &Sequences) -> Value {
    payload_from(&cx.arena, evts, seqs)
}

fn payload_from(arena: &Arena, evts: &DemoEvents, seqs: &Sequences) -> Value {
    let events: Map<String, Value> = evts.iter().map(|(dp, ids)| (dp.clone(), ids.iter().map(|&id| arena.get(id).to_json()).collect())).collect();
    let mut sequences = Map::new();
    for (dp, ss) in seqs {
        // 3.5 `{id(e): i}`: the last position of an event listed twice.
        let pos: HashMap<EventId, usize> = evts.get(dp).into_iter().flatten().enumerate().map(|(i, &id)| (id, i)).collect();
        let rows: Vec<Value> = ss
            .iter()
            .map(|s| {
                let mut row = Map::new();
                row.insert("start_tick".into(), s.start_tick.into());
                row.insert("end_tick".into(), s.end_tick.into());
                row.insert("event_type".into(), s.event_type.clone().into());
                if let Some(t) = &s.event_types {
                    row.insert("event_types".into(), t.clone().into());
                }
                row.insert("event_keys".into(), s.event_keys.clone().into());
                row.insert("camera_segments".into(), s.camera_segments.iter().map(Segment::to_json).collect());
                let evs = s.events.iter().map(|id| pos.get(id).map_or_else(|| json!({"copy": arena.get(*id).to_json()}), |&i| json!(i))).collect();
                row.insert("events".into(), Value::Array(evs));
                Value::Object(row)
            })
            .collect();
        sequences.insert(dp.clone(), Value::Array(rows));
    }
    json!({"events": events, "sequences": sequences})
}

/// What the engine keeps of the last preview for the commands that follow it (3.5
/// `_last_preview_result` = sequences + run cfg), with what those commands read from the host:
/// the events, the demo order and dates of the export, the names read in the demos.
#[derive(Debug, Clone, Default)]
pub struct LastPreview {
    pub arena: Arena,
    pub seqs: Sequences,
    pub cfg: Settings,
    /// Demos of `seqs` in picker order (`_demo_sort_key`).
    pub demo_order: Vec<String>,
    /// Demo path → `_format_demo_date`.
    pub demo_dates: HashMap<String, String>,
    /// Demo path → SteamID → name read in the demo.
    pub demo_names: HashMap<String, HashMap<String, String>>,
}

impl LastPreview {
    /// `_remember_preview`, at the end of a preview: takes the preview's events out of `cx`, so it
    /// comes after everything that reads them (payload included).
    pub fn new(cx: &mut Ctx, seqs: Sequences, cfg: &Settings) -> Self {
        let mut keyed: Vec<((u8, f64), String)> = seqs.keys().map(|dp| (demo_sort_key(cx, dp), dp.clone())).collect();
        keyed.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("demo sort keys are numbers"));
        let demo_order: Vec<String> = keyed.into_iter().map(|(_, dp)| dp).collect();
        let demo_dates = demo_order.iter().map(|dp| (dp.clone(), format_demo_date(cx, dp))).collect();
        let demo_names = seqs.keys().filter_map(|dp| cx.host.demo_names.get(dp).map(|n| (dp.clone(), n.clone()))).collect();
        LastPreview { arena: std::mem::take(&mut cx.arena), seqs, cfg: cfg.clone(), demo_order, demo_dates, demo_names }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::event::Event;

    #[test]
    fn python_int() {
        assert_eq!(py_int(&json!(7.9)), Some(7));
        assert_eq!(py_int(&json!(-7.9)), Some(-7));
        assert_eq!(py_int(&json!(" 12 ")), Some(12));
        assert_eq!(py_int(&json!(true)), Some(1));
        assert_eq!(py_int(&json!(null)), None);
        assert_eq!(py_int(&json!("1.5")), None);
    }

    #[test]
    fn names_prefer_the_demo_then_the_database() {
        let demo = HashMap::from([("1".to_string(), "InDemo".to_string())]);
        let db = HashMap::from([("1", "Db1"), ("2", "Db2")]);
        let f = names_for(Some(&demo), &db);
        assert_eq!((f("1"), f("2"), f("3")), ("InDemo".into(), "Db2".into(), String::new()));
    }

    #[test]
    fn payload_points_at_positions_or_copies() {
        let mut arena = Arena::default();
        let mut e = Event::default();
        e.set("tick", 5);
        let (a, b) = (arena.add(e.clone()), arena.add(e));
        let mut evts = DemoEvents::new();
        evts.insert("d".into(), vec![a]);
        let mut seqs = Sequences::new();
        seqs.insert("d".into(), vec![Sequence { events: vec![a, b], event_type: "kill".into(), ..Default::default() }]);
        let p = payload_from(&arena, &evts, &seqs);
        assert_eq!(p["events"]["d"], json!([{"tick": 5}]));
        assert_eq!(p["sequences"]["d"][0]["events"], json!([0, {"copy": {"tick": 5}}]));
        assert!(p["sequences"]["d"][0].get("event_types").is_none());
    }
}
