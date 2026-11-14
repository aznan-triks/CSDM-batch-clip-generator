//! Driven tests of the CAPTURE tab, one per « CAPTURE » parity line (research/04), no window.
//!
//! The engine's answers to `connect_db`, `describe_filters` and `list_demos` are the scenario
//! recorded from the real engine on the author's database and anonymised
//! (`csdm-engine/examples/record_capture.rs` → `tests/fixtures/capture-scenario.json`); the
//! start-up and the settings round trip answer as the real engine does (`load_config` gives the
//! settings, `save_config` and `run_inputs_problem` accept).

use csdm_app::grid::TabView;
use csdm_app::tabs::capture::kit::{seen_id, Seen};
use csdm_app::tabs::capture::model::filter_rows;
use csdm_app::tabs::capture::CaptureTab;
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_engine::{Command, Engine, EngineEvent};
use eframe::egui;
use egui::accesskit::Role;
use egui_kittest::kittest::{NodeT, Queryable};
use egui_kittest::Harness;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

/// Tall enough that every card of the tab is drawn on screen: clicks land where nodes are.
const SIZE: egui::Vec2 = egui::Vec2::new(1600.0, 4400.0);
const STEP_DT: f32 = 1.0 / 60.0;
const SCENARIO: &str = include_str!("fixtures/capture-scenario.json");
/// The first impossible-to-be-real Steam ID of the fixture (`record_capture.rs`).
const FIRST_REAL_STEAM_ID: u64 = 76_561_197_960_265_728;

fn recorded() -> HashMap<String, Value> {
    let s: Value = serde_json::from_str(SCENARIO).unwrap();
    s["steps"].as_array().unwrap().iter().map(|st| (st["on"].as_str().unwrap().to_string(), st["reply"]["ok"].clone())).collect()
}

pub fn tables() -> Value {
    recorded()["describe_filters"]["data"].clone()
}

/// Recorded replies by command name; the start-up and the settings round trip as the real engine.
struct Canned {
    replies: HashMap<String, Value>,
    settings: Value,
    sent: Arc<Mutex<Vec<Command>>>,
    tx: Sender<EngineEvent>,
    rx: Receiver<EngineEvent>,
    next: u64,
}

impl Engine for Canned {
    fn send(&mut self, command: Command) -> u64 {
        self.next += 1;
        let id = self.next;
        let reply = match command.name() {
            "hello" => json!({"data": {"app_version": "5.0.0-dev"}}),
            "load_config" => json!({"data": self.settings}),
            "save_config" => json!({}),
            "run_inputs_problem" => json!({"problem": null}),
            name => self.replies.get(name).cloned().unwrap_or_else(|| panic!("no recorded reply for {name}")),
        };
        self.sent.lock().unwrap().push(command);
        self.tx.send(EngineEvent::Reply { id, result: Ok(reply) }).unwrap();
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        &self.rx
    }
}

struct Rig {
    h: Harness<'static, Shell>,
    sent: Arc<Mutex<Vec<Command>>>,
    _export: tempfile::TempDir,
}

fn rig_with(settings: Value, replies: HashMap<String, Value>) -> Rig {
    let (tx, rx) = channel();
    let sent = Arc::new(Mutex::new(Vec::new()));
    let engine = Canned { replies, settings, sent: sent.clone(), tx, rx, next: 0 };
    let export = tempfile::tempdir().unwrap();
    let dir = export.path().to_path_buf();
    let mut tab = CaptureTab::new();
    tab.today = chrono::NaiveDate::from_ymd_opt(2026, 11, 14);
    let mut b = Harness::builder().with_size(SIZE).with_step_dt(STEP_DT).with_max_steps(400);
    if std::env::var_os("CSDM_RENDER_OUT").is_some() {
        // Same backend choice as `common::rig_with` (DX12 crashes headless here).
        if std::env::var_os("WGPU_BACKEND").is_none() {
            std::env::set_var("WGPU_BACKEND", "gl");
        }
        b = b.wgpu();
    }
    let h = b.build_eframe(move |cc| {
        Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion: Motion::Still, export_dir: dir }).with_tab(TabId::Capture, Box::new(tab))
    });
    let mut r = Rig { h, sent, _export: export };
    r.h.run();
    r.h.run();
    r
}

fn rig(settings: Value) -> Rig {
    rig_with(settings, recorded())
}

impl Rig {
    fn click(&mut self, label: &str) {
        self.h.get_by_label(label).click();
        self.h.run();
    }
    fn setting(&self, key: &str) -> Value {
        self.h.state().link.get(key).cloned().unwrap_or(Value::Null)
    }
    fn tab(&mut self) -> &mut CaptureTab {
        self.h.state_mut().view::<CaptureTab>(TabId::Capture).expect("capture tab")
    }
    fn sent(&self) -> Vec<String> {
        self.sent.lock().unwrap().iter().map(|c| c.name().to_string()).collect()
    }
    fn has(&self, label: &str) -> bool {
        self.h.query_by_label(label).is_some()
    }
    /// The box, not the caption drawn beside it under the same words.
    fn field<'a>(&'a self, label: &'a str) -> egui_kittest::Node<'a> {
        self.h.query_by_role_and_label(Role::TextInput, label).unwrap_or_else(|| self.h.get_by_role_and_label(Role::SearchInput, label))
    }
    fn type_into(&mut self, label: &str, text: &str) {
        self.field(label).click();
        self.h.run();
        self.h.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::A);
        self.h.key_press(egui::Key::Backspace);
        self.h.run();
        self.field(label).type_text(text);
        self.h.run();
    }
    fn drag(&mut self, from: egui::Pos2, to: egui::Pos2) {
        self.h.hover_at(from);
        self.h.run();
        self.h.drag_at(from);
        self.h.run();
        for k in 1..=8 {
            self.h.hover_at(from + (to - from) * (k as f32 / 8.0));
            self.h.run();
        }
        self.h.drop_at(to);
        self.h.run();
    }
    /// `CSDM_RENDER_OUT=<folder>` saves what the tab looks like at this point.
    fn snap(&mut self, name: &str) {
        if let Some(dir) = std::env::var_os("CSDM_RENDER_OUT") {
            self.h.render().expect("headless render").save(std::path::Path::new(&dir).join(format!("capture-{name}.png"))).expect("save png");
        }
    }
    fn count(&mut self, id: &str) -> Option<String> {
        self.tab().cards().into_iter().find(|d| d.id == id).and_then(|d| d.count)
    }
}

fn player(i: usize) -> (String, String) {
    let p = &recorded()["connect_db"]["data"]["players"][i];
    (p[1].as_str().unwrap().to_string(), p[2].as_str().unwrap().to_string())
}

#[test]
fn player_search_pages_select_star_reorder_and_unregister() {
    let mut r = rig(json!({}));
    let (id0, name0) = player(0);
    let (id1, name1) = player(1);
    // Pages of 60 over 150 players.
    assert!(r.has("Next page") && r.has(&name0));
    r.click("Next page");
    assert_eq!(r.tab().player.page, 1);
    r.click("Previous page");
    // Sort by most recent, then search by Steam ID digits.
    r.click("Sort: recent");
    assert_eq!(r.tab().player.order, csdm_app::tabs::capture::model::Order::Recent);
    r.type_into("Search players", &id1[id1.len() - 6..]);
    assert!(r.has(&name1) && !r.has(&name0), "search narrows the list");
    r.type_into("Search players", "");
    r.click("Sort: name");
    // Pick two players: steam_ids holds both, steam_id / player_name follow the first.
    r.click(&name0);
    r.click(&name1);
    assert_eq!(r.setting("steam_ids"), json!([id0, id1]));
    assert_eq!((r.setting("steam_id"), r.setting("player_name")), (json!(id0), json!(name0)));
    assert_eq!(r.count("player").as_deref(), Some("2 selected"));
    // Register both (★), reorder by dragging, unregister one.
    r.click(&format!("Register {name0}"));
    r.click(&format!("Register {name1}"));
    assert_eq!(r.setting("saved_players"), json!([{"steam_id": id0, "name": name0}, {"steam_id": id1, "name": name1}]));
    let from = r.h.get_by_label(&format!("Registered {name1}")).rect().center();
    let to = r.h.get_by_label(&format!("Registered {name0}")).rect().center();
    r.drag(from, to);
    assert_eq!(r.setting("saved_players")[0]["steam_id"], json!(id1), "dragged to the front");
    r.click(&format!("Unregister {name1}"));
    assert_eq!(r.setting("saved_players"), json!([{"steam_id": id0, "name": name0}]));
    assert_eq!(r.setting("steam_ids"), json!([id0, id1]), "unregistering never deselects");
    // A click on an active chip deactivates.
    r.click(&format!("Active {name0}"));
    assert_eq!((r.setting("steam_ids"), r.setting("steam_id")), (json!([id1]), json!(id1)));
}

#[test]
fn demo_selection_dates_shortcuts_strip_and_manual_picker() {
    let mut r = rig(json!({"date_from": "", "date_to": ""}));
    r.click("7d");
    assert_eq!((r.setting("date_from"), r.setting("date_to")), (json!("07-11-2026"), json!("14-11-2026")));
    assert_eq!(r.h.get_by_label("7d").accesskit_node().toggled(), Some(egui::accesskit::Toggled::True), "the current shortcut is lit");
    r.click("Clear all");
    assert_eq!((r.setting("date_from"), r.setting("date_to")), (json!(""), json!("")));
    r.type_into("From date", "01-03-2025");
    assert_eq!(r.setting("date_from"), json!("01-03-2025"));
    // The calendar opens on the field's month; a day writes the date and closes it.
    r.click("Open calendar From");
    r.click("15");
    assert_eq!(r.setting("date_from"), json!("15-03-2025"));
    assert!(!r.has("15"), "the calendar closed");
    r.click("Today");
    assert_eq!(r.setting("date_to"), json!("14-11-2026"));
    // The strip's To handle, dragged left, brings the end date back.
    let to = r.h.get_by_role_and_label(Role::Slider, "To date").rect().center();
    r.drag(to, to - egui::vec2(120.0, 0.0));
    let after = r.setting("date_to");
    assert_ne!(after, json!("14-11-2026"), "dragging the handle moved the bound");
    // Manual mode loads every demo, all checked.
    r.click("Manual mode (load ALL demos from DB)");
    r.h.run();
    assert!(r.sent().contains(&"list_demos".to_string()));
    let rows = r.tab().demos.rows.clone().expect("demos listed");
    assert_eq!(rows.len(), 60);
    // Click, Ctrl+click, Shift+click highlight; Uncheck selected unchecks only those.
    let row = |i: usize| format!("{} {}", rows[i].date, rows[i].name);
    r.click(&row(0));
    // Rows past the card's fold are not drawn: three are in full view at the default size.
    r.h.get_by_label(&row(2)).click_modifiers(egui::Modifiers::SHIFT);
    r.h.run();
    assert_eq!(r.tab().demos.selected.len(), 3, "Shift: from the anchor (row 0) to row 2");
    r.h.get_by_label(&row(1)).click_modifiers(egui::Modifiers::COMMAND);
    r.h.run();
    assert_eq!(r.tab().demos.selected.len(), 2, "Ctrl toggles one row out");
    r.snap("manual");
    r.click("Uncheck selected");
    let off = r.tab().demos.checked.values().filter(|v| !**v).count();
    assert_eq!(off, 2, "only the highlighted rows");
    r.click("Check all");
    assert!(r.tab().demos.checked.values().all(|v| *v));
    r.click("All");
    assert!(r.tab().demos.rows.is_none(), "All resets the picker");
}

#[test]
fn weapon_rack_pick_category_select_all_and_clear() {
    let mut r = rig(json!({"weapons": []}));
    assert_eq!(r.count("weapon-filter").as_deref(), Some("all"));
    r.click("AK-47");
    assert_eq!(r.setting("weapons"), json!(["AK-47"]));
    r.click("Pistols category");
    let w = r.setting("weapons");
    assert!(w.as_array().unwrap().iter().any(|x| x == "Glock-18") && w[0] == "AK-47");
    r.click("Deselect all");
    assert_eq!(r.setting("weapons"), json!([]));
    r.click("Select all");
    // 3.5 `useWeaponFilter`: classed by the engine AND recorded by the database.
    let present = recorded()["connect_db"]["data"]["weapons"].clone();
    let offered = tables()["weapon_categories"].as_object().unwrap().values().flat_map(|v| v.as_array().unwrap().clone()).filter(|w| present.as_array().unwrap().contains(w)).count();
    assert_eq!(r.setting("weapons").as_array().unwrap().len(), offered, "every weapon the database recorded that the table knows");
}

#[test]
fn capture_timing_rules_camera_handles_mate_pov_and_summary() {
    let mut r = rig(json!({"event_actor": true, "event_target": false, "event_lethal": true, "perspective": "killer", "before": 3, "after": 5, "victim_pre_s": 2, "events": []}));
    assert!(r.has("Each moment becomes an 8s clip (3s on the killer before, 5s after). A second moment within 11s joins the same clip."));
    assert_eq!(r.count("capture-timing").as_deref(), Some("8 s clip"));
    // Lethal needs a role; Other needs Actor.
    r.click("Actor");
    assert_eq!(r.setting("event_actor"), json!(false));
    assert!(r.h.get_by_label("Lethal").accesskit_node().is_disabled());
    assert!(r.h.get_by_label("Other").accesskit_node().is_disabled());
    r.click("Target");
    r.click("Ally");
    assert_eq!((r.setting("event_ally"), r.setting("event_enemy")), (json!(true), json!(true)));
    r.click("Full rounds");
    assert_eq!(r.setting("events"), json!(["Rounds"]));
    // The end handle, dragged right by about four seconds.
    let end = r.h.get_by_label("Seconds after").rect().center();
    let pps = (r.h.get_by_label("Seconds after").rect().center().x - r.h.get_by_label("Seconds before").rect().center().x) / 8.0;
    r.drag(end, end + egui::vec2(pps * 4.0, 0.0));
    assert_eq!(r.setting("after"), json!(9));
    // Arrow keys on a focused handle.
    r.h.get_by_label("Seconds before").focus();
    r.h.run();
    r.h.key_press(egui::Key::ArrowLeft);
    r.h.run();
    assert_eq!(r.setting("before"), json!(4));
    // Both: the victim-view handle appears; Mate POV appears outside killer.
    assert!(!r.has("Victim view") && !r.has("Mate POV: Enable"));
    r.click("Camera: both");
    assert_eq!(r.setting("perspective"), json!("both"));
    assert!(r.has("Victim view") && r.has("Mate POV: Enable"));
    r.click("Mate POV: ★ Must");
    assert_eq!((r.setting("kill_mod_mate_pov"), r.setting("kill_mod_mate_pov_req")), (json!(true), json!(true)), "Must arms Enable");
    r.click("Mate POV: Enable");
    assert_eq!((r.setting("kill_mod_mate_pov"), r.setting("kill_mod_mate_pov_req")), (json!(false), json!(false)), "Enable off drops Must");
    r.type_into("Feed name", "Ace");
    assert_eq!(r.setting("player_name_override"), json!("Ace"));
}

#[test]
fn timing_retries_numbers_order_and_summary() {
    let mut r = rig(json!({"retry_count": 2, "retry_delay": 5, "recording_timeout": 0, "delay_between_demos": 10, "clip_order": "chrono"}));
    assert!(r.has("A failed recording is tried again up to 2 times, 5s apart; one that hangs is stopped after a wait worked out from the clip length. Demos are recorded in match-date order, with a 10s pause between two."));
    // Drag a number sideways: one step per 8 px once egui has seen a drag (its start threshold eats a few).
    let c = r.h.get_by_label("Retries").rect().center();
    r.drag(c, c + egui::vec2(24.0, 0.0));
    assert!(r.setting("retry_count").as_i64().unwrap() > 2, "dragging right raises the count");
    // Click opens the exact box.
    r.click("Stop if stuck");
    r.type_into("Stop if stuck exact", "7");
    assert_eq!(r.setting("recording_timeout"), json!(7));
    // The open box titles itself with the same words: the token is the spin button.
    r.h.get_by_role_and_label(Role::SpinButton, "Stop if stuck").click();
    r.h.run();
    assert!(!r.has("Stop if stuck exact"), "a second click closes the box");
    r.click("Demo order: random");
    assert_eq!(r.setting("clip_order"), json!("random"));
}

fn row_name(key: &str) -> String {
    filter_rows(&tables()).into_iter().find(|r| r.key == key).unwrap().name
}

#[test]
fn kill_filters_keep_must_drop_extras_headshots_clutch_and_clear() {
    let mut r = rig(json!({}));
    let smoke = row_name("kill_mod_through_smoke");
    r.click(&format!("Must {smoke}"));
    assert_eq!((r.setting("kill_mod_through_smoke"), r.setting("kill_mod_through_smoke_req")), (json!(true), json!(true)));
    r.click(&format!("Enable {smoke}"));
    assert_eq!((r.setting("kill_mod_through_smoke"), r.setting("kill_mod_through_smoke_req")), (json!(false), json!(false)));
    r.click(&format!("Exclude {smoke}"));
    assert_eq!(r.setting("kill_mod_through_smoke_exclude"), json!(true));
    assert!(!r.has(&format!("Exclude {}", row_name("kill_mod_trois_tap"))), "no Exclude box for TROIS TAP");
    // ONE TAP greys the headshot choice.
    r.click(&format!("Enable {}", row_name("kill_mod_one_tap")));
    assert!(r.h.get_by_label("Headshots: only").accesskit_node().is_disabled());
    r.type_into("Window", "3");
    assert_eq!(r.setting("kill_mod_one_tap_s"), json!(3));
    // FERRARI PEEK's sub-panel exists only while it is on.
    assert!(!r.has("One-shot"));
    r.click(&format!("Enable {}", row_name("kill_mod_high_velocity")));
    r.click("One-shot");
    assert_eq!(r.setting("kill_mod_hv_one_shot"), json!(false), "on by default, the click turns it off");
    r.click("Min kills: 4");
    assert_eq!(r.setting("kill_mod_multi_kill_n"), json!(4));
    r.click("Suicides: only");
    assert_eq!(r.setting("suicides_mode"), json!("only"));
    // Clutch: sizes once enabled.
    assert!(!r.has("1v3"));
    r.click("🎯 CLUTCH");
    r.click("1v3");
    r.click("Wins only");
    assert_eq!(r.setting("clutch_wins_only"), json!(true));
    r.click("Clutch mode: full_clutch");
    assert_eq!((r.setting("clutch_1v3"), r.setting("clutch_mode")), (json!(true), json!("full_clutch")));
    r.click("Clear");
    assert_eq!(r.setting("kill_mod_one_tap"), json!(false));
    assert_eq!(r.setting("kill_mod_through_smoke_exclude"), json!(true), "Clear resets Enable / Must only");
}

#[test]
fn damage_filters_rows_and_registry_extras() {
    let mut r = rig(json!({}));
    let big = row_name("dmg_mod_big_hit");
    r.click(&format!("Enable {big}"));
    assert_eq!(r.setting("dmg_mod_big_hit"), json!(true));
    assert_eq!(r.count("damage-filters").as_deref(), Some("1 active"));
    let label = filter_rows(&tables()).into_iter().find(|x| x.key == "dmg_mod_big_hit").unwrap().extras[0].1.clone();
    r.type_into(&label, "75");
    assert_eq!(r.setting("dmg_mod_big_hit_min"), json!(75));
}

#[test]
fn shot_filters_rows() {
    let mut r = rig(json!({}));
    let swing = row_name("shot_mod_knife_swing");
    r.click(&format!("Exclude {swing}"));
    assert_eq!(r.setting("shot_mod_knife_swing_exclude"), json!(true));
    assert_eq!(r.count("shot-filters").as_deref(), Some("1 active"));
    // AIRBORNE also judges shots: it stays in Kill Filters and says so.
    assert!(r.has(&format!("Enable {}", row_name("kill_mod_airborne"))));
}

#[test]
fn match_types_switch_tickets_and_absent_types() {
    let mut r = rig(json!({"match_type_filter_enabled": false}));
    assert!(r.h.get_by_label("Premier").accesskit_node().is_disabled(), "inert while the switch is off");
    r.click("Filter by type");
    assert_eq!(r.setting("match_type_filter_enabled"), json!(true));
    r.click("Premier");
    assert_eq!(r.setting("match_type_premier"), json!(true));
    assert_eq!(r.count("match-types").as_deref(), Some("1 of 13"));
    // The recorded database has no Deathmatch: greyed, still drawn.
    assert!(r.h.get_by_label("Deathmatch").accesskit_node().is_disabled());
}

#[test]
fn map_filter_switch_and_pool() {
    let mut r = rig(json!({"map_filter_enabled": true, "map_filter": []}));
    r.click("Dust2");
    r.click("Mirage");
    assert_eq!(r.setting("map_filter"), json!(["dust2", "mirage"]));
    r.click("Dust2");
    assert_eq!(r.setting("map_filter"), json!(["mirage"]));
    r.click("Filter by map");
    assert_eq!(r.setting("map_filter_enabled"), json!(false));
    assert_eq!(r.count("map-filter").as_deref(), Some("all"));
}

#[test]
fn a_new_registry_filter_shows_up_without_touching_the_interface() {
    let mut replies = recorded();
    let mut t = replies["describe_filters"].clone();
    t["data"]["filters"].as_array_mut().unwrap().push(json!({"key": "kill_mod_test_probe", "label": "🧪 TEST PROBE:", "tip": "A filter only this test knows", "category": "db", "hidden": false, "applies_to": ["kill"], "untested": "never run in game", "extras": []}));
    t["data"]["filters"].as_array_mut().unwrap().push(json!({"key": "dmg_mod_test_probe", "label": "🧪 DMG PROBE:", "tip": "", "category": "event", "hidden": false, "applies_to": ["damage"], "untested": null, "extras": [{"key": "dmg_mod_test_probe_min", "label": "floor", "unit": "hp", "default": 7}]}));
    replies.insert("describe_filters".into(), t);
    let mut r = rig_with(json!({}), replies);
    r.click("Enable TEST PROBE");
    assert_eq!(r.setting("kill_mod_test_probe"), json!(true));
    r.click("Exclude DMG PROBE");
    assert_eq!(r.setting("dmg_mod_test_probe_exclude"), json!(true));
    r.type_into("floor", "9");
    assert_eq!(r.setting("dmg_mod_test_probe_min"), json!(9));
}

/// Keys a CAPTURE card owns: every key of these capabilities (`csdm/capabilities.py`), except the
/// ones no window ever drew (3.5 `coverage-ledger.ts::NO_CONTROL_BY_DESIGN`).
const CAPTURE_CAPABILITIES: [&str; 18] = [
    "player_selection", "player_name_override", "demo_date_range", "map_filter", "clip_order", "event_role", "event_kind", "event_side",
    "round_clips", "weapon_filter", "headshot_filter", "suicide_filter", "clutch_filter", "camera_perspective", "clip_window", "retries",
    "batch_pacing", "match_type_filter",
];
const NO_CONTROL_BY_DESIGN: [&str; 4] = ["saved_players_imported", "teamkills_mode", "recording_timeout_auto_factor", "recording_timeout_auto_floor_s"];

/// The guard of 3.5 `settings/__tests__/coverage.test.tsx`, for this tab: measured on what is drawn,
/// after opening every gate (FERRARI PEEK, CLUTCH) and every camera choice.
#[test]
fn every_capture_key_has_a_control_on_screen() {
    let reference = csdm_core::settings::reference();
    let mut wanted: Vec<String> = reference.settings.iter()
        .filter(|d| CAPTURE_CAPABILITIES.contains(&d.owner.as_str()) || d.owner.starts_with("kill_filter_") || d.owner.starts_with("damage_filter_") || d.owner.starts_with("shot_filter_"))
        .map(|d| d.key.clone())
        .filter(|k| !NO_CONTROL_BY_DESIGN.contains(&k.as_str()))
        .collect();
    wanted.sort();
    for c in CAPTURE_CAPABILITIES {
        assert!(reference.capabilities.iter().any(|x| x.id == c), "unknown capability {c}");
    }
    let mut r = rig(json!({}));
    r.click(&format!("Enable {}", row_name("kill_mod_high_velocity")));
    r.click("🎯 CLUTCH");
    let mut seen = std::collections::BTreeSet::new();
    for cam in ["killer", "victim", "both"] {
        r.click(&format!("Camera: {cam}"));
        r.h.run();
        seen.extend(r.h.ctx.data(|d| d.get_temp::<Seen>(seen_id())).unwrap_or_default().0);
    }
    let missing: Vec<&String> = wanted.iter().filter(|k| !seen.contains(*k)).collect();
    assert!(missing.is_empty(), "keys without a control on the CAPTURE tab: {missing:?}");
}

/// `CSDM_RENDER_OUT=<folder>`: the whole tab, day and night, with a few choices made, to set beside
/// the V12 mock (`shots/t6/ref-mock-v12.png`). Does nothing without the variable.
#[test]
fn renders_the_tab_for_the_author() {
    if std::env::var_os("CSDM_RENDER_OUT").is_none() {
        return;
    }
    for (bg, accent) in [("white", "blue"), ("dark", "green")] {
        let (id0, _) = player(0);
        let (id1, _) = player(1);
        let mut r = rig(json!({"theme_bg": bg, "theme_accent": accent, "steam_ids": [id0, id1], "weapons": ["AWP", "AK-47"],
            "kill_mod_one_tap": true, "kill_mod_through_smoke": true, "kill_mod_through_smoke_req": true, "match_type_filter_enabled": true,
            "match_type_premier": true, "map_filter_enabled": true, "map_filter": ["mirage", "inferno"], "date_from": "01-06-2026", "date_to": "14-11-2026"}));
        r.h.run();
        r.snap(bg);
    }
}

/// D-0015: a scenario in the repository holds no real Steam ID and no path of anyone's machine.
#[test]
fn recorded_scenarios_hold_no_real_steam_id_or_path() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures");
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        let text = std::fs::read_to_string(&p).unwrap();
        let bytes = text.as_bytes();
        for i in 0..bytes.len().saturating_sub(17) {
            let w = &bytes[i..i + 17];
            if w.starts_with(b"7656119") && w.iter().all(u8::is_ascii_digit) && (i == 0 || !bytes[i - 1].is_ascii_digit()) {
                assert!(std::str::from_utf8(w).unwrap().parse::<u64>().unwrap() < FIRST_REAL_STEAM_ID, "{}: a real Steam ID", p.display());
            }
        }
        let v: Value = serde_json::from_str(&text).unwrap();
        let mut stack = vec![&v];
        while let Some(x) = stack.pop() {
            match x {
                Value::String(s) if s.len() > 2 && s.as_bytes()[1] == b':' && s.as_bytes()[2] == b'\\' => {
                    assert!(s.starts_with("C:\\Demos\\") || s.starts_with("C:\\Users\\me\\"), "{}: a real path", p.display());
                }
                Value::Array(a) => stack.extend(a),
                Value::Object(o) => stack.extend(o.values()),
                _ => {}
            }
        }
    }
}
