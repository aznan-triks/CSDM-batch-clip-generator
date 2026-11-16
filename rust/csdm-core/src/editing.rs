//! The EDITING tab's clips and their per-clip edits (3.5 `csdm/engine/clip_edits.py` and its
//! renderer mirror `tabs/editing/clipEdits.ts`, kept here once): the engine's recording path and
//! the window both call [`edited_window`].
//!
//! A clip is addressed by `(demo_path, start_tick)`, the start the preview computed before any
//! edit. An edit may set `before_s` / `after_s` (whole seconds before the first kept event /
//! after the last one) and take events out (`excluded_events`, by `event_key`).

use crate::ui_values::{EDITING_PPS, EDITING_RULER_MIN_GAP, EDITING_RULER_STEPS_S, EDITING_TAIL_S};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// The per-clip handle range, in whole seconds (3.5 `CLIP_EDIT_RANGE`): the widget's own range,
/// wider than the global setting on purpose (one clip may need a long run-up).
pub const CLIP_EDIT_RANGE: [i64; 2] = [0, 60];
/// `previewTickrate` when the preview's cfg carries none (3.5 `engineStore.ts`).
pub const TICKRATE_FALLBACK: i64 = 64;

/// One checked clip as GENERATE / SAVE send it and the engine reads it (3.5 `selected_clips` entry).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ClipEntry {
    pub demo_path: String,
    pub start_tick: i64,
    pub before_s: Option<i64>,
    pub after_s: Option<i64>,
    pub excluded_events: Option<Vec<String>>,
}

impl ClipEntry {
    /// Whether any edit field is present.
    pub fn edited(&self) -> bool {
        self.before_s.is_some() || self.after_s.is_some() || self.excluded_events.is_some()
    }

    /// 3.5 `savedClip`: an entry the engine already checked; `None` without its address.
    pub fn from_json(v: &Value) -> Option<Self> {
        let seconds = |k: &str| v.get(k).and_then(Value::as_i64);
        let excluded: Vec<String> = v["excluded_events"].as_array().map(|a| a.iter().filter_map(text).collect()).unwrap_or_default();
        Some(Self {
            demo_path: v.get("demo_path")?.as_str()?.to_string(),
            start_tick: v.get("start_tick")?.as_i64()?,
            before_s: seconds("before_s"),
            after_s: seconds("after_s"),
            excluded_events: (!excluded.is_empty()).then_some(excluded),
        })
    }

    /// The entry as 3.5 holds it: only the edit fields present.
    pub fn to_json(&self) -> Value {
        let mut m = Map::new();
        m.insert("demo_path".into(), self.demo_path.clone().into());
        m.insert("start_tick".into(), self.start_tick.into());
        if let Some(s) = self.before_s {
            m.insert("before_s".into(), s.into());
        }
        if let Some(s) = self.after_s {
            m.insert("after_s".into(), s.into());
        }
        if let Some(k) = &self.excluded_events {
            m.insert("excluded_events".into(), k.clone().into());
        }
        Value::Object(m)
    }
}

/// A clip once edited, in ticks; `first_kept` / `last_kept` index the clip's events.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Window {
    pub start_tick: i64,
    pub end_tick: i64,
    pub first_kept: usize,
    pub last_kept: usize,
}

/// The clip as the run records it (`_edited` / `editedWindow`). `ticks` are its events' ticks in
/// order, `kept[i]` whether event `i` stays. `None` when no event is left. An unedited clip
/// (`edited == false`) keeps the preview's window. Unedited sides keep the lead / tail measured
/// from the clip's first / last event; start ≥ 0; never an empty clip.
#[allow(clippy::too_many_arguments)] // the engine and the window hold the clip in different shapes
pub fn edited_window(start_tick: i64, end_tick: i64, ticks: &[i64], kept: &[bool], before_s: Option<i64>, after_s: Option<i64>, edited: bool, tickrate: i64) -> Option<Window> {
    let first_kept = kept.iter().position(|&k| k)?;
    let last_kept = kept.iter().rposition(|&k| k)?;
    if !edited {
        return Some(Window { start_tick, end_tick, first_kept, last_kept });
    }
    let lead = before_s.map_or(ticks[0] - start_tick, |s| s * tickrate);
    let tail = after_s.map_or(end_tick - ticks[ticks.len() - 1], |s| s * tickrate);
    let start = (ticks[first_kept] - lead).max(0);
    let end = (ticks[last_kept] + tail).max(start + 1);
    Some(Window { start_tick: start, end_tick: end, first_kept, last_kept })
}

/// One event of a preview clip.
#[derive(Debug, Clone, PartialEq)]
pub struct PreviewEvent {
    pub tick: i64,
    pub kind: String,
    /// The engine's `event_key`, handed back opaque in `excluded_events`.
    pub key: String,
}

/// Who the recording follows, and when (engine `camera_segments`).
#[derive(Debug, Clone, PartialEq)]
pub struct CameraSpan {
    pub from_tick: i64,
    pub to_tick: i64,
    pub steam_id: String,
    pub name: String,
}

impl CameraSpan {
    pub fn from_json(v: &Value) -> Self {
        Self { from_tick: tick(&v["from_tick"]).unwrap_or(0), to_tick: tick(&v["to_tick"]).unwrap_or(0), steam_id: text(&v["steam_id"]).unwrap_or_default(), name: text(&v["name"]).unwrap_or_default() }
    }
}

/// JS `String(x ?? …)`: `None` for null / absent.
fn text(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

/// A tick as JS `Number(x)` then `Math.trunc` would keep it; `None` for null / absent / not a number.
fn tick(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))
}

/// One clip of the last preview, with the user's checking and edits.
#[derive(Debug, Clone, PartialEq)]
pub struct PreviewClip {
    pub demo_path: String,
    pub start_tick: i64,
    pub end_tick: i64,
    pub event_type: String,
    /// SteamID of the tracked player in the first event (3.5 `playerName`).
    pub player: String,
    pub selected: bool,
    pub events: Vec<PreviewEvent>,
    pub cameras: Vec<CameraSpan>,
    pub before_s: Option<i64>,
    pub after_s: Option<i64>,
    pub excluded: Vec<String>,
}

/// The edited clip for drawing (3.5 `EditedWindow`).
#[derive(Debug, Clone, PartialEq)]
pub struct EditedWindow {
    pub start_tick: i64,
    pub end_tick: i64,
    pub duration_s: f64,
    /// Indices of the events still in the clip.
    pub kept: Vec<usize>,
    pub lead_s: f64,
    pub tail_s: f64,
}

impl PreviewClip {
    pub fn edited(&self) -> bool {
        self.before_s.is_some() || self.after_s.is_some() || !self.excluded.is_empty()
    }

    pub fn is_excluded(&self, key: &str) -> bool {
        self.excluded.iter().any(|k| k == key)
    }

    /// 3.5 `editedWindow`; `None` when every event was taken out.
    pub fn window(&self, tickrate: i64) -> Option<EditedWindow> {
        let rate = tickrate as f64;
        let (start, end, kept) = if self.events.is_empty() || !self.edited() {
            (self.start_tick, self.end_tick, (0..self.events.len()).collect::<Vec<_>>())
        } else {
            let ticks: Vec<i64> = self.events.iter().map(|e| e.tick).collect();
            let mask: Vec<bool> = self.events.iter().map(|e| !self.is_excluded(&e.key)).collect();
            let w = edited_window(self.start_tick, self.end_tick, &ticks, &mask, self.before_s, self.after_s, true, tickrate)?;
            (w.start_tick, w.end_tick, (0..mask.len()).filter(|&i| mask[i]).collect())
        };
        let first = kept.first().map_or(start, |&i| self.events[i].tick);
        let last = kept.last().map_or(end, |&i| self.events[i].tick);
        Some(EditedWindow { start_tick: start, end_tick: end, duration_s: (end - start) as f64 / rate, kept, lead_s: (first - start) as f64 / rate, tail_s: (end - last) as f64 / rate })
    }

    /// 3.5 `clipPayload`.
    pub fn entry(&self) -> ClipEntry {
        ClipEntry {
            demo_path: self.demo_path.clone(),
            start_tick: self.start_tick,
            before_s: self.before_s,
            after_s: self.after_s,
            excluded_events: (!self.excluded.is_empty()).then(|| self.excluded.clone()),
        }
    }

    /// `pool`: the demo's events (`payload.events[demo]`). The engine names a sequence's event by
    /// its position there, or carries it as `{"copy": event}` when the list does not hold it; an
    /// event written in place (the 3.5 shape) is read as it is.
    fn from_sequence(demo_path: &str, seq: &Value, pool: Option<&Vec<Value>>, fallback_player: &str) -> Self {
        let empty = Map::new();
        let events: Vec<&Value> = seq["events"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|e| match e {
                Value::Number(at) => at.as_u64().and_then(|i| pool?.get(i as usize)).unwrap_or(&Value::Null),
                Value::Object(m) if m.len() == 1 && m.contains_key("copy") => &m["copy"],
                other => other,
            })
            .collect();
        let first = events.first().and_then(|e| e.as_object()).unwrap_or(&empty);
        let start_tick = tick(&seq["start_tick"]).unwrap_or(0);
        let event_type = text(&seq["event_type"]).or_else(|| first.get("type").and_then(text)).unwrap_or_else(|| "?".into());
        // Non-kill events carry the tracked player on attacker_sid (damage, shot) or victim_sid
        // (damage_target / death) instead of killer_sid.
        let field = |k: &str| first.get(k).and_then(text);
        let player = if event_type == "death" || event_type == "damage_target" { field("victim_sid") } else { field("attacker_sid").or_else(|| field("killer_sid")) };
        let keys = seq["event_keys"].as_array();
        Self {
            demo_path: demo_path.to_string(),
            start_tick,
            end_tick: tick(&seq["end_tick"]).unwrap_or(start_tick),
            player: player.unwrap_or_else(|| fallback_player.to_string()),
            selected: true,
            events: events
                .iter()
                .enumerate()
                .map(|(i, e)| PreviewEvent {
                    tick: tick(&e["tick"]).unwrap_or(start_tick),
                    kind: text(&e["type"]).unwrap_or_else(|| event_type.clone()),
                    key: keys.and_then(|k| k.get(i)).and_then(text).unwrap_or_else(|| i.to_string()),
                })
                .collect(),
            cameras: seq["camera_segments"].as_array().map(|c| c.iter().map(CameraSpan::from_json).collect()).unwrap_or_default(),
            event_type,
            before_s: None,
            after_s: None,
            excluded: Vec::new(),
        }
    }
}

/// Why the last preview found no clip (engine `explain_empty_result`).
#[derive(Debug, Clone, PartialEq)]
pub struct EmptyReason {
    pub headline: String,
    pub hint: String,
    pub stages: Vec<(String, f64)>,
}

impl EmptyReason {
    /// 3.5 `readEmptyReason`: `None` when absent or without a headline.
    fn from_json(v: &Value) -> Option<Self> {
        let headline = v.get("headline")?.as_str()?.to_string();
        let stages = v["stages"].as_array().map(|s| s.iter().map(|st| (text(&st["label"]).unwrap_or_default(), st["count"].as_f64().unwrap_or(0.0))).collect()).unwrap_or_default();
        Some(Self { headline, hint: text(&v["hint"]).unwrap_or_default(), stages })
    }
}

/// One demo's row on the timeline: its clips, by index.
#[derive(Debug, Clone, PartialEq)]
pub struct Lane {
    pub demo_path: String,
    pub name: String,
    pub indices: Vec<usize>,
}

/// The last preview as the EDITING tab edits it (3.5 `previewClips` + `previewTickrate` +
/// `previewEmptyReason`).
#[derive(Debug, Clone, PartialEq)]
pub struct Preview {
    pub clips: Vec<PreviewClip>,
    pub tickrate: i64,
    pub empty_reason: Option<EmptyReason>,
    /// Bumped by every change, so a view can cache what it derives.
    pub generation: u64,
}

impl Default for Preview {
    fn default() -> Self {
        Self { clips: Vec::new(), tickrate: TICKRATE_FALLBACK, empty_reason: None, generation: 0 }
    }
}

impl Preview {
    /// 3.5 `reduceEngineState("preview_ready")`: every clip checked, unedited.
    pub fn from_ready(payload: &Value) -> Self {
        let cfg = &payload["cfg"];
        let tickrate = tick(&cfg["tickrate"]).filter(|&t| t > 0).unwrap_or(TICKRATE_FALLBACK);
        let fallback_player = text(&cfg["player_name"]).unwrap_or_default();
        let mut clips = Vec::new();
        if let Some(sequences) = payload["sequences"].as_object() {
            for (demo_path, seqs) in sequences {
                let pool = payload["events"].get(demo_path).and_then(Value::as_array);
                clips.extend(seqs.as_array().into_iter().flatten().map(|s| PreviewClip::from_sequence(demo_path, s, pool, &fallback_player)));
            }
        }
        let empty_reason = if clips.is_empty() { EmptyReason::from_json(&payload["empty_reason"]) } else { None };
        Self { clips, tickrate, empty_reason, generation: 0 }
    }

    pub fn selected_count(&self) -> usize {
        self.clips.iter().filter(|c| c.selected).count()
    }

    /// Seconds the run records: the checked clips' edited windows, a clip with no event left at 0.
    pub fn total_s(&self) -> f64 {
        self.clips.iter().filter(|c| c.selected).filter_map(|c| c.window(self.tickrate)).map(|w| w.duration_s).sum()
    }

    fn change(&mut self, index: usize, f: impl FnOnce(&mut PreviewClip)) {
        if let Some(clip) = self.clips.get_mut(index) {
            f(clip);
            self.generation += 1;
        }
    }

    pub fn toggle(&mut self, index: usize) {
        self.change(index, |c| c.selected = !c.selected);
    }

    /// `editClip(index, {beforeS})`, clamped to [`CLIP_EDIT_RANGE`].
    pub fn set_before(&mut self, index: usize, seconds: i64) {
        self.change(index, |c| c.before_s = Some(seconds.clamp(CLIP_EDIT_RANGE[0], CLIP_EDIT_RANGE[1])));
    }

    pub fn set_after(&mut self, index: usize, seconds: i64) {
        self.change(index, |c| c.after_s = Some(seconds.clamp(CLIP_EDIT_RANGE[0], CLIP_EDIT_RANGE[1])));
    }

    /// `editClip(index, null)`.
    pub fn reset(&mut self, index: usize) {
        self.change(index, |c| {
            c.before_s = None;
            c.after_s = None;
            c.excluded.clear();
        });
    }

    /// `toggleClipEvent`.
    pub fn toggle_event(&mut self, index: usize, key: &str) {
        self.change(index, |c| match c.excluded.iter().position(|k| k == key) {
            Some(at) => {
                c.excluded.remove(at);
            }
            None => c.excluded.push(key.to_string()),
        });
    }

    /// `restoreClipSelection`: exactly the saved clips checked, each with its saved edits; every
    /// other clip unchecked, unedited.
    pub fn restore(&mut self, saved: &[ClipEntry]) {
        let by_address: HashMap<(&str, i64), &ClipEntry> = saved.iter().map(|e| ((e.demo_path.as_str(), e.start_tick), e)).collect();
        for clip in &mut self.clips {
            let entry = by_address.get(&(clip.demo_path.as_str(), clip.start_tick));
            clip.selected = entry.is_some();
            clip.before_s = entry.and_then(|e| e.before_s);
            clip.after_s = entry.and_then(|e| e.after_s);
            clip.excluded = entry.and_then(|e| e.excluded_events.clone()).unwrap_or_default();
        }
        self.generation += 1;
    }

    /// The checked clips with their edits, as `start_run` / `save_preset` take them.
    pub fn selected_clips(&self) -> Value {
        json!(self.clips.iter().filter(|c| c.selected).map(|c| c.entry().to_json()).collect::<Vec<_>>())
    }

    /// `buildLanes`: clips grouped by demo, in the order the preview listed the demos.
    pub fn lanes(&self) -> Vec<Lane> {
        let mut lanes: Vec<Lane> = Vec::new();
        let mut at: HashMap<&str, usize> = HashMap::new();
        for (i, clip) in self.clips.iter().enumerate() {
            let k = *at.entry(clip.demo_path.as_str()).or_insert_with(|| {
                lanes.push(Lane { demo_path: clip.demo_path.clone(), name: demo_name(&clip.demo_path).to_string(), indices: Vec::new() });
                lanes.len() - 1
            });
            lanes[k].indices.push(i);
        }
        lanes
    }

    /// Seconds of axis a page of lanes needs: its latest edited end, plus the tail (3.5 `spanS`).
    pub fn span_s(&self, lanes: &[Lane]) -> f64 {
        let end = lanes.iter().flat_map(|l| &l.indices).filter_map(|&i| self.clips[i].window(self.tickrate)).map(|w| w.end_tick).max().unwrap_or(0);
        end as f64 / self.tickrate as f64 + EDITING_TAIL_S
    }

    /// `overlapsAnother`: this clip, as edited, overlaps another checked clip of its demo (the
    /// engine then records the two as one).
    pub fn overlaps_another(&self, lane: &Lane, index: usize) -> bool {
        let Some(own) = self.clips.get(index).and_then(|c| c.window(self.tickrate)) else {
            return false;
        };
        lane.indices.iter().any(|&j| {
            j != index && self.clips[j].selected && self.clips[j].window(self.tickrate).is_some_and(|o| o.start_tick < own.end_tick && own.start_tick < o.end_tick)
        })
    }

}

/// `clampPps`: a zoom inside its bounds.
pub fn clamp_pps(pps: f64) -> f64 {
    pps.clamp(EDITING_PPS[0], EDITING_PPS[1])
}

/// `rulerTicks`: the smallest labelled step that leaves room for its label, and the labelled
/// seconds between two track positions (px), never past `span_s`.
pub fn ruler_ticks(pps: f64, x0: f64, x1: f64, span_s: f64) -> Vec<f64> {
    let step = EDITING_RULER_STEPS_S.iter().copied().find(|s| s * pps >= EDITING_RULER_MIN_GAP).unwrap_or(EDITING_RULER_STEPS_S[EDITING_RULER_STEPS_S.len() - 1]);
    let first = ((x0 / pps / step).ceil() * step).max(0.0);
    let last = span_s.min(x1 / pps);
    let mut out = Vec::new();
    let mut t = first;
    while t <= last {
        out.push(t);
        t += step;
    }
    out
}

/// Where the track must scroll to keep the second under `anchor_px` in place when the zoom goes
/// from `from_pps` to `to_pps` (3.5 `zoom`).
pub fn zoom_scroll(left_px: f64, anchor_px: f64, from_pps: f64, to_pps: f64) -> f64 {
    ((left_px + anchor_px) / from_pps * to_pps - anchor_px).max(0.0)
}

/// `demoName`: the file name of a demo path.
pub fn demo_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().filter(|n| !n.is_empty()).unwrap_or(path)
}

/// `formatClock`: demo time as M:SS.
pub fn format_clock(seconds: f64) -> String {
    let s = seconds.max(0.0).floor() as i64;
    format!("{}:{:02}", s / 60, s % 60)
}

/// `formatDuration`: M:SS.t (rounded to the tenth first, so 59.96 s reads 1:00.0, not 3.5's 0:60.0).
pub fn format_duration(seconds: f64) -> String {
    let tenths = (seconds.max(0.0) * 10.0).round() as i64;
    format!("{}:{:02}.{}", tenths / 600, tenths % 600 / 10, tenths % 10)
}

/// `formatTotal`: "2 min 34 s".
pub fn format_total(seconds: f64) -> String {
    let s = seconds.max(0.0).floor() as i64;
    format!("{} min {} s", s / 60, s % 60)
}

/// Visual family of an event type (3.5 `EVENT_TYPE_META.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind { Kill, Damage, Shot, Other }

/// `eventTypeMeta`: the badge words and family; an unknown type shows itself under `Other`.
pub fn event_meta(kind: &str) -> (String, Kind) {
    let (label, family) = match kind {
        "kill" => ("💀 Kill", Kind::Kill),
        "death" => ("☠ Death", Kind::Kill),
        "damage_actor" => ("🔫 Dmg", Kind::Damage),
        "damage_target" => ("🩹 Hit", Kind::Damage),
        "shot" => ("🎯 Shot", Kind::Shot),
        "knife_swing" => ("🔪 Swing", Kind::Shot),
        other => (other, Kind::Other),
    };
    (label.to_string(), family)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TR: i64 = 64;

    fn win(start: i64, end: i64, ticks: &[i64], kept: &[bool], b: Option<i64>, a: Option<i64>) -> Option<(i64, i64, usize, usize)> {
        edited_window(start, end, ticks, kept, b, a, b.is_some() || a.is_some() || kept.iter().any(|k| !k), TR).map(|w| (w.start_tick, w.end_tick, w.first_kept, w.last_kept))
    }

    #[test]
    fn window_rules_like_3_5() {
        // Unedited: the preview's window.
        assert_eq!(win(808, 1128, &[1000], &[true], None, None), Some((808, 1128, 0, 0)));
        // Both sides in whole seconds.
        assert_eq!(win(808, 1128, &[1000], &[true], Some(5), Some(7)), Some((1000 - 5 * TR, 1000 + 7 * TR, 0, 0)));
        // One side keeps the other.
        assert_eq!(win(808, 1128, &[1000], &[true], None, Some(0)), Some((808, 1000, 0, 0)));
        // Never empty, never below 0.
        assert_eq!(win(808, 1128, &[1000], &[true], Some(0), Some(0)), Some((1000, 1001, 0, 0)));
        assert_eq!(win(0, 228, &[100], &[true], Some(15), None).map(|w| w.0), Some(0));
        // Excluding the first event moves the start with the same lead.
        assert_eq!(win(808, 1428, &[1000, 1300], &[false, true], None, None), Some((1300 - 192, 1428, 1, 1)));
        // Every event out: not recorded.
        assert_eq!(win(808, 1128, &[1000], &[false], None, None), None);
    }

    fn ready() -> Value {
        json!({
            "cfg": {"tickrate": 64, "player_name": "me"},
            "sequences": {
                "C:/d/a.dem": [
                    {"start_tick": 808, "end_tick": 1428, "event_type": "kill", "events": [{"tick": 1000, "type": "kill", "killer_sid": "765"}, {"tick": 1300, "type": "death", "victim_sid": "765"}], "event_keys": ["1000:kill:x", "1300:death:765"], "camera_segments": [{"from_tick": 808, "to_tick": 1428, "steam_id": "765", "name": "Me"}]},
                    {"start_tick": 5000, "end_tick": 5320, "events": [{"tick": 5192, "type": "damage_target", "victim_sid": "999"}], "event_keys": ["5192:damage_target:999"]}
                ],
                "C:/d/b.dem": [
                    {"start_tick": 100, "end_tick": 420, "event_type": "shot", "events": [{"tick": 292, "type": "shot", "attacker_sid": "765"}], "event_keys": ["292:shot:"]}
                ]
            }
        })
    }

    #[test]
    fn preview_ready_reads_like_the_3_5_store() {
        let p = Preview::from_ready(&ready());
        assert_eq!(p.tickrate, 64);
        assert_eq!(p.clips.len(), 3);
        let c = &p.clips[0];
        assert_eq!((c.demo_path.as_str(), c.start_tick, c.end_tick, c.event_type.as_str(), c.player.as_str(), c.selected), ("C:/d/a.dem", 808, 1428, "kill", "765", true));
        assert_eq!(c.events[1], PreviewEvent { tick: 1300, kind: "death".into(), key: "1300:death:765".into() });
        assert_eq!(c.cameras[0].name, "Me");
        // No event_type: the first event's; damage_target follows the victim.
        assert_eq!((p.clips[1].event_type.as_str(), p.clips[1].player.as_str()), ("damage_target", "999"));
        assert_eq!(p.clips[2].player, "765");
        assert!(p.empty_reason.is_none());
        let empty = Preview::from_ready(&json!({"sequences": {}, "empty_reason": {"headline": "No kill matched.", "hint": "Widen the dates.", "stages": [{"label": "kills in the database", "count": 12}, {"label": "after the date filter", "count": 0}]}}));
        assert_eq!(empty.tickrate, TICKRATE_FALLBACK);
        let r = empty.empty_reason.unwrap();
        assert_eq!((r.headline.as_str(), r.stages.len(), r.stages[1].1), ("No kill matched.", 2, 0.0));
        assert!(Preview::from_ready(&json!({"sequences": {}, "empty_reason": {"hint": "x"}})).empty_reason.is_none(), "no headline: malformed");
    }

    #[test]
    fn preview_ready_reads_the_engine_payload_events_by_position() {
        // The Rust engine: `events` lists each demo's events once; a sequence names them by position,
        // or carries `{"copy": event}` for one the list does not hold.
        let p = Preview::from_ready(&json!({
            "cfg": {"tickrate": 128},
            "events": {"a.dem": [{"tick": 10, "type": "kill", "killer_sid": "1"}, {"tick": 900, "type": "death", "victim_sid": "7"}, {"tick": 950, "type": "kill", "killer_sid": "7"}]},
            "sequences": {"a.dem": [{"start_tick": 700, "end_tick": 1200, "event_type": "death", "events": [1, {"copy": {"tick": 940, "type": "shot", "attacker_sid": "7"}}, 2], "event_keys": ["900:death:7", "940:shot:", "950:kill:x"]}]}
        }));
        let c = &p.clips[0];
        assert_eq!(p.tickrate, 128);
        assert_eq!(c.events.iter().map(|e| (e.tick, e.kind.as_str(), e.key.as_str())).collect::<Vec<_>>(), vec![(900, "death", "900:death:7"), (940, "shot", "940:shot:"), (950, "kill", "950:kill:x")]);
        assert_eq!(c.player, "7", "the first event's victim, read through its position");
    }

    #[test]
    fn edits_checking_and_payload() {
        let mut p = Preview::from_ready(&ready());
        let g = p.generation;
        p.set_before(0, 2);
        assert!(p.generation > g);
        p.set_after(0, 99);
        assert_eq!((p.clips[0].before_s, p.clips[0].after_s), (Some(2), Some(CLIP_EDIT_RANGE[1])), "clamped");
        p.set_before(0, -4);
        assert_eq!(p.clips[0].before_s, Some(0));
        p.toggle_event(0, "1000:kill:x");
        assert!(p.clips[0].is_excluded("1000:kill:x"));
        let w = p.clips[0].window(64).unwrap();
        assert_eq!((w.start_tick, w.end_tick, w.kept.clone()), (1300, 1300 + 60 * 64, vec![1]));
        assert_eq!((w.lead_s, w.tail_s), (0.0, 60.0));
        p.toggle(1);
        assert_eq!(p.selected_count(), 2);
        assert_eq!(
            p.selected_clips(),
            json!([{"demo_path": "C:/d/a.dem", "start_tick": 808, "before_s": 0, "after_s": 60, "excluded_events": ["1000:kill:x"]}, {"demo_path": "C:/d/b.dem", "start_tick": 100}])
        );
        p.toggle_event(0, "1000:kill:x");
        assert!(p.clips[0].excluded.is_empty(), "put back: the list empties");
        p.reset(0);
        assert!(!p.clips[0].edited());
        assert_eq!(p.clips[0].window(64).unwrap().start_tick, 808);
        p.toggle_event(1, "5192:damage_target:999");
        assert!(p.clips[1].window(64).is_none());
    }

    #[test]
    fn totals_count_edited_windows() {
        let mut p = Preview::from_ready(&ready());
        assert!((p.total_s() - (620.0 + 320.0 + 320.0) / 64.0).abs() < 1e-9);
        p.toggle_event(1, "5192:damage_target:999");
        assert!((p.total_s() - (620.0 + 320.0) / 64.0).abs() < 1e-9, "a clip with no event left counts 0");
        p.toggle(0);
        assert!((p.total_s() - 320.0 / 64.0).abs() < 1e-9, "an unchecked clip is not recorded");
    }

    #[test]
    fn restore_checks_exactly_the_saved_clips() {
        let mut p = Preview::from_ready(&ready());
        p.set_before(2, 9);
        p.restore(&[ClipEntry { demo_path: "C:/d/a.dem".into(), start_tick: 5000, after_s: Some(4), excluded_events: Some(vec!["k".into()]), ..Default::default() }]);
        assert_eq!(p.clips.iter().map(|c| c.selected).collect::<Vec<_>>(), vec![false, true, false]);
        assert_eq!((p.clips[1].after_s, p.clips[1].excluded.clone()), (Some(4), vec!["k".to_string()]));
        assert!(!p.clips[2].edited(), "others lose their edits");
    }

    #[test]
    fn lanes_and_overlap() {
        let mut p = Preview::from_ready(&ready());
        let lanes = p.lanes();
        assert_eq!(lanes.iter().map(|l| (l.name.as_str(), l.indices.clone())).collect::<Vec<_>>(), vec![("a.dem", vec![0, 1]), ("b.dem", vec![2])]);
        assert!(!p.overlaps_another(&lanes[0], 0));
        p.set_after(0, 60);
        assert!(p.overlaps_another(&lanes[0], 0), "1300 + 60 s reaches 5000");
        p.toggle(1);
        assert!(!p.overlaps_another(&lanes[0], 0), "an unchecked clip is not recorded");
    }

    #[test]
    fn entry_json_keeps_only_present_edits() {
        let e = ClipEntry { demo_path: "d".into(), start_tick: 7, before_s: Some(2), ..Default::default() };
        assert_eq!(e.to_json(), json!({"demo_path": "d", "start_tick": 7, "before_s": 2}));
        assert!(e.edited());
        assert!(!ClipEntry::default().edited());
        assert_eq!(ClipEntry::from_json(&e.to_json()), Some(e));
        assert_eq!(ClipEntry::from_json(&json!({"demo_path": "d", "start_tick": 1, "excluded_events": []})).unwrap().excluded_events, None);
        assert_eq!(ClipEntry::from_json(&json!({"start_tick": 1})), None);
    }

    #[test]
    fn timeline_scale_like_3_5() {
        assert_eq!((clamp_pps(0.001), clamp_pps(3.0), clamp_pps(900.0)), (0.05, 3.0, 40.0));
        // 1 px/s: the first step with 72 px of room is 120 s.
        assert_eq!(ruler_ticks(1.0, -400.0, 500.0, 400.0), vec![0.0, 120.0, 240.0, 360.0]);
        assert_eq!(ruler_ticks(40.0, 4000.0, 4100.0, 1000.0), vec![100.0, 102.0], "2 s steps at 40 px/s, only the window");
        assert_eq!(ruler_ticks(0.05, 0.0, 100.0, 5000.0), vec![0.0, 900.0, 1800.0], "the largest step when none fits");
        // The second under the pointer (300 px into a view scrolled by 100 px, at 2 px/s = 200 s) stays under it.
        let left = zoom_scroll(100.0, 300.0, 2.0, 3.0);
        assert_eq!(left, 300.0);
        assert_eq!((left + 300.0) / 3.0, 200.0);
        assert_eq!(zoom_scroll(0.0, 300.0, 2.0, 1.0), 0.0, "never before the start");
        let p = Preview::from_ready(&ready());
        let lanes = p.lanes();
        assert_eq!(p.span_s(&lanes), 5320.0 / 64.0 + 10.0);
        assert_eq!(p.span_s(&lanes[1..]), 420.0 / 64.0 + 10.0, "the page's own lanes");
    }

    #[test]
    fn words_like_3_5() {
        assert_eq!(format_clock(754.9), "12:34");
        assert_eq!(format_clock(-3.0), "0:00");
        assert_eq!(format_duration(3.4), "0:03.4");
        assert_eq!(format_duration(105.0), "1:45.0");
        assert_eq!(format_total(154.9), "2 min 34 s");
        assert_eq!(demo_name("C:\\x\\y/z.dem"), "z.dem");
        assert_eq!(demo_name(""), "");
        assert_eq!(event_meta("damage_target"), ("🩹 Hit".to_string(), Kind::Damage));
        assert_eq!(event_meta("jump"), ("jump".to_string(), Kind::Other));
    }
}
