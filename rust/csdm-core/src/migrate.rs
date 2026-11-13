//! 3.5 settings migrations, replayed in memory on an imported file
//! (3.5 `config.py::_migrate_config` and `shell/sectionLayout.ts::migrateLayout`).
//!
//! Same order as 3.5: key renames first, the card-grid steps last (they read the
//! keys as they finally stand). Every step is idempotent.

use crate::settings::{defaults, reference, Settings};
use serde_json::{json, Map, Value};

/// Python truthiness of a JSON value (3.5 tested stored values with `if x`).
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// Python `==` between JSON values: 9 == 9.0.
fn py_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(Value::Null) | None, Some(Value::Null) | None) => true,
        _ => a == b,
    }
}

/// Python `needle in haystack` for a stored `events` value (list or text).
fn contains(haystack: &Value, needle: &str) -> bool {
    match haystack {
        Value::Array(a) => a.iter().any(|v| v.as_str() == Some(needle)),
        Value::String(s) => s.contains(needle),
        _ => false,
    }
}

/// The old three-way teamkill choice as (event_ally, event_enemy) (3.5 `TEAMKILLS_MODE_SIDES`).
pub fn teamkills_sides(mode: &str) -> Option<(bool, bool)> {
    match mode {
        "include" => Some((true, true)),
        "exclude" => Some((false, true)),
        "only" => Some((true, false)),
        _ => None,
    }
}

/// The 2-axis event keys a flat Kills/Deaths/Rounds list stands for (3.5 `legacy_event_axes`).
pub fn legacy_event_axes(events: &Value, teamkills_mode: &Value) -> Map<String, Value> {
    let lethal = contains(events, "Kills") || contains(events, "Deaths");
    let mut axes = Map::new();
    axes.insert("event_actor".into(), json!(lethal));
    axes.insert("event_target".into(), json!(contains(events, "Deaths")));
    axes.insert("event_lethal".into(), json!(lethal));
    axes.insert("event_enemy".into(), json!(true));
    if let Some((ally, enemy)) = teamkills_mode.as_str().and_then(teamkills_sides) {
        axes.insert("event_ally".into(), json!(ally));
        axes.insert("event_enemy".into(), json!(enemy));
    }
    axes
}

const EVENT_AXIS_KEYS: [&str; 7] =
    ["event_actor", "event_target", "event_lethal", "event_non_lethal", "event_other", "event_ally", "event_enemy"];
const FRENCH_FILTER_NAMES: [(&str, &str); 3] =
    [("kill_mod_sauveur", "kill_mod_savior"), ("kill_mod_bourreau", "kill_mod_bully"), ("kill_mod_bourreau_n", "kill_mod_bully_n")];
const FILTER_SUFFIXES: [&str; 2] = ["_req", "_exclude"];
/// Retired filter key → its replacement (3.5 `_LEGACY_FILTER_KEYS`).
const LEGACY_FILTER_KEYS: [(&str, &str); 1] = [("kill_mod_no_trois_shot", "kill_mod_trois_shot_exclude")];
const DEAD_FILTER_KEYS: [&str; 1] = ["kill_mod_no_trois_shot_req"];

/// Rewrites retired kill-filter keys in place (config and preset data). Idempotent.
pub fn migrate_legacy_filter_keys(d: &mut Map<String, Value>) {
    for (old, new) in LEGACY_FILTER_KEYS {
        if let Some(v) = d.shift_remove(old) {
            if truthy(&v) {
                d.insert(new.into(), json!(true));
            }
        }
    }
    for dead in DEAD_FILTER_KEYS {
        d.shift_remove(dead);
    }
}

/// All config migrations (3.5 `_migrate_config`). `saved` is the file as read,
/// `cfg` the defaults overlaid with it.
pub fn migrate_config(saved: &Map<String, Value>, cfg: &mut Settings) {
    let has = |k: &str| saved.contains_key(k);
    // 1. headshots_only bool → headshots_mode (pre-v140)
    if let (Some(v), false) = (saved.get("headshots_only"), has("headshots_mode")) {
        cfg.insert("headshots_mode".into(), json!(if truthy(v) { "only" } else { "all" }));
    }
    // 2. cs2_minimize → cs2_send_to_back (pre-v155)
    if let (Some(v), false) = (saved.get("cs2_minimize"), has("cs2_send_to_back")) {
        cfg.insert("cs2_send_to_back".into(), json!(truthy(v)));
    }
    // 3. include_suicides bool → suicides_mode (pre-v160)
    if let (Some(v), false) = (saved.get("include_suicides"), has("suicides_mode")) {
        cfg.insert("suicides_mode".into(), json!(if truthy(v) { "include" } else { "exclude" }));
    }
    // 4. French kill-filter names → English (pre-v162)
    for (fr, en) in FRENCH_FILTER_NAMES {
        if let (Some(v), false) = (saved.get(fr), has(en)) {
            cfg.insert(en.into(), v.clone());
        }
        for sfx in FILTER_SUFFIXES {
            if let (Some(v), false) = (saved.get(&format!("{fr}{sfx}")), has(&format!("{en}{sfx}"))) {
                cfg.insert(format!("{en}{sfx}"), v.clone());
            }
        }
    }
    // 5. retired filter keys
    migrate_legacy_filter_keys(cfg);
    // 6. flat `events` list → 2-axis event model, only for a file with no axis key
    if let Some(events) = saved.get("events").filter(|e| truthy(e)) {
        if !EVENT_AXIS_KEYS.iter().any(|k| has(k)) {
            let mode = saved.get("teamkills_mode").cloned().unwrap_or_else(|| json!("include"));
            cfg.extend(legacy_event_axes(events, &mode));
            cfg.insert("events".into(), json!(if contains(events, "Rounds") { vec!["Rounds"] } else { vec![] }));
        }
    }
    // 7. card grid: v2 slots, half-step (v<4), hand-set heights (v4 → v5)
    migrate_card_grid_half_step(saved, cfg);
    migrate_card_grid_manual_heights(cfg);
}

const HALF_STEP_VERSION: f64 = 4.0;
const HALF_STEP_SCALE: i64 = 2;
const MIN_BLOCK_SIZE: f64 = 8.0;
/// A stored layout with no `v` is the oldest schema (sectionLayout.ts).
const UNSTAMPED_LAYOUT_VERSION: f64 = 2.0;
/// Fine rows per v2 block (sectionLayout.ts `ROWS_PER_BLOCK`).
const ROWS_PER_V2_BLOCK: i64 = 4;

/// Today's reference layout of a tab, if the tab exists.
fn base_tab(tab: &str) -> Option<Map<String, Value>> {
    defaults(None)["ui_sections"].get(tab).and_then(Value::as_object).cloned()
}

fn num(slot: &Map<String, Value>, k: &str) -> Option<f64> {
    slot.get(k).and_then(Value::as_f64)
}

/// A pre-v3 slot (`col,row,colSpan,rowSpan`, 1-based, rows in blocks) as x/y/w/h
/// (sectionLayout.ts `migrateLayout`). Other slots are returned unchanged.
fn v2_slot_to_grid(slot: &Map<String, Value>) -> Map<String, Value> {
    let has_xywh = ["x", "y", "w", "h"].iter().all(|k| num(slot, k).is_some());
    let v2 = ["col", "row", "colSpan", "rowSpan"].map(|k| num(slot, k));
    let [Some(col), Some(row), Some(col_span), Some(row_span)] = v2 else { return slot.clone() };
    if has_xywh {
        return slot.clone();
    }
    let mut out = slot.clone();
    for k in ["col", "row", "colSpan", "rowSpan"] {
        out.shift_remove(k);
    }
    out.insert("x".into(), json!((col as i64 - 1).max(0)));
    out.insert("y".into(), json!(((row as i64 - 1) * ROWS_PER_V2_BLOCK).max(0)));
    out.insert("w".into(), json!((col_span as i64).max(1)));
    out.insert("h".into(), json!((row_span as i64 * ROWS_PER_V2_BLOCK).max(1)));
    out
}

/// v<4 → v4: v2 slots converted, then `x`/`w` doubled and the column halved
/// (3.5 `_migrate_card_grid_half_step`). Deviation from 3.5: 3.5 stamped v4 on a
/// v2 layout without converting its slots, so the renderer converted them later
/// without the doubling (cards at half width); here they are converted first.
fn migrate_card_grid_half_step(saved: &Map<String, Value>, cfg: &mut Settings) {
    let Some(Value::Object(sections)) = saved.get("ui_sections") else { return };
    let mut migrated = Map::new();
    let mut touched = false;
    for (tab, layout) in sections {
        let Value::Object(lay) = layout else {
            migrated.insert(tab.clone(), layout.clone());
            continue;
        };
        let version = lay.get("v").and_then(Value::as_f64).unwrap_or(UNSTAMPED_LAYOUT_VERSION);
        if let (true, None, Some(default_tab)) = (version < HALF_STEP_VERSION, lay.get("cards"), base_tab(tab)) {
            // Oldest shape (`order`, `wide`, no rectangles): 3.5's renderer drew the
            // reference layout for it and kept only `collapsed`; same here, stored.
            let collapsed: Vec<Value> = lay.get("collapsed").and_then(Value::as_array).into_iter().flatten().filter(|v| v.is_string()).cloned().collect();
            let mut out = default_tab;
            out.insert("collapsed".into(), Value::Array(collapsed));
            migrated.insert(tab.clone(), Value::Object(out));
            touched = true;
            continue;
        }
        let Some(Value::Object(cards)) = lay.get("cards").filter(|_| version < HALF_STEP_VERSION) else {
            migrated.insert(tab.clone(), layout.clone());
            continue;
        };
        touched = true;
        let mut scaled = Map::new();
        for (id, slot) in cards {
            let Value::Object(slot) = slot else { continue };
            let mut wide = v2_slot_to_grid(slot);
            for k in ["x", "w"] {
                if let Some(v) = num(&wide, k) {
                    wide.insert(k.into(), json!(v as i64 * HALF_STEP_SCALE));
                }
            }
            scaled.insert(id.clone(), Value::Object(wide));
        }
        let mut out = lay.clone();
        out.insert("v".into(), json!(HALF_STEP_VERSION as i64));
        out.insert("cards".into(), Value::Object(scaled));
        migrated.insert(tab.clone(), Value::Object(out));
    }
    if !touched {
        return;
    }
    cfg.insert("ui_sections".into(), Value::Object(migrated));
    if let Some(block) = saved.get("ui_card_block_size").and_then(Value::as_f64).filter(|b| *b > 0.0) {
        // Python `round` rounds half to even.
        let halved = (block / HALF_STEP_SCALE as f64).round_ties_even().max(MIN_BLOCK_SIZE);
        cfg.insert("ui_card_block_size".into(), json!(halved as i64));
    }
}

/// v4 → v5: a card whose height differs from today's default was sized by hand
/// (3.5 `_migrate_card_grid_manual_heights`).
fn migrate_card_grid_manual_heights(cfg: &mut Settings) {
    let Some(Value::Object(sections)) = cfg.get("ui_sections").cloned() else { return };
    let base = defaults(None);
    let defaults_sections = &base["ui_sections"];
    let mut migrated = Map::new();
    let mut touched = false;
    for (tab, layout) in sections {
        let cards = match &layout {
            Value::Object(lay) if lay.get("v").and_then(Value::as_f64) == Some(HALF_STEP_VERSION) => lay.get("cards"),
            _ => None,
        };
        let Some(Value::Object(cards)) = cards else {
            migrated.insert(tab, layout);
            continue;
        };
        touched = true;
        let mut marked = Map::new();
        for (id, slot) in cards {
            let Value::Object(slot) = slot else { continue };
            let mut slot = slot.clone();
            let height = slot.get("hPrev").or_else(|| slot.get("h"));
            let default_h = defaults_sections.get(&tab).and_then(|t| t["cards"].get(id)).and_then(|c| c.get("h"));
            if !py_eq(height, default_h) {
                slot.insert("manual".into(), json!(true));
            }
            marked.insert(id.clone(), Value::Object(slot));
        }
        let mut out = layout.as_object().cloned().unwrap_or_default();
        out.insert("v".into(), json!(reference().ui_sections_version));
        out.insert("cards".into(), Value::Object(marked));
        migrated.insert(tab, Value::Object(out));
    }
    if touched {
        cfg.insert("ui_sections".into(), Value::Object(migrated));
    }
}

/// Fills `saved_players` once from the old window's `csdm_players.json`
/// (3.5 `_import_legacy_players`): deduplicated by `steam_id`, name defaults to it.
pub fn import_legacy_players(cfg: &mut Settings, legacy: Option<&Value>) {
    if cfg.get("saved_players_imported").is_some_and(truthy) {
        return;
    }
    cfg.insert("saved_players_imported".into(), json!(true));
    if cfg.get("saved_players").is_some_and(truthy) {
        return;
    }
    let mut players: Vec<Value> = Vec::new();
    for entry in legacy.and_then(Value::as_array).into_iter().flatten() {
        let text = |k: &str| match entry.get(k) {
            Some(Value::String(s)) => s.clone(),
            Some(v) if truthy(v) => v.to_string(),
            _ => String::new(),
        };
        let steam_id = text("steam_id").trim().to_string();
        if steam_id.is_empty() || players.iter().any(|p| p["steam_id"] == steam_id.as_str()) {
            continue;
        }
        let name = Some(text("name")).filter(|n| !n.is_empty()).unwrap_or_else(|| steam_id.clone());
        players.push(json!({"steam_id": steam_id, "name": name}));
    }
    cfg.insert("saved_players".into(), Value::Array(players));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(saved: Value) -> Settings {
        let saved = saved.as_object().unwrap().clone();
        let mut cfg = defaults(None);
        cfg.extend(saved.clone());
        migrate_config(&saved, &mut cfg);
        cfg
    }

    #[test]
    fn renamed_keys() {
        let c = run(json!({"headshots_only": true, "cs2_minimize": 1, "include_suicides": false}));
        assert_eq!((&c["headshots_mode"], &c["cs2_send_to_back"], &c["suicides_mode"]), (&json!("only"), &json!(true), &json!("exclude")));
        // a file that already has the new key keeps it
        let c = run(json!({"headshots_only": true, "headshots_mode": "exclude"}));
        assert_eq!(c["headshots_mode"], json!("exclude"));
    }

    #[test]
    fn french_filter_names() {
        let c = run(json!({"kill_mod_sauveur": true, "kill_mod_bourreau_n_req": true, "kill_mod_bourreau_exclude": true}));
        assert_eq!((&c["kill_mod_savior"], &c["kill_mod_bully_n_req"], &c["kill_mod_bully_exclude"]), (&json!(true), &json!(true), &json!(true)));
    }

    #[test]
    fn retired_trois_shot_keys() {
        let c = run(json!({"kill_mod_no_trois_shot": true, "kill_mod_no_trois_shot_req": true}));
        assert_eq!(c["kill_mod_trois_shot_exclude"], json!(true));
        assert!(!c.contains_key("kill_mod_no_trois_shot") && !c.contains_key("kill_mod_no_trois_shot_req"));
    }

    #[test]
    fn flat_events_become_axes_only_without_axis_keys() {
        let c = run(json!({"events": ["Kills", "Deaths", "Rounds"], "teamkills_mode": "exclude"}));
        assert_eq!(c["event_target"], json!(true));
        assert_eq!((&c["event_ally"], &c["event_enemy"]), (&json!(false), &json!(true)));
        assert_eq!(c["events"], json!(["Rounds"]));
        // the real file: `events: ["Kills"]` next to axis keys → untouched (research/05)
        let c = run(json!({"events": ["Kills"], "event_actor": false}));
        assert_eq!((&c["events"], &c["event_actor"]), (&json!(["Kills"]), &json!(false)));
    }

    #[test]
    fn half_step_doubles_columns_and_halves_block() {
        let c = run(json!({"ui_card_block_size": 96, "ui_sections": {"video": {"v": 3, "cards": {"encoding": {"x": 1, "y": 3, "w": 4, "h": 14}}}}}));
        let slot = &c["ui_sections"]["video"]["cards"]["encoding"];
        assert_eq!((&slot["x"], &slot["y"], &slot["w"], &slot["h"]), (&json!(2), &json!(3), &json!(8), &json!(14)));
        assert_eq!(c["ui_card_block_size"], json!(48));
        assert_eq!(c["ui_sections"]["video"]["v"], json!(5));
        assert_eq!(slot.get("manual"), None, "default height 14 is not hand-set");
    }

    #[test]
    fn block_size_rounds_half_to_even_with_a_floor() {
        let block = |b: Value| run(json!({"ui_card_block_size": b, "ui_sections": {"tags": {"v": 3, "cards": {}}}}))["ui_card_block_size"].clone();
        assert_eq!(block(json!(25)), json!(12));
        assert_eq!(block(json!(10)), json!(8));
    }

    #[test]
    fn v2_and_unstamped_slots_are_converted_then_doubled() {
        let c = run(json!({"ui_sections": {"tags": {"cards": {"tag-grid": {"col": 2, "row": 3, "colSpan": 4, "rowSpan": 2}}}}}));
        let slot = &c["ui_sections"]["tags"]["cards"]["tag-grid"];
        assert_eq!((&slot["x"], &slot["y"], &slot["w"], &slot["h"]), (&json!(2), &json!(8), &json!(8), &json!(8)));
        assert_eq!(slot["manual"], json!(true), "8 rows differs from the default 10");
        assert!(slot.get("col").is_none());
    }

    #[test]
    fn card_list_layout_becomes_the_default_grid() {
        // Oldest shape, seen in three real folders: an order and flags, no rectangles.
        let c = run(json!({"ui_card_block_size": 96, "ui_sections": {
            "capture": {"order": ["player"], "collapsed": ["player", 3], "wide": {"player": true}}}}));
        let tab = &c["ui_sections"]["capture"];
        let d = defaults(None);
        assert_eq!(tab["cards"], d["ui_sections"]["capture"]["cards"]);
        assert_eq!((&tab["v"], &tab["collapsed"]), (&json!(5), &json!(["player"])));
        assert!(tab.get("order").is_none() && tab.get("wide").is_none());
        assert_eq!(c["ui_card_block_size"], json!(48), "default rectangles count 48 px columns");
    }

    #[test]
    fn v4_heights_differing_from_default_are_manual() {
        let c = run(json!({"ui_sections": {"tags": {"v": 4, "cards": {
            "tag-grid": {"x": 0, "y": 0, "w": 15, "h": 10.0},
            "tag-range": {"x": 0, "y": 10, "w": 6, "h": 2, "hPrev": 12}}}}}));
        let cards = &c["ui_sections"]["tags"]["cards"];
        assert_eq!(cards["tag-grid"].get("manual"), None, "10.0 equals the default 10");
        assert_eq!(cards["tag-range"]["manual"], json!(true));
    }

    #[test]
    fn v5_layout_is_left_alone() {
        let d = defaults(None);
        let c = run(json!({"ui_sections": d["ui_sections"].clone()}));
        assert_eq!(c["ui_sections"], d["ui_sections"]);
    }

    #[test]
    fn legacy_players_imported_once() {
        let mut cfg = defaults(None);
        let legacy = json!([{"steam_id": "765", "name": "A"}, {"steam_id": "765", "name": "dup"}, {"steam_id": " 9 ", "name": ""}, {"name": "no id"}]);
        import_legacy_players(&mut cfg, Some(&legacy));
        assert_eq!(cfg["saved_players"], json!([{"steam_id": "765", "name": "A"}, {"steam_id": "9", "name": "9"}]));
        assert_eq!(cfg["saved_players_imported"], json!(true));
        // a list the user emptied later is never refilled
        cfg.insert("saved_players".into(), json!([]));
        import_legacy_players(&mut cfg, Some(&legacy));
        assert_eq!(cfg["saved_players"], json!([]));
    }
}
