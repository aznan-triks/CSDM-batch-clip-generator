//! Database post-filters (3.5 `_apply_db_postfilters`): kill filters that need the whole round
//! or match (ENTRY, ACE, MULTI-KILL, BULLY, ECO). A kill must match every required (★) one;
//! optional ones only tag (`_mf`); excluded ones always remove.

use super::{behaviour, int_cfg, Ctx};
use crate::preview::cfg;
use crate::preview::event::{Arena, EventId};
use crate::preview::DemoEvents;
use crate::EngineError;
use csdm_core::preview::preview;
use csdm_core::preview::sql::{
    ACE_VICTIMS, BULLY_N_DEFAULT, BULLY_N_MIN, MULTI_KILL_N_DEFAULT, MULTI_KILL_N_MIN, MULTI_KILL_S_DEFAULT, MULTI_KILL_S_MIN,
    ROUND_TICKS_FALLBACK, TICKRATE_DEFAULT, WEAPON_PREFIX,
};
use csdm_core::registries::registries;
use csdm_core::Settings;
use indexmap::IndexMap;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, HashSet};

/// A kill's identity across lists: (tick, killer id as text).
pub type Sig = (i64, String);
pub type SigBuilder = fn(&DemoKills) -> HashSet<Sig>;

/// The numeric settings 3.5 reads once, before any demo.
pub struct Params {
    multi_n: i64,
    max_ticks: i64,
    bully_n: i64,
}

/// One demo's kills, grouped the ways the builders need.
pub struct DemoKills<'a> {
    arena: &'a Arena,
    sids: &'a HashSet<String>,
    p: &'a Params,
    kills: Vec<EventId>,
    player_kills: Vec<EventId>,
    /// Round key → the player's kills.
    rounds_player: IndexMap<String, Vec<EventId>>,
    /// Round key → every kill.
    rounds_all: IndexMap<String, Vec<EventId>>,
    ksid: HashMap<EventId, String>,
    sig: HashMap<EventId, Sig>,
}

impl DemoKills<'_> {
    fn tick(&self, id: EventId) -> i64 {
        self.arena.get(id).tick()
    }
    fn in_sids(&self, id: EventId) -> bool {
        self.sids.contains(&self.ksid[&id])
    }
}

fn is_kill(arena: &Arena, id: EventId) -> bool {
    arena.get(id).get("type").and_then(Value::as_str) == Some("kill")
}

/// `_round_key`: (checksum, round number), else (checksum, tick // 7680) (correction g).
fn round_key(arena: &Arena, id: EventId) -> String {
    let e = arena.get(id);
    let chk = e.get("_chk").cloned().unwrap_or_else(|| Value::from(""));
    let ri = match e.get("round_idx") {
        Some(ri) if !ri.is_null() => ri.clone(),
        _ => Value::from(e.tick().div_euclid(ROUND_TICKS_FALLBACK)),
    };
    Value::Array(vec![chk, ri]).to_string()
}

pub fn entry_sigs(d: &DemoKills) -> HashSet<Sig> {
    let mut s = HashSet::new();
    for kills in d.rounds_all.values() {
        let first = kills.iter().map(|&id| d.tick(id)).min().expect("a round group holds a kill");
        s.extend(kills.iter().filter(|&&id| d.tick(id) == first && d.in_sids(id)).map(|id| d.sig[id].clone()));
    }
    s
}

pub fn ace_sigs(d: &DemoKills) -> HashSet<Sig> {
    let mut s = HashSet::new();
    for kills in d.rounds_player.values() {
        let victims: HashSet<String> = kills.iter().map(|&id| d.arena.get(id).text("victim_sid")).collect();
        if victims.len() >= ACE_VICTIMS {
            s.extend(kills.iter().map(|id| d.sig[id].clone()));
        }
    }
    s
}

pub fn multi_sigs(d: &DemoKills) -> HashSet<Sig> {
    let mut s = HashSet::new();
    for kills in d.rounds_player.values() {
        if (kills.len() as i64) < d.p.multi_n {
            continue;
        }
        let ticks: Vec<i64> = kills.iter().map(|&id| d.tick(id)).collect();
        let (lo, hi) = (ticks.iter().min().expect("non-empty"), ticks.iter().max().expect("non-empty"));
        if hi - lo <= d.p.max_ticks {
            s.extend(kills.iter().map(|id| d.sig[id].clone()));
        }
    }
    s
}

pub fn bully_sigs(d: &DemoKills) -> HashSet<Sig> {
    let pair = |id: EventId| (d.ksid[&id].clone(), d.arena.get(id).text("victim_sid"));
    let mut count: HashMap<(String, String), i64> = HashMap::new();
    for &id in d.kills.iter().filter(|&&id| d.in_sids(id)) {
        let p = pair(id);
        if !p.1.is_empty() {
            *count.entry(p).or_default() += 1;
        }
    }
    let mut sorted = d.kills.clone();
    sorted.sort_by_key(|&id| d.tick(id));
    let mut seen: HashMap<(String, String), i64> = HashMap::new();
    let mut s = HashSet::new();
    for id in sorted.into_iter().filter(|&id| d.in_sids(id)) {
        let p = pair(id);
        let n_seen = seen.entry(p.clone()).or_default();
        *n_seen += 1;
        if count.get(&p).copied().unwrap_or(0) >= d.p.bully_n && *n_seen >= d.p.bully_n {
            s.insert((d.tick(id), p.0));
        }
    }
    s
}

/// `_norm_wpn`: lower-case, trimmed, without the `weapon_` prefix.
fn norm_weapon(w: &str) -> String {
    let r = w.to_lowercase().trim().to_string();
    r.strip_prefix(WEAPON_PREFIX).map(str::to_string).unwrap_or(r)
}

fn weapon_list(name: &str) -> HashSet<&'static str> {
    preview()["db_postfilters"][name].as_array().expect("db_postfilters list").iter().filter_map(Value::as_str).collect()
}

pub fn eco_sigs(d: &DemoKills) -> HashSet<Sig> {
    let (pistols, full_buy) = (weapon_list("PISTOLS"), weapon_list("FULL_BUY"));
    let text_or_empty = |id: EventId, k: &str| {
        let e = d.arena.get(id);
        e.get(k).filter(|v| csdm_core::migrate::truthy(v)).map_or_else(String::new, cfg::py_str)
    };
    d.player_kills
        .iter()
        .filter(|&&id| pistols.contains(norm_weapon(&text_or_empty(id, "weapon")).as_str()))
        .filter(|&&id| {
            let vw = norm_weapon(&text_or_empty(id, "victim_weapon"));
            vw.is_empty() || full_buy.contains(vw.as_str())
        })
        .map(|id| d.sig[id].clone())
        .collect()
}

/// `_apply_db_postfilters`: a filtered copy of `results`; kills first, then the other events.
pub fn apply(cx: &mut Ctx, cfg: &Settings, results: DemoEvents, sids: &[String]) -> Result<DemoEvents, EngineError> {
    // (key, on, excluded, builder) in registry order.
    let filters: Vec<(&str, bool, bool, SigBuilder)> = registries()
        .kill_filters
        .iter()
        .filter_map(|f| behaviour::of(&f.key).db.map(|b| (f.key.as_str(), cfg::on(cfg, &f.key), cfg::on(cfg, &format!("{}_exclude", f.key)), b)))
        .collect();
    let any_excl = filters.iter().any(|f| f.2);
    if !filters.iter().any(|f| f.1) && !any_excl {
        return Ok(results);
    }
    let multi_s = int_cfg(cfg, "kill_mod_multi_kill_s", MULTI_KILL_S_DEFAULT)?.max(MULTI_KILL_S_MIN);
    let p = Params {
        multi_n: int_cfg(cfg, "kill_mod_multi_kill_n", MULTI_KILL_N_DEFAULT)?.max(MULTI_KILL_N_MIN),
        bully_n: int_cfg(cfg, "kill_mod_bully_n", BULLY_N_DEFAULT)?.max(BULLY_N_MIN),
        max_ticks: multi_s * int_cfg(cfg, "tickrate", TICKRATE_DEFAULT)?,
    };
    let sids_set: HashSet<String> = sids.iter().cloned().collect();
    let arena = &cx.arena;
    let mut filtered = DemoEvents::new();
    let mut stamps: Vec<(EventId, BTreeSet<String>)> = Vec::new();

    for (dp, events) in results {
        let kills: Vec<EventId> = events.iter().copied().filter(|&id| is_kill(arena, id)).collect();
        let non_kill: Vec<EventId> = events.iter().copied().filter(|&id| !is_kill(arena, id)).collect();
        if kills.is_empty() {
            filtered.insert(dp, events);
            continue;
        }
        let ksid: HashMap<EventId, String> = kills.iter().map(|&id| (id, arena.get(id).text("killer_sid"))).collect();
        let sig: HashMap<EventId, Sig> = kills.iter().map(|&id| (id, (arena.get(id).tick(), ksid[&id].clone()))).collect();
        let player_kills: Vec<EventId> = kills.iter().copied().filter(|id| sids_set.contains(&ksid[id])).collect();
        let mut rounds_player: IndexMap<String, Vec<EventId>> = IndexMap::new();
        for &id in &player_kills {
            rounds_player.entry(round_key(arena, id)).or_default().push(id);
        }
        let mut rounds_all: IndexMap<String, Vec<EventId>> = IndexMap::new();
        for &id in &kills {
            rounds_all.entry(round_key(arena, id)).or_default().push(id);
        }
        let d = DemoKills { arena, sids: &sids_set, p: &p, kills, player_kills, rounds_player, rounds_all, ksid, sig };

        let mut cache: HashMap<&str, HashSet<Sig>> = HashMap::new();
        let mut per_mod: Vec<(&str, HashSet<Sig>)> = Vec::new();
        for &(key, on, _, build) in &filters {
            if on {
                let sigs = build(&d);
                cache.insert(key, sigs.clone());
                per_mod.push((key, sigs));
            }
        }
        if per_mod.is_empty() && !any_excl {
            continue;
        }
        let all: HashSet<Sig> = d.sig.values().cloned().collect();
        let mut keep: HashSet<Sig> = if per_mod.is_empty() {
            all
        } else {
            let req: Vec<&HashSet<Sig>> = per_mod.iter().filter(|(k, _)| cfg::on(cfg, &format!("{k}_req"))).map(|(_, s)| s).collect();
            match req.split_first() {
                Some((first, rest)) => first.iter().filter(|s| rest.iter().all(|r| r.contains(*s))).cloned().collect(),
                None => all,
            }
        };
        for &(key, _, excl, build) in &filters {
            if excl {
                let sigs = cache.get(key).filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| build(&d));
                keep.retain(|s| !sigs.contains(s));
            }
        }
        let mut sig_keys: HashMap<&Sig, BTreeSet<String>> = HashMap::new();
        for (key, set) in &per_mod {
            for s in set.iter().filter(|s| keep.contains(*s)) {
                sig_keys.entry(s).or_default().insert(key.to_string());
            }
        }
        let mut kept = Vec::new();
        for &id in &d.kills {
            let s = &d.sig[&id];
            if keep.contains(s) {
                if let Some(matched) = sig_keys.get(s).filter(|m| !m.is_empty()) {
                    stamps.push((id, matched.clone()));
                }
                kept.push(id);
            }
        }
        if !kept.is_empty() || !non_kill.is_empty() {
            kept.extend(non_kill);
            filtered.insert(dp, kept);
        }
    }
    for (id, keys) in stamps {
        let e = cx.arena.get_mut(id);
        for k in keys {
            e.stamp_mf(&k);
        }
    }
    Ok(filtered)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::event::Event;
    use serde_json::json;

    fn kill(arena: &mut Arena, tick: i64, killer: &str, victim: &str, round: i64) -> EventId {
        let mut e = Event::default();
        for (k, v) in [("tick", json!(tick)), ("type", json!("kill")), ("weapon", json!("glock")), ("killer_sid", json!(killer)), ("victim_sid", json!(victim)), ("_chk", json!("c")), ("round_idx", json!(round))] {
            e.set(k, v);
        }
        arena.add(e)
    }

    fn demo<'a>(arena: &'a Arena, ids: &[EventId], sids: &'a HashSet<String>, p: &'a Params) -> DemoKills<'a> {
        let ksid: HashMap<EventId, String> = ids.iter().map(|&id| (id, arena.get(id).text("killer_sid"))).collect();
        let sig = ids.iter().map(|&id| (id, (arena.get(id).tick(), ksid[&id].clone()))).collect();
        let player_kills: Vec<EventId> = ids.iter().copied().filter(|id| sids.contains(&ksid[id])).collect();
        let mut rp: IndexMap<String, Vec<EventId>> = IndexMap::new();
        for &id in &player_kills {
            rp.entry(round_key(arena, id)).or_default().push(id);
        }
        let mut ra: IndexMap<String, Vec<EventId>> = IndexMap::new();
        for &id in ids {
            ra.entry(round_key(arena, id)).or_default().push(id);
        }
        DemoKills { arena, sids, p, kills: ids.to_vec(), player_kills, rounds_player: rp, rounds_all: ra, ksid, sig }
    }

    #[test]
    fn entry_is_the_first_kill_of_each_round_by_number() {
        let mut arena = Arena::default();
        // Round 1: an opponent kills first; round 2: the player opens it.
        let ids = vec![kill(&mut arena, 100, "x", "p", 1), kill(&mut arena, 200, "p", "y", 1), kill(&mut arena, 300, "p", "y", 2)];
        let sids: HashSet<String> = ["p".to_string()].into();
        let p = Params { multi_n: 2, max_ticks: 640, bully_n: 2 };
        let d = demo(&arena, &ids, &sids, &p);
        assert_eq!(entry_sigs(&d), [(300, "p".to_string())].into());
        assert_eq!(multi_sigs(&d), HashSet::new(), "one player kill per round");
        assert_eq!(bully_sigs(&d), [(300, "p".to_string())].into(), "the second kill of the same victim");
        assert_eq!(eco_sigs(&d).len(), 2, "pistol kills with no victim weapon count as eco");
    }

    #[test]
    fn rounds_fall_back_to_tick_slices_without_a_number() {
        let mut arena = Arena::default();
        let mut e = Event::default();
        e.set("tick", ROUND_TICKS_FALLBACK + 1);
        let id = arena.add(e);
        assert_eq!(round_key(&arena, id), r#"["",1]"#);
        assert_eq!(norm_weapon(" Weapon_Glock "), "glock");
    }
}
