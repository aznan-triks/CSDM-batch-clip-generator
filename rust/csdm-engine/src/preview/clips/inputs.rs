//! Settings that can only ever give zero results (3.5 `run_inputs_problem` and the checks it walks:
//! `_problem_*`, `_event_source_blockers`, `_dead_filter_reason`). The first sentence wins.

use crate::preview::cfg::{derive_event_flags, on, py_str};
use crate::preview::dates::epoch_bounds;
use csdm_core::migrate::truthy;
use csdm_core::registries::registries;
use csdm_core::Settings;
use serde_json::Value;

/// `_NEVER_MATCHING_FILTERS`: (filter key, dead given the derived flags, why).
type NeverMatching = (&'static str, fn(&Settings) -> bool, &'static str);
const NEVER_MATCHING_FILTERS: [NeverMatching; 1] = [(
    "dmg_mod_team_damage",
    |flags| !on(flags, "_events_ally"),
    "TEAM DAMAGE only matches damage to a teammate, and Ally is unticked (Capture & Timing > Event Type): tick Ally or turn TEAM DAMAGE off (Damage Filters).",
)];

/// `_dead_filter_reason`: why the active filters let no `category` event through, or none. An
/// event must match every ★ filter that applies to it and at least one optional one.
fn dead_filter_reason(cfg: &Settings, flags: &Settings, category: &str) -> Option<&'static str> {
    let active: Vec<&str> = registries().kill_filters.iter().filter(|f| on(cfg, &f.key) && f.applies_to.iter().any(|c| c == category)).map(|f| f.key.as_str()).collect();
    let (required, optional) = crate::preview::cfg::split_required_optional(cfg, &active);
    let dead = |k: &str| NEVER_MATCHING_FILTERS.iter().find(|(key, is_dead, _)| *key == k && is_dead(flags)).map(|(_, _, why)| *why);
    if let Some(why) = required.iter().find_map(|k| dead(k)) {
        return Some(why);
    }
    if !optional.is_empty() && optional.iter().all(|k| dead(k).is_some()) {
        return dead(optional[0]);
    }
    None
}

/// `_event_source_blockers`: (source, why it is empty or none) for each source the settings turn on.
fn event_source_blockers(cfg: &Settings) -> Vec<(&'static str, Option<&'static str>)> {
    let flags = derive_event_flags(cfg);
    let perspective = if cfg.contains_key("event_actor") || cfg.contains_key("event_target") {
        on(&flags, "_events_actor") || on(&flags, "_events_target")
    } else {
        // Pre-2-axis settings: their `events` list names a perspective.
        let legacy = cfg.get("events").filter(|v| truthy(v));
        legacy.and_then(Value::as_array).is_some_and(|a| a.iter().any(|v| v == "Kills" || v == "Deaths"))
    };
    let teams_off = !(on(&flags, "_events_ally") || on(&flags, "_events_enemy"));
    let teams_why = "Ally and Enemy are both unticked (Capture & Timing > Event Type), so no kill or damage can match: tick Ally, Enemy or both.";
    let persp_why = "Select at least one perspective (Actor / Target) or enable Rounds.";
    let shot_why = "Other (shots) only captures your own shots: tick Actor (Capture & Timing > Event Type).";
    let structural = if !perspective {
        Some(persp_why)
    } else if teams_off {
        Some(teams_why)
    } else {
        None
    };
    let candidates = [
        ("kill", cfg.get("event_lethal").is_none_or(truthy), structural),
        ("damage", on(&flags, "_events_non_lethal"), structural),
        ("shot", on(&flags, "_events_other"), if on(&flags, "_events_actor") { None } else { Some(shot_why) }),
        ("round", on(&flags, "_events_rounds"), None),
    ];
    candidates.into_iter().filter(|c| c.1).map(|(source, _, why)| (source, why.or_else(|| dead_filter_reason(cfg, &flags, source)))).collect()
}

fn problem_no_account(cfg: &Settings) -> Option<String> {
    (!on(cfg, "steam_ids")).then(|| "Pick at least one player: CAPTURE › Player, search your name or Steam ID, then click the row.".into())
}

fn problem_no_live_source(cfg: &Settings) -> Option<String> {
    let blockers = event_source_blockers(cfg);
    if blockers.is_empty() {
        return Some("No event type is ticked (Capture & Timing > Event Type): tick Lethal, Non-lethal or Other, or enable Rounds.".into());
    }
    if blockers.iter().any(|b| b.1.is_none()) {
        return None;
    }
    let mut whys: Vec<&str> = Vec::new();
    for why in blockers.iter().filter_map(|b| b.1) {
        if !whys.contains(&why) {
            whys.push(why);
        }
    }
    Some(whys.join(" "))
}

fn problem_empty_date_range(cfg: &Settings) -> Option<String> {
    let (from, to) = epoch_bounds(cfg);
    let shown = |k: &str| cfg.get(k).map_or_else(|| "None".into(), py_str);
    match (from, to) {
        (Some(f), Some(t)) if f > t => Some(format!(
            "The date range is empty: From {} is after To {}. Fix the dates in Demo Selection.",
            shown("date_from"),
            shown("date_to")
        )),
        _ => None,
    }
}

fn problem_empty_match_types(cfg: &Settings) -> Option<String> {
    let any_type = registries().match_types.iter().any(|m| on(cfg, &m.key));
    (on(cfg, "match_type_filter_enabled") && !any_type).then(|| {
        "The Match Types filter is on but no match type is ticked (CAPTURE › Match Types): tick at least one type, or switch the filter off to keep every match.".into()
    })
}

fn problem_empty_map_filter(cfg: &Settings) -> Option<String> {
    (on(cfg, "map_filter_enabled") && !on(cfg, "map_filter")).then(|| {
        "The Map Filter is on but no map is selected (CAPTURE › Map Filter): select at least one map, or switch the filter off to keep every map.".into()
    })
}

/// `_RUN_INPUT_CHECKS`, in order.
type Check = fn(&Settings) -> Option<String>;
const RUN_INPUT_CHECKS: [Check; 5] = [problem_no_account, problem_no_live_source, problem_empty_date_range, problem_empty_match_types, problem_empty_map_filter];

/// `run_inputs_problem`: why `cfg` (a run cfg) cannot run, preview or search, in the user's words.
pub fn run_inputs_problem(cfg: &Settings) -> Option<String> {
    RUN_INPUT_CHECKS.iter().find_map(|check| check(cfg))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::cfg::build_run_cfg;
    use csdm_core::preview::preview;
    use serde_json::json;

    fn problem(v: Value) -> Option<String> {
        run_inputs_problem(&build_run_cfg(&serde_json::from_value(v).unwrap()))
    }

    #[test]
    fn never_matching_table_matches_the_exported_flags() {
        let flagged: Vec<&str> = preview()["filters"].as_object().unwrap().iter().filter(|(_, t)| t["never_matching"] == json!(true)).map(|(k, _)| k.as_str()).collect();
        let ours: Vec<&str> = NEVER_MATCHING_FILTERS.iter().map(|n| n.0).collect();
        assert_eq!(flagged, ours);
    }

    #[test]
    fn first_problem_wins() {
        assert!(problem(json!({})).unwrap().starts_with("Pick at least one player"));
        let legacy = problem(json!({"steam_ids": ["1"]}));
        assert_eq!(legacy.as_deref(), Some("Select at least one perspective (Actor / Target) or enable Rounds."), "no 2-axis key: the empty `events` list names no perspective");
        let ok = json!({"steam_ids": ["1"], "event_actor": true});
        assert_eq!(problem(ok), None);
        let p = problem(json!({"steam_ids": ["1"], "event_actor": false, "event_target": false}));
        assert_eq!(p.as_deref(), Some("Select at least one perspective (Actor / Target) or enable Rounds."));
        let p = problem(json!({"steam_ids": ["1"], "event_actor": true, "event_lethal": false}));
        assert!(p.unwrap().starts_with("No event type is ticked"));
        let p = problem(json!({"steam_ids": ["1"], "event_actor": true, "date_from": "02-01-2024", "date_to": "01-01-2024"}));
        assert_eq!(p.as_deref(), Some("The date range is empty: From 02-01-2024 is after To 01-01-2024. Fix the dates in Demo Selection."));
        assert!(problem(json!({"steam_ids": ["1"], "event_actor": true, "match_type_filter_enabled": true})).unwrap().starts_with("The Match Types filter"));
        assert!(problem(json!({"steam_ids": ["1"], "event_actor": true, "map_filter_enabled": true, "map_filter": []})).unwrap().starts_with("The Map Filter"));
    }

    #[test]
    fn team_damage_without_ally_empties_the_damage_source() {
        let base = json!({"steam_ids": ["1"], "event_actor": true, "event_lethal": false, "event_non_lethal": true, "dmg_mod_team_damage": true});
        assert!(problem(base.clone()).unwrap().starts_with("TEAM DAMAGE only matches"));
        let mut with_ally = base;
        with_ally["event_ally"] = json!(true);
        assert_eq!(problem(with_ally), None);
        // Deduplicated: two blocked sources with the same reason say it once.
        let p = problem(json!({"steam_ids": ["1"], "event_actor": true, "event_non_lethal": true, "event_ally": false, "event_enemy": false})).unwrap();
        assert!(p.starts_with("Ally and Enemy are both unticked") && p.matches("Ally and Enemy").count() == 1);
    }
}
