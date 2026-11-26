//! Driven tests of the VIDEO tab, one per « VIDEO » parity line (research/04), no window.
//!
//! The engine is the real one (`RealEngine` + `SettingsHome`) on a throwaway profile: settings are
//! loaded and saved by it, the tables come from its `describe_filters`. Its database address points
//! at a closed port (the tab needs no database), so no answer here is written by hand and nothing
//! reaches a server.

use csdm_app::link::DbState;
use csdm_app::tabs::video::kit::{drawn_id, Drawn};
use csdm_app::tabs::video::VideoTab;
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_core::values::{CONFIG_FILE, V5_CONFIG_SUBDIR};
use csdm_engine::import35::SearchPlaces;
use csdm_engine::settings_home::SettingsHome;
use csdm_engine::{Command, Engine, EngineEvent, RealEngine, Secrets};
use eframe::egui;
use egui_kittest::kittest::Queryable;
use egui_kittest::Harness;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Tall enough that every card of the tab is on screen: clicks land where the node is drawn.
const SIZE: egui::Vec2 = egui::Vec2::new(1600.0, 4200.0);
const STEP_DT: f32 = 1.0 / 60.0;
const WAIT: Duration = Duration::from_secs(30);
const TICK: Duration = Duration::from_millis(10);

/// The real engine, with the commands the window sent kept for the test.
struct Logged {
    inner: RealEngine,
    sent: Arc<Mutex<Vec<Command>>>,
}

impl Engine for Logged {
    fn send(&mut self, command: Command) -> u64 {
        self.sent.lock().unwrap().push(command.clone());
        self.inner.send(command)
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        self.inner.events()
    }
}

struct Rig {
    h: Harness<'static, Shell>,
    sent: Arc<Mutex<Vec<Command>>>,
    profile: tempfile::TempDir,
    _lad: tempfile::TempDir,
    _export: tempfile::TempDir,
}

/// A throwaway profile whose 5.x folder holds `settings` (plus a database at a closed port), the
/// real engine on it, the window on the VIDEO tab with its tables in.
fn rig(settings: Value) -> Rig {
    rig_sized(settings, SIZE, false)
}

fn rig_sized(settings: Value, size: egui::Vec2, wgpu: bool) -> Rig {
    let (profile, lad, export) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut s = json!({"pg_host": "127.0.0.1", "pg_port": "1", "theme_bg": "white"});
    s.as_object_mut().unwrap().extend(settings.as_object().unwrap().clone());
    let dir = profile.path().join(V5_CONFIG_SUBDIR);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(CONFIG_FILE), serde_json::to_vec_pretty(&s).unwrap()).unwrap();
    let secrets = Secrets::default();
    let places = SearchPlaces { explicit_root: Some(profile.path().into()), exe_dir: None, local_app_data: Some(lad.path().into()) };
    let (home, _) = SettingsHome::open(&places, secrets.clone()).unwrap();
    let loaded = home.load_config().unwrap()["data"].as_object().unwrap().clone();
    let sent = Arc::new(Mutex::new(Vec::new()));
    let engine = Logged { inner: RealEngine::start_with_home(loaded, secrets, None, Some(home)), sent: sent.clone() };
    let out = export.path().to_path_buf();
    let mut b = Harness::builder().with_size(size).with_step_dt(STEP_DT).with_max_steps(400);
    if wgpu {
        // DX12 crashes headless on the dev machine (rust/PIEGES.md); GL is what the window uses.
        if std::env::var_os("WGPU_BACKEND").is_none() {
            std::env::set_var("WGPU_BACKEND", "gl");
        }
        b = b.wgpu();
    }
    let h = b.build_eframe(move |cc| {
        Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion: Motion::Still, export_dir: out }).with_tab(TabId::Video, Box::new(VideoTab::new()))
    });
    let mut r = Rig { h, sent, profile, _lad: lad, _export: export };
    r.until("the start-up", |s| s.link.settings_loaded && s.link.db != DbState::Pending);
    r.click("VIDEO");
    r.until("the tables", |s| tab(s).tables.is_some() || tab(s).tables_error.is_some());
    assert!(r.tab().tables_error.is_none(), "the real engine sent its tables");
    r
}

fn tab(s: &mut Shell) -> &mut VideoTab {
    s.view::<VideoTab>(TabId::Video).expect("the VIDEO tab")
}

impl Rig {
    /// Steps the window until `done` holds (the engine answers on its own thread).
    fn until(&mut self, what: &str, done: impl Fn(&mut Shell) -> bool) {
        let start = Instant::now();
        while !done(self.h.state_mut()) {
            assert!(start.elapsed() < WAIT, "timed out waiting for {what}");
            std::thread::sleep(TICK);
            self.h.step();
        }
        self.h.run();
    }

    fn tab(&mut self) -> &mut VideoTab {
        tab(self.h.state_mut())
    }

    fn click(&mut self, label: &str) {
        self.h.get_by_label(label).click();
        self.h.run();
    }

    /// Selects the box's text first, then types over it.
    fn replace_in(&mut self, label: &str, text: &str) {
        self.h.get_by_label(label).click();
        self.h.run();
        self.h.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::A);
        self.h.run();
        self.h.get_by_label(label).type_text(text);
        self.h.run();
    }

    fn setting(&self, key: &str) -> Value {
        self.h.state().link.get(key).cloned().unwrap_or(Value::Null)
    }

    fn saves(&self) -> usize {
        self.sent.lock().unwrap().iter().filter(|c| c.name() == "save_config").count()
    }

    fn config_file(&self) -> PathBuf {
        self.profile.path().join(V5_CONFIG_SUBDIR).join(CONFIG_FILE)
    }

    /// Past the save debounce, until the real engine has written the file.
    fn saved(&mut self, key: &str, want: Value) -> Value {
        let file = self.config_file();
        let start = Instant::now();
        loop {
            self.h.step();
            let on_disk: Value = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
            if on_disk[key] == want {
                self.h.run();
                return on_disk;
            }
            assert!(start.elapsed() < WAIT, "`{key}` never saved as {want}; on disk: {}", on_disk[key]);
            std::thread::sleep(TICK);
        }
    }

    fn card_ids(&mut self) -> Vec<&'static str> {
        use csdm_app::grid::TabView;
        self.tab().cards().iter().map(|c| c.id).collect()
    }

    fn count(&mut self, id: &str) -> Option<String> {
        use csdm_app::grid::TabView;
        self.tab().cards().into_iter().find(|c| c.id == id).and_then(|c| c.count)
    }
}

fn registries() -> &'static csdm_core::registries::Registries {
    csdm_core::registries::registries()
}

#[test]
fn video_01_final_assembly_switches_name_and_summary() {
    let mut r = rig(json!({"assemble_after": false, "concatenate_sequences": false, "delete_after_assemble": false, "assemble_output": "assembled.mp4"}));
    r.h.get_by_label("Each clip stays its own file; no final video is made.");
    assert_eq!(r.count("final-assembly").as_deref(), Some("off"));
    r.click("Delete source clips after assembly");
    assert_eq!(r.setting("delete_after_assemble"), json!(true));
    r.h.get_by_label("only when assembling");
    r.click("Assemble at the end");
    r.click("Join sequences");
    assert!(r.h.query_by_label("only when assembling").is_none(), "no warning once assembling");
    r.replace_in("Output filename", "best of.mp4");
    r.h.get_by_label("Clips of one sequence are joined first, then everything is joined into best of.mp4; then the source clips are deleted.");
    assert_eq!(r.count("final-assembly").as_deref(), Some("best of.mp4"));
    let disk = r.saved("assemble_output", json!("best of.mp4"));
    assert_eq!((disk["assemble_after"].clone(), disk["concatenate_sequences"].clone()), (json!(true), json!(true)));
}

#[test]
fn video_02_resolution_presets_write_width_and_height_together() {
    let mut r = rig(json!({"width": 1920, "height": 1080, "framerate": 60, "cs2_window_mode": "none", "cs2_send_to_back": false}));
    for res in &registries().resolutions {
        r.h.get_by_label(&format!("Resolution: {}", res.label));
    }
    for fps in &registries().framerates {
        r.h.get_by_label(&format!("FPS: {fps}"));
    }
    r.h.get_by_label("1920x1080");
    r.h.get_by_label("16:9");
    let before = r.saves();
    r.click("Resolution: 2560x1440");
    assert_eq!((r.setting("width"), r.setting("height")), (json!(2560), json!(1440)));
    let disk = r.saved("width", json!(2560));
    assert_eq!(disk["height"], json!(1440), "height saved with width");
    assert_eq!(r.saves() - before, 1, "one save for the two keys (L3)");
    r.replace_in("Width", "1366");
    r.replace_in("Height", "768");
    r.h.get_by_label("custom");
    r.h.get_by_label("1.78:1");
    r.click("FPS: 120");
    r.click("Window mode: noborder");
    r.click("Send to back on launch");
    assert_eq!((r.setting("framerate"), r.setting("cs2_window_mode"), r.setting("cs2_send_to_back")), (json!(120), json!("noborder"), json!(true)));
    assert_eq!(r.count("resolution").as_deref(), Some("1366x768 · 120 fps"));
    r.saved("framerate", json!(120));
}

#[test]
fn video_03_recording_system_hlae_card_only_in_hlae_mode() {
    let mut r = rig(json!({"recsys": "HLAE"}));
    assert!(r.card_ids().contains(&"hlae-options"));
    r.h.get_by_label("FOV");
    r.click("System: CS");
    r.h.run();
    assert_eq!(r.setting("recsys"), json!("CS"));
    assert!(!r.card_ids().contains(&"hlae-options"), "HLAE Options only in HLAE mode");
    assert!(r.h.query_by_label("FOV").is_none());
    r.h.get_by_label("Ragdoll gravity");
    r.h.get_by_label("CS2 startmovie");
    r.click("System: HLAE");
    r.h.run();
    assert!(r.card_ids().contains(&"hlae-options"));
    r.saved("recsys", json!("HLAE"));
    // The engine's own rule: anything but "CS" records through HLAE, and a lower-case "cs" is CS.
    let mut r = rig(json!({"recsys": "cs"}));
    assert!(!r.card_ids().contains(&"hlae-options"));
    assert_eq!(r.count("recording-system").as_deref(), Some("CS"));
}

#[test]
fn video_04_hlae_options_numbers_shortcuts_switches_args() {
    let mut r = rig(json!({"recsys": "HLAE", "hlae_fov": 90, "hlae_slow_motion": 100, "hlae_afx_stream": false, "hlae_no_spectator_ui": false, "hlae_fix_scope_fov": false, "hlae_extra_args": ""}));
    r.h.get_by_label("default");
    r.replace_in("FOV", "105");
    assert_eq!(r.setting("hlae_fov"), json!(105));
    r.h.get_by_label("cinematic wide");
    r.click("Increase FOV");
    assert_eq!(r.setting("hlae_fov"), json!(106), "the › arrow steps the value");
    r.click("Decrease FOV");
    r.replace_in("FOV", "abc");
    assert_eq!(r.setting("hlae_fov"), json!(105), "a word is not stored");
    for q in [50, 75, 100, 125, 150, 200, 500, 1000] {
        r.h.get_by_label(&format!("Game speed {q}"));
    }
    r.click("Game speed 50");
    assert_eq!(r.setting("hlae_slow_motion"), json!(50));
    r.h.get_by_label("2× slow motion");
    for s in ["AFX Stream", "No spectator UI", "Fix scope FOV"] {
        r.click(s);
    }
    r.replace_in("Extra HLAE args", "-afxDisableSteamStorage");
    assert_eq!(r.count("hlae-options").as_deref(), Some("105° · 50%"));
    let disk = r.saved("hlae_extra_args", json!("-afxDisableSteamStorage"));
    assert_eq!([&disk["hlae_afx_stream"], &disk["hlae_no_spectator_ui"], &disk["hlae_fix_scope_fov"]], [&json!(true); 3]);
    assert_eq!(disk["hlae_slow_motion"], json!(50));
}

#[test]
fn video_05_in_game_options_switches_and_feed_duration() {
    let mut r = rig(json!({"true_view": false, "show_only_death_notices": false, "show_xray": false, "close_game_after": false, "death_notices_duration": 5}));
    for s in ["TrueView", "Death notices only", "X-Ray", "Close CS2"] {
        r.click(s);
    }
    r.replace_in("Death notices", "2.5");
    assert_eq!(r.setting("death_notices_duration"), json!(2.5), "one decimal kept, as 3.5");
    let disk = r.saved("death_notices_duration", json!(2.5));
    for k in ["true_view", "show_only_death_notices", "show_xray", "close_game_after"] {
        assert_eq!(disk[k], json!(true), "{k}");
    }
}

#[test]
fn video_06_cs2_effects_numbers_shortcuts_switches() {
    let mut r = rig(json!({"phys_ragdoll_gravity": 600, "phys_ragdoll_scale": 1.0, "phys_sv_gravity": 800, "phys_ragdoll_enable": true, "phys_blood": true, "phys_dynamic_lighting": true, "recsys": "CS"}));
    for q in [-500, -200, 0, 200, 600, 2000, 5000] {
        r.h.get_by_label(&format!("Ragdoll gravity {q}"));
    }
    for q in [100, 200, 400, 800, 1200, 2000] {
        r.h.get_by_label(&format!("World gravity {q}"));
    }
    r.click("Ragdoll gravity -500");
    r.click("Ragdoll scale 0.5");
    r.click("World gravity 400");
    assert_eq!((r.setting("phys_ragdoll_gravity"), r.setting("phys_ragdoll_scale"), r.setting("phys_sv_gravity")), (json!(-500), json!(0.5), json!(400)));
    r.replace_in("Ragdoll scale", "0.333");
    assert_eq!(r.setting("phys_ragdoll_scale"), json!(0.33), "two decimals kept, as 3.5");
    assert!(r.h.query_by_label("ragdoll physics off: the two ragdoll values do nothing").is_none());
    for s in ["Ragdoll physics", "Blood on walls", "Dynamic lighting"] {
        r.click(s);
    }
    r.h.get_by_label("ragdoll physics off: the two ragdoll values do nothing");
    let disk = r.saved("phys_dynamic_lighting", json!(false));
    assert_eq!((disk["phys_ragdoll_enable"].clone(), disk["phys_blood"].clone(), disk["phys_ragdoll_scale"].clone()), (json!(false), json!(false), json!(0.33)));
}

#[test]
fn video_07_encoding_codecs_from_the_table_and_an_unknown_codec_kept() {
    let mut r = rig(json!({"video_codec": "my_custom_enc", "crf": 18, "video_preset": "medium", "video_container": "mp4", "audio_codec": "aac", "audio_bitrate": 256}));
    r.h.run();
    assert_eq!(r.setting("video_codec"), json!("my_custom_enc"), "an unknown stored codec is kept");
    r.click("Codec");
    r.h.get_by_label("my_custom_enc");
    for c in registries().video_codecs.keys() {
        r.h.get_by_label(c);
    }
    r.click("h264_nvenc");
    assert_eq!(r.setting("video_codec"), json!("h264_nvenc"));
    r.click("Audio codec");
    for c in registries().audio_codecs.keys() {
        r.h.get_by_label(c);
    }
    r.click("libopus");
    assert_eq!(r.setting("audio_codec"), json!("libopus"));
    r.replace_in("CRF", "23");
    r.h.get_by_label("good");
    r.click("Preset: slow");
    r.click("Container: mkv");
    r.replace_in("Audio bitrate", "320");
    r.replace_in("Input params", "-hwaccel cuda");
    r.replace_in("Output params", "-movflags +faststart");
    r.h.get_by_label("-i frames … -c:v h264_nvenc -crf 23 -preset slow");
    r.h.get_by_label("clip.mkv");
    assert_eq!(r.count("encoding").as_deref(), Some("h264_nvenc · CRF 23 · .mkv"));
    let disk = r.saved("ffmpeg_output_params", json!("-movflags +faststart"));
    assert_eq!(
        [&disk["video_preset"], &disk["video_container"], &disk["audio_bitrate"], &disk["crf"], &disk["ffmpeg_input_params"]],
        [&json!("slow"), &json!("mkv"), &json!(320), &json!(23), &json!("-hwaccel cuda")]
    );
}

#[test]
fn video_07b_the_header_pill_follows_the_encoding_preset() {
    let mut r = rig(json!({"video_preset": "medium"}));
    r.h.get_by_value("Preset medium");
    r.click("Preset: veryslow");
    assert!(r.h.query_by_value("Preset medium").is_none(), "the pill follows");
    r.h.get_by_value("Preset veryslow");
}

/// Keys a VIDEO card owns: every key of these capabilities (`csdm/capabilities.py`).
const VIDEO_CAPABILITIES: [&str; 12] = [
    "final_assembly", "sequence_concatenation", "resolution_framerate", "cs2_window", "recording_system", "hlae_options",
    "in_game_display", "close_game_between_demos", "cs2_effects", "video_encoding", "audio_encoding", "ffmpeg_raw_params",
];

/// The guard of 3.5 `settings/__tests__/coverage.test.tsx`, for this tab: measured on what is drawn
/// (HLAE mode, so every card is on screen).
#[test]
fn every_video_key_has_a_control_on_screen() {
    let reference = csdm_core::settings::reference();
    for c in VIDEO_CAPABILITIES {
        assert!(reference.capabilities.iter().any(|x| x.id == c), "unknown capability {c}");
    }
    let wanted: Vec<&str> = reference.settings.iter().filter(|d| VIDEO_CAPABILITIES.contains(&d.owner.as_str())).map(|d| d.key.as_str()).collect();
    assert!(wanted.len() >= VIDEO_CAPABILITIES.len());
    let mut r = rig(json!({"recsys": "HLAE"}));
    r.h.run();
    let seen = r.h.ctx.data(|d| d.get_temp::<Drawn>(drawn_id())).unwrap_or_default().0;
    let missing: Vec<&&str> = wanted.iter().filter(|k| !seen.contains(**k)).collect();
    assert!(missing.is_empty(), "keys without a control on the VIDEO tab: {missing:?}");
}

/// `CSDM_RENDER_OUT=<folder>`: the whole tab, day and night, to set beside the 3.5.1 window and the
/// V12 mock. Does nothing without the variable.
#[test]
fn renders_the_tab_for_the_author() {
    let Some(out) = std::env::var_os("CSDM_RENDER_OUT").map(PathBuf::from) else { return };
    for ground in ["white", "dark"] {
        for (name, size) in [("window", egui::Vec2::new(1600.0, 900.0)), ("all", egui::Vec2::new(1600.0, 2600.0))] {
            let mut r = rig_sized(json!({"theme_bg": ground, "theme_accent": "blue", "assemble_after": true, "recsys": "HLAE"}), size, true);
            r.h.run();
            let img = r.h.render().expect("headless render");
            img.save(out.join(format!("t10b-video-{ground}-{name}.png"))).expect("save png");
        }
    }
}
