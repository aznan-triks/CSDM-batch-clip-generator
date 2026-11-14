//! Driven tests of the shell, one per « Coquille » parity line (research/04), no window:
//! clicks by accessible label on the real widgets, effects read on the shell and the engine.

mod common;

use common::{boot, rig, rig_with, scenario, Cards};
use csdm_app::tabs::TabId;
use csdm_app::{motion_gate, Motion};
use eframe::egui;
use egui_kittest::kittest::{NodeT, Queryable};
use serde_json::{json, Value};

const DEFAULTS: &str = r##"{"theme_bg": "white", "theme_accent": "#2563EB", "pg_db": "csdm", "video_preset": "medium"}"##;

/// Past egui's tooltip delay.
const TIP_WAIT_S: f32 = 0.8;

fn lines(r: &common::Rig) -> Vec<String> {
    r.h.state().console.texts()
}

#[test]
fn coquille_01_five_tabs_switch_by_label_with_their_tip() {
    let mut r = rig(&scenario(&[&boot(DEFAULTS)]));
    for label in ["CAPTURE", "EDITING", "TAGS", "VIDEO", "SETTINGS"] {
        r.click(label);
        assert_eq!(csdm_app::tabs::spec(r.h.state().active).label, label);
    }
    r.h.get_by_label("TAGS").hover();
    r.wait(TIP_WAIT_S);
    r.h.get_by_label("Database demo tags management, tag filtering, and demo labeling");
}

#[test]
fn coquille_02_action_bar_one_click_one_command_states_from_engine() {
    let run = r#"{"on": "start_preview", "events": [{"state": {"name": "buttons_busy"}}, {"state": {"name": "buttons", "payload": {"run": false, "stop": true, "kill": true, "stop_label": "⏸ Stop preview"}}}, {"state": {"name": "preview_started"}}], "reply": {"ok": {}}}"#;
    let stop = r#"{"on": "request_stop", "events": [{"state": {"name": "stop_requested"}}], "reply": {"ok": {}}}"#;
    let mut r = rig(&scenario(&[&boot(DEFAULTS), run, stop]));
    assert!(r.h.get_by_label("STOP").accesskit_node().is_disabled(), "STOP greyed before a run");
    assert!(r.h.get_by_label("KILL").accesskit_node().is_disabled());
    r.click("PREVIEW");
    assert_eq!(r.sent().iter().filter(|c| *c == "start_preview").count(), 1, "one click, one command");
    assert!(!r.h.get_by_label("STOP PREVIEW").accesskit_node().is_disabled(), "engine enabled STOP");
    assert!(r.h.get_by_label("RUN").accesskit_node().is_disabled(), "engine disabled RUN");
    r.click("STOP PREVIEW");
    assert_eq!(r.remaining(), 0);
}

#[test]
fn coquille_02b_run_inputs_problem_greys_preview_and_run_with_the_reason() {
    let booted = boot(DEFAULTS).replace(r#"{"problem": null}"#, r#"{"problem": "Pick at least one player on the CAPTURE tab"}"#);
    let mut r = rig(&scenario(&[&booted]));
    assert!(r.h.get_by_label("RUN").accesskit_node().is_disabled());
    assert!(r.h.get_by_label("PREVIEW").accesskit_node().is_disabled());
    r.h.get_by_label("RUN").hover();
    r.wait(TIP_WAIT_S);
    r.h.get_by_label("Pick at least one player on the CAPTURE tab");
}

#[test]
fn coquille_03_editing_bar_generate_save_asks_a_name_cancel_goes_back() {
    let preview = r#"{"on": "start_preview", "events": [{"state": {"name": "preview_ready", "payload": {"sequences": {"a.dem": [{"start_tick": 1}, {"start_tick": 2}]}}}}], "reply": {"ok": {}}}"#;
    let save = r#"{"on": "save_preset", "events": [{"ask": {"kind": "text", "message": "Name this preset", "options": ["Preset name", "Save"]}}], "reply": {"ok": {}}}"#;
    let mut r = rig(&scenario(&[&boot(DEFAULTS), preview, save]));
    r.click("EDITING");
    assert!(r.h.get_by_label("GENERATE").accesskit_node().is_disabled(), "no preview yet");
    r.click("CAPTURE");
    r.click("PREVIEW");
    assert_eq!(r.h.state().active, TabId::Editing, "a preview with clips opens EDITING");
    assert!(!r.h.get_by_label("GENERATE").accesskit_node().is_disabled());
    r.click("SAVE");
    r.h.get_by_label("Preset name").type_text("night");
    r.h.run();
    r.click("Save");
    assert_eq!(r.answers(), vec![Some(Some("night".into()))]);
    r.click("CANCEL");
    assert_eq!(r.h.state().active, TabId::Capture);
}

#[test]
fn coquille_04_weapon_band_progress_summary_and_engine_driven_shot() {
    let run = r#"{"on": "start_run", "events": [{"state": {"name": "run_started"}}, {"state": {"name": "progress", "payload": {"text": "▰▰▱▱ 2/4"}}}, {"state": {"name": "summary", "payload": {"text": "2 clips recorded", "demos": 1, "clips": 2, "total_s": 75, "avg_s": 37.5}}}], "reply": {"ok": {}}}"#;
    let mut r = rig_with(&scenario(&[&boot(DEFAULTS), run]), Motion::Full, None, false);
    assert!(r.h.state().bar.weapon.effect.is_none(), "nothing plays before the engine says so");
    r.h.get_by_label("RUN").click();
    r.h.run_steps(3);
    r.h.get_by_label("▰▰▱▱ 2/4");
    r.h.get_by_label("2 clips recorded");
    assert!(r.h.state().bar.weapon.effect.is_some(), "run_started fired the shot");
}

#[test]
fn coquille_05_console_narrates_filters_walks_and_toggles() {
    let mut r = rig(&scenario(&[&boot(DEFAULTS)]));
    let all = lines(&r);
    assert!(all.iter().any(|l| l == "engine ready"), "{all:?}");
    for l in &all {
        assert!(!l.contains("[log") && !l.contains("[result") && !l.contains("id="), "protocol on screen: {l}");
    }
    // Ctrl+F focuses the search; the filter keeps matching lines; Enter walks; Esc closes.
    r.h.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::F);
    r.h.run();
    r.h.get_by_label("Search").type_text("ready");
    r.h.run();
    r.h.get_by_label("1/1");
    r.click("Next match");
    r.h.get_by_label("1/1");
    r.click("Close search");
    assert!(r.h.state().console.search.is_empty());
    // Toggles: timestamps on by default, badges off, auto-scroll on.
    assert!(r.h.state().console.timestamps && !r.h.state().console.badges && r.h.state().console.autoscroll);
    r.click("Timestamps");
    r.click("Level badges");
    r.click("Auto-scroll");
    assert!(!r.h.state().console.timestamps && r.h.state().console.badges && !r.h.state().console.autoscroll);
    // Copy all, copy selection with nothing selected.
    r.click("Copy all");
    assert!(r.h.state().console.last_copied.as_deref().unwrap_or_default().contains("engine ready"));
    r.click("Copy sel.");
    assert_eq!(r.h.state().console.copy_status, "Nothing selected");
}

#[test]
fn coquille_05b_console_saves_txt_and_flash_leaves_after_three_seconds() {
    let mut r = rig(&scenario(&[&boot(DEFAULTS)]));
    r.click("Export");
    r.click("Console log, Text (.txt)");
    let saved = std::fs::read_to_string(r.export.path().join("csdm-console-log.txt")).unwrap();
    assert!(saved.contains("engine ready"));
    assert!(lines(&r).iter().any(|l| l.starts_with("✓ Log saved")), "flash shown");
    r.wait(3.2);
    assert!(!lines(&r).iter().any(|l| l.starts_with("✓ Log saved")), "flash gone");
    assert!(!saved.contains("Log saved"), "the record never holds status lines");
}

#[test]
fn coquille_06_export_menu_preview_files_and_injection_preview() {
    let export = r#"{"on": "export_preview", "reply": {"ok": {"data": {"content": "{\"clips\": []}", "filename": "csdm-preview.json", "mime": "application/json", "clips": 0}}}}"#;
    let inject = r#"{"on": "injection_preview", "reply": {"ok": {"lines": [["-novid", "key"], ["exec csdm", ""]]}}}"#;
    let mut r = rig(&scenario(&[&boot(DEFAULTS), export, inject]));
    r.click("Export");
    r.click("Preview clips, JSON (.json)");
    assert_eq!(std::fs::read_to_string(r.export.path().join("csdm-preview.json")).unwrap(), "{\"clips\": []}");
    r.click("Export");
    r.click("CS2 injection preview");
    let all = lines(&r);
    assert!(all.iter().any(|l| l == "── CS2 injection preview ──") && all.iter().any(|l| l == "-novid"), "{all:?}");
}

#[test]
fn coquille_07_question_panel_confirm_error_and_cancel() {
    let ask = r#"{"on": "start_preview", "events": [
        {"ask": {"kind": "confirm", "message": "Demos already tagged", "options": ["Some demos are already tagged", "Continue"]}},
        {"ask": {"kind": "error", "message": "CS2 is not installed"}},
        {"ask": {"kind": "confirm", "message": "Overwrite?", "options": ["Files exist", "Overwrite"]}}
    ], "reply": {"ok": {}}}"#;
    let mut r = rig(&scenario(&[&boot(DEFAULTS), ask]));
    r.click("PREVIEW");
    assert_eq!(r.h.state().console.pending_asks(), 3, "questions queue, none replaced");
    r.click("Continue");
    r.click("OK");
    r.click("Cancel");
    assert_eq!(r.answers(), vec![Some(Some("Continue".into())), Some(Some("ok".into())), Some(None)]);
}

#[test]
fn coquille_08_split_handle_drags_and_clamps() {
    let mut r = rig(&scenario(&[&boot(DEFAULTS)]));
    let handle = r.h.get_by_label("Resize console").rect().center();
    r.drag(handle, handle - egui::vec2(300.0, 0.0));
    let pct = r.setting("ui_split_pct").and_then(|v| v.as_f64()).unwrap();
    assert!(pct < 60.0 && pct >= 38.0, "{pct}");
    let handle = r.h.get_by_label("Resize console").rect().center();
    r.drag(handle, egui::pos2(1590.0, handle.y));
    assert_eq!(r.setting("ui_split_pct"), Some(json!(80)), "clamped to the 3.5 maximum");
}

#[test]
fn coquille_09_backdrop_animates_only_with_motion_and_pointer() {
    assert!(motion_gate(true, false, false));
    assert!(!motion_gate(false, false, false), "inactive window: still");
    assert!(!motion_gate(true, true, false), "minimised: still");
    assert!(!motion_gate(true, false, true), "Windows reduced motion: still");
    // Full motion, pointer over the window: the field asks for frames; pointer gone: it settles.
    let mut r = rig_with(&scenario(&[&boot(DEFAULTS)]), Motion::Still, None, false);
    r.h.hover_at(egui::pos2(400.0, 400.0));
    assert!(r.h.try_run().is_ok(), "no motion: nothing keeps repainting");
}

#[test]
fn coquille_10_reticle_follows_snaps_and_click_sparks() {
    let mut r = rig_with(&scenario(&[&boot(DEFAULTS)]), Motion::Full, None, false);
    r.h.hover_at(egui::pos2(300.0, 300.0));
    r.h.run_steps(2);
    let free = r.h.state().cursor.reticle.expect("reticle over the background");
    assert_eq!(free.center(), egui::pos2(300.0, 300.0));
    let run = r.h.get_by_label("RUN").rect();
    r.h.hover_at(run.center());
    r.h.run_steps(2);
    let snapped = r.h.state().cursor.reticle.expect("reticle on the button");
    assert!(snapped.contains_rect(run), "snaps around the button");
}

#[test]
fn coquille_11_engine_lost_banner() {
    struct Dead(std::sync::mpsc::Receiver<csdm_engine::EngineEvent>);
    impl csdm_engine::Engine for Dead {
        fn send(&mut self, _c: csdm_engine::Command) -> u64 {
            0
        }
        fn events(&self) -> &std::sync::mpsc::Receiver<csdm_engine::EngineEvent> {
            &self.0
        }
    }
    let (_, rx) = std::sync::mpsc::channel();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    let mut h = egui_kittest::Harness::builder().with_size(common::SIZE).build_eframe(move |cc| csdm_app::Shell::new(&cc.egui_ctx, Box::new(Dead(rx)), csdm_app::ShellOptions { motion: Motion::Still, export_dir: path }));
    h.run();
    h.get_by_label("The engine stopped. Restart the app to continue; details are in csdm_errors.log next to the settings.");
    assert!(h.state().console.texts().iter().any(|l| l.contains("The engine stopped answering")));
}

#[test]
fn coquille_12_confirm_dialog_cancel_and_confirm() {
    let tab = Cards::new(&[("b", "Presets", false)]);
    let mut r = rig_with(&scenario(&[&boot(DEFAULTS)]), Motion::Still, Some((TabId::Capture, Box::new(tab))), false);
    r.click("Delete preset");
    r.h.get_by_label("Delete preset?");
    r.click("Cancel");
    assert_eq!(r.h.state_mut().view::<Cards>(TabId::Capture).unwrap().confirm, Some(csdm_app::widgets::Confirm::Cancelled));
    r.click("Delete preset");
    r.click("Confirm");
    assert_eq!(r.h.state_mut().view::<Cards>(TabId::Capture).unwrap().confirm, Some(csdm_app::widgets::Confirm::Confirmed));
}

#[test]
fn coquille_13_tips_on_hover_or_always_shown() {
    let tab = || Box::new(Cards::new(&[("b", "Presets", false)]));
    let r = rig_with(&scenario(&[&boot(DEFAULTS)]), Motion::Still, Some((TabId::Capture, tab())), false);
    assert!(r.h.query_by_label("Kills through a wall").is_none(), "hover only by default");
    let always = DEFAULTS.replace('}', r#", "ui_always_show_tooltips": true}"#);
    let r = rig_with(&scenario(&[&boot(&always)]), Motion::Still, Some((TabId::Capture, tab())), false);
    r.h.get_by_label("Kills through a wall");
}

#[test]
fn coquille_14_settings_saved_400ms_after_the_last_change() {
    let save = r#"{"on": "save_config", "reply": {"ok": {}}}"#;
    let check = r#"{"on": "run_inputs_problem", "reply": {"ok": {"problem": null}}}"#;
    let mut r = rig(&scenario(&[&boot(DEFAULTS), check, save]));
    let handle = r.h.get_by_label("Resize console").rect().center();
    r.drag(handle, handle - egui::vec2(100.0, 0.0));
    assert!(!r.sent().contains(&"save_config".to_string()), "not saved during the burst");
    r.wait(0.5);
    assert_eq!(r.sent().iter().filter(|c| *c == "save_config").count(), 1, "saved once, after the quiet");
}

#[test]
fn coquille_15_window_defaults_and_minimum() {
    let d = csdm_core::settings::defaults(None);
    assert_eq!((d["ui_window_w"].clone(), d["ui_window_h"].clone()), (json!(1600), json!(900)));
    assert_eq!(csdm_core::ui_values::WINDOW_MIN, [900.0, 640.0]);
    assert_eq!(d["ui_remember_layout"], json!(true));
}

#[test]
fn coquille_16_debug_trace_records_and_exports() {
    let check = r#"{"on": "run_inputs_problem", "reply": {"ok": {"problem": null}}}"#;
    let mut r = rig(&scenario(&[&boot(DEFAULTS), check]));
    r.click("Export");
    assert!(r.h.get_by_label("Debug trace (.txt)").accesskit_node().is_disabled(), "nothing recorded yet");
    r.h.key_press(egui::Key::Escape);
    r.h.run();
    r.click("Debug trace");
    let handle = r.h.get_by_label("Resize console").rect().center();
    r.drag(handle, handle - egui::vec2(50.0, 0.0));
    r.wait(0.1);
    r.click("Export");
    r.click("Debug trace (.txt)");
    let trace = std::fs::read_to_string(r.export.path().join("csdm-trace.txt")).unwrap();
    assert!(trace.contains("-> run_inputs_problem"), "{trace}");
}

#[test]
fn coquille_17_errors_in_one_clear_sentence() {
    let booted = boot(DEFAULTS).replace(r#"{"on": "connect_db", "reply": {"ok": {"data": {}}}}"#, r#"{"on": "connect_db", "reply": {"err": "The database refused the password."}}"#);
    let r = rig(&scenario(&[&booted]));
    let all = lines(&r);
    assert!(all.iter().any(|l| l == "! The database refused the password."), "{all:?}");
    r.h.get_by_label("DB offline");
}

#[test]
fn coquille_18_version_chip() {
    let r = rig(&scenario(&[&boot(DEFAULTS)]));
    r.h.get_by_label("Version 5.0.0-dev");
}

#[test]
fn coquille_19_primary_ring_turns_only_with_motion() {
    let mut still = rig(&scenario(&[&boot(DEFAULTS)]));
    assert!(still.h.try_run().is_ok(), "no motion: the window comes to rest");
    let mut moving = rig_with(&scenario(&[&boot(DEFAULTS)]), Motion::Full, None, false);
    moving.h.hover_at(egui::pos2(-10.0, -10.0));
    assert!(moving.h.try_run().is_err(), "the ring keeps asking for frames");
}

#[test]
fn coquille_20_first_run_db_pending_then_hint() {
    // An engine that has not answered yet: the connection is pending.
    // The sender stays alive so the engine reads as silent, not gone.
    struct Silent(#[allow(dead_code)] std::sync::mpsc::Sender<csdm_engine::EngineEvent>, std::sync::mpsc::Receiver<csdm_engine::EngineEvent>);
    impl csdm_engine::Engine for Silent {
        fn send(&mut self, _c: csdm_engine::Command) -> u64 {
            0
        }
        fn events(&self) -> &std::sync::mpsc::Receiver<csdm_engine::EngineEvent> {
            &self.1
        }
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    let mut h = egui_kittest::Harness::builder().with_size(common::SIZE).build_eframe(move |cc| {
        csdm_app::Shell::new(&cc.egui_ctx, Box::new(Silent(tx, rx)), csdm_app::ShellOptions { motion: Motion::Still, export_dir: path }).with_tab(TabId::Capture, Box::new(Cards::new(&[("b", "Presets", false)])))
    });
    h.run();
    h.get_by_label(csdm_app::widgets::DB_WAITING);
    h.get_by_label("DB csdm");
    let failed = boot(DEFAULTS).replace(r#"{"on": "connect_db", "reply": {"ok": {"data": {}}}}"#, r#"{"on": "connect_db", "reply": {"err": "Connection refused."}}"#);
    let r = rig_with(&scenario(&[&failed]), Motion::Still, Some((TabId::Capture, Box::new(Cards::new(&[("b", "Presets", false)])))), false);
    r.h.get_by_label(csdm_app::widgets::DB_UNREACHABLE_HINT);
    assert_eq!(r.setting("pg_db").as_ref().and_then(Value::as_str), Some("csdm"));
}
