//! End to end, by hand: the VIDEO tab on the real engine (`RealEngine` + `SettingsHome`), a
//! throwaway copy of a real 3.5 settings folder, the real database read-only (csdm-db only reads).
//! Prints nothing from the files: they hold the database password.
//!
//!   $env:CSDM_REAL_SETTINGS_DIR = "<a 3.5 CSDM-batch-clip_config folder>"
//!   cargo test -p csdm-app --test video_real -- --ignored --nocapture

use csdm_app::link::DbState;
use csdm_app::tabs::video::VideoTab;
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_core::values::{CONFIG_FILE, CONFIG_FILES, CONFIG_SUBDIR, V5_CONFIG_SUBDIR};
use csdm_engine::import35::SearchPlaces;
use csdm_engine::real::RealEngine;
use csdm_engine::settings_home::{Opened, SettingsHome};
use csdm_engine::Secrets;
use eframe::egui;
use egui_kittest::kittest::Queryable;
use egui_kittest::Harness;
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};

const SIZE: egui::Vec2 = egui::Vec2::new(1600.0, 4200.0);
const STEP_DT: f32 = 1.0 / 60.0;
const WAIT: Duration = Duration::from_secs(60);
const TICK: Duration = Duration::from_millis(20);

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

fn tab(s: &mut Shell) -> &mut VideoTab {
    s.view::<VideoTab>(TabId::Video).expect("the VIDEO tab")
}

fn click(h: &mut Harness<'static, Shell>, label: &str) {
    h.get_by_label(label).click();
    h.run();
}

#[test]
#[ignore = "needs a real 3.5 settings folder and its database; run by hand"]
fn video_tab_on_the_real_engine() {
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
    let settings = home.load_config().unwrap()["data"].as_object().unwrap().clone();
    let password = settings.get("pg_pass").and_then(Value::as_str).unwrap_or_default().to_string();
    let engine = RealEngine::start_with_home(settings, secrets, None, Some(home));
    let dir = export.path().to_path_buf();
    let mut h = Harness::builder().with_size(SIZE).with_step_dt(STEP_DT).with_max_steps(400).build_eframe(move |cc| {
        Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion: Motion::Still, export_dir: dir }).with_tab(TabId::Video, Box::new(VideoTab::new()))
    });

    until(&mut h, "the start-up connection", |s| s.link.settings_loaded && s.link.db != DbState::Pending);
    assert_eq!(h.state().link.db, DbState::Ok, "the real database answered (read-only)");
    click(&mut h, "VIDEO");
    until(&mut h, "the tables", |s| tab(s).tables.is_some() || tab(s).tables_error.is_some());
    let tables = tab(h.state_mut()).tables.clone().expect("the real engine's tables");
    assert!(!tables.resolutions.is_empty() && !tables.framerates.is_empty() && !tables.video_codecs.is_empty() && !tables.audio_codecs.is_empty());

    // Every card in HLAE mode, the HLAE card gone in CS mode.
    click(&mut h, "System: HLAE");
    h.get_by_label("FOV");
    click(&mut h, "System: CS");
    h.run();
    assert!(h.query_by_label("FOV").is_none(), "HLAE Options only in HLAE mode");

    // A preset writes width and height; a codec from the real table; both saved by the real engine.
    let (label, w, hgt) = tables.resolutions.last().cloned().unwrap();
    click(&mut h, &format!("Resolution: {label}"));
    click(&mut h, "Codec");
    let codec = tables.video_codecs.last().cloned().unwrap();
    click(&mut h, &codec);
    let file = profile.path().join(V5_CONFIG_SUBDIR).join(CONFIG_FILE);
    let start = Instant::now();
    let disk = loop {
        h.step();
        let d: Value = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
        if d["video_codec"] == json!(codec) && d["width"] == json!(w) {
            break d;
        }
        let shown = |k: &str| h.state().link.get(k).cloned().unwrap_or(Value::Null);
        assert!(start.elapsed() < WAIT, "never saved: on disk codec {} width {}; in the window codec {} width {}; wanted {codec} {w}", d["video_codec"], d["width"], shown("video_codec"), shown("width"));
        std::thread::sleep(TICK);
    };
    assert_eq!((disk["height"].clone(), disk["recsys"].clone()), (json!(hgt), json!("CS")));

    if !password.is_empty() {
        assert!(h.query_by_label(&password).is_none(), "password on screen");
        assert!(h.state().console.texts().iter().all(|l| !l.contains(&password)), "password in the console");
    }
    assert!(originals(src) == before, "the real 3.5 folder was not written");
    assert!(originals(&old) == copies, "the 3.5 copy was not written");
    println!("e2e ok: db connected, {} resolutions / {} codecs from the real engine, HLAE card follows the mode, {label} + {codec} saved, 3.5 files unchanged", tables.resolutions.len(), tables.video_codecs.len());
}
