//! End to end, by hand: the CAPTURE tab on the real engine (`RealEngine` + `SettingsHome`), a
//! throwaway copy of a real 3.5 settings folder, the real database read-only (csdm-db only reads).
//! Prints no player name, Steam ID or path: they are the author's.
//!
//!   $env:CSDM_REAL_SETTINGS_DIR = "<a 3.5 CSDM-batch-clip_config folder>"
//!   cargo test -p csdm-app --test capture_real -- --ignored --nocapture

use csdm_app::link::DbState;
use csdm_app::tabs::capture::CaptureTab;
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_core::values::{CONFIG_FILE, CONFIG_FILES, CONFIG_SUBDIR, V5_CONFIG_SUBDIR};
use csdm_engine::import35::SearchPlaces;
use csdm_engine::real::RealEngine;
use csdm_engine::settings_home::SettingsHome;
use csdm_engine::Secrets;
use eframe::egui;
use egui::accesskit::Role;
use egui_kittest::kittest::{NodeT, Queryable};
use egui_kittest::Harness;
use serde_json::Value;
use std::path::Path;
use std::time::{Duration, Instant};

const SIZE: egui::Vec2 = egui::Vec2::new(1600.0, 4400.0);
const STEP_DT: f32 = 1.0 / 60.0;
/// Listing every demo of a large database takes a while.
const WAIT: Duration = Duration::from_secs(300);
const TICK: Duration = Duration::from_millis(20);
/// Registry rows of the Kill, Damage and Shot cards on the 3.5 registry.
const LEAST_FILTER_ROWS: usize = 10;

fn originals(dir: &Path) -> Vec<Option<Vec<u8>>> {
    CONFIG_FILES.iter().map(|f| std::fs::read(dir.join(f)).ok()).collect()
}

fn until(h: &mut Harness<'static, Shell>, what: &str, done: impl Fn(&mut Shell) -> bool) {
    let start = Instant::now();
    while !done(h.state_mut()) {
        assert!(start.elapsed() < WAIT, "timed out waiting for {what}");
        std::thread::sleep(TICK);
        h.step();
    }
    h.run();
}

fn tab(s: &mut Shell) -> &mut CaptureTab {
    s.view::<CaptureTab>(TabId::Capture).expect("capture tab")
}

/// The saved 5.x settings, flat or under `data`.
fn saved(path: &Path, key: &str) -> Value {
    let v: Value = std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    if v.get(key).is_some() { v[key].clone() } else { v["data"][key].clone() }
}

#[test]
#[ignore = "needs a real 3.5 settings folder and its database; run by hand"]
fn capture_tab_on_the_real_engine() {
    let src = std::env::var_os("CSDM_REAL_SETTINGS_DIR").expect("CSDM_REAL_SETTINGS_DIR names a 3.5 settings folder");
    let src = Path::new(&src);
    let before = originals(src);
    let (profile, lad, export) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let old = profile.path().join(CONFIG_SUBDIR);
    std::fs::create_dir_all(&old).unwrap();
    for f in CONFIG_FILES {
        if src.join(f).is_file() {
            std::fs::copy(src.join(f), old.join(f)).unwrap();
        }
    }
    let copies = originals(&old);
    let secrets = Secrets::default();
    let places = SearchPlaces { explicit_root: Some(profile.path().into()), exe_dir: None, local_app_data: Some(lad.path().into()) };
    let (home, _) = SettingsHome::open(&places, secrets.clone()).unwrap();
    let settings = home.load_config().unwrap()["data"].as_object().unwrap().clone();
    let engine = RealEngine::start_with_home(settings, secrets, None, Some(home));
    let dir = export.path().to_path_buf();
    let mut h = Harness::builder().with_size(SIZE).with_step_dt(STEP_DT).with_max_steps(400).build_eframe(move |cc| {
        Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion: Motion::Still, export_dir: dir }).with_tab(TabId::Capture, Box::new(CaptureTab::new()))
    });

    until(&mut h, "the start-up connection", |s| s.link.settings_loaded && s.link.db != DbState::Pending);
    assert_eq!(h.state().link.db, DbState::Ok, "the real database answered (read-only)");
    until(&mut h, "the database read", |s| s.link.database.is_some());
    h.get_by_label("CAPTURE").click();
    h.run();

    // Player: the database's players are listed; a click toggles the first by name in the clips
    // (the imported profile may already hold a selection).
    let players = h.state().link.database.as_ref().and_then(|d| d["players"].as_array().cloned()).unwrap_or_default();
    assert!(!players.is_empty(), "the database lists players");
    let first = players.iter().min_by_key(|p| p[2].as_str().unwrap_or_default().to_lowercase()).unwrap().clone();
    let (first_id, first_name) = (first[1].clone(), first[2].as_str().unwrap().to_string());
    let held = |s: &Shell| s.link.get("steam_ids").and_then(Value::as_array).is_some_and(|a| a.contains(&first_id));
    let before_click = held(h.state());
    h.query_all_by_role_and_label(Role::CheckBox, &first_name).next().expect("the first player by name is drawn").click();
    h.run();
    assert_ne!(held(h.state()), before_click, "the click toggled that player in the clips");
    let ids = h.state().link.get("steam_ids").cloned().unwrap_or(Value::Null);

    // Weapon Filter: Select all writes every weapon the database recorded that the engine classes.
    h.get_by_label("Select all").click();
    h.run();
    let weapons = h.state().link.get("weapons").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
    assert!(weapons > 0, "Select all picked the database's weapons");

    // Demo Selection: manual mode lists every demo of the database.
    h.get_by_label("Manual mode (load ALL demos from DB)").click();
    h.run();
    until(&mut h, "the demo list", |s| tab(s).demos.rows.is_some() || tab(s).demos.error.is_some());
    assert!(tab(h.state_mut()).demos.error.is_none(), "list_demos answered");
    let demos = tab(h.state_mut()).demos.rows.as_ref().map(Vec::len).unwrap_or(0);
    assert!(demos > 0, "the database lists demos");

    // Filter cards: rows from the real engine's registry (asked at start-up, answered by now).
    let rows = h.query_all_by_role(Role::CheckBox).filter(|n| n.accesskit_node().label().is_some_and(|l| l.starts_with("Enable "))).count();
    assert!(rows >= LEAST_FILTER_ROWS, "{rows} filter rows drawn from the registry");

    // The choices reach the 5.x settings file of the throwaway profile.
    let file = profile.path().join(V5_CONFIG_SUBDIR).join(CONFIG_FILE);
    until(&mut h, "the saved settings", |_| saved(&file, "steam_ids") == ids && saved(&file, "weapons").as_array().map(Vec::len) == Some(weapons));

    assert!(originals(src) == before, "the real 3.5 folder was not written");
    assert!(originals(&old.join(csdm_core::values::PRE_V5_BACKUP_DIR)) == copies, "pre-v5 backup holds the unmodified 3.5 copy");
    println!("e2e ok: db connected, {} players, 1 toggled, {weapons} weapons, {rows} filter rows, {demos} demos listed, settings saved, 3.5 files unchanged", players.len());
}
