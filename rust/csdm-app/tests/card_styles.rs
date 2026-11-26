//! Driven tests for T12: the three card styles (`timeline`, `sentence`, `tiles`) across all 28
//! styled cards (`CAPTURE`, `VIDEO`, `TAGS`, `SETTINGS`), bidirectional parity, coverage guards,
//! `grid::fit` height auto-adjustment, and optional headless `wgpu` contact-sheet capture.

use csdm_app::grid::TabView;
use csdm_app::tabs::capture::kit::{seen_id, Seen};
use csdm_app::tabs::capture::CaptureTab;
use csdm_app::tabs::settings::SettingsTab;
use csdm_app::tabs::tags::TagsTab;
use csdm_app::tabs::video::VideoTab;
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_core::grid::Item;
use csdm_core::ui_values::CARD_STYLES;
use csdm_engine::{Command, Engine, EngineEvent};
use eframe::egui;
use egui_kittest::kittest::Queryable;
use egui_kittest::Harness;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};

const SIZE_TALL: egui::Vec2 = egui::Vec2::new(1600.0, 4400.0);
const SIZE_STD: egui::Vec2 = egui::Vec2::new(1600.0, 900.0);
const SIZE_NARROW: egui::Vec2 = egui::Vec2::new(960.0, 900.0);
const STEP_DT: f32 = 1.0 / 60.0;
const CAPTURE_SCENARIO: &str = include_str!("fixtures/capture-scenario.json");

fn capture_replies() -> HashMap<String, Value> {
    let s: Value = serde_json::from_str(CAPTURE_SCENARIO).unwrap();
    s["steps"].as_array().unwrap().iter().map(|st| (st["on"].as_str().unwrap().to_string(), st["reply"]["ok"].clone())).collect()
}

struct MockEngine {
    replies: HashMap<String, Value>,
    settings: Value,
    tx: Sender<EngineEvent>,
    rx: Receiver<EngineEvent>,
    next: u64,
}

impl Engine for MockEngine {
    fn send(&mut self, command: Command) -> u64 {
        self.next += 1;
        let id = self.next;
        let reply = match command.name() {
            "hello" => json!({"data": {"app_version": "5.0.0-dev"}}),
            "load_config" => json!({"data": self.settings}),
            "save_config" => json!({}),
            "run_inputs_problem" => json!({"problem": null}),
            "list_presets" => json!({"data": {"presets": []}}),
            "list_tags" => json!({"data": {"tags": [{"id": 1, "name": "Flick", "color": "#3b82f6"}, {"id": 2, "name": "Ace", "color": "#22c55e"}], "auto_tag_on_export": false}}),
            "settings_folder_info" => json!({"data": {"current": "C:\\Users\\me\\AppData\\Local\\CSDM", "kind": "local", "default_local": "C:\\Users\\me\\AppData\\Local\\CSDM", "app_folder": "C:\\CSDM", "custom": "", "file_count": 2}}),
            "injection_preview" => json!({"data": {"lines": [{"text": "// CS2 preview", "kind": "comment"}, {"text": "-novid", "kind": "arg"}]}}),
            name => self.replies.get(name).cloned().unwrap_or_else(|| json!({})),
        };
        self.tx.send(EngineEvent::Reply { id, result: Ok(reply) }).unwrap();
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        &self.rx
    }
}

struct Rig {
    h: Harness<'static, Shell>,
    _export: tempfile::TempDir,
}

fn rig_tab(tab_id: TabId, view: Box<dyn TabView>, settings: Value, size: egui::Vec2, wgpu: bool) -> Rig {
    let (tx, rx) = channel();
    let mut base = json!({"theme_bg": "white", "theme_accent": "#2563EB", "recsys": "HLAE"});
    if let Some(obj) = settings.as_object() {
        base.as_object_mut().unwrap().extend(obj.clone());
    }
    let mut replies = capture_replies();
    replies.entry("list_tags".into()).or_insert_with(|| json!({"data": {"tags": [], "auto_tag_on_export": false}}));
    let engine = MockEngine { replies, settings: base, tx, rx, next: 0 };
    let export = tempfile::tempdir().unwrap();
    let dir = export.path().to_path_buf();
    let mut b = Harness::builder().with_size(size).with_step_dt(STEP_DT).with_max_steps(400);
    if wgpu {
        if std::env::var_os("WGPU_BACKEND").is_none() {
            std::env::set_var("WGPU_BACKEND", "gl");
        }
        b = b.wgpu();
    }
    let h = b.build_eframe(move |cc| {
        Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion: Motion::Still, export_dir: dir }).with_tab(tab_id, view)
    });
    let mut r = Rig { h, _export: export };
    r.h.run();
    r.h.run();
    let tab_label = match tab_id {
        TabId::Capture => "CAPTURE",
        TabId::Editing => "EDITING",
        TabId::Tags => "TAGS",
        TabId::Video => "VIDEO",
        TabId::Settings => "SETTINGS",
    };
    r.click(tab_label);
    r
}

fn make_tab(tab_id: TabId) -> Box<dyn TabView> {
    match tab_id {
        TabId::Capture => {
            let mut t = CaptureTab::new();
            t.today = chrono::NaiveDate::from_ymd_opt(2026, 11, 14);
            Box::new(t)
        }
        TabId::Tags => Box::new(TagsTab::new()),
        TabId::Video => Box::new(VideoTab::new()),
        TabId::Settings => Box::new(SettingsTab::new()),
        TabId::Editing => panic!("EDITING has no styled cards"),
    }
}

impl Rig {
    fn click(&mut self, label: &str) {
        self.h.get_by_label(label).click();
        self.h.run();
    }

    fn set_setting(&mut self, key: &str, value: Value) {
        self.h.state_mut().link.set(0.0, key, value);
        self.h.run();
        self.h.run();
    }

    fn setting(&self, key: &str) -> Value {
        self.h.state().link.get(key).cloned().unwrap_or(Value::Null)
    }

    fn seen_keys(&self) -> BTreeSet<String> {
        self.h.ctx.data(|d| d.get_temp::<Seen>(seen_id())).unwrap_or_default().0
    }
}

fn assert_grid_clean(r: &Rig, tab_id: TabId, tab_label: &str, style: &str, width_tag: &str) {
    let g = &r.h.state().grids[tab_id as usize];
    let v: &[(String, Item)] = &g.drawn;
    assert!(!v.is_empty(), "{tab_label}/{style}/{width_tag}: empty drawn grid");
    for (ia, a) in v {
        for (ib, b) in v {
            assert!(
                ia == ib || a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h,
                "{tab_label}/{style}/{width_tag}: {ia} {a:?} overlaps {ib} {b:?}"
            );
        }
        if !a.manual {
            if let Some(&measured) = g.measured.get(ia) {
                assert!(
                    measured <= a.h,
                    "{tab_label}/{style}/{width_tag}: card {ia} truncated (measured {measured} > drawn {})",
                    a.h
                );
            }
        }
    }
}

#[test]
fn t12_01_live_style_switching_preserves_settings_and_supports_overrides() {
    let initial = json!({
        "ui_card_style": "timeline",
        "ui_card_style_overrides": {"capture-timing": "tiles"},
        "before": 6,
        "after": 3,
        "crf": 19,
        "dp2_threads": 4
    });
    let mut r = rig_tab(TabId::Settings, make_tab(TabId::Settings), initial, SIZE_TALL, false);
    assert!(r.h.query_by_label("Card style: sentence").is_some());
    r.click("Card style: sentence");
    assert_eq!(r.setting("ui_card_style"), json!("sentence"));
    assert_eq!(r.setting("before"), json!(6));
    assert_eq!(r.setting("after"), json!(3));
    assert_eq!(r.setting("crf"), json!(19));
    assert_eq!(r.setting("dp2_threads"), json!(4));
    assert_eq!(r.setting("ui_card_style_overrides")["capture-timing"], json!("tiles"));

    r.click("Card style: tiles");
    assert_eq!(r.setting("ui_card_style"), json!("tiles"));
    assert_eq!(r.setting("before"), json!(6));
    assert_eq!(r.setting("dp2_threads"), json!(4));
}

#[test]
fn t12_02_capture_controls_and_coverage_in_sentence_and_tiles() {
    const CAPTURE_CAPABILITIES: [&str; 18] = [
        "player_selection", "player_name_override", "demo_date_range", "map_filter", "clip_order", "event_role", "event_kind", "event_side",
        "round_clips", "weapon_filter", "headshot_filter", "suicide_filter", "clutch_filter", "camera_perspective", "clip_window", "retries",
        "batch_pacing", "match_type_filter",
    ];
    const NO_CONTROL_BY_DESIGN: [&str; 4] = ["saved_players_imported", "teamkills_mode", "recording_timeout_auto_factor", "recording_timeout_auto_floor_s"];
    let reference = csdm_core::settings::reference();
    let wanted: Vec<String> = reference
        .settings
        .iter()
        .filter(|d| CAPTURE_CAPABILITIES.contains(&d.owner.as_str()) || d.owner.starts_with("kill_filter_") || d.owner.starts_with("damage_filter_") || d.owner.starts_with("shot_filter_"))
        .map(|d| d.key.clone())
        .filter(|k| !NO_CONTROL_BY_DESIGN.contains(&k.as_str()))
        .collect();

    for style in CARD_STYLES {
        let mut r = rig_tab(
            TabId::Capture,
            make_tab(TabId::Capture),
            json!({"ui_card_style": style, "kill_mod_high_velocity": true, "clutch_enabled": true}),
            SIZE_TALL,
            false,
        );
        let mut seen = BTreeSet::new();
        for cam in ["killer", "victim", "both"] {
            r.set_setting("perspective", json!(cam));
            seen.extend(r.seen_keys());
        }
        let missing: Vec<&String> = wanted.iter().filter(|k| !seen.contains(*k)).collect();
        assert!(missing.is_empty(), "CAPTURE in {style} missing keys: {missing:?}");
    }

    // Bidirectional parity test in sentence & tiles: mutating settings persists across style switch.
    let mut r = rig_tab(TabId::Capture, make_tab(TabId::Capture), json!({"ui_card_style": "sentence"}), SIZE_TALL, false);
    r.click("Today");
    assert_eq!(r.setting("date_to"), json!("14-11-2026"));
    r.click("Select all");
    assert!(!r.setting("weapons").as_array().unwrap().is_empty());
    r.set_setting("ui_card_style", json!("tiles"));
    assert_eq!(r.setting("date_to"), json!("14-11-2026"));
    r.click("Kills & deaths");
    assert_eq!(r.setting("event_lethal"), json!(false));
    r.click("Filter by type");
    assert_eq!(r.setting("match_type_filter_enabled"), json!(true));
    r.set_setting("ui_card_style", json!("timeline"));
    assert_eq!(r.setting("event_lethal"), json!(false));
    assert_eq!(r.setting("match_type_filter_enabled"), json!(true));
}

#[test]
fn t12_03_video_controls_and_coverage_in_sentence_and_tiles() {
    const VIDEO_CAPABILITIES: [&str; 12] = [
        "final_assembly", "sequence_concatenation", "resolution_framerate", "cs2_window", "recording_system", "hlae_options",
        "in_game_display", "close_game_between_demos", "cs2_effects", "video_encoding", "audio_encoding", "ffmpeg_raw_params",
    ];
    let reference = csdm_core::settings::reference();
    let wanted: Vec<&str> = reference.settings.iter().filter(|d| VIDEO_CAPABILITIES.contains(&d.owner.as_str())).map(|d| d.key.as_str()).collect();

    for style in CARD_STYLES {
        let r = rig_tab(TabId::Video, make_tab(TabId::Video), json!({"ui_card_style": style, "recsys": "HLAE"}), SIZE_TALL, false);
        let seen = r.seen_keys();
        let missing: Vec<&&str> = wanted.iter().filter(|k| !seen.contains(**k)).collect();
        assert!(missing.is_empty(), "VIDEO in {style} missing keys: {missing:?}");
    }

    let mut r = rig_tab(TabId::Video, make_tab(TabId::Video), json!({"ui_card_style": "tiles", "true_view": false, "phys_ragdoll_enable": false}), SIZE_TALL, false);
    r.click("TrueView");
    assert_eq!(r.setting("true_view"), json!(true));
    r.click("Ragdoll physics");
    assert_eq!(r.setting("phys_ragdoll_enable"), json!(true));
    r.set_setting("ui_card_style", json!("sentence"));
    assert_eq!(r.setting("true_view"), json!(true));
    assert_eq!(r.setting("phys_ragdoll_enable"), json!(true));
}

#[test]
fn t12_04_tags_and_settings_families_work_in_all_styles() {
    for style in CARD_STYLES {
        let mut rt = rig_tab(TabId::Tags, make_tab(TabId::Tags), json!({"ui_card_style": style}), SIZE_TALL, false);
        assert!(rt.h.query_by_label("Auto-tag on export").is_some(), "TAGS {style} missing Auto-tag on export");
        if rt.h.query_by_label("Tag 1").is_some() {
            rt.click("Tag 1");
            assert_eq!(rt.setting("ui_active_tags"), json!([1]), "TAGS {style} failed to toggle Tag 1");
        }
        assert!(rt.h.query_by_label("Calculate range").is_some(), "TAGS {style} missing Calculate range");

        let mut rs = rig_tab(TabId::Settings, make_tab(TabId::Settings), json!({"ui_card_style": style}), SIZE_TALL, false);
        rs.click("Test & Reload");
        assert!(rs.h.query_by_label("Refresh preview").is_some() || rs.h.query_by_label("⟳ Refresh").is_some(), "SETTINGS {style} missing injection refresh");
    }
}

#[test]
fn t12_05_grid_fit_has_no_overlap_or_truncation_across_styles() {
    let tabs = [
        (TabId::Capture, "CAPTURE"),
        (TabId::Tags, "TAGS"),
        (TabId::Video, "VIDEO"),
        (TabId::Settings, "SETTINGS"),
    ];
    for (tab_id, label) in tabs {
        for style in CARD_STYLES {
            for (wtag, size) in [("std", SIZE_STD), ("narrow", SIZE_NARROW)] {
                let r = rig_tab(tab_id, make_tab(tab_id), json!({"ui_card_style": style}), size, false);
                assert_grid_clean(&r, tab_id, label, style, wtag);
            }
        }
    }
}

/// `CSDM_T12_SHOTS_OUT=<folder>`: renders all 4 card-grid tabs in `timeline`, `sentence`, `tiles`.
#[test]
fn renders_t12_style_comparison_pages() {
    let Some(out) = std::env::var_os("CSDM_T12_SHOTS_OUT").map(PathBuf::from) else { return };
    std::fs::create_dir_all(&out).expect("create shots dir");
    let tabs = [
        (TabId::Capture, "capture", egui::Vec2::new(1600.0, 3400.0)),
        (TabId::Tags, "tags", egui::Vec2::new(1600.0, 1300.0)),
        (TabId::Video, "video", egui::Vec2::new(1600.0, 2300.0)),
        (TabId::Settings, "settings", egui::Vec2::new(1600.0, 2500.0)),
    ];
    for (tab_id, name, size) in tabs {
        for style in CARD_STYLES {
            let mut r = rig_tab(
                tab_id,
                make_tab(tab_id),
                json!({
                    "ui_card_style": style,
                    "theme_bg": "white",
                    "theme_accent": "#2563EB",
                    "recsys": "HLAE",
                    "assemble_after": true,
                    "match_type_filter_enabled": true,
                    "match_type_premier": true,
                    "map_filter_enabled": true,
                    "map_filter": ["mirage", "inferno"],
                    "weapons": ["AWP", "AK-47"],
                    "kill_mod_one_tap": true,
                    "clutch_enabled": true,
                    "date_from": "01-06-2026",
                    "date_to": "14-11-2026"
                }),
                size,
                true,
            );
            r.h.run();
            let img = r.h.render().expect("headless wgpu render");
            img.save(out.join(format!("t12-{name}-{style}.png"))).expect("save t12 png");
        }
    }
}
