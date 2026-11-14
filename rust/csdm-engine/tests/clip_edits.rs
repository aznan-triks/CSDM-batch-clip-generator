//! 3.5 `tests/test_clip_edits.py`, ported: per-clip EDITING edits reach what the run records.

use csdm_core::editing::ClipEntry;
use csdm_core::Settings;
use csdm_engine::preview::clips::{apply_clip_edits, build_sequences, event_key, normalize_clip_selection, Sequence};
use csdm_engine::preview::{Arena, Event, EventId};
use serde_json::{json, Value};

const TR: i64 = 64;
const DP: &str = "d.dem";

fn ev(arena: &mut Arena, v: Value) -> EventId {
    arena.add(Event { fields: serde_json::from_value(v).unwrap(), mf: None })
}

fn kill(arena: &mut Arena, tick: i64, victim: &str) -> EventId {
    ev(arena, json!({"tick": tick, "type": "kill", "killer_sid": "me", "victim_sid": victim}))
}

fn seqs(arena: &Arena, events: &[EventId]) -> Vec<Sequence> {
    build_sequences(arena, events, TR, 3, 2)
}

fn sel(seq: &Sequence, edits: Value) -> Vec<ClipEntry> {
    let mut entry = json!({"demo_path": DP, "start_tick": seq.start_tick});
    entry.as_object_mut().unwrap().extend(edits.as_object().unwrap().clone());
    normalize_clip_selection(Some(&json!([entry]))).unwrap().unwrap()
}

fn victims(arena: &Arena, s: &Sequence) -> Vec<String> {
    s.events.iter().map(|&id| arena.get(id).text("victim_sid")).collect()
}

#[test]
fn no_selection_records_everything_untouched() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "v"), kill(&mut a, 5000, "v")];
    let s = seqs(&a, &e);
    assert_eq!(apply_clip_edits(&a, &s, DP, None, TR), s);
}

#[test]
fn unedited_entry_keeps_the_engine_window() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "v")];
    let s = seqs(&a, &e);
    let out = apply_clip_edits(&a, &s, DP, Some(&sel(&s[0], json!({}))), TR);
    assert_eq!((out[0].start_tick, out[0].end_tick), (s[0].start_tick, s[0].end_tick));
}

#[test]
fn override_start_and_end_in_whole_seconds() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "v")];
    let s = seqs(&a, &e);
    let out = apply_clip_edits(&a, &s, DP, Some(&sel(&s[0], json!({"before_s": 5, "after_s": 7}))), TR);
    assert_eq!((out[0].start_tick, out[0].end_tick), (1000 - 5 * TR, 1000 + 7 * TR));
}

#[test]
fn override_one_side_keeps_the_other() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "v")];
    let s = seqs(&a, &e);
    let out = apply_clip_edits(&a, &s, DP, Some(&sel(&s[0], json!({"after_s": 0}))), TR);
    assert_eq!((out[0].start_tick, out[0].end_tick), (s[0].start_tick, 1000));
}

#[test]
fn zero_seconds_both_sides_is_never_an_empty_clip() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "v")];
    let s = seqs(&a, &e);
    let out = apply_clip_edits(&a, &s, DP, Some(&sel(&s[0], json!({"before_s": 0, "after_s": 0}))), TR);
    assert_eq!(out[0].end_tick - out[0].start_tick, 1);
}

#[test]
fn start_never_goes_below_tick_zero() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 100, "v")];
    let s = seqs(&a, &e);
    let out = apply_clip_edits(&a, &s, DP, Some(&sel(&s[0], json!({"before_s": 15}))), TR);
    assert_eq!(out[0].start_tick, 0);
}

#[test]
fn excluded_clip_is_not_recorded() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "v"), kill(&mut a, 9000, "v")];
    let s = seqs(&a, &e);
    let out = apply_clip_edits(&a, &s, DP, Some(&sel(&s[1], json!({}))), TR);
    assert_eq!(out.iter().map(|q| q.start_tick).collect::<Vec<_>>(), vec![s[1].start_tick]);
}

#[test]
fn selection_of_another_demo_does_not_leak() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "v")];
    let s = seqs(&a, &e);
    let other = normalize_clip_selection(Some(&json!([{"demo_path": "x.dem", "start_tick": s[0].start_tick}]))).unwrap().unwrap();
    assert!(apply_clip_edits(&a, &s, DP, Some(&other), TR).is_empty());
}

#[test]
fn excluded_event_leaves_the_clip_and_moves_its_edge() {
    // Two kills merged into one clip; taking out the first starts the clip at the second, with the same lead.
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "a"), kill(&mut a, 1300, "b")];
    let s = seqs(&a, &e);
    assert_eq!(s[0].events.len(), 2);
    let first = event_key(a.get(s[0].events[0]));
    let out = apply_clip_edits(&a, &s, DP, Some(&sel(&s[0], json!({"excluded_events": [first]}))), TR);
    assert_eq!(victims(&a, &out[0]), vec!["b"]);
    assert_eq!((out[0].start_tick, out[0].end_tick), (1300 - 3 * TR, s[0].end_tick));
    assert_eq!(s[0].events.len(), 2, "the input is not changed");
}

#[test]
fn every_event_excluded_drops_the_clip() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "v")];
    let s = seqs(&a, &e);
    let keys: Vec<String> = s[0].events.iter().map(|&id| event_key(a.get(id))).collect();
    assert!(apply_clip_edits(&a, &s, DP, Some(&sel(&s[0], json!({"excluded_events": keys}))), TR).is_empty());
}

#[test]
fn clips_the_edits_make_overlap_are_joined() {
    // Far apart: the engine's merge rule keeps them separate.
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "a"), kill(&mut a, 1000 + 20 * TR, "b")];
    let s = seqs(&a, &e);
    let selection = normalize_clip_selection(Some(&json!([
        {"demo_path": DP, "start_tick": s[0].start_tick, "after_s": 18},
        {"demo_path": DP, "start_tick": s[1].start_tick},
    ])))
    .unwrap()
    .unwrap();
    let out = apply_clip_edits(&a, &s, DP, Some(&selection), TR);
    assert_eq!(out.len(), 1);
    assert_eq!((out[0].start_tick, out[0].end_tick), (s[0].start_tick, s[1].end_tick));
    assert_eq!(victims(&a, &out[0]), vec!["a", "b"]);
}

#[test]
fn touching_but_not_overlapping_clips_stay_apart() {
    let mut a = Arena::default();
    let e = [kill(&mut a, 1000, "a"), kill(&mut a, 1000 + 20 * TR, "b")];
    let s = seqs(&a, &e);
    let gap_s = (s[1].start_tick - 1000).div_euclid(TR);
    let selection = normalize_clip_selection(Some(&json!([
        {"demo_path": DP, "start_tick": s[0].start_tick, "after_s": gap_s},
        {"demo_path": DP, "start_tick": s[1].start_tick},
    ])))
    .unwrap()
    .unwrap();
    assert_eq!(apply_clip_edits(&a, &s, DP, Some(&selection), TR).len(), 2);
}

#[test]
fn excluded_event_in_a_merged_clip_updates_its_types() {
    let mut a = Arena::default();
    let k = kill(&mut a, 1000, "a");
    let dmg = ev(&mut a, json!({"tick": 1100, "type": "damage_actor", "attacker_sid": "me", "victim_sid": "c"}));
    let s = seqs(&a, &[k, dmg]);
    assert_eq!(s[0].event_types, Some(vec!["damage_actor".to_string(), "kill".to_string()]));
    let out = apply_clip_edits(&a, &s, DP, Some(&sel(&s[0], json!({"excluded_events": [event_key(a.get(dmg))]}))), TR);
    assert_eq!((out[0].event_type.as_str(), out[0].event_types.clone()), ("kill", None));
}

#[test]
fn malformed_selection_fails_fast() {
    for bad in [
        json!("nope"),
        json!([{"start_tick": 1}]),
        json!([{"demo_path": DP, "start_tick": 1, "before_s": -1}]),
        json!([{"demo_path": DP, "start_tick": 1, "after_s": 2.5}]),
        json!([{"demo_path": DP, "start_tick": 1, "after_s": true}]),
        json!([{"demo_path": DP, "start_tick": 1, "excluded_events": "1:kill:v"}]),
    ] {
        assert!(normalize_clip_selection(Some(&bad)).is_err(), "{bad} must be refused");
    }
}

#[test]
fn save_keeps_the_edits_with_the_selection() {
    let clips = json!([{"demo_path": DP, "start_tick": 808, "before_s": 5, "excluded_events": ["1000:kill:v"]}]);
    let mut cfg = Settings::new();
    cfg.insert("before".into(), json!(3));
    let preset = csdm_engine::settings_home::build_preset(&cfg, &["full".to_string()], Some(&clips));
    let stored = preset.get("selected_clips").cloned();
    let got: Vec<Value> = normalize_clip_selection(stored.as_ref()).unwrap().unwrap().iter().map(ClipEntry::to_json).collect();
    assert_eq!(Value::Array(got), clips);
}
