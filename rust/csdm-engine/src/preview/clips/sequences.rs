//! Clip sequences and the preview summary (3.5 `_effective_before`, `_build_sequences`,
//! `_calc_summary`, `_sequence_totals`, `_summary_counts`, `_fmt_summary`, `_hms`, `_player_str`).

use super::{py_int, Sequence, Sequences};
use crate::preview::cfg::py_str;
use crate::preview::event::{Arena, DemoEvents, EventId};
use crate::EngineError;
use csdm_core::migrate::truthy;
use csdm_core::preview::clips::{SECONDS_PER_HOUR, SECONDS_PER_MINUTE};
use csdm_core::settings::def;
use csdm_core::Settings;
use csdm_db::Dict;
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// `cfg.get(key, default)` read as a whole number; `default` = the settings table's when `None`.
pub(crate) fn whole(cfg: &Settings, key: &str, default: Option<i64>) -> Result<i64, EngineError> {
    let table = || def(key).and_then(|d| d.default.as_i64()).expect("a whole-number setting has a whole default");
    match cfg.get(key) {
        None => Ok(default.unwrap_or_else(table)),
        Some(v) => py_int(v)
            .filter(|_| v.as_f64().is_none_or(|f| f.fract() == 0.0))
            .ok_or_else(|| EngineError::User(format!("The setting `{key}` must be a whole number, not {}.", py_str(v)))),
    }
}

/// `_effective_before`: in "both" mode the victim lead time is added, so the killer phase fits.
pub fn effective_before(cfg: &Settings) -> Result<i64, EngineError> {
    let before = whole(cfg, "before", None)?;
    if cfg.get("perspective").and_then(Value::as_str) == Some("both") {
        return Ok(before + whole(cfg, "victim_pre_s", Some(0))?.max(0));
    }
    Ok(before)
}

/// `_build_sequences`: one window per event (stable tick order), merged while the gap to the
/// previous window is at most the lead time. A clutch event brings its own bounds.
pub fn build_sequences(arena: &Arena, events: &[EventId], tickrate: i64, before_s: i64, after_s: i64) -> Vec<Sequence> {
    let mut events = events.to_vec();
    events.sort_by_key(|&id| arena.get(id).tick());
    let (bt, at) = (before_s * tickrate, after_s * tickrate);
    let mut merged: Vec<Sequence> = Vec::new();
    for id in events {
        let e = arena.get(id);
        let (start, end) = match (e.get("_seq_start_tick"), e.get("_seq_end_tick")) {
            (Some(s), Some(t)) => {
                let s = py_int(s).expect("clutch bounds are whole ticks").max(0);
                (s, py_int(t).expect("clutch bounds are whole ticks").max(s + 1))
            }
            _ => ((e.tick() - bt).max(0), e.tick() + at),
        };
        match merged.last_mut() {
            Some(p) if start - p.end_tick <= bt => {
                p.end_tick = p.end_tick.max(end);
                p.events.push(id);
                // Correction (i): every type of the merged events, not the last pair only.
                let types: BTreeSet<&str> = p.events.iter().map(|&i| arena.get(i).kind()).collect();
                p.event_types = Some(types.into_iter().map(String::from).collect());
            }
            _ => merged.push(Sequence { start_tick: start, end_tick: end, events: vec![id], event_type: e.kind().to_string(), ..Default::default() }),
        }
    }
    merged
}

/// `_sequence_totals`: (clips, total seconds, average seconds).
pub fn sequence_totals(seqs: &Sequences, tickrate: i64) -> (usize, f64, f64) {
    let nb_clips: usize = seqs.values().map(Vec::len).sum();
    let ticks: i64 = seqs.values().flatten().map(|s| s.end_tick - s.start_tick).sum();
    let total = if tickrate != 0 { ticks as f64 / tickrate as f64 } else { 0.0 };
    let avg = if nb_clips != 0 { total / nb_clips as f64 } else { 0.0 };
    (nb_clips, total, avg)
}

/// `_calc_summary`: (demos, clips, total seconds, average seconds) of events not yet sequenced.
pub fn calc_summary(arena: &Arena, all_events: &DemoEvents, cfg: &Settings) -> Result<(usize, usize, f64, f64), EngineError> {
    let tickrate = whole(cfg, "tickrate", None)?;
    let (before, after) = (effective_before(cfg)?, whole(cfg, "after", None)?);
    let seqs: Sequences = all_events.iter().map(|(dp, evs)| (dp.clone(), build_sequences(arena, evs, tickrate, before, after))).collect();
    let (nb_clips, total, avg) = sequence_totals(&seqs, tickrate);
    Ok((all_events.len(), nb_clips, total, avg))
}

/// `_summary_counts`: the summary's numbers, for the counter strip.
pub fn summary_counts(nb_demos: usize, nb_clips: usize, total_sec: f64, avg_sec: f64) -> Value {
    json!({"demos": nb_demos, "clips": nb_clips, "total_s": total_sec, "avg_s": avg_sec})
}

/// `_hms`: whole seconds as `12s`, `3m04s` or `1h02m03s`.
pub fn hms(seconds: f64) -> String {
    let s = seconds.trunc() as i64;
    if s < SECONDS_PER_MINUTE {
        return format!("{s}s");
    }
    if s < SECONDS_PER_HOUR {
        return format!("{}m{:02}s", s / SECONDS_PER_MINUTE, s % SECONDS_PER_MINUTE);
    }
    format!("{}h{:02}m{:02}s", s / SECONDS_PER_HOUR, (s % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE, s % SECONDS_PER_MINUTE)
}

/// `_fmt_summary`.
pub fn fmt_summary(nb_demos: usize, nb_clips: usize, total_sec: f64, avg_sec: f64) -> String {
    let plural = |n: usize| if n != 1 { "s" } else { "" };
    format!(
        "  {nb_clips} clip{}  •  total duration {}  •  avg. {}/clip  •  {nb_demos} demo{}",
        plural(nb_clips),
        hms(total_sec),
        hms(avg_sec),
        plural(nb_demos)
    )
}

/// `_get_sids`: `steam_ids`, else `[steam_id]`, as 3.5 holds them (raw values).
pub(crate) fn raw_sids(cfg: &Settings) -> Vec<Value> {
    match cfg.get("steam_ids") {
        Some(Value::Array(a)) if !a.is_empty() => a.clone(),
        _ => cfg.get("steam_id").filter(|v| truthy(v)).map(|v| vec![v.clone()]).unwrap_or_default(),
    }
}

/// `_player_str`: who the preview is for, as the export header shows it.
pub fn player_str(cfg: &Settings, player_names: &Dict<String>) -> String {
    let name = |sid: &Value| {
        let sid = py_str(sid);
        player_names.iter().find(|(k, _)| *k == sid).map_or(sid.clone(), |(_, n)| n.clone())
    };
    match raw_sids(cfg).as_slice() {
        [] => "—".into(),
        [one] => {
            let pn = cfg.get("player_name").filter(|v| truthy(v)).map_or_else(|| name(one), py_str);
            format!("{pn} ({})", py_str(one))
        }
        many => many.iter().map(name).collect::<Vec<_>>().join("  +  "),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::event::Event;

    fn ev(arena: &mut Arena, tick: i64, kind: &str) -> EventId {
        let mut e = Event::default();
        e.set("tick", tick);
        e.set("type", kind);
        arena.add(e)
    }

    fn cfg(v: Value) -> Settings {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn windows_merge_within_one_lead_time_and_keep_every_type() {
        let mut a = Arena::default();
        // tickrate 1, before 2, after 3: windows [8,13] [13,18] [20,25] [40,45]
        let ids = [ev(&mut a, 15, "death"), ev(&mut a, 10, "kill"), ev(&mut a, 22, "shot"), ev(&mut a, 42, "kill")];
        let seqs = build_sequences(&a, &ids, 1, 2, 3);
        assert_eq!(seqs.len(), 2);
        assert_eq!((seqs[0].start_tick, seqs[0].end_tick), (8, 25));
        assert_eq!(seqs[0].events, vec![ids[1], ids[0], ids[2]]);
        assert_eq!(seqs[0].event_type, "kill");
        assert_eq!(seqs[0].event_types, Some(vec!["death".into(), "kill".into(), "shot".into()]), "correction (i)");
        assert_eq!(seqs[1].event_types, None, "a lone window has no event_types");
    }

    #[test]
    fn clutch_bounds_win_and_start_never_goes_below_zero() {
        let mut a = Arena::default();
        let c = ev(&mut a, 50, "clutch_round");
        a.get_mut(c).set("_seq_start_tick", -5);
        a.get_mut(c).set("_seq_end_tick", -9);
        let k = ev(&mut a, 1, "kill");
        let seqs = build_sequences(&a, &[c, k], 64, 3, 5);
        assert_eq!((seqs[0].start_tick, seqs[0].end_tick), (0, 321), "kill window first, clutch merged");
        let alone = build_sequences(&a, &[c], 64, 3, 5);
        assert_eq!((alone[0].start_tick, alone[0].end_tick), (0, 1));
    }

    #[test]
    fn both_mode_adds_the_victim_lead() {
        assert_eq!(effective_before(&cfg(json!({"before": 3, "perspective": "both", "victim_pre_s": -4}))).unwrap(), 3);
        assert_eq!(effective_before(&cfg(json!({"before": 3, "perspective": "both", "victim_pre_s": 2}))).unwrap(), 5);
        assert_eq!(effective_before(&cfg(json!({"perspective": "both"}))).unwrap(), 3, "victim_pre_s defaults to 0 here");
        assert!(effective_before(&cfg(json!({"before": "x"}))).is_err());
    }

    #[test]
    fn summary_reads_like_3_5() {
        assert_eq!(hms(59.9), "59s");
        assert_eq!(hms(3599.0), "59m59s");
        assert_eq!(hms(3723.0), "1h02m03s");
        assert_eq!(fmt_summary(1, 1, 12.0, 12.0), "  1 clip  •  total duration 12s  •  avg. 12s/clip  •  1 demo");
        let mut seqs = Sequences::new();
        seqs.insert("a".into(), vec![Sequence { start_tick: 0, end_tick: 64, ..Default::default() }, Sequence { start_tick: 0, end_tick: 32, ..Default::default() }]);
        assert_eq!(sequence_totals(&seqs, 64), (2, 1.5, 0.75));
        assert_eq!(sequence_totals(&Sequences::new(), 0), (0, 0.0, 0.0));
    }

    #[test]
    fn player_string() {
        let names: Dict<String> = vec![("1".into(), "One".into())];
        assert_eq!(player_str(&cfg(json!({})), &names), "—");
        assert_eq!(player_str(&cfg(json!({"steam_ids": ["1"]})), &names), "One (1)");
        assert_eq!(player_str(&cfg(json!({"steam_ids": ["1"], "player_name": "Me"})), &names), "Me (1)");
        assert_eq!(player_str(&cfg(json!({"steam_id": "2"})), &names), "2 (2)");
        assert_eq!(player_str(&cfg(json!({"steam_ids": ["1", "2"]})), &names), "One  +  2");
    }
}
