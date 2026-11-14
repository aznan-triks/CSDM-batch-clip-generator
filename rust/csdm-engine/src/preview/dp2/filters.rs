//! Kill filters that read demo sections (3.5 `_spray_transfer_filter`, `_high_velocity_filter`,
//! `_flick_filter`, `_savior_filter`, `_death_flag_filter` and its users, `_penetrated_kills`,
//! wallbang and collateral, `_trois_shot_filter`, `_one_tap_filter`, `_no_trois_shot_filter`,
//! `_trois_tap_filter`). Each takes one demo's events and returns those it keeps, in 3.5's order;
//! a demo file that is missing keeps only its non-kill events.

use super::store::{default_sections, parse_demo, DeathFlags, Fire, Section, Sections, Shot};
use super::{is_kill, non_kill_only, Stage};
use crate::preview::cfg::{cfg_float, cfg_int, py_str};
use crate::preview::event::{Event, EventId};
use crate::EngineError;
use csdm_core::migrate::truthy;
use csdm_core::preview::dp2::{DP2_WEAPON_PREFIX, FLICK_DEG_MIN, HIGH_VEL_THR_MIN, ONE_TAP_S_MIN, TROIS_SHOT_MOVING_VEL};
use csdm_core::preview::preview;
use csdm_core::settings::def;
use csdm_core::Settings;
use indexmap::IndexMap;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Yaw arithmetic of `_flick_filter` (degrees).
const FULL_TURN: f64 = 360.0;
const HALF_TURN: f64 = 180.0;

fn table_i64(section: &str, key: &str) -> i64 {
    preview()[section][key].as_i64().unwrap_or_else(|| panic!("preview.json {section}.{key} is an integer"))
}

fn table_f64(section: &str, key: &str) -> f64 {
    preview()[section][key].as_f64().unwrap_or_else(|| panic!("preview.json {section}.{key} is a number"))
}

fn top_i64(key: &str) -> i64 {
    preview()[key].as_i64().unwrap_or_else(|| panic!("preview.json {key} is an integer"))
}

/// The settings table's default for `key`, which 3.5's `cfg.get(key, default)` repeated.
fn default_f64(key: &str) -> f64 {
    def(key).and_then(|d| d.default.as_f64()).unwrap_or_else(|| panic!("{key} is a numeric setting"))
}

/// The filter prelude of 3.5: `False` for a missing file; a demo this preview has not read yet is
/// read with the default sections.
fn ready(st: &mut Stage, dp: &str) -> bool {
    if !Path::new(dp).is_file() {
        return false;
    }
    if !st.cache.contains(dp) {
        parse_demo(st, dp, &default_sections());
    }
    true
}

fn killer(e: &Event) -> String {
    e.text("killer_sid")
}

/// `evt.get("weapon", "").lower().strip()`: 3.5 failed on a weapon that is not text.
fn weapon_lower(e: &Event) -> Result<String, EngineError> {
    match e.get("weapon") {
        None => Ok(String::new()),
        Some(Value::String(s)) => Ok(s.to_lowercase().trim().to_string()),
        Some(v) => Err(EngineError::User(format!("A kill in the preview has a weapon that is not text ({v}); the demo filters cannot judge it."))),
    }
}

/// `CSDM_TO_DP2_WEAPON[w]`: the demoparser name of a CSDM weapon (`weapon_deagle`).
fn mapped(w: &str) -> Option<&'static str> {
    preview()["csdm_to_dp2_weapon"].get(w).and_then(Value::as_str).filter(|m| !m.is_empty())
}

fn strip_prefix(w: &str) -> &str {
    w.strip_prefix(DP2_WEAPON_PREFIX).unwrap_or(w)
}

/// `_weapon_suffix_key`: the weapon as a shot key (mapped name, else the name without separators).
pub fn weapon_suffix_key(weapon: Option<&Value>) -> String {
    let w = weapon.filter(|v| truthy(v)).map(py_str).unwrap_or_default().to_lowercase().trim().to_string();
    match mapped(&w) {
        Some(m) => strip_prefix(m).to_string(),
        None => strip_prefix(&w).replace([' ', '-', '_'], ""),
    }
}

fn no_shots() -> Vec<i64> {
    Vec::new()
}

/// `_spray_transfer_filter`: kills made in one burst of an automatic weapon that kills two or more.
pub fn spray_transfer(st: &mut Stage, dp: &str, events: &[EventId], _cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    if !ready(st, dp) {
        return Ok(non_kill_only(st.arena, events));
    }
    let fire = st.cache.fire(dp);
    let weapons = preview()["spray_transfer_weapons"].as_array().expect("preview.json spray_transfer_weapons is a list");
    let gap = top_i64("spray_max_gap_ticks");
    let mut groups: IndexMap<(String, String), Vec<i64>> = IndexMap::new();
    for &id in events {
        let e = st.arena.get(id);
        if !is_kill(e) {
            continue;
        }
        let w = weapon_lower(e)?;
        if weapons.iter().any(|v| v.as_str() == Some(w.as_str())) {
            groups.entry((killer(e), w)).or_default().push(e.tick());
        }
    }
    let mut sigs: HashSet<(i64, String)> = HashSet::new();
    let empty = no_shots();
    for (key, kill_ticks) in &groups {
        if kill_ticks.len() < 2 {
            continue;
        }
        let shots = fire.as_ref().and_then(|f| f.ticks.get(key)).unwrap_or(&empty);
        let (Some(&first), Some(&last)) = (shots.first(), shots.last()) else { continue };
        let mut sorted = kill_ticks.clone();
        sorted.sort();
        let mut bursts = Vec::new();
        let mut start = first;
        for w in shots.windows(2) {
            if w[1] - w[0] > gap {
                bursts.push((start, w[0]));
                start = w[1];
            }
        }
        bursts.push((start, last));
        let mut ki = 0;
        for (b_start, b_end) in bursts {
            while ki < sorted.len() && sorted[ki] < b_start {
                ki += 1;
            }
            let in_burst: Vec<i64> = sorted[ki..].iter().copied().take_while(|&t| t <= b_end + gap).collect();
            if in_burst.len() >= 2 {
                sigs.extend(in_burst.into_iter().map(|t| (t, key.0.clone())));
            }
        }
    }
    Ok(events
        .iter()
        .copied()
        .filter(|&id| {
            let e = st.arena.get(id);
            !is_kill(e) || sigs.contains(&(e.tick(), killer(e)))
        })
        .collect())
}

/// `_high_velocity_filter` (FERRARI PEEK): an isolated kill shot fired on a fast peek, then moving on.
pub fn high_velocity(st: &mut Stage, dp: &str, events: &[EventId], cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    if !ready(st, dp) {
        return Ok(non_kill_only(st.arena, events));
    }
    let fire = st.cache.fire(dp);
    let key = "kill_mod_high_vel_thr";
    let approach_thr = cfg_float(st.ports, cfg, key, default_f64(key), Some(HIGH_VEL_THR_MIN), None);
    let one_shot = cfg.get("kill_mod_hv_one_shot").is_none_or(truthy);
    let resume_thr = table_f64("high_velocity", "RESUME_THR");
    let (pre, approach_win) = (table_i64("high_velocity", "PRE_WINDOW"), table_i64("high_velocity", "APPROACH_WIN"));
    let (resume_win, shot_window) = (table_i64("high_velocity", "RESUME_WIN"), table_i64("high_velocity", "SHOT_WINDOW"));
    let mut out = Vec::new();
    for &id in events {
        let e = st.arena.get(id);
        if !is_kill(e) {
            out.push(id);
            continue;
        }
        let (kill_tick, killer_sid) = (e.tick(), killer(e));
        let w = e.text("weapon").to_lowercase().trim().to_string();
        let kill_wpn = match mapped(&w) {
            Some(m) => strip_prefix(m).to_string(),
            None if w.starts_with(DP2_WEAPON_PREFIX) => strip_prefix(&w).to_string(),
            None => w.replace([' ', '-', '_'], ""),
        };
        let (mut kill_entries, mut other_entries): (Vec<Shot>, Vec<Shot>) = (Vec::new(), Vec::new());
        for ((sid, wpn), entries) in fire.iter().flat_map(|f| f.detail.iter()) {
            if *sid != killer_sid {
                continue;
            }
            if *wpn == kill_wpn { &mut kill_entries } else { &mut other_entries }.extend_from_slice(entries);
        }
        let mut all: Vec<Shot> = kill_entries.iter().chain(&other_entries).copied().collect();
        all.sort_by_key(|s| s.tick);
        if all.is_empty() {
            continue;
        }
        let mut shot: Option<Shot> = None;
        for list in [&mut kill_entries, &mut other_entries] {
            if shot.is_some() {
                break;
            }
            list.sort_by_key(|s| s.tick);
            for s in list.iter() {
                if (kill_tick - s.tick).abs() <= shot_window && shot.is_none_or(|b| (kill_tick - s.tick).abs() < (kill_tick - b.tick).abs()) {
                    shot = Some(*s);
                }
            }
        }
        let Some(shot) = shot else { continue };
        if one_shot && all.iter().any(|s| shot.tick - pre <= s.tick && s.tick < shot.tick) {
            continue;
        }
        let approach: Vec<f64> = all.iter().filter(|s| shot.tick - approach_win <= s.tick && s.tick < shot.tick).map(|s| s.vel).collect();
        let fastest = |v: &[f64]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if !((!approach.is_empty() && fastest(&approach) >= approach_thr) || shot.vel >= approach_thr) {
            continue;
        }
        let resume: Vec<f64> = all.iter().filter(|s| kill_tick < s.tick && s.tick <= kill_tick + resume_win).map(|s| s.vel).collect();
        if !resume.is_empty() && fastest(&resume) < resume_thr {
            continue;
        }
        out.push(id);
    }
    Ok(out)
}

/// `_flick_filter`: the killer's yaw at this kill differs enough from his yaw at a kill at least
/// `LOOK_BACK` ticks earlier.
pub fn flick(st: &mut Stage, dp: &str, events: &[EventId], cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    if !ready(st, dp) {
        return Ok(non_kill_only(st.arena, events));
    }
    let death = st.cache.death(dp);
    let Some(view_angles) = death.as_ref().map(|d| &d.view_angles).filter(|v| !v.is_empty()) else {
        return Ok(non_kill_only(st.arena, events));
    };
    let key = "kill_mod_flick_deg";
    let min_deg = cfg_float(st.ports, cfg, key, default_f64(key), Some(FLICK_DEG_MIN), None);
    let look_back = table_i64("flick", "LOOK_BACK");
    let delta = |a: f64, b: f64| {
        let d = (a - b).abs() % FULL_TURN;
        if d <= HALF_TURN { d } else { FULL_TURN - d }
    };
    let mut out = Vec::new();
    for &id in events {
        let e = st.arena.get(id);
        if !is_kill(e) {
            out.push(id);
            continue;
        }
        let Some(angles) = view_angles.get(&killer(e)).filter(|a| !a.is_empty()) else { continue };
        let at_or_before = |t: i64| angles.partition_point(|a| a.0 <= t).checked_sub(1);
        let Some(pos) = at_or_before(e.tick()) else { continue };
        if at_or_before(e.tick() - look_back).is_some_and(|prior| prior != pos && delta(angles[pos].1, angles[prior].1) >= min_deg) {
            out.push(id);
        }
    }
    Ok(out)
}

/// `_savior_filter`: the victim hurt one of the tracked players in the `SAVIOR_WINDOW` ticks before.
pub fn savior(st: &mut Stage, dp: &str, events: &[EventId], _cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    if !ready(st, dp) {
        return Ok(non_kill_only(st.arena, events));
    }
    let hurt = st.cache.hurt(dp);
    let Some(hurt) = hurt.as_ref().filter(|h| !h.is_empty()) else {
        return Ok(non_kill_only(st.arena, events));
    };
    let window = table_i64("savior", "SAVIOR_WINDOW");
    let tracked: HashSet<String> = events.iter().map(|&id| st.arena.get(id)).filter(|e| is_kill(e)).map(killer).collect();
    let mut hurt_ticks: HashMap<&str, Vec<i64>> = HashMap::new();
    for (_, entries) in hurt.iter().filter(|(v, _)| tracked.contains(*v)) {
        for (t, attacker) in entries {
            hurt_ticks.entry(attacker.as_str()).or_default().push(*t);
        }
    }
    for ticks in hurt_ticks.values_mut() {
        ticks.sort();
    }
    Ok(events
        .iter()
        .copied()
        .filter(|&id| {
            let e = st.arena.get(id);
            if !is_kill(e) {
                return true;
            }
            let kill_tick = e.tick();
            let Some(ticks) = hurt_ticks.get(e.text("victim_sid").as_str()) else { return false };
            let pos = ticks.partition_point(|&t| t < kill_tick - window);
            pos < ticks.len() && ticks[pos] <= kill_tick
        })
        .collect())
}

/// `_death_flags_for_kill`: the flags of the death within `tick_match_window` ticks of the kill.
fn flags_for_kill<'d>(flags: &'d HashMap<(i64, String), DeathFlags>, e: &Event) -> Option<&'d DeathFlags> {
    let w = top_i64("tick_match_window");
    let (tick, killer_sid) = (e.tick(), killer(e));
    (-w..=w).find_map(|dt| flags.get(&(tick + dt, killer_sid.clone())))
}

/// `_death_flag_filter(flag, True)`: kills whose death event has the flag set.
fn death_flag(st: &mut Stage, dp: &str, events: &[EventId], flag: fn(&DeathFlags) -> Option<bool>) -> Vec<EventId> {
    if !ready(st, dp) {
        return non_kill_only(st.arena, events);
    }
    let death = st.cache.death(dp);
    let Some(flags) = death.as_ref().map(|d| &d.flags).filter(|f| !f.is_empty()) else {
        return non_kill_only(st.arena, events);
    };
    events
        .iter()
        .copied()
        .filter(|&id| {
            let e = st.arena.get(id);
            !is_kill(e) || flags_for_kill(flags, e).and_then(flag) == Some(true)
        })
        .collect()
}

/// `_airborne_dp2_filter`: `attackerinair`.
pub fn airborne(st: &mut Stage, dp: &str, events: &[EventId], _cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    Ok(death_flag(st, dp, events, |f| f.attackerinair))
}

/// `_attacker_blind_dp2_filter`: `attackerblind`.
pub fn attacker_blind(st: &mut Stage, dp: &str, events: &[EventId], _cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    Ok(death_flag(st, dp, events, |f| f.attackerblind))
}

/// `_penetrated_kills`: (kills through an object, non-kill events). Reads "death" and "fire".
fn penetrated_kills(st: &mut Stage, dp: &str, events: &[EventId]) -> (Vec<EventId>, Vec<EventId>) {
    if !Path::new(dp).is_file() {
        return (Vec::new(), non_kill_only(st.arena, events));
    }
    if !st.cache.contains(dp) {
        parse_demo(st, dp, &Sections::from([Section::Death, Section::Fire]));
    }
    if !st.cache.sections(dp).contains(&Section::Fire) {
        parse_demo(st, dp, &Sections::from([Section::Fire]));
    }
    let death = st.cache.death(dp);
    let Some(flags) = death.as_ref().map(|d| &d.flags).filter(|f| !f.is_empty()) else {
        return (Vec::new(), non_kill_only(st.arena, events));
    };
    let non_kill = non_kill_only(st.arena, events);
    let penetrated = events
        .iter()
        .copied()
        .filter(|&id| {
            let e = st.arena.get(id);
            is_kill(e) && flags_for_kill(flags, e).and_then(|f| f.penetrated).is_some_and(|p| p >= 1)
        })
        .collect();
    (penetrated, non_kill)
}

/// Penetrated kills grouped by (tick, killer, weapon key), in first-kill order.
fn shot_groups(st: &Stage, kills: &[EventId]) -> IndexMap<(i64, String, String), Vec<EventId>> {
    let mut groups: IndexMap<_, Vec<EventId>> = IndexMap::new();
    for &id in kills {
        let e = st.arena.get(id);
        groups.entry((e.tick(), killer(e), weapon_suffix_key(e.get("weapon")))).or_default().push(id);
    }
    groups
}

/// `_wall_bang_dp2_filter`: penetrated kills that are alone on their shot (not a collateral).
pub fn wall_bang(st: &mut Stage, dp: &str, events: &[EventId], _cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    let (penetrated, non_kill) = penetrated_kills(st, dp, events);
    if penetrated.is_empty() {
        return Ok(non_kill);
    }
    let collateral: HashSet<EventId> = shot_groups(st, &penetrated).into_values().filter(|g| g.len() >= 2).flatten().collect();
    Ok(penetrated.into_iter().filter(|id| !collateral.contains(id)).chain(non_kill).collect())
}

/// `_collateral_dp2_filter`: two or more penetrated kills on one tick from exactly one shot.
pub fn collateral(st: &mut Stage, dp: &str, events: &[EventId], _cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    let (penetrated, non_kill) = penetrated_kills(st, dp, events);
    if penetrated.is_empty() {
        return Ok(non_kill);
    }
    let fire = st.cache.fire(dp);
    let w = top_i64("tick_match_window");
    let empty = no_shots();
    let mut out = Vec::new();
    for ((tick, killer_sid, wpn), group) in shot_groups(st, &penetrated) {
        if group.len() < 2 {
            continue;
        }
        let shots = fire.as_ref().and_then(|f| f.ticks.get(&(killer_sid, wpn))).unwrap_or(&empty);
        if shots.iter().filter(|&&t| (t - tick).abs() <= w).count() == 1 {
            out.extend(group);
        }
    }
    out.extend(non_kill);
    Ok(out)
}

/// `_is_lucky` of `_trois_shot_filter`: the closest shot of that weapon before the kill (within
/// `dp2_tick_window`) was inaccurate, unscoped, or fired moving, by the weapon's thresholds.
fn lucky(fire: Option<&Fire>, kill_tick: i64, killer_sid: &str, w_key: &str) -> bool {
    let th = &preview()["trois_shot_thresholds"][w_key];
    let flag = |k: &str| th[k].as_bool().unwrap_or_else(|| panic!("preview.json trois_shot_thresholds.{w_key}.{k} is a bool"));
    let acc_limit = th["acc"].as_f64().unwrap_or_else(|| panic!("preview.json trois_shot_thresholds.{w_key}.acc is a number"));
    let window = top_i64("dp2_tick_window");
    let Some(entries) = fire.and_then(|f| f.detail.get(&(killer_sid.to_string(), strip_prefix(w_key).to_string()))) else { return false };
    let pos = entries.partition_point(|s| s.tick <= kill_tick);
    let (mut best, mut best_dist) = (None, window + 1);
    for s in entries[..pos].iter().rev() {
        let dist = kill_tick - s.tick;
        if dist >= window {
            break;
        }
        if dist < best_dist {
            best_dist = dist;
            best = Some(*s);
        }
    }
    let Some(s) = best else { return false };
    match (flag("scope"), flag("vel")) {
        (true, true) => !s.scoped || s.acc > acc_limit || s.vel > TROIS_SHOT_MOVING_VEL,
        (true, false) => !s.scoped || s.acc > acc_limit,
        _ => s.acc > acc_limit,
    }
}

/// `_trois_shot_filter` (TROIS SHOT): lucky kills with a weapon that has thresholds.
pub fn trois_shot(st: &mut Stage, dp: &str, events: &[EventId], _cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    if !ready(st, dp) {
        return Ok(non_kill_only(st.arena, events));
    }
    let fire = st.cache.fire(dp);
    let mut out = Vec::new();
    for &id in events {
        let e = st.arena.get(id);
        if !is_kill(e) {
            out.push(id);
            continue;
        }
        let Some(w_key) = mapped(&weapon_lower(e)?) else { continue };
        if lucky(fire.as_deref(), e.tick(), &killer(e), w_key) {
            out.push(id);
        }
    }
    Ok(out)
}

/// `_one_tap_filter` (ONE TAP): exactly one shot of the kill weapon within ± `kill_mod_one_tap_s`.
pub fn one_tap(st: &mut Stage, dp: &str, events: &[EventId], cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    if !ready(st, dp) {
        return Ok(non_kill_only(st.arena, events));
    }
    let fire = st.cache.fire(dp);
    let (s_key, rate_key) = ("kill_mod_one_tap_s", "tickrate");
    let seconds = cfg_float(st.ports, cfg, s_key, default_f64(s_key), Some(ONE_TAP_S_MIN), None);
    let rate_default = def(rate_key).and_then(|d| d.default.as_i64()).expect("tickrate is an integer setting");
    let tickrate = cfg_int(st.ports, cfg, rate_key, rate_default, None, None);
    let window = (seconds * tickrate as f64) as i64;
    let empty = no_shots();
    let mut out = Vec::new();
    for &id in events {
        let e = st.arena.get(id);
        if !is_kill(e) {
            out.push(id);
            continue;
        }
        let w = weapon_lower(e)?;
        let wpn = mapped(&w).map_or_else(|| strip_prefix(&w).to_string(), |m| strip_prefix(m).to_string());
        let ticks = fire.as_ref().and_then(|f| f.ticks.get(&(killer(e), wpn))).unwrap_or(&empty);
        let kill_tick = e.tick();
        let pos = ticks.partition_point(|&t| t < kill_tick - window);
        if ticks[pos..].iter().take_while(|&&t| t <= kill_tick + window).take(2).count() == 1 {
            out.push(id);
        }
    }
    Ok(out)
}

/// `_no_trois_shot_filter`: the kills TROIS SHOT does not keep (no caller in 3.5 either).
pub fn no_trois_shot(st: &mut Stage, dp: &str, events: &[EventId], cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    // 3.5 keyed on `str(e.get("killer_sid"))`: an absent id reads "None" here.
    let key = |e: &Event| (e.tick(), e.get("killer_sid").map_or_else(|| "None".to_string(), py_str));
    let lucky: HashSet<(i64, String)> = trois_shot(st, dp, events, cfg)?.into_iter().map(|id| st.arena.get(id)).filter(|e| is_kill(e)).map(key).collect();
    Ok(events
        .iter()
        .copied()
        .filter(|&id| {
            let e = st.arena.get(id);
            !is_kill(e) || !lucky.contains(&key(e))
        })
        .collect())
}

/// `_trois_tap_filter` (TROIS TAP): lucky kills that are also one taps.
pub fn trois_tap(st: &mut Stage, dp: &str, events: &[EventId], cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    let lucky = trois_shot(st, dp, events, cfg)?;
    one_tap(st, dp, &lucky, cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::dp2::store::{Death, Hurt};
    use crate::preview::dp2::testkit::Kit;
    use serde_json::json;

    fn shot(tick: i64, acc: f64, scoped: bool, vel: f64) -> Shot {
        Shot { tick, acc, scoped, vel }
    }

    fn fire(groups: &[((&str, &str), Vec<Shot>)]) -> Fire {
        let mut f = Fire::default();
        for ((sid, w), shots) in groups {
            let key = (sid.to_string(), w.to_string());
            f.ticks.insert(key.clone(), shots.iter().map(|s| s.tick).collect());
            f.detail.insert(key, shots.clone());
        }
        f
    }

    fn cfg(v: Value) -> Settings {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn spray_transfer_needs_two_kills_in_one_burst() {
        let mut kit = Kit::new();
        let a = kit.kill(100, "1", "8", "AUG");
        let b = kit.kill(130, "1", "9", "AUG");
        let late = kit.kill(400, "1", "7", "AUG");
        let awp = kit.kill(101, "1", "6", "AWP");
        let other = kit.event(5, "shot");
        // Shots every 10 ticks from 90 to 120 (a burst); next shot 30 ticks later (> 22) starts a new burst.
        let shots = [90, 100, 110, 120, 150, 390].map(|t| shot(t, 0.0, false, 0.0)).to_vec();
        kit.fill(Some(fire(&[(("1", "aug"), shots)])), None, None);
        let dp = kit.demo.clone();
        let got = spray_transfer(&mut kit.stage(), &dp, &[a, b, late, awp, other], &Settings::new()).unwrap();
        // 130 is within the first burst's 22-tick grace (120 + 22); 400 is alone in the last burst.
        assert_eq!(got, [a, b, other]);
    }

    #[test]
    fn trois_shot_reads_the_closest_shot_against_the_weapon_thresholds() {
        let mut kit = Kit::new();
        let lucky_deagle = kit.kill(1000, "1", "9", "Desert Eagle");
        let precise_deagle = kit.kill(2000, "1", "9", "Deagle");
        let unscoped_awp = kit.kill(1000, "2", "9", "AWP");
        let scoped_awp = kit.kill(2000, "2", "9", "AWP");
        let moving_scar = kit.kill(1000, "3", "9", "SCAR-20");
        let stale = kit.kill(5000, "1", "9", "Deagle");
        // Another tick: 3.5 matches kills by (tick, killer), so the same pair would count as lucky too.
        let no_threshold = kit.kill(1500, "1", "9", "AK-47");
        kit.fill(
            Some(fire(&[
                (("1", "deagle"), vec![shot(990, 0.0, false, 0.0), shot(995, 0.02, false, 0.0), shot(1995, 0.01, false, 0.0), shot(4872, 0.5, false, 0.0)]),
                (("2", "awp"), vec![shot(999, 0.0, false, 0.0), shot(1999, 0.005, true, 0.0)]),
                (("3", "scar20"), vec![shot(999, 0.001, true, 150.0)]),
            ])),
            None,
            None,
        );
        let all = [lucky_deagle, precise_deagle, unscoped_awp, scoped_awp, moving_scar, stale, no_threshold];
        let dp = kit.demo.clone();
        let got = trois_shot(&mut kit.stage(), &dp, &all, &Settings::new()).unwrap();
        // The deagle shot 128 ticks before (5000 - 4872) is outside dp2_tick_window.
        assert_eq!(got, [lucky_deagle, unscoped_awp, moving_scar]);
        let precise = no_trois_shot(&mut kit.stage(), &dp, &all, &Settings::new()).unwrap();
        assert_eq!(precise, [precise_deagle, scoped_awp, stale, no_threshold]);
    }

    #[test]
    fn one_tap_wants_exactly_one_shot_in_the_window_and_trois_tap_both() {
        let mut kit = Kit::new();
        let alone = kit.kill(1000, "1", "9", "Desert Eagle");
        let spray = kit.kill(3000, "1", "9", "Desert Eagle");
        let none = kit.kill(6000, "1", "9", "Desert Eagle");
        // 2 s × 64 = 128 ticks each side.
        kit.fill(Some(fire(&[(("1", "deagle"), vec![shot(995, 0.02, false, 0.0), shot(1129, 0.0, false, 0.0), shot(2990, 0.0, false, 0.0), shot(3128, 0.0, false, 0.0)])])), None, None);
        let c = cfg(json!({"kill_mod_one_tap_s": 2, "tickrate": 64}));
        let dp = kit.demo.clone();
        assert_eq!(one_tap(&mut kit.stage(), &dp, &[alone, spray, none], &c).unwrap(), [alone]);
        assert_eq!(trois_tap(&mut kit.stage(), &dp, &[alone, spray, none], &c).unwrap(), [alone]);
        let short = cfg(json!({"kill_mod_one_tap_s": 0, "tickrate": 64}));
        // 0 s is raised to 0.5 s = 32 ticks: the shot at 2990 is 10 ticks away and 3128 is out.
        assert_eq!(one_tap(&mut kit.stage(), &dp, &[spray], &short).unwrap(), [spray]);
    }

    #[test]
    fn ferrari_peek_wants_an_isolated_fast_shot_then_movement() {
        let mut kit = Kit::new();
        let peek = kit.kill(1000, "1", "9", "AK-47");
        let sprayed = kit.kill(2000, "1", "9", "AK-47");
        let camped = kit.kill(3000, "1", "9", "AK-47");
        let missed = kit.kill(4000, "1", "9", "AK-47");
        kit.fill(
            Some(fire(&[(
                ("1", "ak47"),
                vec![
                    shot(998, 0.0, false, 150.0),
                    shot(1050, 0.0, false, 200.0),
                    shot(1960, 0.0, false, 150.0),
                    shot(1999, 0.0, false, 150.0),
                    shot(2999, 0.0, false, 150.0),
                    shot(3050, 0.0, false, 10.0),
                    shot(3900, 0.0, false, 150.0),
                ],
            )])),
            None,
            None,
        );
        let dp = kit.demo.clone();
        let all = [peek, sprayed, camped, missed];
        assert_eq!(high_velocity(&mut kit.stage(), &dp, &all, &cfg(json!({"kill_mod_high_vel_thr": 100}))).unwrap(), [peek]);
        let any_shot = cfg(json!({"kill_mod_high_vel_thr": 100, "kill_mod_hv_one_shot": false}));
        assert_eq!(high_velocity(&mut kit.stage(), &dp, &all, &any_shot).unwrap(), [peek, sprayed]);
    }

    #[test]
    fn flick_compares_the_yaw_with_a_kill_at_least_look_back_ticks_before() {
        let mut kit = Kit::new();
        let first = kit.kill(1000, "1", "9", "AK-47");
        let flicked = kit.kill(2000, "1", "9", "AK-47");
        let turned = kit.kill(3000, "1", "9", "AK-47");
        let wrapped = kit.kill(4000, "1", "9", "AK-47");
        let no_new_sample = kit.kill(5000, "1", "9", "AK-47");
        let mut d = Death::default();
        d.view_angles.insert("1".into(), vec![(1000, 10.0, 0.0), (2000, 100.0, 0.0), (3000, 350.0, 0.0), (4000, 15.0, 0.0)]);
        kit.fill(None, Some(d), None);
        let dp = kit.demo.clone();
        let all = [first, flicked, turned, wrapped, no_new_sample];
        let got = flick(&mut kit.stage(), &dp, &all, &cfg(json!({"kill_mod_flick_deg": 50}))).unwrap();
        // 350° vs 100° is 110° the short way; 15° vs 350° is only 25°; at 5000 both samples are 4000's.
        assert_eq!(got, [flicked, turned]);
    }

    #[test]
    fn savior_wants_the_victim_to_have_hurt_a_tracked_player_just_before() {
        let mut kit = Kit::new();
        let saved = kit.kill(1000, "1", "5", "AK-47");
        let stranger = kit.kill(2000, "1", "6", "AK-47");
        let old = kit.kill(3000, "1", "7", "AK-47");
        let mut h = Hurt::new();
        h.insert("1".into(), vec![(950, "5".into()), (2800, "7".into())]);
        h.insert("4".into(), vec![(1990, "6".into())]);
        kit.fill(None, None, Some(h));
        let dp = kit.demo.clone();
        let got = savior(&mut kit.stage(), &dp, &[saved, stranger, old], &Settings::new()).unwrap();
        assert_eq!(got, [saved]);
    }

    #[test]
    fn death_flags_match_within_two_ticks_and_split_wallbangs_from_collaterals() {
        let mut kit = Kit::new();
        let air = kit.kill(1000, "1", "5", "AK-47");
        let ground = kit.kill(2000, "1", "6", "AK-47");
        let wall = kit.kill(3000, "1", "7", "AWP");
        let col_a = kit.kill(4000, "1", "8", "AWP");
        let col_b = kit.kill(4000, "1", "9", "AWP");
        let other = kit.event(10, "damage_actor");
        let mut d = Death::default();
        let f = |inair, pen| DeathFlags { attackerinair: inair, penetrated: pen, ..DeathFlags::default() };
        d.flags.insert((1002, "1".into()), f(Some(true), Some(0)));
        d.flags.insert((2000, "1".into()), f(Some(false), Some(0)));
        d.flags.insert((2999, "1".into()), f(None, Some(1)));
        d.flags.insert((4000, "1".into()), f(None, Some(2)));
        kit.fill(Some(fire(&[(("1", "awp"), vec![shot(3000, 0.0, true, 0.0), shot(3999, 0.0, true, 0.0)])])), Some(d), None);
        let dp = kit.demo.clone();
        let all = [air, ground, wall, col_a, col_b, other];
        let none = Settings::new();
        assert_eq!(airborne(&mut kit.stage(), &dp, &all, &none).unwrap(), [air, other]);
        assert_eq!(attacker_blind(&mut kit.stage(), &dp, &all, &none).unwrap(), [other]);
        assert_eq!(wall_bang(&mut kit.stage(), &dp, &all, &none).unwrap(), [wall, other]);
        assert_eq!(collateral(&mut kit.stage(), &dp, &all, &none).unwrap(), [col_a, col_b, other]);
    }

    #[test]
    fn a_missing_demo_keeps_only_the_non_kill_events_and_empty_data_too() {
        let mut kit = Kit::new();
        let k = kit.kill(1, "1", "2", "AK-47");
        let o = kit.event(2, "shot");
        assert_eq!(flick(&mut kit.stage(), "Z:/no/such.dem", &[k, o], &Settings::new()).unwrap(), [o]);
        kit.fill(None, Some(Death::default()), Some(Hurt::new()));
        let dp = kit.demo.clone();
        assert_eq!(savior(&mut kit.stage(), &dp, &[k, o], &Settings::new()).unwrap(), [o]);
        assert_eq!(airborne(&mut kit.stage(), &dp, &[k, o], &Settings::new()).unwrap(), [o]);
        assert!(kit.cache.fire(&dp).is_none());
    }

    #[test]
    fn weapon_keys_follow_the_3_5_rules() {
        assert_eq!(weapon_suffix_key(Some(&json!("SSG 08"))), "ssg08");
        assert_eq!(weapon_suffix_key(Some(&json!("M4A1-S"))), "m4a1s");
        assert_eq!(weapon_suffix_key(Some(&json!("weapon_usp_silencer"))), "uspsilencer");
        assert_eq!(weapon_suffix_key(None), "");
        assert!(weapon_lower(&Event { fields: [("weapon".to_string(), json!(3))].into_iter().collect(), mf: None }).is_err());
    }
}
