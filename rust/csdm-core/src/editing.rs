//! The EDITING tab's clips and their per-clip edits (3.5 `csdm/engine/clip_edits.py` and its
//! renderer mirror `tabs/editing/clipEdits.ts`, kept here once): the engine's recording path and
//! the window both call [`edited_window`].
//!
//! A clip is addressed by `(demo_path, start_tick)`, the start the preview computed before any
//! edit. An edit may set `before_s` / `after_s` (whole seconds before the first kept event /
//! after the last one) and take events out (`excluded_events`, by `event_key`).

use serde_json::{json, Map, Value};

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
        todo!()
    }

    /// The entry as 3.5 holds it: only the edit fields present.
    pub fn to_json(&self) -> Value {
        todo!()
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
pub fn edited_window(start_tick: i64, end_tick: i64, ticks: &[i64], kept: &[bool], before_s: Option<i64>, after_s: Option<i64>, edited: bool, tickrate: i64) -> Option<Window> {
    let _ = (start_tick, end_tick, ticks, kept, before_s, after_s, edited, tickrate);
    todo!()
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
        let _ = v;
        todo!()
    }
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
        todo!()
    }

    pub fn is_excluded(&self, key: &str) -> bool {
        let _ = key;
        todo!()
    }

    /// 3.5 `editedWindow`; `None` when every event was taken out.
    pub fn window(&self, tickrate: i64) -> Option<EditedWindow> {
        let _ = tickrate;
        todo!()
    }

    /// 3.5 `clipPayload`.
    pub fn entry(&self) -> ClipEntry {
        todo!()
    }
}

/// Why the last preview found no clip (engine `explain_empty_result`).
#[derive(Debug, Clone, PartialEq)]
pub struct EmptyReason {
    pub headline: String,
    pub hint: String,
    pub stages: Vec<(String, f64)>,
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
        let _ = payload;
        todo!()
    }

    pub fn selected_count(&self) -> usize {
        todo!()
    }

    /// Seconds the run records: edited windows, clips with no event left at 0 (3.5 `durations`).
    pub fn total_s(&self) -> f64 {
        todo!()
    }

    pub fn toggle(&mut self, index: usize) {
        let _ = index;
        todo!()
    }

    /// `editClip(index, {beforeS})`, clamped to [`CLIP_EDIT_RANGE`].
    pub fn set_before(&mut self, index: usize, seconds: i64) {
        let _ = (index, seconds);
        todo!()
    }

    pub fn set_after(&mut self, index: usize, seconds: i64) {
        let _ = (index, seconds);
        todo!()
    }

    /// `editClip(index, null)`.
    pub fn reset(&mut self, index: usize) {
        let _ = index;
        todo!()
    }

    /// `toggleClipEvent`.
    pub fn toggle_event(&mut self, index: usize, key: &str) {
        let _ = (index, key);
        todo!()
    }

    /// `restoreClipSelection`: exactly the saved clips checked, each with its saved edits; every
    /// other clip unchecked, unedited.
    pub fn restore(&mut self, saved: &[ClipEntry]) {
        let _ = saved;
        todo!()
    }

    /// The checked clips with their edits, as `start_run` / `save_preset` take them.
    pub fn selected_clips(&self) -> Value {
        todo!()
    }

    /// `buildLanes`: clips grouped by demo, in the order the preview listed the demos.
    pub fn lanes(&self) -> Vec<Lane> {
        todo!()
    }

    /// `overlapsAnother`: this clip, as edited, overlaps another checked clip of its demo (the
    /// engine then records the two as one).
    pub fn overlaps_another(&self, lane: &Lane, index: usize) -> bool {
        let _ = (lane, index);
        todo!()
    }
}

/// `demoName`: the file name of a demo path.
pub fn demo_name(path: &str) -> &str {
    let _ = path;
    todo!()
}

/// `formatClock`: demo time as M:SS.
pub fn format_clock(seconds: f64) -> String {
    let _ = seconds;
    todo!()
}

/// `formatDuration`: M:SS.t.
pub fn format_duration(seconds: f64) -> String {
    let _ = seconds;
    todo!()
}

/// `formatTotal`: "2 min 34 s".
pub fn format_total(seconds: f64) -> String {
    let _ = seconds;
    todo!()
}

/// Visual family of an event type (3.5 `EVENT_TYPE_META.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind { Kill, Damage, Shot, Other }

/// `eventTypeMeta`: the badge words and family; an unknown type shows itself under `Other`.
pub fn event_meta(kind: &str) -> (String, Kind) {
    let _ = kind;
    todo!()
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
