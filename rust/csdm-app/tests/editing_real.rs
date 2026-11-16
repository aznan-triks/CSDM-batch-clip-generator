//! End to end, by hand: the EDITING tab on the real engine (`RealEngine` + `SettingsHome`), a
//! throwaway copy of a real 3.5 settings folder, the real database read-only (csdm-db only reads).
//! Prints counts and timings only, nothing from the files or the database.
//!
//! PREVIEW with the folder's own settings, the clips on the timeline, one edit whose cameras the
//! engine plans again, one clip left out, SAVE under a name, the selection scrambled, the preset
//! loaded from SETTINGS: the selection and the edit come back. Also measures what a frame of the
//! tab costs on that real preview (no window, so layout and painting commands, not the GPU).
//!
//!   $env:CSDM_REAL_SETTINGS_DIR = "<a 3.5 CSDM-batch-clip_config folder>"
//!   cargo test -p csdm-app --test editing_real -- --ignored --nocapture

use csdm_app::link::DbState;
use csdm_app::tabs::editing::{EditingTab, View};
use csdm_app::tabs::settings::controls::PickKind;
use csdm_app::tabs::settings::SettingsTab;
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_core::ui_values::EDITING_PPS;
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
/// A first preview reads every demo file it needs.
const WAIT: Duration = Duration::from_secs(1800);
const TICK: Duration = Duration::from_millis(20);
const PRESET: &str = "t8-e2e";
const FRAMES: u32 = 120;

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

fn tab(s: &mut Shell) -> &mut EditingTab {
    s.view::<EditingTab>(TabId::Editing).expect("editing tab")
}

fn settings(s: &mut Shell) -> &mut SettingsTab {
    s.view::<SettingsTab>(TabId::Settings).expect("settings tab")
}

/// Mean and worst time of one frame, in milliseconds.
fn frame_cost(h: &mut Harness<'static, Shell>) -> (f64, f64) {
    let (mut total, mut worst) = (Duration::ZERO, Duration::ZERO);
    for _ in 0..FRAMES {
        let t = Instant::now();
        h.step();
        let d = t.elapsed();
        total += d;
        worst = worst.max(d);
    }
    (total.as_secs_f64() * 1e3 / f64::from(FRAMES), worst.as_secs_f64() * 1e3)
}

#[test]
#[ignore = "needs a real 3.5 settings folder and its database; run by hand"]
fn editing_tab_on_the_real_engine() {
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
    let secrets = Secrets::default();
    let places = SearchPlaces { explicit_root: Some(profile.path().into()), exe_dir: None, local_app_data: Some(lad.path().into()) };
    let (home, opened) = SettingsHome::open(&places, secrets.clone()).unwrap();
    assert!(matches!(opened, Opened::Imported { .. }), "first launch imports the 3.5 copy");
    let loaded = home.load_config().unwrap();
    let engine = RealEngine::start_with_home(loaded["data"].as_object().unwrap().clone(), secrets, None, Some(home));
    let dir = export.path().to_path_buf();
    let mut h = Harness::builder().with_size(SIZE).with_step_dt(STEP_DT).with_max_steps(400).build_eframe(move |cc| {
        Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion: Motion::Still, export_dir: dir })
            .with_tab(TabId::Editing, Box::new(EditingTab::new()))
            .with_tab(TabId::Settings, Box::new(SettingsTab::with_picker(Box::new(|_kind: PickKind| None))))
    });
    until(&mut h, "the start-up connection", |s| s.link.settings_loaded && s.link.db != DbState::Pending && s.link.inputs_problem.is_none());
    assert_eq!(h.state().link.db, DbState::Ok, "the real database answered (read-only)");

    // PREVIEW with the folder's own settings.
    let started = Instant::now();
    h.get_by_label("PREVIEW").click();
    h.run();
    until(&mut h, "the preview", |s| s.link.state.preview_serial > 0 && !s.link.state.busy);
    let (clips, lanes) = {
        let p = &h.state().link.state.preview;
        (p.clips.len(), p.lanes().len())
    };
    println!("preview: {clips} clips in {lanes} demos, {:.1} s", started.elapsed().as_secs_f64());
    assert!(clips > 0, "these settings find no clip: the end-to-end run needs a preview with clips");
    assert_eq!(h.state().active, TabId::Editing, "a preview with clips opens EDITING");

    // What a frame costs on this preview.
    let arithmetic = Instant::now();
    let total = h.state().link.state.preview.total_s();
    println!("totals over {clips} clips: {:.3} ms ({total:.0} s of clips)", arithmetic.elapsed().as_secs_f64() * 1e3);
    let fit = frame_cost(&mut h);
    tab(h.state_mut()).zoom.pps = Some(EDITING_PPS[1]);
    h.run();
    let zoomed = frame_cost(&mut h);
    tab(h.state_mut()).zoom.pps = None;
    tab(h.state_mut()).view = View::List;
    h.run();
    let list = frame_cost(&mut h);
    tab(h.state_mut()).view = View::Timeline;
    h.run();
    println!("frame (mean / worst ms): timeline fitted {:.2} / {:.2}, timeline at the closest zoom {:.2} / {:.2}, list {:.2} / {:.2}", fit.0, fit.1, zoomed.0, zoomed.1, list.0, list.1);

    // One edit: the end of the first clip of the first demo, one second later; the engine plans its cameras again.
    let first = {
        let p = &h.state().link.state.preview;
        format!("{} clip 1", p.lanes()[0].name)
    };
    h.get_by_label(&first).click();
    h.run();
    let index = tab(h.state_mut()).active.expect("the clicked clip is open");
    h.get_by_label("Seconds after this clip's last event").focus();
    h.run();
    h.key_press(egui::Key::ArrowRight);
    h.run();
    let after = h.state().link.state.preview.clips[index].after_s.expect("the end handle moved");
    until(&mut h, "the cameras of the edited clip", |s| tab(s).planned_cameras().is_some());
    println!("edit: after = {after} s, {} camera span(s) planned again by the engine", tab(h.state_mut()).planned_cameras().unwrap().len());

    // One clip left out, then SAVE under a name: settings, selection and edits go to the throwaway folder.
    let other = (0..clips).find(|k| *k != index).expect("a second clip");
    h.state_mut().link.state.preview.toggle(other);
    h.run();
    let saved = h.state().link.state.preview.selected_clips();
    h.get_by_label("SAVE").click();
    h.run();
    // The engine asks the name from its own thread.
    let start = Instant::now();
    while h.query_by_label("Preset name:").is_none() {
        assert!(start.elapsed() < WAIT, "timed out waiting for the name question");
        std::thread::sleep(TICK);
        h.step();
    }
    h.get_by_label("Preset name:").type_text(PRESET);
    h.run();
    h.get_by_label("Save").click();
    h.run();
    let presets = profile.path().join(V5_CONFIG_SUBDIR).join(PRESETS_FILE);
    let stored = |path: &Path| std::fs::read(path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|v| v[PRESET]["selected_clips"].clone()).filter(|v| v.is_array());
    let start = Instant::now();
    while stored(&presets).is_none() {
        assert!(start.elapsed() < WAIT, "timed out waiting for the saved preset");
        std::thread::sleep(TICK);
        h.step();
    }
    assert_eq!(stored(&presets).unwrap(), saved, "the preset holds the checked clips with their edits");

    // Scramble: the edit put back, the left-out clip checked again, another one left out.
    h.state_mut().link.state.preview.reset(index);
    h.state_mut().link.state.preview.toggle(other);
    h.state_mut().link.state.preview.toggle(index);
    h.run();
    assert_ne!(h.state().link.state.preview.selected_clips(), saved);

    // Loading the preset from SETTINGS restores the selection and the edit.
    h.get_by_label("SETTINGS").click();
    h.run();
    until(&mut h, "the preset list", |s| settings(s).presets.contains_key(PRESET));
    h.get_by_label(&format!("Load {PRESET}")).click();
    h.run();
    until(&mut h, "the loaded preset", |s| settings(s).preset_status == format!("Loaded \"{PRESET}\"."));
    let p = &h.state().link.state.preview;
    assert_eq!(p.selected_clips(), saved, "selection and edits restored");
    assert_eq!((p.clips[index].after_s, p.clips[other].selected), (Some(after), false));
    assert!(h.state().console.texts().iter().any(|l| l.contains("EDITING selection restored")), "the engine says what it restored");
    assert!(originals(src) == before, "the real 3.5 folder was not written");
    println!("e2e ok: preview, edit with cameras, save ({} clips kept of {clips}), scramble, load: selection and edits restored; 3.5 files unchanged", saved.as_array().unwrap().len());
}
