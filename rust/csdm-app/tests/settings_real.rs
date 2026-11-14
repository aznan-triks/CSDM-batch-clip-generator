//! End to end, by hand: the SETTINGS tab on the real engine (`RealEngine` + `SettingsHome`),
//! a throwaway copy of a real 3.5 settings folder, the real database read-only (csdm-db only
//! reads). Prints nothing from the files: they hold the database password.
//!
//!   $env:CSDM_REAL_SETTINGS_DIR = "<a 3.5 CSDM-batch-clip_config folder>"
//!   cargo test -p csdm-app --test settings_real -- --ignored --nocapture

use csdm_app::link::DbState;
use csdm_app::tabs::settings::controls::PickKind;
use csdm_app::tabs::settings::{PgState, SettingsTab};
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_core::values::{CONFIG_FILES, CONFIG_SUBDIR, PRESETS_FILE, V5_CONFIG_SUBDIR};
use csdm_engine::import35::SearchPlaces;
use csdm_engine::real::RealEngine;
use csdm_engine::settings_home::{Opened, SettingsHome};
use csdm_engine::Secrets;
use eframe::egui;
use egui_kittest::kittest::Queryable;
use egui_kittest::Harness;
use serde_json::Value;
use std::path::Path;
use std::time::{Duration, Instant};

const SIZE: egui::Vec2 = egui::Vec2::new(1600.0, 3200.0);
const STEP_DT: f32 = 1.0 / 60.0;
const WAIT: Duration = Duration::from_secs(60);
const TICK: Duration = Duration::from_millis(20);
const PRESET: &str = "t11-e2e";

fn originals(dir: &Path) -> Vec<Option<Vec<u8>>> {
    CONFIG_FILES.iter().map(|f| std::fs::read(dir.join(f)).ok()).collect()
}

/// Steps the window until `done` holds (the engine answers on its own thread).
fn until(h: &mut Harness<'static, Shell>, what: &str, done: impl Fn(&mut Shell) -> bool) {
    let start = Instant::now();
    while !done(h.state_mut()) {
        assert!(start.elapsed() < WAIT, "timed out waiting for {what}");
        std::thread::sleep(TICK);
        h.step();
    }
    h.run();
}

fn tab(s: &mut Shell) -> &mut SettingsTab {
    s.view::<SettingsTab>(TabId::Settings).expect("settings tab")
}

#[test]
#[ignore = "needs a real 3.5 settings folder and its database; run by hand"]
fn settings_tab_on_the_real_engine() {
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
    let (home, opened) = SettingsHome::open(&places, secrets.clone()).unwrap();
    assert!(matches!(opened, Opened::Imported { .. }), "first launch imports the 3.5 copy");
    let loaded = home.load_config().unwrap();
    let settings = loaded["data"].as_object().unwrap().clone();
    let password = settings.get("pg_pass").and_then(Value::as_str).unwrap_or_default().to_string();
    let engine = RealEngine::start_with_home(settings, secrets, None, Some(home));
    let dir = export.path().to_path_buf();
    let mut h = Harness::builder().with_size(SIZE).with_step_dt(STEP_DT).with_max_steps(400).build_eframe(move |cc| {
        let picker = Box::new(|_kind: PickKind| None);
        Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion: Motion::Still, export_dir: dir }).with_tab(TabId::Settings, Box::new(SettingsTab::with_picker(picker)))
    });

    until(&mut h, "the start-up connection", |s| s.link.settings_loaded && s.link.db != DbState::Pending);
    assert_eq!(h.state().link.db, DbState::Ok, "the real database answered (read-only)");
    h.get_by_label("SETTINGS").click();
    h.run();
    until(&mut h, "the folder and the presets", |s| tab(s).folder.is_some());
    let v5 = profile.path().join(V5_CONFIG_SUBDIR);
    h.get_by_label(&v5.to_string_lossy());

    // Test & Reload with the values on screen.
    h.get_by_label("Test & Reload").click();
    h.run();
    until(&mut h, "the connection test", |s| tab(s).pg_state != PgState::Busy);
    assert_eq!(tab(h.state_mut()).pg_state, PgState::Ok);

    // A preset, saved by the real engine into the 5.x folder of the throwaway profile.
    tab(h.state_mut()).preset_name = PRESET.into();
    h.get_by_label("Timing").click();
    h.run();
    h.get_by_label("SAVE").click();
    h.run();
    until(&mut h, "the saved preset", |s| tab(s).presets.contains_key(PRESET));
    let file: Value = serde_json::from_slice(&std::fs::read(v5.join(PRESETS_FILE)).unwrap()).unwrap();
    let data = file[PRESET]["data"].as_object().unwrap();
    assert!(data.keys().all(|k| !k.starts_with("pg_")), "no credential key in the preset");
    assert!(password.is_empty() || data.values().all(|v| v.as_str() != Some(password.as_str())), "no password in the preset");
    h.get_by_label(&format!("Load {PRESET}")).click();
    h.run();
    until(&mut h, "the loaded preset", |s| tab(s).preset_status == format!("Loaded \"{PRESET}\"."));

    // Injection preview: its tranche (T4) has not landed; the engine says so in words.
    h.get_by_label("⟳ Refresh").click();
    h.run();
    until(&mut h, "the injection answer", |s| tab(s).injection.is_some());
    assert!(matches!(&tab(h.state_mut()).injection, Some(Err(e)) if e.contains("not available")));

    // Nothing secret on screen or in the console; the 3.5 files untouched, original and copy.
    if !password.is_empty() {
        assert!(h.query_by_label(&password).is_none(), "password on screen");
        assert!(h.state().console.texts().iter().all(|l| !l.contains(&password)), "password in the console");
    }
    assert!(originals(src) == before, "the real 3.5 folder was not written");
    assert!(originals(&old) == copies, "the 3.5 copy was not written");
    println!("e2e ok: db connected, test & reload ok, preset saved ({} settings) and loaded, 3.5 files unchanged", data.len());
}
