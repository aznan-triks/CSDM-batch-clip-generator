//! Shared modifier layer: kill filters evaluated on damage / shot / round events (3.5
//! `_apply_shared_modifiers` and the C5bis rules and groups it calls).
//!
//! Positions (`player_positions`) never exist when the query runs (T3 Conception, row 8: E), so
//! AIRBORNE judges a non-kill event by its own vertical velocity only, as 3.5 did in practice.

use super::{behaviour, num, Ctx};
use crate::preview::cfg;
use crate::preview::event::{Arena, Event, EventId};
use crate::preview::DemoEvents;
use csdm_core::preview::preview;
use csdm_core::registries::{registries, FilterDef};
use csdm_core::settings::def;
use csdm_core::Settings;
use indexmap::IndexMap;
use serde_json::{Map, Value};
use std::collections::BTreeSet;

/// A rule on one event's own columns; `n` is the filter's numeric setting.
pub type EventRule = fn(&Event, Option<f64>) -> bool;
/// A rule on a set of events: (members, the member whose clip is kept).
pub type GroupRule = fn(&Arena, &[EventId], f64) -> Vec<(Vec<EventId>, EventId)>;

const GROUP_FIRST: &str = "first";
const GROUP_DUP: &str = "dup";
const GRENADE: &str = "grenade";
const AIRBORNE_SPEED_KEY: &str = "airborne_shot_speed_z";

/// `_event_category`: "kill" | "damage" | "shot" | "round", `None` for an unknown type.
pub fn event_category(e: &Event) -> Option<&'static str> {
    preview()["event_categories"].get(e.get("type")?.as_str()?)?.as_str()
}

/// Python `a == b` on two field values (numbers by value).
fn py_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Bool(x), Value::Number(y)) | (Value::Number(y), Value::Bool(x)) => y.as_f64() == Some(f64::from(u8::from(*x))),
        _ => a == b,
    }
}

/// `str(e.get(key))`: an absent key reads as "None".
fn py_text(e: &Event, key: &str) -> String {
    e.get(key).map_or_else(|| "None".into(), cfg::py_str)
}

/// `str(e.get(key) or "")`.
fn text_or_empty(e: &Event, key: &str) -> String {
    e.get(key).filter(|v| csdm_core::migrate::truthy(v)).map_or_else(String::new, cfg::py_str)
}

fn hit_zone(e: &Event, zone: &str) -> bool {
    let Some(hg) = num(e.get("hitgroup")) else { return false };
    preview()["damage_hitgroups"][zone].as_array().expect("damage_hitgroups zone is a list").iter().any(|z| z.as_f64() == Some(hg))
}

pub fn rule_headshot_hit(e: &Event, _n: Option<f64>) -> bool {
    hit_zone(e, "head")
}
pub fn rule_body_hit(e: &Event, _n: Option<f64>) -> bool {
    hit_zone(e, "body")
}
pub fn rule_arm_hit(e: &Event, _n: Option<f64>) -> bool {
    hit_zone(e, "arm")
}
pub fn rule_leg_hit(e: &Event, _n: Option<f64>) -> bool {
    hit_zone(e, "leg")
}
pub fn rule_big_hit(e: &Event, n: Option<f64>) -> bool {
    matches!((num(e.get("health_damage")), n), (Some(hp), Some(n)) if hp >= n)
}
pub fn rule_low_hp(e: &Event, n: Option<f64>) -> bool {
    matches!((num(e.get("victim_new_health")), n), (Some(left), Some(n)) if 1.0 <= left && left <= n)
}
pub fn rule_team_damage(e: &Event, _n: Option<f64>) -> bool {
    match (e.get("attacker_side"), e.get("victim_side")) {
        (Some(a), v) if !a.is_null() => py_eq(a, v.unwrap_or(&Value::Null)) && py_text(e, "attacker_sid") != py_text(e, "victim_sid"),
        _ => false,
    }
}
pub fn rule_knife_swing(e: &Event, _n: Option<f64>) -> bool {
    e.get("type").and_then(Value::as_str) == Some("knife_swing")
}
pub fn rule_run_gun(e: &Event, n: Option<f64>) -> bool {
    let w = text_or_empty(e, "weapon").trim().to_lowercase();
    if !registries().gun_weapons.contains(&w) {
        return false;
    }
    match (num(e.get("player_velocity_x")), num(e.get("player_velocity_y")), n) {
        (Some(vx), Some(vy), Some(n)) => (vx * vx + vy * vy).sqrt() >= n,
        _ => false,
    }
}

/// `_filter_setting`: the filter's numeric setting (text fields send strings), else its default.
pub fn filter_setting(cfg: &Settings, f: &FilterDef) -> Option<f64> {
    let (key, default) = f.extra_config.as_ref()?.iter().next()?;
    num(cfg.get(key)).or_else(|| num(Some(default)))
}

/// A JSON key for a tuple of field values (Python dict keys of `e.get(...)` tuples).
fn tuple_key(e: &Event, keys: &[&str]) -> String {
    Value::Array(keys.iter().map(|k| e.get(k).cloned().unwrap_or(Value::Null)).collect()).to_string()
}

fn tick_or_zero(arena: &Arena, id: EventId) -> f64 {
    num(arena.get(id).get("tick")).unwrap_or(0.0)
}

/// `_multi_nade_groups`: one grenade (`weapon_unique_id`) that hurt at least n distinct players,
/// the thrower never counted; the group's clip is its first impact.
pub fn multi_nade_groups(arena: &Arena, events: &[EventId], n: f64) -> Vec<(Vec<EventId>, EventId)> {
    let mut nades: IndexMap<String, (String, Vec<EventId>)> = IndexMap::new();
    for &id in events {
        let e = arena.get(id);
        if event_category(e) != Some("damage") || text_or_empty(e, "weapon_type").to_lowercase() != GRENADE {
            continue;
        }
        if !e.get("weapon_unique_id").is_some_and(csdm_core::migrate::truthy) {
            continue;
        }
        nades.entry(tuple_key(e, &["attacker_sid", "weapon_unique_id"])).or_insert_with(|| (py_text(e, "attacker_sid"), Vec::new())).1.push(id);
    }
    let mut out = Vec::new();
    for (_, (thrower, mut members)) in nades {
        let victims: BTreeSet<String> = members.iter().map(|&id| py_text(arena.get(id), "victim_sid")).filter(|v| *v != thrower).collect();
        if victims.len() as f64 >= n {
            members.sort_by(|a, b| tick_or_zero(arena, *a).total_cmp(&tick_or_zero(arena, *b)));
            let first = members[0];
            out.push((members, first));
        }
    }
    out
}

/// `_long_spray_groups`: bursts (one player, one weapon, recoil index climbing) whose recoil
/// reaches n; the clip is the shot reaching n. A drop starts the next burst.
pub fn long_spray_groups(arena: &Arena, events: &[EventId], n: f64) -> Vec<(Vec<EventId>, EventId)> {
    let mut seqs: IndexMap<String, Vec<EventId>> = IndexMap::new();
    for &id in events {
        let e = arena.get(id);
        if e.get("type").and_then(Value::as_str) != Some("shot") {
            continue;
        }
        seqs.entry(tuple_key(e, &["attacker_sid", "weapon"])).or_default().push(id);
    }
    let recoil = |id: EventId| num(arena.get(id).get("recoil_index"));
    let mut out = Vec::new();
    for (_, mut shots) in seqs {
        shots.sort_by(|a, b| tick_or_zero(arena, *a).total_cmp(&tick_or_zero(arena, *b)));
        let mut burst: Vec<EventId> = Vec::new();
        let mut prev: Option<f64> = None;
        for e in shots.iter().copied().map(Some).chain([None]) {
            let r = e.and_then(recoil);
            let breaks = match (e, r, prev) {
                (Some(_), Some(r), Some(p)) => r <= p,
                _ => true,
            };
            if breaks {
                if let Some(&reach) = burst.iter().find(|&&b| recoil(b).unwrap_or(0.0) >= n) {
                    out.push((std::mem::take(&mut burst), reach));
                }
                burst.clear();
            }
            if let (Some(e), Some(_)) = (e, r) {
                burst.push(e);
            }
            prev = r;
        }
    }
    out
}

fn active(cfg: &Settings, key: &str) -> bool {
    cfg::on(cfg, key) || cfg::on(cfg, &format!("{key}_exclude"))
}

/// `_stamp_group_modifiers`: every member of a group gets `_grp[key]` = "first" or "dup".
fn stamp_groups(cx: &mut Ctx, cfg: &Settings, events: &[EventId]) {
    for f in &registries().kill_filters {
        let Some(rule) = behaviour::of(&f.key).group else { continue };
        if !active(cfg, &f.key) {
            continue;
        }
        let n = filter_setting(cfg, f).expect("a group filter has a numeric setting");
        for (members, first) in rule(&cx.arena, events, n) {
            for id in members {
                let e = cx.arena.get_mut(id);
                let grp = e.fields.entry("_grp").or_insert_with(|| Value::Object(Map::new()));
                if let Value::Object(g) = grp {
                    g.insert(f.key.clone(), Value::from(if id == first { GROUP_FIRST } else { GROUP_DUP }));
                }
            }
        }
    }
}

/// `_event_airborne` without positions: a shot carries its vertical velocity (0 on the ground).
fn airborne(cx: &Ctx, cfg: &Settings, e: &Event) -> bool {
    let Some(vz) = e.get("player_velocity_z").filter(|v| !v.is_null()) else {
        return false; // no positions frame exists when the query runs
    };
    let Some(vz) = num(Some(vz)) else { return false };
    let default = def(AIRBORNE_SPEED_KEY).and_then(|d| d.default.as_f64()).expect("airborne_shot_speed_z is a number setting");
    vz.abs() > cfg::cfg_float(cx.ports, cfg, AIRBORNE_SPEED_KEY, default, Some(0.0), None)
}

/// `_check_modifier`: does one filter match one event.
fn check(cx: &Ctx, cfg: &Settings, f: &FilterDef, e: &Event) -> bool {
    let b = behaviour::of(&f.key);
    if b.group.is_some() {
        return e.get("_grp").and_then(Value::as_object).is_some_and(|g| g.contains_key(&f.key));
    }
    if let Some(rule) = b.rule {
        return rule(e, filter_setting(cfg, f));
    }
    let cols: &[String] = f.sql_cols.as_deref().unwrap_or(&[]);
    if preview()["filters"][&f.key]["needs_positions"] == true {
        // AIRBORNE (no column): velocity; NO-SCOPE: its column when the event carries one.
        if cols.is_empty() {
            return airborne(cx, cfg, e);
        }
        return cols.iter().find_map(|c| e.get(c).filter(|v| !v.is_null())).is_some_and(csdm_core::migrate::truthy);
    }
    cols.iter().any(|c| e.get(c).is_some_and(csdm_core::migrate::truthy))
}

/// `_evaluate_modifiers_for_event`: the active filters that apply to the event's category and match.
fn evaluate(cx: &Ctx, cfg: &Settings, e: &Event) -> BTreeSet<String> {
    let Some(category) = event_category(e) else { return BTreeSet::new() };
    registries()
        .kill_filters
        .iter()
        .filter(|f| f.applies_to.iter().any(|a| a == category) && active(cfg, &f.key) && check(cx, cfg, f, e))
        .map(|f| f.key.clone())
        .collect()
}

/// `_apply_shared_modifiers`: groups first, then `_mf` on every non-kill event.
pub fn apply_shared(cx: &mut Ctx, cfg: &Settings, results: &DemoEvents) {
    for events in results.values() {
        stamp_groups(cx, cfg, events);
    }
    for &id in results.values().flatten() {
        if event_category(cx.arena.get(id)) == Some("kill") {
            continue;
        }
        let mf = evaluate(cx, cfg, cx.arena.get(id));
        if !mf.is_empty() {
            cx.arena.get_mut(id).mf.get_or_insert_with(BTreeSet::new).extend(mf);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ev(v: Value) -> Event {
        Event { fields: v.as_object().unwrap().clone(), mf: None }
    }

    #[test]
    fn damage_rules() {
        let e = ev(json!({"tick": 1, "type": "damage_actor", "hitgroup": 1, "health_damage": 95, "victim_new_health": 3,
                          "attacker_side": 2, "victim_side": 2.0, "attacker_sid": "a", "victim_sid": "b"}));
        assert!(rule_headshot_hit(&e, None) && !rule_body_hit(&e, None));
        assert!(rule_big_hit(&e, Some(90.0)) && !rule_big_hit(&e, Some(96.0)));
        assert!(rule_low_hp(&e, Some(5.0)) && !rule_low_hp(&e, Some(2.0)));
        assert!(rule_team_damage(&e, None), "2 == 2.0 in Python");
        let self_hit = ev(json!({"attacker_side": "T", "victim_side": "T", "attacker_sid": "a", "victim_sid": "a"}));
        assert!(!rule_team_damage(&self_hit, None));
    }

    #[test]
    fn run_and_gun_needs_a_gun_and_speed() {
        let e = ev(json!({"weapon": "AK47 ", "player_velocity_x": 150.0, "player_velocity_y": 150.0}));
        assert!(rule_run_gun(&e, Some(200.0)));
        let knife = ev(json!({"weapon": "knife", "player_velocity_x": 300.0, "player_velocity_y": 0.0}));
        assert!(!rule_run_gun(&knife, Some(200.0)));
    }

    #[test]
    fn long_spray_bursts_restart_on_a_recoil_drop() {
        let mut arena = Arena::default();
        let shot = |t: i64, r: f64| ev(json!({"tick": t, "type": "shot", "attacker_sid": "a", "weapon": "ak47", "recoil_index": r}));
        let ids: Vec<EventId> = [(1, 1.0), (2, 2.0), (3, 3.0), (4, 1.0), (5, 2.0)].iter().map(|&(t, r)| arena.add(shot(t, r))).collect();
        let groups = long_spray_groups(&arena, &ids, 3.0);
        assert_eq!(groups, vec![(vec![ids[0], ids[1], ids[2]], ids[2])]);
    }

    #[test]
    fn multi_nade_counts_distinct_victims_but_not_the_thrower() {
        let mut arena = Arena::default();
        let hit = |t: i64, v: &str| ev(json!({"tick": t, "type": "damage_actor", "weapon_type": "Grenade", "weapon_unique_id": "u1", "attacker_sid": "a", "victim_sid": v}));
        let ids: Vec<EventId> = [(5, "b"), (3, "a"), (4, "c")].iter().map(|&(t, v)| arena.add(hit(t, v))).collect();
        assert!(multi_nade_groups(&arena, &ids, 3.0).is_empty(), "two victims, the thrower does not count");
        let g = multi_nade_groups(&arena, &ids, 2.0);
        assert_eq!(g, vec![(vec![ids[1], ids[2], ids[0]], ids[1])]);
    }

    #[test]
    fn setting_falls_back_to_the_default() {
        let f = registries().kill_filters.iter().find(|f| f.key == "dmg_mod_big_hit").unwrap();
        let cfg: Settings = serde_json::from_value(json!({"dmg_mod_big_hit_min": "x"})).unwrap();
        assert_eq!(filter_setting(&cfg, f), Some(90.0));
        let cfg: Settings = serde_json::from_value(json!({"dmg_mod_big_hit_min": " 70 "})).unwrap();
        assert_eq!(filter_setting(&cfg, f), Some(70.0));
    }
}
