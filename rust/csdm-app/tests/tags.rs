//! Driven tests of the TAGS tab (T9), no window.
//!
//! One flow walks the four TAGS rows of the parity list (tag grid, tag range, operations, shared
//! selection) and both confirmations. It runs twice:
//! - `tags_tab_on_the_real_engine` (ignored; `rust/tools/t9_tags_e2e.py` runs it): the real engine
//!   on a throwaway local copy (real schema, synthetic rows). With `CSDM_T9_RECORD=1` it records
//!   every command and answer into `tests/scenarios/tags-flow.json`;
//! - `tags_tab_flow_replayed`: the same flow on the scripted engine playing that recording.
//!
//! Hello, settings load and save have no real engine yet (T11/T13): this file answers them itself,
//! and records those answers too.

mod common;

use csdm_app::grid::TabView;
use csdm_app::tabs::tags::TagsTab;
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_engine::event::{EngineEvent, StateName, STATE_NAMES};
use csdm_engine::{Command, Engine, RealEngine, Secrets};
use egui_kittest::kittest::Queryable;
use egui_kittest::Harness;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

const SCENARIO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/scenarios/tags-flow.json");
const LOCAL_IDS: u64 = 1 << 40;
const MIN_SETTLE_STEPS: usize = 40;
const MAX_SETTLE_STEPS: usize = 4000;
const REAL_STEP_PAUSE: std::time::Duration = std::time::Duration::from_millis(2);
/// Where the recording writes temporary paths (export, import file).
const TMP_MARK: &str = "<tmp>";
const IMPORT_FILE: &str = "t9-import.json";

/// The real engine, with the commands it does not serve yet answered here, every step recorded.
struct Recorder {
    real: RealEngine,
    tx: Sender<EngineEvent>,
    rx: Receiver<EngineEvent>,
    local: u64,
    settings: Value,
    rec: Arc<Mutex<Rec>>,
}

#[derive(Default)]
struct Rec {
    steps: Vec<Value>,
    open: Vec<(u64, usize)>,
    events: Vec<Value>,
}

impl Engine for Recorder {
    fn send(&mut self, command: Command) -> u64 {
        let on = command.name();
        let local = match command {
            Command::Hello => Some(json!({"data": {"app_version": "5.0.0-dev"}})),
            Command::LoadConfig => Some(json!({"data": self.settings})),
            Command::SaveConfig { .. } => Some(json!({})),
            _ => None,
        };
        let mut rec = self.rec.lock().unwrap();
        if let Some(v) = local {
            self.local += 1;
            let id = LOCAL_IDS + self.local;
            rec.steps.push(json!({"on": on, "reply": {"ok": v.clone()}}));
            self.tx.send(EngineEvent::Reply { id, result: Ok(v) }).unwrap();
            return id;
        }
        let id = self.real.send(command);
        rec.steps.push(json!({"on": on, "reply": null}));
        let at = rec.steps.len() - 1;
        rec.open.push((id, at));
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        let mut rec = self.rec.lock().unwrap();
        for e in self.real.events().try_iter() {
            match &e {
                EngineEvent::Reply { id, result } => {
                    let at = rec.open.iter().position(|(i, _)| i == id).map(|k| rec.open.remove(k).1);
                    let at = at.expect("an answer to a command sent");
                    let reply = match result {
                        Ok(v) => json!({"ok": v}),
                        Err(s) => json!({"err": s}),
                    };
                    let events = std::mem::take(&mut rec.events);
                    rec.steps[at]["reply"] = reply;
                    if !events.is_empty() {
                        rec.steps[at]["events"] = Value::Array(events);
                    }
                }
                EngineEvent::Log { message, level } => rec.events.push(json!({"log": {"message": message, "level": format!("{level:?}").to_lowercase()}})),
                EngineEvent::LogParts(parts) => rec.events.push(json!({"log_parts": parts.iter().map(|(t, l)| json!([t, format!("{l:?}").to_lowercase()])).collect::<Vec<_>>()})),
                EngineEvent::State { name, payload } => rec.events.push(json!({"state": {"name": state_name(*name), "payload": payload}})),
                EngineEvent::Ask(_) => panic!("the tags flow never asks a question"),
            }
            self.tx.send(e).unwrap();
        }
        &self.rx
    }
}

fn state_name(n: StateName) -> &'static str {
    STATE_NAMES[n as usize]
}

struct Run {
    h: Harness<'static, Shell>,
    real: bool,
    dir: PathBuf,
    /// Where `shot` saves the tab, day and night (`CSDM_RENDER_OUT`); `None`: no capture.
    shots: Option<PathBuf>,
}

/// The tab as drawn, in the day ground and in the night ground. The ground is set without
/// `Link::set`, so no save and no RUN question join the recorded order of commands.
fn shot(r: &mut Run, name: &str) {
    let Some(dir) = r.shots.clone() else { return };
    for ground in ["white", "dark"] {
        r.h.state_mut().link.settings.insert("theme_bg".into(), json!(ground));
        r.h.run();
        let img = r.h.render().expect("headless render");
        img.save(dir.join(format!("t9-{name}-{ground}.png"))).expect("save png");
    }
    r.h.state_mut().link.settings.insert("theme_bg".into(), json!("white"));
    r.h.run();
}

fn build(engine: Box<dyn Engine>, dir: &Path, wgpu: bool) -> Harness<'static, Shell> {
    let (export, import) = (dir.to_path_buf(), dir.join(IMPORT_FILE));
    let export_dir = dir.to_path_buf();
    let mut b = Harness::builder().with_size(common::SIZE).with_step_dt(common::STEP_DT).with_max_steps(400);
    if wgpu {
        // DX12 crashes headless on the dev machine (rust/PIEGES.md).
        if std::env::var_os("WGPU_BACKEND").is_none() {
            std::env::set_var("WGPU_BACKEND", "gl");
        }
        b = b.wgpu();
    }
    b.build_eframe(move |cc| {
        let tab = TagsTab::with_pickers(Box::new(move || Some(import.clone())), Box::new(move |name: &str| Some(export.join(name))));
        Shell::new(&cc.egui_ctx, engine, ShellOptions { motion: Motion::Still, export_dir }).with_tab(TabId::Tags, Box::new(tab))
    })
}

fn tab(r: &mut Run) -> &mut TagsTab {
    r.h.state_mut().view::<TagsTab>(TabId::Tags).expect("the TAGS tab")
}

/// Frames until no answer is awaited and the settings are saved (same order of commands on both engines).
fn settle(r: &mut Run) {
    for i in 0..MAX_SETTLE_STEPS {
        r.h.step();
        if r.real {
            std::thread::sleep(REAL_STEP_PAUSE);
        }
        if i >= MIN_SETTLE_STEPS && !tab(r).busy() && !r.h.state().link.dirty() {
            break;
        }
    }
    r.h.run();
}

fn click(r: &mut Run, label: &str) {
    r.h.get_by_label(label).click();
    settle(r);
}

fn has(r: &Run, label: &str) -> bool {
    r.h.query_by_label(label).is_some()
}

fn type_into(r: &mut Run, placeholder: &'static str, text: &str) {
    let field = r.h.get_by(move |n| n.placeholder() == Some(placeholder));
    field.click();
    r.h.run();
    r.h.get_by(move |n| n.placeholder() == Some(placeholder)).type_text(text);
    settle(r);
}

fn setting(r: &Run, key: &str) -> Value {
    r.h.state().link.get(key).cloned().unwrap_or(Value::Null)
}

fn ops_status(r: &mut Run) -> String {
    tab(r).ops.status.clone()
}

fn write_import_file(dir: &Path) {
    let body = json!({"version": 1, "tags": [{"name": "Imported", "color": "#d946ef"}],
        "assignments": [{"checksum": "t9-chk-d", "demo_name": "eco-inferno.dem", "tags": ["Imported"]}]});
    std::fs::write(dir.join(IMPORT_FILE), body.to_string()).unwrap();
}

/// The flow: every TAGS action of 3.5, in an order that leaves the copy as it found it but for the
/// writes it checks.
fn flow(r: &mut Run) {
    settle(r);
    r.h.get_by_label("TAGS").click();
    settle(r);
    for t in ["tag-Aces", "tag-Clutch", "tag-Entry"] {
        assert!(has(r, t), "{t} listed from the database");
    }

    // Tags: filter and sort are view state.
    type_into(r, "Filter tags…", "cl");
    assert!(has(r, "tag-Clutch") && !has(r, "tag-Aces"), "the filter keeps matching names only");
    tab(r).grid.search.clear();
    settle(r);
    assert!(has(r, "tag-Aces"), "clearing the filter shows every tag");
    click(r, "sort-color");
    click(r, "sort-name");

    // Tags: create (name + preset colour).
    click(r, "New tag");
    type_into(r, "Tag name", "Wallbang");
    click(r, "colour-#8b5cf6");
    click(r, "Create");
    assert!(has(r, "tag-Wallbang"), "the new tag is read back from the database");
    assert_eq!(tab(r).grid.status, "Created \"Wallbang\".");

    // Tags: reload reads the list again from the database.
    click(r, "Reload");
    assert!(has(r, "tag-Wallbang") && has(r, "tag-Aces"), "the reloaded list still holds every tag");
    assert_eq!(tab(r).grid.status, "Reloaded.");

    // Tags: activate; the three cards share the selection.
    click(r, "tag-Aces");
    assert_eq!(setting(r, "ui_active_tags").as_array().map(Vec::len), Some(1));
    assert!(has(r, "in-use-Aces"), "the tray shows the active tag");

    // Tag Range: computed on the tag chosen in the Tags card, applied four ways.
    click(r, "Calculate range");
    let range = tab(r).range.range.clone().expect("a range");
    assert_eq!((range.start.as_deref(), range.end.as_deref(), range.after.as_deref(), range.count), (Some("05-01-2024"), Some("10-02-2024"), Some("11-02-2024"), 2));
    click(r, "Apply start");
    assert_eq!(setting(r, "date_from"), json!("05-01-2024"));
    click(r, "Apply end");
    assert_eq!(setting(r, "date_to"), json!("10-02-2024"));
    click(r, "After range");
    assert_eq!((setting(r, "date_from"), setting(r, "date_to")), (json!("11-02-2024"), json!("")));
    click(r, "Apply full range");
    assert_eq!((setting(r, "date_from"), setting(r, "date_to")), (json!("05-01-2024"), json!("10-02-2024")));

    // Operations: search by tag, by the current filters (refused here: no player), tag, remove.
    click(r, "By tag");
    assert_eq!(tab(r).ops.found.len(), 2);
    click(r, "By config");
    let refused = ops_status(r);
    assert!(!refused.is_empty() && !refused.contains("found"), "the config search says why it cannot run: {refused}");
    assert_eq!(tab(r).ops.found.len(), 2, "a refused search keeps the list");
    click(r, "tag-Entry");
    click(r, "ace-ancient.dem");
    click(r, "Tag sel.");
    assert_eq!(ops_status(r), "Tagged 1 demo(s).");
    click(r, "Tag ALL");
    assert_eq!(ops_status(r), "Tagged 2 demo(s).");
    shot(r, "tab");
    click(r, "Remove sel.");
    assert!(has(r, "Remove tags"), "removing asks first");
    click(r, "Cancel");
    assert!(!has(r, "Remove tags") && ops_status(r) == "Tagged 2 demo(s).", "cancel removes nothing");
    click(r, "Remove sel.");
    shot(r, "confirm-remove");
    click(r, "Confirm");
    assert_eq!(ops_status(r), "Removed from 1 demo(s).");

    // Operations: export the active tags, import a file that names a missing tag.
    click(r, "Export tags");
    // Aces and Entry were just removed from the first demo: only the second still carries them.
    assert_eq!(ops_status(r), "Exported 2 tag(s), 1 demo(s).");
    click(r, "Import tags");
    assert_eq!(ops_status(r), "Imported: 1 OK, 0 skipped, 0 failed.");
    assert!(has(r, "tag-Imported"), "the missing tag was created");

    // Tags: delete asks first.
    click(r, "delete-tag-Wallbang");
    assert!(has(r, "Delete tag"));
    click(r, "Cancel");
    assert!(has(r, "tag-Wallbang"), "cancel deletes nothing");
    click(r, "delete-tag-Wallbang");
    click(r, "Confirm");
    assert!(!has(r, "tag-Wallbang"), "the tag is gone from the database");

    // Tags: auto-tag on export, deselect all.
    click(r, "Auto-tag on export");
    assert_eq!(setting(r, "tag_enabled"), json!(true));
    click(r, "Deselect all");
    assert_eq!(setting(r, "ui_active_tags"), json!([]));
    assert!(!has(r, "in-use-Aces"));
}

fn replay(shots: Option<PathBuf>) {
    let text = std::fs::read_to_string(SCENARIO).expect("tests/scenarios/tags-flow.json: record it with rust/tools/t9_tags_e2e.py --record");
    let dir = tempfile::tempdir().unwrap();
    write_import_file(dir.path());
    let engine = common::Shared::new(&text.replace(TMP_MARK, &dir.path().display().to_string().replace('\\', "\\\\")));
    let script = engine.script.clone();
    let wgpu = shots.is_some();
    let mut r = Run { h: build(Box::new(engine), dir.path(), wgpu), real: false, dir: dir.path().to_path_buf(), shots };
    flow(&mut r);
    assert_eq!(script.lock().unwrap().remaining_steps(), 0, "every recorded command was sent, in order");
    let _ = &r.dir;
}

#[test]
fn tags_tab_flow_replayed() {
    replay(None);
}

/// `CSDM_RENDER_OUT=<folder>`: the same flow rendered headless (wgpu), the tab saved day and night.
#[test]
fn tags_tab_renders_day_and_night() {
    if let Some(dir) = std::env::var_os("CSDM_RENDER_OUT") {
        replay(Some(PathBuf::from(dir)));
    }
}

#[test]
#[ignore = "needs the throwaway PostgreSQL copy of rust/tools/t9_tags_e2e.py"]
fn tags_tab_on_the_real_engine() {
    let pg: Value = serde_json::from_str(&std::env::var("CSDM_T9_PG").expect("CSDM_T9_PG: run rust/tools/t9_tags_e2e.py")).unwrap();
    let port: i64 = pg["pg_port"].as_str().and_then(|p| p.parse().ok()).or(pg["pg_port"].as_i64()).unwrap();
    let settings = json!({"pg_host": pg["pg_host"], "pg_port": port, "pg_user": pg["pg_user"], "pg_pass": "trust", "pg_db": pg["pg_db"]});
    let dir = tempfile::tempdir().unwrap();
    write_import_file(dir.path());
    let real = RealEngine::start(settings.as_object().unwrap().clone(), Secrets::default(), None);
    let (tx, rx) = channel();
    let rec = Arc::new(Mutex::new(Rec::default()));
    let engine = Recorder { real, tx, rx, local: 0, settings, rec: rec.clone() };
    let mut r = Run { h: build(Box::new(engine), dir.path(), false), real: true, dir: dir.path().to_path_buf(), shots: None };
    flow(&mut r);
    let export = std::fs::read_to_string(r.dir.join(csdm_core::ui_values::TAG_EXPORT_FILE)).expect("the export file was written");
    assert!(export.contains("\"Aces\"") && export.contains("t9-chk-b") && !export.contains("t9-chk-a"), "the removal reached the database");
    let rec = rec.lock().unwrap();
    assert!(rec.open.is_empty(), "every command was answered");
    if std::env::var_os("CSDM_T9_RECORD").is_some() {
        let mut text = serde_json::to_string_pretty(&json!({"steps": rec.steps})).unwrap();
        let tmp = dir.path().display().to_string();
        text = text.replace(&tmp.replace('\\', "\\\\"), TMP_MARK).replace(&tmp, TMP_MARK);
        assert!(!text.contains("Users"), "no machine path in the recording");
        std::fs::create_dir_all(Path::new(SCENARIO).parent().unwrap()).unwrap();
        std::fs::write(SCENARIO, text + "\n").unwrap();
        println!("recorded {} steps into {SCENARIO}", rec.steps.len());
    }
}

/// The cards say where to set the database while it is not reachable (3.5 `DatabasePending`).
#[test]
fn cards_wait_for_the_database_and_say_where_to_set_it() {
    let json = common::scenario(&[
        r#"{"on": "hello", "reply": {"ok": {"data": {"app_version": "5.0.0-dev"}}}}"#,
        r#"{"on": "load_config", "reply": {"ok": {"data": {}}}}"#,
        r#"{"on": "connect_db", "reply": {"err": "Could not reach the database server."}}"#,
        r#"{"on": "run_inputs_problem", "reply": {"ok": {"problem": null}}}"#,
        r#"{"on": "tags_set_active", "reply": {"ok": {"data": {"active_tag_ids": [], "active_tag_names": []}}}}"#,
    ]);
    let dir = tempfile::tempdir().unwrap();
    let mut r = Run { h: build(Box::new(common::Shared::new(&json)), dir.path(), false), real: false, dir: dir.path().to_path_buf(), shots: None };
    settle(&mut r);
    r.h.get_by_label("TAGS").click();
    settle(&mut r);
    let hint = csdm_app::widgets::DB_UNREACHABLE_HINT;
    assert_eq!(r.h.query_all_by_label(hint).count(), 3, "each of the three cards points to SETTINGS");
    assert!(tab(&mut r).cards().iter().any(|c| c.title == "Tag Range"));
}
