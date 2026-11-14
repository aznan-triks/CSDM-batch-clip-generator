//! Driven tests of the SETTINGS tab, one per « SETTINGS » parity line (research/04), no window.
//!
//! The settings commands (load/save config, presets, settings folder) run for real
//! (`csdm_engine::settings_home`) on a throwaway profile; the commands other tranches own
//! (`connect_db`, `describe_filters`, `injection_preview`, `run_inputs_problem`) get fixed answers
//! shaped like the real engine's (T3 `real.rs`, `describe.rs`), re-recorded at the merge.

use csdm_app::tabs::settings::controls::PickKind;
use csdm_app::tabs::settings::{PgState, SettingsTab};
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_core::values::{CONFIG_FILE, PRESETS_FILE, V5_CONFIG_SUBDIR};
use csdm_engine::import35::SearchPlaces;
use csdm_engine::settings_home::{SettingsEngine, SettingsHome};
use csdm_engine::{Command, Engine, EngineEvent, Secrets};
use eframe::egui;
use egui_kittest::kittest::Queryable;
use egui_kittest::Harness;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

/// Tall enough that every card of the tab is on screen: clicks land where the node is drawn.
const SIZE: egui::Vec2 = egui::Vec2::new(1600.0, 3200.0);
const STEP_DT: f32 = 1.0 / 60.0;
const SECRET: &str = "pw-t11-driven-secret";
const PG_HINT: &str = "Use the values shown in CS Demo Manager › Settings › Database. CS Demo Manager must be installed and its database running.";

/// Real settings handlers, fixed answers for the commands other tranches serve.
struct Hybrid {
    real: SettingsEngine,
    canned: HashMap<&'static str, Result<Value, String>>,
    sent: Arc<Mutex<Vec<Command>>>,
    tx: Sender<EngineEvent>,
    rx: Receiver<EngineEvent>,
    next: u64,
}

impl Engine for Hybrid {
    fn send(&mut self, command: Command) -> u64 {
        self.sent.lock().unwrap().push(command.clone());
        self.next += 1;
        let id = self.next;
        match self.canned.get(command.name()) {
            Some(r) => self.tx.send(EngineEvent::Reply { id, result: r.clone() }).unwrap(),
            None => {
                let inner = self.real.send(command);
                for e in self.real.events().try_iter() {
                    let e = match e {
                        EngineEvent::Reply { id: i, result } if i == inner => EngineEvent::Reply { id, result },
                        other => other,
                    };
                    self.tx.send(e).unwrap();
                }
            }
        }
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        &self.rx
    }
}

fn canned() -> HashMap<&'static str, Result<Value, String>> {
    HashMap::from([
        ("connect_db", Ok(json!({"data": {"players": [], "tags": []}}))),
        ("run_inputs_problem", Ok(json!({"problem": null}))),
        ("describe_filters", Ok(json!({"data": {
            "preset_categories": ["full", "players", "date", "filters", "mode", "output_name", "encoding", "hlae_opts", "physics", "timing"],
            "default_paths": {"csdm_exe": "C:\\Users\\me\\AppData\\Local\\Programs\\cs-demo-manager\\csdm.CMD", "clips_dir": "C:\\Users\\me\\Videos\\CSDM Batch Clips"}
        }}))),
        ("injection_preview", Ok(json!({"lines": [["+exec csdm_inject", "head"], ["host_timescale 1", "plain"]]}))),
    ])
}

struct Rig {
    h: Harness<'static, Shell>,
    sent: Arc<Mutex<Vec<Command>>>,
    profile: tempfile::TempDir,
    lad: tempfile::TempDir,
    picks: Arc<Mutex<Vec<Option<String>>>>,
    _export: tempfile::TempDir,
}

/// A throwaway profile whose 5.x folder holds `settings`, then the window on the SETTINGS tab.
fn rig(settings: Option<Value>, tweak: impl FnOnce(&mut HashMap<&'static str, Result<Value, String>>)) -> Rig {
    let (profile, lad, export) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    if let Some(s) = settings {
        let dir = profile.path().join(V5_CONFIG_SUBDIR);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(CONFIG_FILE), serde_json::to_vec_pretty(&s).unwrap()).unwrap();
    }
    let secrets = Secrets::default();
    let places = SearchPlaces { explicit_root: Some(profile.path().into()), exe_dir: None, local_app_data: Some(lad.path().into()) };
    let (home, _) = SettingsHome::open(&places, secrets.clone()).unwrap();
    let mut answers = canned();
    tweak(&mut answers);
    let (tx, rx) = channel();
    let sent = Arc::new(Mutex::new(Vec::new()));
    let engine = Hybrid { real: SettingsEngine::new(home, secrets), canned: answers, sent: sent.clone(), tx, rx, next: 0 };
    let picks: Arc<Mutex<Vec<Option<String>>>> = Arc::default();
    let queue = picks.clone();
    let dir = export.path().to_path_buf();
    let h = Harness::builder().with_size(SIZE).with_step_dt(STEP_DT).with_max_steps(400).build_eframe(move |cc| {
        let picker = Box::new(move |_kind: PickKind| queue.lock().unwrap().pop().flatten());
        Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion: Motion::Still, export_dir: dir }).with_tab(TabId::Settings, Box::new(SettingsTab::with_picker(picker)))
    });
    let mut r = Rig { h, sent, profile, lad, picks, _export: export };
    r.h.run();
    r.click("SETTINGS");
    r
}

impl Rig {
    fn click(&mut self, label: &str) {
        self.h.get_by_label(label).click();
        self.h.run();
    }

    fn type_into(&mut self, label: &str, text: &str) {
        self.h.get_by_label(label).click();
        self.h.run();
        self.h.get_by_label(label).type_text(text);
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

    fn setting(&self, key: &str) -> Option<Value> {
        self.h.state().link.get(key).cloned()
    }

    fn tab(&mut self) -> &mut SettingsTab {
        self.h.state_mut().view::<SettingsTab>(TabId::Settings).expect("settings tab")
    }

    fn sent_named(&self, name: &str) -> Vec<Command> {
        self.sent.lock().unwrap().iter().filter(|c| c.name() == name).cloned().collect()
    }

    fn v5(&self) -> PathBuf {
        self.profile.path().join(V5_CONFIG_SUBDIR)
    }

    /// Past the 400 ms save debounce.
    fn settle(&mut self) {
        for _ in 0..40 {
            self.h.step();
        }
        self.h.run();
    }
}

fn read(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn base() -> Value {
    json!({"pg_host": "", "pg_port": "5432", "pg_user": "postgres", "pg_pass": SECRET, "pg_db": "csdm", "theme_bg": "white", "theme_accent": "#2563EB"})
}

#[test]
fn settings_01_postgres_test_and_reload_uses_the_typed_values_and_keeps_the_help() {
    let mut r = rig(Some(base()), |_| {});
    r.type_into("Host", "10.1.2.3");
    r.click("Test & Reload");
    let sent = r.sent_named("connect_db");
    let Command::ConnectDb { pg: Some(pg) } = sent.last().unwrap() else { panic!("Test & Reload sends the typed values") };
    assert_eq!(pg["pg_host"], json!("10.1.2.3"), "typed, not yet saved");
    assert_eq!(pg["pg_pass"], json!(SECRET));
    assert_eq!(r.tab().pg_state, PgState::Ok);
    r.h.get_by_label("Connected");
    r.h.get_by_label(PG_HINT);
    assert_eq!(r.h.state().link.db, csdm_app::link::DbState::Ok);
    assert!(r.h.query_by_label(SECRET).is_none(), "the password is never written on screen");
    assert!(r.h.state().console.texts().iter().all(|l| !l.contains(SECRET)));
}

#[test]
fn settings_01b_failed_test_says_why_and_keeps_the_help() {
    let refused = "Could not reach PostgreSQL at 10.9.9.9:5432. Check the host and port.";
    let mut r = rig(Some(base()), |c| {
        c.insert("connect_db", Err(refused.into()));
    });
    r.click("Test & Reload");
    assert_eq!(r.tab().pg_state, PgState::Bad);
    r.h.get_by_label(refused);
    r.h.get_by_label(PG_HINT);
    assert!(matches!(r.h.state().link.db, csdm_app::link::DbState::Error(_)));
}

#[test]
fn settings_02_paths_browse_cancel_subfolder_and_default_hint() {
    let mut r = rig(Some(base()), |_| {});
    assert_eq!(r.tab().default_clips_dir.as_deref(), Some("C:\\Users\\me\\Videos\\CSDM Batch Clips"));
    let chosen = r.lad.path().join("clips").to_string_lossy().into_owned();
    r.picks.lock().unwrap().push(Some(chosen.clone()));
    r.click("Browse for Raw clips folder");
    assert_eq!(r.setting("output_dir_clips"), Some(json!(chosen)));
    r.picks.lock().unwrap().push(None);
    r.click("Browse for CSDM Executable");
    assert_eq!(r.setting("csdm_exe"), Some(json!("")), "Cancel keeps the value");
    let before = r.setting("subfolder_per_demo");
    r.click("Subfolder per demo");
    assert_ne!(r.setting("subfolder_per_demo"), before);
    r.settle();
    assert_eq!(read(&r.v5().join(CONFIG_FILE))["output_dir_clips"], json!(chosen), "saved to the throwaway profile");
}

#[test]
fn settings_03_config_folder_copies_with_backup_after_two_confirmations() {
    let mut r = rig(Some(base()), |_| {});
    r.h.get_by_label(&r.v5().to_string_lossy());
    // A custom folder that already has settings: warned, then confirmed, then backed up.
    let custom = tempfile::tempdir().unwrap();
    let target = custom.path().join(V5_CONFIG_SUBDIR);
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join(CONFIG_FILE), br#"{"crf": 99}"#).unwrap();
    r.picks.lock().unwrap().push(Some(custom.path().to_string_lossy().into_owned()));
    r.click("Choose…");
    r.h.get_by_label(&format!("These files already exist in {}: {CONFIG_FILE}. Copying would overwrite them.", target.display()));
    r.click("Continue");
    r.h.get_by_label("Really overwrite? The existing files are first backed up in a \"backup-…\" subfolder, then replaced by the current ones.");
    r.click("Overwrite & copy");
    assert_eq!(read(&target.join(CONFIG_FILE))["pg_db"], json!("csdm"), "the current settings were copied");
    let backup = std::fs::read_dir(&target).unwrap().map(|e| e.unwrap().path()).find(|p| p.is_dir()).expect("a backup folder");
    assert_eq!(read(&backup.join(CONFIG_FILE))["crf"], json!(99), "the overwritten file is kept");
    assert!(r.v5().join(CONFIG_FILE).is_file(), "the source stays in place");
    assert_eq!(r.setting("config_dir"), Some(json!(custom.path().to_string_lossy())));
    r.h.get_by_label(&target.to_string_lossy());

    // Local AppData: nothing there, one confirmation; Cancel first changes nothing.
    r.click("User Local AppData");
    r.click("Cancel");
    assert!(!r.lad.path().join(V5_CONFIG_SUBDIR).exists());
    r.click("User Local AppData");
    r.h.get_by_label(&format!("Copy the settings files to {}?", r.lad.path().join(V5_CONFIG_SUBDIR).display()));
    r.click("Copy");
    assert!(r.lad.path().join(V5_CONFIG_SUBDIR).join(CONFIG_FILE).is_file());
    assert_eq!(r.setting("config_dir"), Some(json!("appdata")));
}

#[test]
fn settings_04_presets_save_by_category_load_only_those_delete_with_confirmation() {
    let mut s = base();
    s["before"] = json!(3);
    s["crf"] = json!(18);
    let mut r = rig(Some(s), |_| {});
    r.click("SAVE");
    r.h.get_by_label("This preset needs a name.");
    r.type_into("Name", "night");
    r.click("SAVE");
    r.h.get_by_label("Select at least one category to include.");
    r.click("Timing");
    r.click("SAVE");
    r.h.get_by_label("Saved \"night\".");
    // The written file: only timing keys, never a credential or personal key.
    let file = read(&r.v5().join(PRESETS_FILE));
    let data = file["night"]["data"].as_object().unwrap();
    assert_eq!(file["night"]["cats"], json!(["timing"]));
    assert_eq!(data["before"], json!(3));
    assert!(!data.contains_key("crf"));
    for (k, v) in data {
        assert!(!k.starts_with("pg_") && !k.starts_with("ui_") && !k.starts_with("theme_") && k != "csdm_exe" && k != "config_dir", "{k}");
        assert_ne!(v, &json!(SECRET));
    }
    // Load overwrites only what the preset holds.
    r.h.state_mut().link.set(99.0, "before", json!(9));
    r.h.state_mut().link.set(99.0, "crf", json!(30));
    r.click("Load night");
    assert_eq!((r.setting("before"), r.setting("crf")), (Some(json!(3)), Some(json!(30))));
    // Delete asks first; Cancel keeps it.
    r.click("Delete night");
    r.click("Cancel");
    assert!(r.tab().presets.contains_key("night"));
    r.click("Delete night");
    r.click("Confirm");
    assert!(!r.tab().presets.contains_key("night"));
    assert!(read(&r.v5().join(PRESETS_FILE)).get("night").is_none());
}

#[test]
fn settings_05_ui_theme_ground_accent_card_styles_font() {
    let mut r = rig(Some(base()), |_| {});
    r.click("Mode: amoled");
    assert_eq!(r.setting("theme_bg"), Some(json!("amoled")));
    r.h.run();
    assert!(r.h.state().theme().dark, "night ground applied at once");
    r.click("Red accent");
    assert_eq!(r.setting("theme_accent"), Some(json!("#EF4444")));
    r.click("Card style: tiles");
    assert_eq!(r.setting("ui_card_style"), Some(json!("tiles")));
    r.click("Per-card style");
    r.click("Demo Selection");
    r.h.run();
    r.click("sentence");
    assert_eq!(r.setting("ui_card_style_overrides"), Some(json!({"demo-selection": "sentence"})));
    r.replace_in("Font family", "Consolas");
    assert_eq!(r.setting("ui_font_family"), Some(json!("Consolas")));
    r.settle();
    let saved = read(&r.v5().join(CONFIG_FILE));
    assert_eq!((&saved["theme_bg"], &saved["ui_card_style"]), (&json!("amoled"), &json!("tiles")));
}

#[test]
fn settings_06_ui_layout_apply_clamps_auto_reset_cards_tooltips() {
    let mut r = rig(Some(base()), |_| {});
    r.replace_in("Window width", "500");
    r.click("Apply");
    assert_eq!((r.setting("ui_window_w"), r.setting("ui_split_pct")), (Some(json!(1000)), Some(json!(60))), "clamped like 3.5");
    // Apply resized the window itself; give the test its tall window back to reach the next buttons.
    r.h.set_size(SIZE);
    r.h.run();
    r.click("Auto");
    assert_eq!((r.setting("ui_window_w"), r.setting("ui_window_h")), (Some(json!(1651)), Some(json!(907))), "86 % x 84 % of the screen");
    r.h.set_size(SIZE);
    r.h.run();
    r.click("Reset default");
    assert_eq!((r.setting("ui_window_w"), r.setting("ui_window_h")), (Some(json!(1600)), Some(json!(900))));
    r.h.set_size(SIZE);
    r.h.run();
    r.click("Reset card layout");
    assert_eq!(r.setting("ui_sections"), Some(json!({})));
    assert!(r.h.query_by_label("PostgreSQL user name").is_none(), "hover only by default");
    r.click("Always show tooltips");
    assert_eq!(r.setting("ui_always_show_tooltips"), Some(json!(true)));
    r.h.get_by_label("PostgreSQL user name");
    r.click("Remember current layout");
    assert_eq!(r.setting("ui_remember_layout"), Some(json!(false)));
}

#[test]
fn settings_07_performance_threads() {
    let mut r = rig(Some(base()), |_| {});
    r.click("6 threads");
    assert_eq!(r.setting("dp2_threads"), Some(json!(6)));
    r.h.get_by_label("6 threads in parallel");
    r.click("1 thread");
    r.h.get_by_label("1 thread -- parallel pre-parse off");
}

#[test]
fn settings_08_injection_preview_refresh_shows_the_lines_or_why_not() {
    let mut r = rig(Some(base()), |_| {});
    r.click("⟳ Refresh");
    r.h.get_by_label("+exec csdm_inject");
    r.h.get_by_label("host_timescale 1");
    let Command::InjectionPreview { cfg } = r.sent_named("injection_preview").pop().unwrap() else { unreachable!() };
    assert_eq!(cfg["pg_db"], json!("csdm"), "built from the current settings");
    let mut r = rig(Some(base()), |c| {
        c.insert("injection_preview", Err("\"injection_preview\" is not available in this build yet.".into()));
    });
    r.click("⟳ Refresh");
    r.h.get_by_label("\"injection_preview\" is not available in this build yet.");
}

#[test]
fn settings_first_run_without_database_says_where_to_connect() {
    let refused = "Could not reach PostgreSQL at 127.0.0.1:5432. Check the host and port.";
    let mut r = rig(None, |c| {
        c.insert("connect_db", Err(refused.into()));
        c.insert("describe_filters", Ok(json!({"data": {"preset_categories": ["full"], "default_paths": {"csdm_exe": "", "clips_dir": "C:\\Users\\me\\Videos\\CSDM Batch Clips"}}})));
    });
    assert_eq!(r.setting("pg_db"), Some(json!("csdm")), "defaults on a first run");
    r.h.get_by_label(&format!("Not connected: {refused}"));
    r.h.get_by_label(PG_HINT);
    assert_eq!(r.tab().default_csdm_exe, None, "CS Demo Manager not found: the box says to Browse");
    assert!(!r.v5().exists(), "nothing written before the first change");
}
