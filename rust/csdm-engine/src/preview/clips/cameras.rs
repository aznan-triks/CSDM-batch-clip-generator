//! Who the camera follows in a clip (3.5 `_camera_players`, `_seq_actor_sid`, `_seq_anchor_sid`,
//! `_build_cams_killer` / `_victim` / `_both`, `build_camera_ticks`, `_seq_cameras`,
//! `_preview_camera_segments`).
//!
//! SteamIDs are compared as 3.5 compares them: a raw event value is "in" the active players only
//! when it is that very text, and is turned into text (`str(x or "")`) only where 3.5 does.

use super::sequences::{raw_sids, whole};
use super::{Segment, Sequence};
use crate::preview::cfg::py_str;
use crate::preview::event::{Arena, Event, EventId};
use crate::EngineError;
use csdm_core::migrate::truthy;
use csdm_core::preview::clips::CAMERA_POST_TICK_DIVISOR;
use csdm_core::Settings;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashSet};

/// `_camera_players`: the active SteamIDs in order (no empty, no repeat) and the primary one.
#[derive(Debug, Clone, Default)]
pub struct CameraPlayers {
    pub list: Vec<String>,
    pub set: HashSet<String>,
    pub primary: String,
}

pub fn camera_players(cfg: &Settings) -> CameraPlayers {
    let mut list: Vec<String> = Vec::new();
    for sid in raw_sids(cfg) {
        let sid = text(Some(&sid));
        if !sid.is_empty() && !list.contains(&sid) {
            list.push(sid);
        }
    }
    let set: HashSet<String> = list.iter().cloned().collect();
    let mut primary = text(cfg.get("steam_id"));
    if !set.contains(&primary) {
        primary = list.first().cloned().unwrap_or(primary);
    }
    CameraPlayers { list, set, primary }
}

/// One camera point: from `tick`, follow `sid` (a raw event value or a SteamID text).
#[derive(Debug, Clone, PartialEq)]
struct Cam {
    tick: i64,
    sid: Value,
}

/// `str(v or "")`.
fn text(v: Option<&Value>) -> String {
    v.filter(|v| truthy(v)).map(py_str).unwrap_or_default()
}

/// Python `a or b` on two optional values.
fn or<'a>(a: Option<&'a Value>, b: Option<&'a Value>) -> Option<&'a Value> {
    if a.is_some_and(truthy) { a } else { b }
}

/// `_seq_actor_sid`: the killer, else the attacker (damage, shots).
fn actor(e: &Event) -> Option<&Value> {
    or(e.get("killer_sid"), e.get("attacker_sid"))
}

/// `value in sids_active`: only that exact text matches.
fn active(v: Option<&Value>, p: &CameraPlayers) -> bool {
    matches!(v, Some(Value::String(s)) if p.set.contains(s))
}

fn sorted<'a, 'b>(arena: &'a Arena, ids: impl Iterator<Item = &'b EventId>) -> Vec<&'a Event> {
    let mut evs: Vec<&Event> = ids.map(|&id| arena.get(id)).collect();
    evs.sort_by_key(|e| e.tick());
    evs
}

/// Events where an active player acts or is the victim, in tick order.
fn involving<'a>(arena: &'a Arena, seq: &Sequence, p: &CameraPlayers) -> Vec<&'a Event> {
    sorted(arena, seq.events.iter().filter(|&&id| active(actor(arena.get(id)), p) || active(arena.get(id).get("victim_sid"), p)))
}

fn is_own_death(e: &Event, p: &CameraPlayers) -> bool {
    e.get("type").and_then(Value::as_str) == Some("death") && active(e.get("victim_sid"), p)
}

/// `_seq_anchor_sid`: first active actor, else first active victim, else the primary player.
fn anchor(arena: &Arena, seq: &Sequence, p: &CameraPlayers) -> String {
    let evs = sorted(arena, seq.events.iter());
    let hit = |key: fn(&Event) -> String| evs.iter().map(|e| key(e)).find(|s| p.set.contains(s));
    hit(|e| text(actor(e))).or_else(|| hit(|e| text(e.get("victim_sid")))).unwrap_or_else(|| p.primary.clone())
}

/// `_build_cams_killer`: follow each active actor, one point per change of actor.
fn cams_killer(arena: &Arena, seq: &Sequence, p: &CameraPlayers) -> Vec<Cam> {
    let acts = sorted(arena, seq.events.iter().filter(|&&id| active(actor(arena.get(id)), p)));
    let Some(first) = acts.first() else {
        let target = if p.set.contains(&p.primary) { p.primary.clone() } else { anchor(arena, seq, p) };
        return vec![Cam { tick: seq.start_tick, sid: Value::String(target) }];
    };
    let mut prev = actor(first).cloned().unwrap_or_default();
    let mut cams = vec![Cam { tick: seq.start_tick, sid: prev.clone() }];
    for e in &acts[1..] {
        let ks = actor(e).cloned().unwrap_or_default();
        if ks != prev {
            cams.push(Cam { tick: e.tick(), sid: ks.clone() });
            prev = ks;
        }
    }
    cams
}

/// The teammate Mate POV stamped on an event, when that filter is on.
fn mate<'a>(e: &'a Event, cfg: &Settings) -> Option<&'a Value> {
    if cfg.get("kill_mod_mate_pov").is_some_and(truthy) { e.get("_mate_pov_sid") } else { None }
}

/// `_build_cams_victim`: one fixed camera, on the first event's victim (or its Mate POV), on the
/// player when the first event is their own death.
fn cams_victim(arena: &Arena, seq: &Sequence, p: &CameraPlayers, cfg: &Settings) -> Vec<Cam> {
    let mut target = Value::String(anchor(arena, seq, p));
    if let Some(first) = involving(arena, seq, p).first() {
        let victim = first.get("victim_sid");
        if is_own_death(first, p) || victim.is_some_and(truthy) {
            let pick = if is_own_death(first, p) { victim } else { or(mate(first, cfg), victim) };
            target = pick.cloned().unwrap_or_default();
        }
    }
    vec![Cam { tick: seq.start_tick, sid: target }]
}

/// `build_camera_ticks`: the clip start, and around each event.
fn camera_ticks(arena: &Arena, seq: &Sequence, tickrate: i64) -> BTreeSet<i64> {
    let pre = tickrate.div_euclid(2).max(1);
    let post = tickrate.div_euclid(CAMERA_POST_TICK_DIVISOR).max(1);
    let mut ticks = BTreeSet::from([seq.start_tick]);
    for &id in &seq.events {
        let t = arena.get(id).tick();
        ticks.insert((t - pre).max(seq.start_tick));
        ticks.insert((t + post).min(seq.end_tick));
    }
    ticks
}

/// `_build_cams_both`: on the killer, switching to the victim (or Mate POV) `victim_pre_ticks`
/// before each kill and back to the next killer right after it.
fn cams_both(arena: &Arena, seq: &Sequence, p: &CameraPlayers, cfg: &Settings, tickrate: i64, victim_pre_ticks: i64) -> Vec<Cam> {
    let evs = involving(arena, seq, p);
    let primary = Value::String(p.primary.clone());
    if evs.is_empty() {
        return vec![Cam { tick: seq.start_tick, sid: primary }];
    }
    let mut initial = Value::String(anchor(arena, seq, p));
    let mut timeline: BTreeMap<i64, Value> = BTreeMap::new();
    for (i, e) in evs.iter().enumerate() {
        if is_own_death(e, p) {
            initial = e.get("victim_sid").cloned().unwrap_or_default();
            timeline.clear();
            break;
        }
        let ksid = or(actor(e), Some(&primary)).cloned().unwrap_or_default();
        let victim_cam = or(e.get("victim_sid"), Some(&primary));
        let vsid = or(mate(e, cfg), victim_cam).cloned().unwrap_or_default();
        if i > 0 && !active(evs[i - 1].get("victim_sid"), p) {
            timeline.entry(evs[i - 1].tick() + 1).or_insert(ksid);
        }
        timeline.insert((e.tick() - victim_pre_ticks).max(seq.start_tick), vsid);
    }
    camera_ticks(arena, seq, tickrate)
        .into_iter()
        .map(|t| Cam { tick: t, sid: timeline.range(..=t).next_back().map_or_else(|| initial.clone(), |(_, s)| s.clone()) })
        .collect()
}

/// `_seq_cameras`: the cameras of one sequence for the settings' perspective.
fn seq_cameras(arena: &Arena, seq: &Sequence, cfg: &Settings, p: &CameraPlayers) -> Result<Vec<Cam>, EngineError> {
    Ok(match cfg.get("perspective").and_then(Value::as_str) {
        Some("both") => {
            let tickrate = whole(cfg, "tickrate", None)?;
            let pre = (whole(cfg, "victim_pre_s", None)? * tickrate).max(0);
            cams_both(arena, seq, p, cfg, tickrate, pre)
        }
        Some("victim") => cams_victim(arena, seq, p, cfg),
        _ => cams_killer(arena, seq, p),
    })
}

/// `_preview_camera_segments`: the cameras with consecutive points on one player folded into a
/// span. `name` = the name read in the demo, else the database's, else "".
pub fn camera_segments(arena: &Arena, seq: &Sequence, cfg: &Settings, p: &CameraPlayers, name: &dyn Fn(&str) -> String) -> Result<Vec<Segment>, EngineError> {
    let mut segments: Vec<Segment> = Vec::new();
    for cam in seq_cameras(arena, seq, cfg, p)? {
        let sid = text(Some(&cam.sid));
        if let Some(last) = segments.last_mut() {
            if last.steam_id == sid {
                continue;
            }
            last.to_tick = cam.tick;
        }
        segments.push(Segment { from_tick: cam.tick, to_tick: seq.end_tick, name: name(&sid), steam_id: sid });
    }
    Ok(segments)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn add(a: &mut Arena, v: Value) -> EventId {
        a.add(Event { fields: serde_json::from_value(v).unwrap(), mf: None })
    }

    fn cfg(v: Value) -> Settings {
        serde_json::from_value(v).unwrap()
    }

    fn seq(start: i64, end: i64, events: Vec<EventId>) -> Sequence {
        Sequence { start_tick: start, end_tick: end, events, ..Default::default() }
    }

    fn segs(a: &Arena, s: &Sequence, c: &Settings) -> Vec<(i64, i64, String)> {
        let p = camera_players(c);
        camera_segments(a, s, c, &p, &|_| String::new()).unwrap().into_iter().map(|g| (g.from_tick, g.to_tick, g.steam_id)).collect()
    }

    #[test]
    fn players_skip_empty_and_repeated_ids() {
        let p = camera_players(&cfg(json!({"steam_ids": ["", "b", "a", "b", null], "steam_id": "z"})));
        assert_eq!(p.list, ["b", "a"]);
        assert_eq!(p.primary, "b", "steam_id not active: first active one");
    }

    #[test]
    fn killer_follows_each_change_of_active_actor() {
        let mut a = Arena::default();
        let ids = vec![
            add(&mut a, json!({"tick": 100, "type": "kill", "killer_sid": "me", "victim_sid": "x"})),
            add(&mut a, json!({"tick": 150, "type": "kill", "killer_sid": "other", "victim_sid": "y"})),
            add(&mut a, json!({"tick": 200, "type": "damage_actor", "attacker_sid": "mate", "victim_sid": "y"})),
            add(&mut a, json!({"tick": 250, "type": "kill", "killer_sid": "me", "victim_sid": "z"})),
        ];
        let c = cfg(json!({"steam_ids": ["me", "mate"]}));
        assert_eq!(segs(&a, &seq(10, 400, ids), &c), [(10, 200, "me".into()), (200, 250, "mate".into()), (250, 400, "me".into())]);
    }

    #[test]
    fn killer_without_active_actor_falls_back_to_the_primary_player() {
        let mut a = Arena::default();
        let ids = vec![add(&mut a, json!({"tick": 100, "type": "death", "killer_sid": "x", "victim_sid": "me"}))];
        assert_eq!(segs(&a, &seq(10, 400, ids), &cfg(json!({"steam_ids": ["me"]}))), [(10, 400, "me".into())]);
    }

    #[test]
    fn a_number_is_not_an_active_text_id() {
        // 3.5 `76561 in {"76561"}` is False: the event does not count as the player's.
        let mut a = Arena::default();
        let ids = vec![add(&mut a, json!({"tick": 100, "type": "kill", "killer_sid": 5, "victim_sid": "x"}))];
        let c = cfg(json!({"steam_ids": ["5"], "perspective": "victim"}));
        assert_eq!(segs(&a, &seq(0, 9, ids), &c), [(0, 9, "5".into())], "anchor matches the text form");
    }

    #[test]
    fn victim_follows_the_first_victim_or_its_mate_or_the_player_who_dies() {
        let mut a = Arena::default();
        let kill = add(&mut a, json!({"tick": 100, "type": "kill", "killer_sid": "me", "victim_sid": "x", "_mate_pov_sid": "m"}));
        let c = cfg(json!({"steam_ids": ["me"], "perspective": "victim"}));
        assert_eq!(segs(&a, &seq(0, 9, vec![kill]), &c), [(0, 9, "x".into())]);
        let c = cfg(json!({"steam_ids": ["me"], "perspective": "victim", "kill_mod_mate_pov": true}));
        assert_eq!(segs(&a, &seq(0, 9, vec![kill]), &c), [(0, 9, "m".into())]);
        let death = add(&mut a, json!({"tick": 50, "type": "death", "killer_sid": "k", "victim_sid": "me"}));
        assert_eq!(segs(&a, &seq(0, 9, vec![kill, death]), &c), [(0, 9, "me".into())]);
    }

    #[test]
    fn both_switches_to_the_victim_before_each_kill_and_back_after() {
        let mut a = Arena::default();
        let ids = vec![
            add(&mut a, json!({"tick": 1000, "type": "kill", "killer_sid": "me", "victim_sid": "x"})),
            add(&mut a, json!({"tick": 1500, "type": "kill", "killer_sid": "me", "victim_sid": "y"})),
        ];
        // tickrate 64, victim_pre_s 2 → switch 128 ticks before; camera ticks around events: -32 / +8.
        let c = cfg(json!({"steam_ids": ["me"], "perspective": "both", "tickrate": 64, "victim_pre_s": 2}));
        assert_eq!(segs(&a, &seq(700, 1800, ids), &c), [(700, 968, "me".into()), (968, 1008, "x".into()), (1008, 1468, "me".into()), (1468, 1800, "y".into())]);
    }

    #[test]
    fn both_follows_the_player_from_the_start_when_they_die() {
        let mut a = Arena::default();
        let ids = vec![
            add(&mut a, json!({"tick": 1000, "type": "kill", "killer_sid": "me", "victim_sid": "x"})),
            add(&mut a, json!({"tick": 1100, "type": "death", "killer_sid": "k", "victim_sid": "me"})),
        ];
        let c = cfg(json!({"steam_ids": ["me"], "perspective": "both", "tickrate": 64, "victim_pre_s": 2}));
        // The timeline is built from the kill before the death is met, then cleared.
        assert_eq!(segs(&a, &seq(700, 1800, ids), &c), [(700, 1800, "me".into())]);
    }
}
