//! Clutch filter (3.5 `_clutch_windows_for` and what it calls). A window is one round in which a
//! tracked player was the last one alive on his team. Sources: CSDM's `clutches` table first
//! (`_fetch_native_clutches`), else windows rebuilt from every kill of the demo
//! (`_fetch_all_kills_for_demos` + `_detect_clutch_windows_from_kills`). `_apply_clutch_windows`
//! then applies size / wins-only / mode to either.

use super::{float_cfg, int_cfg, int_db, tie, Ctx};
use crate::event::Level;
use crate::preview::cfg;
use crate::preview::event::{Event, EventId};
use crate::preview::DemoEvents;
use crate::EngineError;
use csdm_core::preview::sql::{CLUTCH_AFTER_S_DEFAULT, CLUTCH_BEFORE_S_DEFAULT, CLUTCH_MAX_OPPONENTS, CLUTCH_ROUND_S, TICKRATE_DEFAULT};
use csdm_core::Settings;
use csdm_db::reads::{self, DemoKey};
use csdm_db::{DbValue, Row};
use indexmap::{IndexMap, IndexSet};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// One clutch window (3.5 window dict).
#[derive(Debug, Clone, PartialEq)]
pub struct Window {
    start_tick: i64,
    opponents: i64,
    won: bool,
    /// Tick range of the round, to match kill events (they carry no round number).
    round_tick_min: i64,
    round_tick_max: i64,
    /// End of the full-clutch clip.
    end_tick: i64,
    kill_ticks: Vec<i64>,
}

/// Demo path → round → window, rounds in 3.5 dict order.
pub type Windows = HashMap<String, IndexMap<i64, Window>>;

/// One row of `_fetch_all_kills_for_demos`.
#[derive(Debug, Clone)]
struct KillRow {
    tick: i64,
    killer: String,
    victim: String,
    killer_team: String,
    victim_team: String,
    round: Option<i64>,
}

/// Players per team of each match (`_clutch_roster_sizes`): checksum → team → count.
type Roster = HashMap<String, IndexMap<String, i64>>;

/// `_fetch_native_clutches` row: demo path, match, round, tick, clutcher, won, opponents,
/// round start, round end, round max end.
const NATIVE_COLS: usize = 10;
/// `_fetch_all_kills_for_demos` row: demo path, tick, killer, victim, then optional columns.
const KILL_TICK: usize = 1;
const KILL_KILLER: usize = 2;
const KILL_VICTIM: usize = 3;
const KILLS_OPTIONAL_FROM: usize = 4;
const PLAYER_TEAM: &str = "player_team";
const OPP_TEAM: &str = "opp_team";

/// `int(v) if v is not None else fallback`.
fn int_or(v: &DbValue, fallback: i64, what: &str) -> Result<i64, EngineError> {
    if v.is_null() { Ok(fallback) } else { int_db(v, what) }
}

/// `_fetch_native_clutches`: `None` when the table, a column or the query is unavailable.
fn native(cx: &mut Ctx, demos: &IndexSet<String>, sids: &HashSet<String>) -> Result<Option<Windows>, EngineError> {
    let chk_to_dp: Vec<(DbValue, String)> = {
        let mut m: Vec<(DbValue, String)> = Vec::new();
        for dp in demos {
            if let Some(chk) = cx.host.demo_checksums.get(dp).filter(|c| c.is_truthy()) {
                match m.iter_mut().find(|(c, _)| c == chk) {
                    Some(slot) => slot.1 = dp.clone(),
                    None => m.push((chk.clone(), dp.clone())),
                }
            }
        }
        m
    };
    let by_checksum = chk_to_dp.len() == demos.len();
    let (by, keys): (DemoKey, Vec<DbValue>) = if by_checksum {
        (DemoKey::Checksum, chk_to_dp.iter().map(|(c, _)| c.clone()).collect())
    } else {
        (DemoKey::Path, demos.iter().map(|d| DbValue::text(d.clone())).collect())
    };
    let Some(mut q) = reads::native_clutches(cx.disc, by, &keys) else {
        return Ok(None);
    };
    q.sql.push_str(&tie(cx, "clutches", "c"));
    let rows = match cx.db.run(&q) {
        Ok(r) => r,
        Err(e) => {
            cx.log(&format!("  ⚠ Clutch: reading the clutches table failed: {e}"), Level::Warn);
            return Ok(None);
        }
    };
    let mut out: Windows = HashMap::new();
    for row in rows {
        let [dp_val, chk, rn, tick, sid, won, opp, r_start, r_end, r_max]: [DbValue; NATIVE_COLS] = row.try_into().map_err(|_| EngineError::User("The clutches query returned an unexpected row.".into()))?;
        let dp = if by_checksum { chk_to_dp.iter().find(|(c, _)| *c == chk).map(|(_, d)| d.clone()) } else { Some(dp_val.py_str()) };
        let Some(dp) = dp.filter(|d| demos.contains(d)) else { continue };
        if rn.is_null() || tick.is_null() {
            continue;
        }
        let windows = out.entry(dp).or_default(); // the table covers this demo
        if !sids.contains(&sid.py_str()) {
            continue;
        }
        let rk = int_db(&rn, "clutch round")?;
        let start = int_db(&tick, "clutch tick")?;
        if windows.get(&rk).is_some_and(|w| w.start_tick <= start) {
            continue;
        }
        let end = int_or(&r_end, start, "round end tick")?;
        windows.insert(
            rk,
            Window {
                start_tick: start,
                opponents: int_db(&opp, "clutch opponents")?,
                won: won.is_truthy(),
                round_tick_min: int_or(&r_start, start, "round start tick")?,
                round_tick_max: int_or(&r_max, end, "round end tick")?,
                end_tick: end,
                kill_ticks: Vec::new(),
            },
        );
    }
    Ok(Some(out))
}

/// `_fetch_all_kills_for_demos` (+ the roster it stores). Errors are logged and give nothing,
/// as 3.5 (the clutch filter then skips those demos).
fn all_kills(cx: &mut Ctx, demos: &[String]) -> (HashMap<String, Vec<KillRow>>, Roster) {
    match read_all_kills(cx, demos) {
        Ok(Some((kills, chk_to_dp))) => {
            let roster = read_roster(cx, &chk_to_dp);
            (kills, roster)
        }
        Ok(None) => (HashMap::new(), Roster::new()),
        Err(e) => {
            cx.log(&format!("  ⚠ Clutch: reading clutches failed: {}", e.user_message()), Level::Warn);
            (HashMap::new(), Roster::new())
        }
    }
}

type KillsAndKeys = (HashMap<String, Vec<KillRow>>, Vec<(DbValue, String)>);

fn read_all_kills(cx: &mut Ctx, demos: &[String]) -> Result<Option<KillsAndKeys>, EngineError> {
    if demos.is_empty() {
        return Ok(None);
    }
    let mut chk_to_dp: Vec<(DbValue, String)> = Vec::new();
    for dp in demos {
        if let Some(chk) = cx.host.demo_checksums.get(dp).filter(|c| c.is_truthy()) {
            match chk_to_dp.iter_mut().find(|(c, _)| c == chk) {
                Some(slot) => slot.1 = dp.clone(),
                None => chk_to_dp.push((chk.clone(), dp.clone())),
            }
        }
    }
    let q = if chk_to_dp.is_empty() {
        reads::all_kills_for_demos(cx.disc, DemoKey::Path, &demos.iter().map(|d| DbValue::text(d.clone())).collect::<Vec<_>>())
    } else {
        reads::all_kills_for_demos(cx.disc, DemoKey::Checksum, &chk_to_dp.iter().map(|(c, _)| c.clone()).collect::<Vec<_>>())
    };
    let Some(mut q) = q else { return Ok(None) };
    q.sql.push_str(&tie(cx, "kills", "k"));
    let tkk = cx.disc.find_col("kills", &["killer_team_name", "killer_side", "killer_team"]).is_some();
    let tvk = cx.disc.find_col("kills", &["victim_team_name", "victim_side", "victim_team"]).is_some();
    let rnc = cx.disc.find_col("kills", &["round_number", "round_num", "round"]).is_some();
    let rows: Vec<Row> = cx.db.run(&q)?;
    let mut out: HashMap<String, Vec<KillRow>> = HashMap::new();
    for row in rows {
        let mut dp = row[0].py_str();
        if !demos.contains(&dp) {
            // may have arrived via checksum; map back
            if let Some(chk) = cx.host.demo_checksums.get(&dp) {
                if let Some((_, d)) = chk_to_dp.iter().find(|(c, _)| c == chk) {
                    dp = d.clone();
                }
            }
        }
        if !demos.contains(&dp) {
            continue;
        }
        let text = |v: &DbValue| if v.is_truthy() { v.py_str() } else { String::new() };
        let mut idx = KILLS_OPTIONAL_FROM;
        let mut team = |present: bool| {
            let t = if present { row.get(idx).map_or(String::new(), |v| text(v).to_lowercase()) } else { String::new() };
            if present {
                idx += 1;
            }
            t
        };
        let killer_team = team(tkk);
        let victim_team = team(tvk);
        let round = match row.get(idx) {
            Some(v) if rnc && !v.is_null() => Some(int_db(v, "round number")?),
            _ => None,
        };
        out.entry(dp).or_default().push(KillRow {
            tick: int_or(&row[KILL_TICK], 0, "kill tick")?,
            killer: text(&row[KILL_KILLER]),
            victim: text(&row[KILL_VICTIM]),
            killer_team,
            victim_team,
            round,
        });
    }
    Ok(Some((out, chk_to_dp)))
}

/// Read 14: team sizes per match, to spot players who never kill nor die (Wingman). Best effort:
/// a failure is logged and the detection runs without it, as 3.5.
fn read_roster(cx: &mut Ctx, chk_to_dp: &[(DbValue, String)]) -> Roster {
    let mut roster = Roster::new();
    let keys: Vec<DbValue> = chk_to_dp.iter().map(|(c, _)| c.clone()).collect();
    let Some(q) = reads::roster_sizes(cx.disc, &keys) else { return roster };
    match cx.db.run(&q) {
        Ok(rows) => {
            for r in rows {
                let [chk, team, count] = r.as_slice() else { continue };
                if !chk.is_truthy() || !team.is_truthy() {
                    continue;
                }
                match int_db(count, "player count") {
                    Ok(n) => {
                        roster.entry(chk.py_str()).or_default().insert(team.py_str().to_lowercase(), n);
                    }
                    Err(e) => cx.log(&format!("  ⚠ Clutch: team sizes unavailable: {}", e.user_message()), Level::Warn),
                }
            }
        }
        Err(e) => cx.log(&format!("  ⚠ Clutch: team sizes unavailable ({e}) — clutches detected from the kills alone."), Level::Warn),
    }
    roster
}

/// `_detect_clutch_windows_from_kills`: windows rebuilt from the kills alone (every size and
/// outcome; `apply_windows` filters).
fn detect(cx: &Ctx, demos: &[String], sids: &HashSet<String>, cfg: &Settings, kills: &HashMap<String, Vec<KillRow>>, roster: &Roster) -> Result<Windows, EngineError> {
    let tickrate = int_cfg(cfg, "tickrate", TICKRATE_DEFAULT)?;
    let slice = (tickrate * CLUTCH_ROUND_S).max(1);
    let mut out = Windows::new();
    for dp in demos {
        let Some(demo_kills) = kills.get(dp).filter(|k| !k.is_empty()) else { continue };
        let mut rounds: IndexMap<i64, Vec<KillRow>> = IndexMap::new();
        for k in demo_kills {
            rounds.entry(k.round.unwrap_or_else(|| k.tick.div_euclid(slice))).or_default().push(k.clone());
        }
        for r in rounds.values_mut() {
            r.sort_by_key(|k| k.tick);
        }
        let chk = cx.host.demo_checksums.get(dp).map(DbValue::py_str);
        let demo_roster = chk.and_then(|c| roster.get(&c));
        let mut windows: IndexMap<i64, Window> = IndexMap::new();
        for (&rk, r_kills) in &rounds {
            if let Some(w) = detect_round(r_kills, sids, demo_roster) {
                windows.insert(rk, w);
            }
        }
        if !windows.is_empty() {
            out.insert(dp.clone(), windows);
        }
    }
    Ok(out)
}

/// One round of `_detect_clutch_windows_from_kills`.
fn detect_round(r_kills: &[KillRow], sids: &HashSet<String>, roster: Option<&IndexMap<String, i64>>) -> Option<Window> {
    let in_round: HashSet<&str> = r_kills.iter().flat_map(|k| [k.killer.as_str(), k.victim.as_str()]).filter(|s| !s.is_empty()).collect();
    let ours: HashSet<&str> = in_round.into_iter().filter(|s| sids.contains(*s)).collect();
    if ours.is_empty() {
        return None;
    }
    let mut our_team = String::new();
    for k in r_kills {
        if ours.contains(k.killer.as_str()) && !k.killer_team.is_empty() {
            our_team = k.killer_team.clone();
            break;
        }
        if ours.contains(k.victim.as_str()) && !k.victim_team.is_empty() {
            our_team = k.victim_team.clone();
            break;
        }
    }
    let mut alive_set: IndexMap<String, String> = IndexMap::new();
    for k in r_kills {
        if !k.killer.is_empty() && !alive_set.contains_key(&k.killer) {
            alive_set.insert(k.killer.clone(), k.killer_team.clone());
        }
        if !k.victim.is_empty() && !alive_set.contains_key(&k.victim) {
            alive_set.insert(k.victim.clone(), k.victim_team.clone());
        }
    }
    if alive_set.values().all(String::is_empty) {
        for (sid, team) in alive_set.iter_mut() {
            *team = if sids.contains(sid) { PLAYER_TEAM } else { OPP_TEAM }.to_string();
        }
        our_team = PLAYER_TEAM.into();
    }
    if our_team.is_empty() {
        return None;
    }
    // Players who never kill nor die are absent from the kills: add them from the roster.
    if let Some(roster) = roster.filter(|r| !r.is_empty()) {
        let names: HashSet<String> = alive_set.values().filter(|v| !v.is_empty()).cloned().collect();
        for (tname, count) in roster {
            let label = tname.to_lowercase();
            if !names.contains(&label) {
                continue;
            }
            let observed = alive_set.values().filter(|v| **v == label).count() as i64;
            for i in 0..(count - observed).max(0) {
                alive_set.insert(format!("__ghost_{label}_{i}__"), label.clone());
            }
        }
    }

    let mut alive = alive_set;
    let (mut start, mut opponents, mut won) = (None, 0, false);
    let mut kill_ticks = Vec::new();
    for k in r_kills {
        if !k.victim.is_empty() {
            alive.shift_remove(&k.victim);
        }
        let our_alive: Vec<&String> = alive.iter().filter(|(_, t)| **t == our_team).map(|(s, _)| s).collect();
        let opp_alive = alive.values().filter(|t| **t != our_team).count();
        if start.is_none() && our_alive.len() == 1 && sids.contains(our_alive[0]) && opp_alive >= 1 {
            start = Some(k.tick);
            opponents = opp_alive as i64;
        }
        if start.is_some() {
            if sids.contains(&k.killer) && k.victim_team != our_team {
                kill_ticks.push(k.tick);
            }
            if opp_alive == 0 {
                won = true;
                break;
            }
            if !alive.keys().any(|s| sids.contains(s)) {
                break;
            }
        }
    }
    let start = start?;
    let lo = r_kills.iter().map(|k| k.tick).min().unwrap_or(start);
    let hi = r_kills.iter().map(|k| k.tick).max().unwrap_or(start);
    Some(Window { start_tick: start, opponents, won, round_tick_min: lo, round_tick_max: hi, end_tick: hi, kill_ticks })
}

/// `_clutch_windows_for`: native table first, kills else. `None` only when neither source gave
/// anything (the caller skips the clutch filter).
pub fn windows_for(cx: &mut Ctx, results: &DemoEvents, sids: &[String], cfg: &Settings) -> Result<Option<Windows>, EngineError> {
    let sids_set: HashSet<String> = sids.iter().cloned().collect();
    let demos: IndexSet<String> = results.keys().cloned().collect();
    let native = native(cx, &demos, &sids_set)?;
    let mut windows = native.clone().unwrap_or_default();
    let missing: Vec<String> = demos.iter().filter(|d| !windows.contains_key(*d)).cloned().collect();
    let mut n_fallback = 0;
    if !missing.is_empty() {
        let (kills, roster) = all_kills(cx, &missing);
        if !kills.is_empty() {
            windows.extend(detect(cx, &missing, &sids_set, cfg, &kills, &roster)?);
            n_fallback = missing.iter().filter(|d| kills.contains_key(*d)).count();
        } else if native.is_none() {
            return Ok(None);
        }
    }
    let mut parts = Vec::new();
    if let Some(n) = native.as_ref().filter(|n| !n.is_empty()) {
        parts.push(format!("{} demo(s) from the CSDM clutches table", n.len()));
    }
    if !missing.is_empty() {
        parts.push(format!("{n_fallback} demo(s) by kill-based detection{}", if native.is_some() { "" } else { " (no clutches table)" }));
    }
    cx.log(&format!("  Clutch source: {}.", parts.join(", ")), Level::Info);
    Ok(Some(windows))
}

/// `_apply_clutch_windows`: keep only what happens inside a kept window. A demo with no window
/// left is dropped; events other than kills, deaths and rounds pass untouched.
pub fn apply_windows(cx: &mut Ctx, results: &DemoEvents, sids: &[String], cfg: &Settings, windows: &Windows) -> Result<DemoEvents, EngineError> {
    let tickrate = int_cfg(cfg, "tickrate", TICKRATE_DEFAULT)?;
    let wins_only = cfg::on(cfg, "clutch_wins_only");
    let full = super::text_setting(cfg, "clutch_mode", "kills_only") == Some("full_clutch");
    let sizes: Vec<i64> = (1..=CLUTCH_MAX_OPPONENTS).filter(|n| cfg::on(cfg, &format!("clutch_1v{n}"))).collect();
    let mut filtered = DemoEvents::new();
    for (dp, events) in results {
        let cws: Vec<&Window> = windows
            .get(dp)
            .map(|w| w.values().filter(|cw| (sizes.is_empty() || sizes.contains(&cw.opponents)) && (!wins_only || cw.won)).collect())
            .unwrap_or_default();
        if cws.is_empty() {
            continue;
        }
        let kind = |id: EventId| cx.arena.get(id).get("type").and_then(Value::as_str).map(str::to_string);
        let kills: Vec<EventId> = events.iter().copied().filter(|&id| kind(id).as_deref() == Some("kill")).collect();
        let non_kill: Vec<EventId> = events.iter().copied().filter(|&id| !matches!(kind(id).as_deref(), Some("kill" | "death" | "round"))).collect();
        let mut kept: Vec<EventId> = Vec::new();
        if full {
            let bt = (float_cfg(cfg, "before", CLUTCH_BEFORE_S_DEFAULT)? * tickrate as f64).trunc() as i64;
            let at = (float_cfg(cfg, "after", CLUTCH_AFTER_S_DEFAULT)? * tickrate as f64).trunc() as i64;
            let mut sorted = cws.clone();
            sorted.sort_by_key(|cw| cw.start_tick);
            for cw in sorted {
                let mut e = Event::default();
                e.set("tick", cw.start_tick);
                e.set("type", "clutch_round");
                e.set("weapon", "");
                e.set("_clutch_start_tick", cw.start_tick);
                e.set("_clutch_end_tick", cw.end_tick);
                e.set("_clutch_opponents", cw.opponents);
                e.set("_clutch_won", cw.won);
                e.set("_seq_start_tick", (cw.start_tick - bt).max(0));
                e.set("_seq_end_tick", cw.end_tick + at);
                // The clutch's kills, for the badges: kill tick in [clutch start, round end].
                let ck: Vec<Value> = kills
                    .iter()
                    .map(|&id| cx.arena.get(id))
                    .filter(|k| k.tick() >= cw.start_tick && cw.round_tick_min <= k.tick() && k.tick() <= cw.round_tick_max)
                    .map(Event::to_json)
                    .collect();
                if !ck.is_empty() {
                    e.set("_clutch_kills", ck);
                }
                kept.push(cx.arena.add(e));
            }
        } else {
            let mut by_ticks = cws.clone();
            by_ticks.sort_by_key(|cw| cw.round_tick_min);
            for id in kills {
                let k = cx.arena.get(id);
                if !sids.contains(&k.text("killer_sid")) {
                    continue;
                }
                let t = k.tick();
                let Some(cw) = by_ticks.iter().find(|cw| cw.round_tick_min <= t && t <= cw.round_tick_max) else { continue };
                if t < cw.start_tick {
                    continue;
                }
                let copy = cx.arena.clone_event(id);
                let e = cx.arena.get_mut(copy);
                e.set("_clutch_start_tick", cw.start_tick);
                e.set("_clutch_opponents", cw.opponents);
                e.set("_clutch_won", cw.won);
                kept.push(copy);
            }
        }
        if !kept.is_empty() || !non_kill.is_empty() {
            kept.extend(non_kill);
            filtered.insert(dp.clone(), kept);
        }
    }
    Ok(filtered)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(tick: i64, killer: &str, kt: &str, victim: &str, vt: &str) -> KillRow {
        KillRow { tick, killer: killer.into(), victim: victim.into(), killer_team: kt.into(), victim_team: vt.into(), round: Some(1) }
    }

    #[test]
    fn last_alive_starts_a_clutch_and_killing_everyone_wins_it() {
        let sids: HashSet<String> = ["p".to_string()].into();
        // 2v2: the mate dies, the player kills both opponents.
        let kills = [k(10, "o1", "t", "m", "ct"), k(20, "p", "ct", "o1", "t"), k(30, "p", "ct", "o2", "t")];
        let w = detect_round(&kills, &sids, None).unwrap();
        assert_eq!((w.start_tick, w.opponents, w.won, w.kill_ticks.clone()), (10, 2, true, vec![20, 30]));
        assert_eq!((w.round_tick_min, w.round_tick_max, w.end_tick), (10, 30, 30));
    }

    #[test]
    fn roster_ghosts_delay_the_clutch() {
        let sids: HashSet<String> = ["p".to_string()].into();
        let kills = [k(10, "o1", "t", "m", "ct"), k(20, "p", "ct", "o1", "t")];
        let roster: IndexMap<String, i64> = [("CT".to_string(), 3)].into_iter().collect();
        // A silent third CT is alive: the player is not last alive.
        assert!(detect_round(&kills, &sids, Some(&roster)).is_none());
        assert!(detect_round(&kills, &sids, None).is_some());
    }
}
