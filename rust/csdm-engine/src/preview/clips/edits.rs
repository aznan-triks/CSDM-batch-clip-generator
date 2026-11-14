//! Per-clip edits from the EDITING tab (3.5 `csdm/engine/clip_edits.py`), and the two commands
//! that read them against the last preview (`edited_clip_cameras`, `preset_clip_selection`).
//!
//! A clip is addressed by `(demo_path, start_tick)`, the start `build_sequences` computed before any
//! edit. An entry may carry `before_s` / `after_s` (whole seconds around the first / last kept
//! event) and `excluded_events` (`event_key`s taken out). The renderer mirrors this arithmetic
//! (`electron/renderer/src/tabs/editing/clipEdits.ts` in 3.5).

use super::cameras::{camera_players, camera_segments};
use super::sequences::whole;
use super::{names_for, player_names, py_int, LastPreview, Segment, Sequence};
use crate::event::Level;
use crate::preview::cfg::py_str;
use crate::preview::event::{Arena, Event};
use crate::preview::Ports;
use crate::EngineError;
use csdm_core::migrate::truthy;
use csdm_db::Discovery;
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};

/// `event_key`: tick, type and victim, the name the renderer hands back for one event.
pub fn event_key(e: &Event) -> String {
    let tick = e.get("tick").map_or(0, |t| py_int(t).expect("an event tick is a whole number"));
    let kind = e.get("type").map_or_else(|| "kill".to_string(), py_str);
    let victim = e.get("victim_sid").filter(|v| truthy(v)).map(py_str).unwrap_or_default();
    format!("{tick}:{kind}:{victim}")
}

/// One checked `selected_clips` entry (`normalize_clip_selection` output).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ClipEntry {
    pub demo_path: String,
    pub start_tick: i64,
    pub before_s: Option<i64>,
    pub after_s: Option<i64>,
    pub excluded_events: Option<Vec<String>>,
}

impl ClipEntry {
    fn edited(&self) -> bool {
        self.before_s.is_some() || self.after_s.is_some() || self.excluded_events.is_some()
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

fn bad(message: String) -> EngineError {
    EngineError::User(message)
}

/// `_whole_seconds`: absent or null → none; else a whole number of seconds ≥ 0.
fn whole_seconds(entry: &Map<String, Value>, field: &str) -> Result<Option<i64>, EngineError> {
    let Some(v) = entry.get(field).filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    match v.as_f64() {
        Some(f) if f >= 0.0 && f.fract() == 0.0 => Ok(Some(f as i64)),
        _ => Err(bad(format!("selected_clips: `{field}` must be a whole number of seconds >= 0, got {}", py_str(v)))),
    }
}

/// `normalize_clip_selection`: GENERATE's selection checked once (`None` stays `None`).
pub fn normalize_clip_selection(selected: Option<&Value>) -> Result<Option<Vec<ClipEntry>>, EngineError> {
    let Some(selected) = selected.filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let Value::Array(entries) = selected else {
        return Err(bad("selected_clips must be a list".into()));
    };
    let mut out = Vec::new();
    for entry in entries {
        let needs = || bad(format!("selected_clips: every entry needs demo_path and start_tick, got {entry}"));
        let Value::Object(m) = entry else { return Err(needs()) };
        let (Some(dp), Some(st)) = (m.get("demo_path"), m.get("start_tick")) else { return Err(needs()) };
        // 3.5 `int(x)`: a value it cannot convert stops the selection, as a bad entry does.
        let start_tick = py_int(st).ok_or_else(|| bad(format!("selected_clips: `start_tick` must be a whole number, got {}", py_str(st))))?;
        let (before_s, after_s) = (whole_seconds(m, "before_s")?, whole_seconds(m, "after_s")?);
        let excluded_events = match m.get("excluded_events").filter(|v| truthy(v)) {
            None => None,
            Some(Value::Array(keys)) => Some(keys.iter().map(py_str).collect()),
            Some(_) => return Err(bad("selected_clips: `excluded_events` must be a list of event keys".into())),
        };
        out.push(ClipEntry { demo_path: py_str(dp), start_tick, before_s, after_s, excluded_events });
    }
    Ok(Some(out))
}

fn kinds<'a>(arena: &'a Arena, events: &[usize]) -> BTreeSet<&'a str> {
    events.iter().map(|&id| arena.get(id).kind()).collect()
}

/// `_edited`: one sequence with its entry's edits; `None` when every event was taken out.
fn edited(arena: &Arena, seq: &Sequence, entry: &ClipEntry, tickrate: i64) -> Option<Sequence> {
    let excluded: HashSet<&str> = entry.excluded_events.iter().flatten().map(String::as_str).collect();
    let kept: Vec<usize> = seq.events.iter().copied().filter(|&id| !excluded.contains(event_key(arena.get(id)).as_str())).collect();
    let (&first_kept, &last_kept) = (kept.first()?, kept.last()?);
    if !entry.edited() {
        return Some(seq.clone());
    }
    // Unedited sides keep the lead / tail measured from the first / last event of the clip.
    let (first, last) = (arena.get(seq.events[0]).tick(), arena.get(seq.events[seq.events.len() - 1]).tick());
    let lead = entry.before_s.map_or(first - seq.start_tick, |s| s * tickrate);
    let tail = entry.after_s.map_or(seq.end_tick - last, |s| s * tickrate);
    let start = (arena.get(first_kept).tick() - lead).max(0);
    let end = (arena.get(last_kept).tick() + tail).max(start + 1);
    let types = kinds(arena, &kept);
    let event_type = arena.get(first_kept).get("type").map_or_else(|| seq.event_type.clone(), py_str);
    let mut out = Sequence { start_tick: start, end_tick: end, event_type, ..seq.clone() };
    out.event_types = (types.len() > 1).then(|| types.into_iter().map(String::from).collect());
    out.events = kept;
    Some(out)
}

/// `apply_clip_edits`: the sequences of one demo a run records once edited; clips the edits make
/// overlap are joined. `None` records every sequence untouched.
pub fn apply_clip_edits(arena: &Arena, seqs: &[Sequence], demo_path: &str, selected: Option<&[ClipEntry]>, tickrate: i64) -> Vec<Sequence> {
    let Some(selected) = selected else {
        return seqs.to_vec();
    };
    let by_start: HashMap<i64, &ClipEntry> = selected.iter().filter(|e| e.demo_path == demo_path).map(|e| (e.start_tick, e)).collect();
    let mut clips: Vec<Sequence> = seqs.iter().filter_map(|s| by_start.get(&s.start_tick).and_then(|e| edited(arena, s, e, tickrate))).collect();
    clips.sort_by_key(|s| s.start_tick);
    let mut merged: Vec<Sequence> = Vec::new();
    for clip in clips {
        match merged.last_mut() {
            Some(prev) if clip.start_tick < prev.end_tick => {
                let mut events = [prev.events.as_slice(), clip.events.as_slice()].concat();
                events.sort_by_key(|&id| arena.get(id).tick());
                let types = kinds(arena, &events);
                prev.end_tick = prev.end_tick.max(clip.end_tick);
                if types.len() > 1 {
                    prev.event_types = Some(types.into_iter().map(String::from).collect());
                }
                prev.events = events;
            }
            _ => merged.push(clip),
        }
    }
    merged
}

/// `edited_clip_cameras`: who the camera follows in one EDITING clip once edited; `None` when every
/// event was taken out.
pub fn edited_clip_cameras(last: Option<&LastPreview>, disc: &Discovery, entry: &Value) -> Result<Option<Vec<Segment>>, EngineError> {
    let last = last.ok_or_else(|| bad("Run a PREVIEW first: there is no clip to edit yet.".into()))?;
    let clean = normalize_clip_selection(Some(&Value::Array(vec![entry.clone()])))?.into_iter().flatten().next().expect("one entry in, one out");
    let own: Vec<Sequence> = last.seqs.get(&clean.demo_path).into_iter().flatten().filter(|s| s.start_tick == clean.start_tick).cloned().collect();
    if own.is_empty() {
        return Err(bad("This clip is not in the last PREVIEW any more: run PREVIEW again.".into()));
    }
    let tickrate = whole(&last.cfg, "tickrate", None)?;
    let edited = apply_clip_edits(&last.arena, &own, &clean.demo_path, Some(std::slice::from_ref(&clean)), tickrate);
    let Some(seq) = edited.first() else {
        return Ok(None);
    };
    let db_names = player_names(disc);
    let names = names_for(last.demo_names.get(&clean.demo_path), &db_names);
    camera_segments(&last.arena, seq, &last.cfg, &camera_players(&last.cfg), &names).map(Some)
}

/// `preset_clip_selection`: the preset's EDITING entries whose clip the last preview listed, or
/// `None` when there is nothing to restore; says in the console what happened either way.
pub fn preset_clip_selection(ports: &dyn Ports, last: Option<&LastPreview>, preset_name: &str, selected_clips: Option<&Value>) -> Option<Vec<ClipEntry>> {
    if !selected_clips.is_some_and(truthy) {
        ports.log(&format!("Preset '{preset_name}' holds no EDITING clip selection: the EDITING tab keeps its own."), Level::Dim);
        return None;
    }
    let Ok(wanted) = normalize_clip_selection(selected_clips) else {
        // A hand-edited presets file must not stop its settings loading.
        ports.log(&format!("Preset '{preset_name}': its EDITING clip selection is unreadable and was ignored; its settings were loaded."), Level::Warn);
        return None;
    };
    let wanted = wanted.unwrap_or_default();
    let count = wanted.len();
    let Some(last) = last else {
        ports.log(
            &format!("Preset '{preset_name}' holds an EDITING selection of {count} clip(s): run PREVIEW with its settings, then load the preset again to restore it."),
            Level::Warn,
        );
        return None;
    };
    let listed: HashSet<(&str, i64)> = last.seqs.iter().flat_map(|(dp, ss)| ss.iter().map(move |s| (dp.as_str(), s.start_tick))).collect();
    let matched: Vec<ClipEntry> = wanted.into_iter().filter(|e| listed.contains(&(e.demo_path.as_str(), e.start_tick))).collect();
    if matched.is_empty() {
        ports.log(
            &format!(
                "None of the {count} clip(s) saved in preset '{preset_name}' is in the current PREVIEW (other settings or demos): the EDITING selection was left as it was. Run PREVIEW with the preset's settings, then load it again."
            ),
            Level::Warn,
        );
        return None;
    }
    let missing = count - matched.len();
    let mut message = format!("Preset '{preset_name}': EDITING selection restored ({} clip(s) checked, with their edits).", matched.len());
    if missing > 0 {
        message.push_str(&format!(" {missing} saved clip(s) are not in this PREVIEW and were skipped."));
    }
    ports.log(&message, if missing > 0 { Level::Warn } else { Level::Ok });
    Some(matched)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::CollectPorts;
    use serde_json::json;

    fn add(a: &mut Arena, tick: i64, kind: &str, victim: &str) -> usize {
        a.add(Event { fields: serde_json::from_value(json!({"tick": tick, "type": kind, "victim_sid": victim})).unwrap(), mf: None })
    }

    fn norm(v: Value) -> Result<Option<Vec<ClipEntry>>, EngineError> {
        normalize_clip_selection(Some(&v))
    }

    #[test]
    fn keys_and_entries_like_3_5() {
        let mut a = Arena::default();
        let e = add(&mut a, 12, "kill", "");
        assert_eq!(event_key(a.get(e)), "12:kill:");
        assert_eq!(norm(json!(null)).unwrap(), None);
        let got = norm(json!([{"demo_path": "d", "start_tick": 7.9, "before_s": 2.0, "after_s": null, "excluded_events": []}])).unwrap().unwrap();
        assert_eq!(got[0].to_json(), json!({"demo_path": "d", "start_tick": 7, "before_s": 2}));
        assert!(norm(json!([{"demo_path": "d", "start_tick": 1, "before_s": 1.5}])).is_err());
        assert!(norm(json!([{"demo_path": "d", "start_tick": 1, "after_s": true}])).is_err(), "a bool is not seconds");
        assert!(norm(json!([{"demo_path": "d", "start_tick": 1, "before_s": -1}])).is_err());
        assert!(norm(json!([{"demo_path": "d"}])).is_err());
        assert!(norm(json!({"demo_path": "d"})).is_err());
    }

    #[test]
    fn excluding_the_first_event_moves_the_start_with_it() {
        let mut a = Arena::default();
        let (k1, k2) = (add(&mut a, 1000, "kill", "x"), add(&mut a, 1300, "death", "me"));
        let seq = Sequence { start_tick: 808, end_tick: 1620, events: vec![k1, k2], event_type: "kill".into(), event_types: Some(vec!["death".into(), "kill".into()]), ..Default::default() };
        let entry = ClipEntry { demo_path: "d".into(), start_tick: 808, excluded_events: Some(vec!["1000:kill:x".into()]), ..Default::default() };
        let out = apply_clip_edits(&a, std::slice::from_ref(&seq), "d", Some(&[entry]), 64);
        assert_eq!((out[0].start_tick, out[0].end_tick, out[0].events.clone()), (1108, 1620, vec![k2]));
        assert_eq!((out[0].event_type.as_str(), out[0].event_types.clone()), ("death", None));
        let all_out = ClipEntry { demo_path: "d".into(), start_tick: 808, excluded_events: Some(vec!["1000:kill:x".into(), "1300:death:me".into()]), ..Default::default() };
        assert!(apply_clip_edits(&a, std::slice::from_ref(&seq), "d", Some(&[all_out]), 64).is_empty());
        let handles = ClipEntry { demo_path: "d".into(), start_tick: 808, before_s: Some(1), after_s: Some(2), ..Default::default() };
        let out = apply_clip_edits(&a, &[seq], "d", Some(&[handles]), 64);
        assert_eq!((out[0].start_tick, out[0].end_tick), (936, 1428));
    }

    #[test]
    fn overlapping_edited_clips_are_joined() {
        let mut a = Arena::default();
        let (k1, k2) = (add(&mut a, 100, "kill", "x"), add(&mut a, 300, "shot", ""));
        let s1 = Sequence { start_tick: 50, end_tick: 150, events: vec![k1], event_type: "kill".into(), ..Default::default() };
        let s2 = Sequence { start_tick: 250, end_tick: 350, events: vec![k2], event_type: "shot".into(), ..Default::default() };
        let sel = [
            ClipEntry { demo_path: "d".into(), start_tick: 50, after_s: Some(3), ..Default::default() },
            ClipEntry { demo_path: "d".into(), start_tick: 250, ..Default::default() },
        ];
        let out = apply_clip_edits(&a, &[s1, s2], "d", Some(&sel), 64);
        assert_eq!(out.len(), 1);
        assert_eq!((out[0].start_tick, out[0].end_tick, out[0].events.clone()), (50, 350, vec![k1, k2]));
        assert_eq!(out[0].event_types, Some(vec!["kill".into(), "shot".into()]));
    }

    #[test]
    fn preset_selection_keeps_only_listed_clips() {
        let ports = CollectPorts::default();
        assert_eq!(preset_clip_selection(&ports, None, "p", Some(&json!([]))), None);
        assert_eq!(preset_clip_selection(&ports, None, "p", Some(&json!("x"))), None);
        let mut last = LastPreview::default();
        last.seqs.insert("d".into(), vec![Sequence { start_tick: 5, ..Default::default() }]);
        let sel = json!([{"demo_path": "d", "start_tick": 5}, {"demo_path": "d", "start_tick": 6}]);
        let got = preset_clip_selection(&ports, Some(&last), "p", Some(&sel)).unwrap();
        assert_eq!(got.len(), 1);
        let logs = ports.logs.lock().unwrap();
        assert_eq!(logs.len(), 3);
        assert!(logs[2].0.ends_with("1 saved clip(s) are not in this PREVIEW and were skipped.") && logs[2].1 == Level::Warn);
    }
}
