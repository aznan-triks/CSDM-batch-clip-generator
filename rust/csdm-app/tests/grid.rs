//! Driven tests of the card grid, one per « Grille de cartes » parity line (research/04),
//! no window: real pointer events on the grip, the corner and the header; every test
//! starts with transient start-up measurements (ticket 06: they must never reorder cards).

mod common;

use common::{boot, rig_with, scenario, Cards, Rig};
use csdm_app::tabs::TabId;
use csdm_app::Motion;
use csdm_core::grid::Item;
use eframe::egui;
use egui_kittest::kittest::Queryable;
use serde_json::{json, Value};

const DEFAULTS: &str = r##"{"theme_bg": "white", "theme_accent": "#2563EB"}"##;
const CARDS: [(&str, &str, bool); 4] = [("a", "Kill Filters", false), ("b", "Presets", false), ("log", "Run Log", true), ("c", "Players", false)];

fn grid_rig(settings: &str) -> Rig {
    let mut tab = Cards::new(&CARDS);
    tab.tall_frames = 3; // the first measurements are huge, as before the window has its size
    rig_with(&scenario(&[&boot(settings), r#"{"on": "run_inputs_problem", "reply": {"ok": {"problem": null}}}"#]), Motion::Still, Some((TabId::Capture, Box::new(tab))), false)
}

fn item(r: &Rig, id: &str) -> Item {
    r.h.state().grids[0].drawn.iter().find(|(i, _)| i == id).map(|(_, it)| *it).unwrap_or_else(|| panic!("card {id} not drawn"))
}

fn order(r: &Rig) -> Vec<String> {
    let mut v = r.h.state().grids[0].drawn.clone();
    v.sort_by_key(|(_, it)| (it.y, it.x));
    v.into_iter().map(|(id, _)| id).collect()
}

fn no_overlap(r: &Rig) {
    let v = &r.h.state().grids[0].drawn;
    for (ia, a) in v {
        for (ib, b) in v {
            assert!(ia == ib || a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, "{ia} {a:?} overlaps {ib} {b:?}");
        }
    }
}

fn stored(r: &Rig) -> Value {
    r.setting("ui_sections").unwrap_or(Value::Null)
}

#[test]
fn grille_00_transient_startup_measures_keep_the_order() {
    let r = grid_rig(DEFAULTS);
    assert_eq!(order(&r), ["a", "b", "log", "c"], "reading order kept after the transient tall frames");
    no_overlap(&r);
    assert!(item(&r, "a").h < 24, "fitted to its short body: {:?}", item(&r, "a"));
}

#[test]
fn grille_01_move_by_the_grip_pushes_and_saves_on_drop_only() {
    let mut r = grid_rig(DEFAULTS);
    assert_eq!(stored(&r), csdm_core::settings::defaults(None)["ui_sections"], "nothing saved before a gesture");
    let from = r.h.get_by_label("Move Players").rect().center();
    let to = r.h.get_by_label("Move Kill Filters").rect().center();
    r.drag(from, to);
    let (c, a) = (item(&r, "c"), item(&r, "a"));
    assert_eq!((c.x, c.y), (0, 0), "Players took the spot");
    assert!(a.y >= c.h, "Kill Filters pushed below: {a:?}");
    no_overlap(&r);
    let saved = &stored(&r)["capture"];
    assert_eq!(saved["v"], json!(5));
    assert_eq!((saved["cards"]["c"]["x"].clone(), saved["cards"]["c"]["y"].clone()), (json!(0), json!(0)));
}

#[test]
fn grille_02_resize_by_the_corner_marks_the_height_manual() {
    let mut r = grid_rig(DEFAULTS);
    let before = item(&r, "b");
    let from = r.h.get_by_label("Resize Presets").rect().center();
    r.drag(from, from + egui::vec2(-58.0, 3.0 * 34.0));
    let after = item(&r, "b");
    assert!(after.manual, "{after:?}");
    assert!(after.user_resized, "{after:?}");
    assert_eq!(after.w, before.w - 1);
    assert!(after.h > before.h);
    assert_eq!(stored(&r)["capture"]["cards"]["b"]["manual"], json!(true));
    assert_eq!(stored(&r)["capture"]["cards"]["b"]["userResized"], json!(true));
    no_overlap(&r);
}

#[test]
fn grille_02b_legacy_manual_height_fits_near_content_and_keeps_far_taller() {
    let base_h = item(&grid_rig(DEFAULTS), "a").h;
    let near_h = base_h + 2;
    let tall_h = base_h + csdm_core::ui_values::LEGACY_MANUAL_MARGIN_ROWS + 3;
    let settings = json!({
        "theme_bg": "white",
        "theme_accent": "#2563EB",
        "ui_sections": {
            "capture": {
                "v": 5,
                "cards": {
                    "a": {"x": 0, "y": 0, "w": 6, "h": near_h, "manual": true},
                    "b": {"x": 6, "y": 0, "w": 6, "h": tall_h, "manual": true}
                },
                "collapsed": []
            }
        }
    })
    .to_string();
    let r = grid_rig(&settings);
    assert_eq!(item(&r, "a").h, base_h, "legacy manual height within margin fits to content");
    assert_eq!(item(&r, "b").h, tall_h, "legacy manual height exceeding content by > margin stays locked");
}

#[test]
fn grille_03_fold_and_unfold_give_back_the_height() {
    let mut r = grid_rig(DEFAULTS);
    let h = item(&r, "c").h;
    r.click("Collapse Players card");
    assert_eq!(item(&r, "c").h, 2, "ui_card_collapsed_rows");
    assert_eq!(stored(&r)["capture"]["cards"]["c"]["hPrev"], json!(h));
    assert_eq!(stored(&r)["capture"]["collapsed"], json!(["c"]));
    r.click("Expand Players card");
    assert_eq!(item(&r, "c").h, h);
}

#[test]
fn grille_04_height_follows_content() {
    let mut r = grid_rig(DEFAULTS);
    let loaded = stored(&r);
    let h = item(&r, "log").h;
    for _ in 0..6 {
        r.click("Add line");
    }
    assert!(item(&r, "log").h > h, "the log card grew with its lines");
    no_overlap(&r);
    assert_eq!(stored(&r), loaded, "a fitted height is never saved by itself");
}

#[test]
fn grille_05_reference_layout_and_reset() {
    let mut r = grid_rig(DEFAULTS);
    let (a, b, log) = (item(&r, "a"), item(&r, "b"), item(&r, "log"));
    assert_eq!((a.x, a.w, b.x, b.w), (0, 6, 6, 6), "six columns per card, reading order");
    let cols = csdm_app::grid::geometry(&r.h.state().link, r.h.state().grids[0].drawn.len() as f32).cols;
    assert!(cols >= 1);
    assert_eq!(log.x, 0, "wide card starts a row");
    let from = r.h.get_by_label("Move Players").rect().center();
    let to = r.h.get_by_label("Move Kill Filters").rect().center();
    r.drag(from, to);
    assert!(stored(&r).get("capture").is_some());
    r.click("Reset card layout");
    assert_eq!(stored(&r), json!({}), "every tab back to its reference layout");
    r.h.run();
    assert_eq!((item(&r, "a").x, item(&r, "a").y), (0, 0));
}

#[test]
fn grille_06_layout_persists_per_tab_and_survives_a_reload() {
    let mut r = grid_rig(DEFAULTS);
    let loaded = stored(&r);
    let from = r.h.get_by_label("Move Players").rect().center();
    let to = r.h.get_by_label("Move Kill Filters").rect().center();
    r.drag(from, to);
    let saved = stored(&r);
    assert_ne!(saved["capture"], loaded["capture"]);
    assert_eq!(saved["tags"], loaded["tags"], "another tab untouched");
    let mut settings: serde_json::Map<String, Value> = serde_json::from_str(DEFAULTS).unwrap();
    settings.insert("ui_sections".into(), saved.clone());
    let again = grid_rig(&Value::Object(settings).to_string());
    assert_eq!((item(&again, "c").x, item(&again, "c").y), (0, 0), "reloaded where the user left it");
}

#[test]
fn grille_07_columns_follow_the_pane_width_without_saving() {
    let mut r = grid_rig(DEFAULTS);
    let loaded = stored(&r);
    let wide_w = item(&r, "log").w;
    r.h.set_size(egui::vec2(1000.0, 900.0));
    r.h.run();
    let narrow_w = item(&r, "log").w;
    assert!(narrow_w < wide_w, "wide card follows the column count: {wide_w} -> {narrow_w}");
    no_overlap(&r);
    assert_eq!(stored(&r), loaded, "a transient width never overwrites the layout");
}

#[test]
fn grille_08_wheel_over_a_card_scrolls_the_pane() {
    let mut r = grid_rig(DEFAULTS);
    r.h.set_size(egui::vec2(1600.0, 700.0));
    r.h.run();
    let before = r.h.get_by_label("Move Players").rect().top();
    let over = r.h.get_by_label("Collapse Kill Filters card").rect().center() + egui::vec2(0.0, 60.0);
    r.h.hover_at(over);
    r.h.event(egui::Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta: egui::vec2(0.0, -200.0), modifiers: egui::Modifiers::NONE, phase: egui::TouchPhase::Move, source: egui::MouseWheelSource::Unknown });
    r.h.run();
    let after = r.h.get_by_label("Move Players").rect().top();
    assert!(after < before, "the pane scrolled under the wheel: {before} -> {after}");
}
