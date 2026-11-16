//! Driven tests of the EDITING tab, one per « EDITING » parity line (research/04), no window.
//!
//! Every engine answer about the preview is replayed from `fixtures/editing.json`, recorded from
//! the real engine on the author's database and anonymised (`csdm-engine/examples/record_editing.rs`):
//! the connection, the run-inputs check, the preview, the cameras of the
//! edited clip after each edit (asked with exactly the recorded entry, else the test fails), the
//! preset's restored selection, the preview that finds nothing. Settings and presets run for real
//! on a throwaway profile (`SettingsHome`, on its own thread as in the real engine: a question
//! waits for its answer); what neither serves is refused in words, as the real engine refuses
//! what its build does not hold yet (`start_run`).

use csdm_app::tabs::editing::{EditingTab, View};
use csdm_app::tabs::settings::controls::PickKind;
use csdm_app::tabs::settings::SettingsTab;
use csdm_app::tabs::TabId;
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_core::editing::{event_meta, format_clock, format_duration, format_total, ClipEntry, Preview};
use csdm_core::ui_values::{EDITING_LANES_PER_PAGE, EDITING_LIST_PAGE_SIZE, EDITING_ZOOM_STEP};
use csdm_engine::event::StateName;
use csdm_engine::import35::SearchPlaces;
use csdm_engine::settings_home::SettingsHome;
use csdm_engine::{Command, Engine, EngineEvent, EventSink, Secrets};
use eframe::egui;
use egui_kittest::kittest::{NodeT, Queryable};
use egui_kittest::Harness;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

const FIXTURE: &str = include_str!("fixtures/editing.json");
const SIZE: egui::Vec2 = egui::Vec2::new(1600.0, 1000.0);
/// SETTINGS needs every card on screen for a click to land (rust/PIEGES.md).
const TALL: egui::Vec2 = egui::Vec2::new(1600.0, 3200.0);
const STEP_DT: f32 = 1.0 / 60.0;
const NOTCHES: usize = 3;
const WAIT: std::time::Duration = std::time::Duration::from_secs(20);
const TICK: std::time::Duration = std::time::Duration::from_millis(5);
/// The largest preview measured in 3.5 (AUDIT_perf_ressources.md).
const LARGE_PREVIEW: usize = 8465;
const COST_FRAMES: u32 = 120;
/// The window and the zoom of 3.5's own proof (`electron/e2e/editing-timeline-proof.mjs`).
const REFERENCE_SIZE: egui::Vec2 = egui::Vec2::new(1600.0, 900.0);
const REFERENCE_ZOOMS: usize = 5;
/// The clip of the second lane that proof opens (`ref-3.5.1/03-inspector.png`: "clip 6 of 9").
const REFERENCE_CLIP: usize = 6;
const TOTAL_CALLS: u32 = 100;

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the recorded fixture")
}

/// Recorded answers by command, played in the order recorded; settings commands for real.
struct Replay {
    recorded: HashMap<&'static str, VecDeque<Value>>,
    /// Answers that hold for every asking (the connection, the run-inputs check, the categories).
    steady: HashMap<&'static str, Value>,
    /// The entry each recorded `clip_cameras` answer was given for.
    asked: VecDeque<Value>,
    /// The settings folder's own thread.
    settings: Sender<(u64, Command)>,
    sent: Arc<Mutex<Vec<Command>>>,
    tx: Sender<EngineEvent>,
    rx: Receiver<EngineEvent>,
    next: u64,
}

impl Engine for Replay {
    fn send(&mut self, command: Command) -> u64 {
        self.sent.lock().unwrap().push(command.clone());
        self.next += 1;
        let id = self.next;
        let name = command.name();
        if let Command::ClipCameras { clip } = &command {
            let expected = self.asked.pop_front();
            assert_eq!(Some(clip), expected.as_ref(), "the tab asked the cameras of an entry that was not recorded");
        }
        let step = self.recorded.get_mut(name).and_then(VecDeque::pop_front).or_else(|| self.steady.get(name).map(|reply| json!({"reply": reply})));
        match step {
            Some(step) => {
                for e in step["events"].as_array().into_iter().flatten() {
                    let name: StateName = serde_json::from_value(e["state"]["name"].clone()).expect("a recorded state");
                    self.tx.send(EngineEvent::State { name, payload: e["state"]["payload"].clone() }).unwrap();
                }
                let result = match step["reply"].get("ok") {
                    Some(v) => Ok(v.clone()),
                    None => Err(step["reply"]["err"].as_str().expect("a recorded refusal").to_string()),
                };
                self.tx.send(EngineEvent::Reply { id, result }).unwrap();
            }
            // The real engine does not serve `hello` yet (T13): answered as the settings engine does.
            None if matches!(command, Command::Hello) => self.tx.send(EngineEvent::Reply { id, result: Ok(json!({"data": {"app_version": env!("CARGO_PKG_VERSION")}})) }).unwrap(),
            None => self.settings.send((id, command)).unwrap(),
        }
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        &self.rx
    }
}

struct Rig {
    h: Harness<'static, Shell>,
    sent: Arc<Mutex<Vec<Command>>>,
    fx: Value,
    /// Profile root, local app data, exports.
    dirs: [tempfile::TempDir; 3],
}

/// What a flow replays, in order, per command.
#[derive(Default)]
struct Plan {
    previews: Vec<&'static str>,
    cameras: usize,
    load_preset: bool,
    with_settings: bool,
    wgpu: bool,
    /// Grow the recorded preview to this many clips by repeating it: as more demos, or (`dense`)
    /// as later clips of the same demos.
    grow: Option<(usize, bool)>,
    /// Show this preview (`{"sequences": …, "cfg": …}`) in place of the recorded one, in 3.5's proof window.
    reference: Option<Value>,
}

/// The recorded preview repeated until it holds `target` clips.
fn grown(step: &Value, target: usize, dense: bool) -> Value {
    let mut step = step.clone();
    let ready = step["events"].as_array_mut().unwrap().iter_mut().find(|e| e["state"]["name"] == "preview_ready").unwrap();
    let payload = &mut ready["state"]["payload"];
    let (events, sequences) = (payload["events"].as_object().unwrap().clone(), payload["sequences"].as_object().unwrap().clone());
    let span = sequences.values().flat_map(|s| s.as_array().unwrap()).map(|s| s["end_tick"].as_i64().unwrap()).max().unwrap() + 1;
    let mut count: usize = sequences.values().map(|s| s.as_array().unwrap().len()).sum();
    let mut round = 0;
    while count < target {
        round += 1;
        for (demo, seqs) in &sequences {
            if count >= target {
                break;
            }
            let shift = if dense { span * round } else { 0 };
            let moved = |v: &Value, keys: &[&str]| {
                let mut v = v.clone();
                for k in keys {
                    if let Some(t) = v.get(*k).and_then(Value::as_i64) {
                        v[*k] = json!(t + shift);
                    }
                }
                v
            };
            let pool: Vec<Value> = events[demo].as_array().unwrap().iter().map(|e| moved(e, &["tick"])).collect();
            let rows: Vec<Value> = seqs.as_array().unwrap().iter().map(|s| {
                let mut row = moved(s, &["start_tick", "end_tick"]);
                row["camera_segments"] = s["camera_segments"].as_array().unwrap().iter().map(|c| moved(c, &["from_tick", "to_tick"])).collect();
                row["events"] = s["events"].as_array().unwrap().iter().map(|e| if e.is_number() { json!(e.as_u64().unwrap() + if dense { payload["events"][demo].as_array().unwrap().len() as u64 } else { 0 }) } else { json!({"copy": moved(&e["copy"], &["tick"])}) }).collect();
                row
            }).collect();
            count += rows.len();
            if dense {
                payload["events"][demo].as_array_mut().unwrap().extend(pool);
                payload["sequences"][demo].as_array_mut().unwrap().extend(rows);
            } else {
                let name = demo.replace(".dem", &format!("-r{round}.dem"));
                payload["events"][&name] = pool.into();
                payload["sequences"][&name] = rows.into();
            }
        }
    }
    step
}

fn rig(plan: Plan) -> Rig {
    let fx = fixture();
    let mut recorded: HashMap<&'static str, VecDeque<Value>> = HashMap::new();
    let preview_step = |k: &str| {
        let mut step = plan.grow.map_or_else(|| fx[k].clone(), |(target, dense)| grown(&fx[k], target, dense));
        if let Some(shown) = &plan.reference {
            let ready = step["events"].as_array_mut().unwrap().iter_mut().find(|e| e["state"]["name"] == "preview_ready").unwrap();
            ready["state"]["payload"] = json!({"sequences": shown["sequences"], "cfg": shown["cfg"], "events": {}});
        }
        step
    };
    recorded.insert("start_preview", plan.previews.iter().map(|k| preview_step(k)).collect());
    recorded.insert("clip_cameras", fx["cameras"].as_array().unwrap().iter().take(plan.cameras).cloned().collect());
    if plan.load_preset {
        recorded.insert("load_preset", VecDeque::from([json!({"reply": fx["preset"]["load_reply"]})]));
    }
    let steady = HashMap::from([("connect_db", fx["connect_db"].clone()), ("run_inputs_problem", fx["run_inputs_problem"].clone())]);
    let asked = fx["cameras"].as_array().unwrap().iter().take(plan.cameras).map(|c| c["clip"].clone()).collect();
    let dirs = [tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap()];
    let secrets = Secrets::default();
    let places = SearchPlaces { explicit_root: Some(dirs[0].path().into()), exe_dir: None, local_app_data: Some(dirs[1].path().into()) };
    let (home, _) = SettingsHome::open(&places, secrets.clone()).unwrap();
    let (tx, rx) = channel();
    let sent = Arc::new(Mutex::new(Vec::new()));
    let (settings, inbox) = channel::<(u64, Command)>();
    let sink = EventSink::new(tx.clone(), secrets);
    std::thread::spawn(move || {
        let mut home = home;
        for (id, command) in inbox {
            let result = home.handle(&command, &sink).unwrap_or_else(|| Err(format!("\"{}\" is not available in this build yet.", command.name())));
            let _ = sink.emit(EngineEvent::Reply { id, result });
        }
    });
    let engine = Replay { recorded, steady, asked, settings, sent: sent.clone(), tx, rx, next: 0 };
    let export = dirs[2].path().to_path_buf();
    let mut b = Harness::builder().with_size(if plan.with_settings { TALL } else if plan.reference.is_some() { REFERENCE_SIZE } else { SIZE }).with_step_dt(STEP_DT).with_max_steps(400);
    if plan.wgpu {
        // DX12 crashes headless on the dev machine (rust/PIEGES.md); GL is what the window uses.
        if std::env::var_os("WGPU_BACKEND").is_none() {
            std::env::set_var("WGPU_BACKEND", "gl");
        }
        b = b.wgpu();
    }
    let with_settings = plan.with_settings;
    let h = b.build_eframe(move |cc| {
        let shell = Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion: Motion::Still, export_dir: export }).with_tab(TabId::Editing, Box::new(EditingTab::new()));
        if with_settings {
            shell.with_tab(TabId::Settings, Box::new(SettingsTab::with_picker(Box::new(|_kind: PickKind| None))))
        } else {
            shell
        }
    });
    let mut r = Rig { h, sent, fx, dirs };
    r.until("the start-up", |s| s.link.settings_loaded && s.link.db == csdm_app::link::DbState::Ok);
    r
}

impl Rig {
    /// Steps the window until `done` holds (the settings folder answers on its own thread).
    fn until(&mut self, what: &str, done: impl Fn(&mut Shell) -> bool) {
        let start = std::time::Instant::now();
        while !done(self.h.state_mut()) {
            assert!(start.elapsed() < WAIT, "timed out waiting for {what}");
            std::thread::sleep(TICK);
            self.h.step();
        }
        self.h.run();
    }

    fn click(&mut self, label: &str) {
        self.h.get_by_label(label).click();
        self.h.run();
    }

    /// Whether the check box `label` reads as checked.
    fn checked(&self, label: &str) -> bool {
        self.h.get_by_label(label).accesskit_node().toggled() == Some(egui::accesskit::Toggled::True)
    }

    /// Steps the window until `label` is on screen (an engine question comes from its own thread).
    fn wait_label(&mut self, label: &str) {
        let start = std::time::Instant::now();
        while self.h.query_by_label(label).is_none() {
            assert!(start.elapsed() < WAIT, "timed out waiting for \"{label}\" on screen");
            std::thread::sleep(TICK);
            self.h.step();
        }
        self.h.run();
    }

    fn click_containing(&mut self, part: &str) {
        self.h.get_by_label_contains(part).click();
        self.h.run();
    }

    fn preview(&self) -> &Preview {
        &self.h.state().link.state.preview
    }

    fn tab(&mut self) -> &mut EditingTab {
        self.h.state_mut().view::<EditingTab>(TabId::Editing).expect("the EDITING tab")
    }

    fn sent(&self, name: &str) -> Vec<Command> {
        self.sent.lock().unwrap().iter().filter(|c| c.name() == name).cloned().collect()
    }

    fn header(&self) -> String {
        let p = self.preview();
        format!("{} of {} clips · {}", p.selected_count(), p.clips.len(), format_total(p.total_s()))
    }

    /// The recorded clip the cameras were asked for: its index, its lane and its place in the lane.
    fn recorded_clip(&self) -> (usize, usize, usize) {
        let address = &self.fx["clip"]["address"];
        let p = self.preview();
        let index = p.clips.iter().position(|c| json!(c.demo_path) == address["demo_path"] && json!(c.start_tick) == address["start_tick"]).expect("the recorded clip is in the preview");
        let lanes = p.lanes();
        let lane = lanes.iter().position(|l| l.indices.contains(&index)).unwrap();
        (index, lane, lanes[lane].indices.iter().position(|&i| i == index).unwrap())
    }

    /// Opens clip `nth` of lane `lane` in the inspector, turning the pages to it.
    fn open(&mut self, lane: usize, nth: usize) -> String {
        for _ in 0..lane / EDITING_LANES_PER_PAGE {
            self.click("Next page");
        }
        let name = format!("{} clip {}", self.preview().lanes()[lane].name, nth + 1);
        self.click(&name);
        name
    }
}

#[test]
fn editing_01_timeline_lanes_blocks_pages_and_anchored_zoom() {
    let mut r = rig(Plan { previews: vec!["preview"], ..Default::default() });
    r.click("EDITING");
    r.h.get_by_label("No preview available. Run a PREVIEW first.");
    r.click("CAPTURE");
    r.click("PREVIEW");
    assert_eq!(r.h.state().active, TabId::Editing, "a preview with clips opens EDITING");
    let lanes = r.preview().lanes();
    assert!(lanes.len() > EDITING_LANES_PER_PAGE && r.preview().clips.len() > EDITING_LIST_PAGE_SIZE, "the recording spans two pages of each view");
    assert!(r.preview().clips.iter().all(|c| c.selected && !c.edited() && !c.events.is_empty()), "every clip checked, unedited, with its events read by position");
    r.h.get_by_label(&r.header());

    // One lane per demo, ten per page; the pager turns the lanes.
    let lane_label = |k: usize| format!("{}, {n}/{n} clips", lanes[k].name, n = lanes[k].indices.len());
    for k in 0..EDITING_LANES_PER_PAGE {
        r.h.get_by_label(&lane_label(k));
    }
    assert!(r.h.query_by_label(&lane_label(EDITING_LANES_PER_PAGE)).is_none(), "the eleventh demo is on page 2");
    r.h.get_by_label(&format!("1 / {}", lanes.len().div_ceil(EDITING_LANES_PER_PAGE)));
    r.click("Next page");
    r.h.get_by_label(&lane_label(EDITING_LANES_PER_PAGE));
    r.click("Previous page");

    // A block per clip; a click opens it in the inspector without checking or editing anything.
    r.open(0, 0);
    assert_eq!(r.tab().active, Some(lanes[0].indices[0]));
    r.h.get_by_label("Include");
    assert_eq!(r.preview().selected_count(), r.preview().clips.len());

    // Fitted, the page's longest demo fills the width; the buttons step by 1.5.
    let fitted = r.tab().zoom.scale;
    assert!(r.tab().zoom.pps.is_none() && fitted > 0.0);
    assert!(r.h.get_by_label("Fit").accesskit_node().is_disabled());
    r.click("Zoom in");
    assert!((r.tab().zoom.scale - fitted * EDITING_ZOOM_STEP).abs() < 1e-9);
    r.click("Zoom out");
    assert!((r.tab().zoom.scale - fitted).abs() < 1e-9);

    // Ctrl + wheel: the second under the pointer stays under it, on the very next frame.
    // On the page's earliest clip: near the end of the longest demo the scroll stops at the
    // content's end, as a browser's does, and the second can no longer stay put.
    let (lane, nth) = (0..EDITING_LANES_PER_PAGE).flat_map(|l| (0..lanes[l].indices.len()).map(move |n| (l, n))).min_by_key(|&(l, n)| r.preview().clips[lanes[l].indices[n]].start_tick).unwrap();
    let name = format!("{} clip {}", lanes[lane].name, nth + 1);
    let edge = r.h.get_by_label(&name).rect().left_center();
    r.h.hover_at(edge);
    r.h.run();
    let mut scale = r.tab().zoom.scale;
    for _ in 0..NOTCHES {
        r.h.event(egui::Event::MouseWheel { unit: egui::MouseWheelUnit::Line, delta: egui::vec2(0.0, 1.0), modifiers: egui::Modifiers::CTRL, phase: egui::TouchPhase::Move, source: egui::MouseWheelSource::Unknown });
        r.h.step();
        scale *= EDITING_ZOOM_STEP;
        assert!((r.tab().zoom.scale - scale).abs() < 1e-9, "one notch, one step");
        let now = r.h.get_by_label(&name).rect().left();
        assert!((now - edge.x).abs() <= 1.0, "the clip's start left the pointer: {now} vs {}", edge.x);
    }
    r.h.run();
    assert!(r.tab().zoom.left > 0.0, "the lanes scrolled to keep that second in place");
    r.click("Fit");
    assert!(r.tab().zoom.pps.is_none());
    assert!((r.tab().zoom.scale - fitted).abs() < 1e-9);

    // The buttons keep the view's middle second in the middle, step after step.
    let middle = |z: &csdm_app::tabs::editing::timeline::Zoom| (f64::from(z.left) + f64::from(z.viewport) / 2.0) / z.scale;
    let before = middle(&r.tab().zoom);
    for _ in 0..REFERENCE_ZOOMS {
        r.click("Zoom in");
        let (now, scale) = (middle(&r.tab().zoom), r.tab().zoom.scale);
        assert!((now - before).abs() * scale <= 1.0, "the middle second moved: {now} vs {before}");
    }
}

#[test]
fn editing_02_inspector_edits_in_whole_seconds_events_and_cameras() {
    let cameras = fixture()["cameras"].as_array().unwrap().len();
    let mut r = rig(Plan { previews: vec!["preview"], cameras, ..Default::default() });
    r.click("PREVIEW");
    let (index, lane, nth) = r.recorded_clip();
    let (lead, tail) = (r.fx["clip"]["lead_s"].as_i64().unwrap(), r.fx["clip"]["tail_s"].as_i64().unwrap());
    r.open(lane, nth);
    assert!(r.h.get_by_label("Reset").accesskit_node().is_disabled(), "nothing to put back yet");
    assert!(r.tab().planned_cameras().is_none() && r.sent("clip_cameras").is_empty(), "an unedited clip shows the preview's cameras");

    // The end handle, one second later; then the start handle, one second earlier.
    r.h.get_by_label("Seconds after this clip's last event").focus();
    r.h.run();
    r.h.key_press(egui::Key::ArrowRight);
    r.h.run();
    assert_eq!((r.preview().clips[index].before_s, r.preview().clips[index].after_s), (None, Some(tail + 1)));
    r.h.get_by_label("Seconds before this clip's first event").focus();
    r.h.run();
    r.h.key_press(egui::Key::ArrowLeft);
    r.h.run();
    assert_eq!((r.preview().clips[index].before_s, r.preview().clips[index].after_s), (Some(lead + 1), Some(tail + 1)));
    let rate = r.preview().tickrate;
    let w = r.preview().clips[index].window(rate).unwrap();
    assert_eq!((w.lead_s, w.tail_s), ((lead + 1) as f64, (tail + 1) as f64), "whole seconds around the kept events");

    // Taking the first event out (when the recorded clip holds two or more).
    let clip = r.preview().clips[index].clone();
    if clip.events.len() > 1 {
        let chip = format!("Event 1: {} {}", event_meta(&clip.events[0].kind).0, format_clock(clip.events[0].tick as f64 / rate as f64));
        r.click(&chip);
        assert_eq!(r.preview().clips[index].excluded, vec![clip.events[0].key.clone()]);
        assert!(!r.checked(&chip), "the event reads as taken out");
        assert_eq!(r.preview().clips[index].window(rate).unwrap().kept, (1..clip.events.len()).collect::<Vec<_>>());
    }

    // Each edit asked the engine for the cameras of exactly that entry (checked by the replay),
    // and the last answer is what the inspector draws.
    assert_eq!(r.sent("clip_cameras").len(), cameras);
    let planned = r.fx["cameras"][cameras - 1]["reply"]["ok"]["cameras"].as_array().unwrap().len();
    assert_eq!(r.tab().planned_cameras().map(<[_]>::len), Some(planned));

    // GENERATE sends the checked clips with their edits.
    r.click("Include");
    assert!(!r.preview().clips[index].selected);
    let kept = r.preview().lanes()[lane].clone();
    r.h.get_by_label(&format!("{}, {}/{} clips", kept.name, kept.indices.len() - 1, kept.indices.len()));
    r.click("Include");
    r.click("GENERATE");
    let runs = r.sent("start_run");
    let Some(Command::StartRun { selected_clips: Some(sent), .. }) = runs.first() else { panic!("GENERATE sent no selection") };
    assert_eq!(*sent, r.preview().selected_clips());
    let mine = sent.as_array().unwrap().iter().find(|e| ClipEntry::from_json(e).is_some_and(|e| e.demo_path == clip.demo_path && e.start_tick == clip.start_tick)).unwrap();
    assert_eq!(*mine, r.fx["cameras"][cameras - 1]["clip"], "the entry GENERATE sends is the one the engine planned cameras for");

    // Reset puts the clip back as previewed; closing the inspector keeps the selection.
    r.click("Reset");
    assert!(!r.preview().clips[index].edited());
    assert!(r.tab().planned_cameras().is_none());
    r.click("Close the inspector");
    assert_eq!(r.tab().active, None);
    assert!(r.h.query_by_label("Include").is_none());
}

#[test]
fn editing_03_list_view_pages_badges_durations_and_total() {
    let mut r = rig(Plan { previews: vec!["preview"], ..Default::default() });
    r.click("PREVIEW");
    r.click("Editing view: List");
    assert_eq!(r.tab().view, View::List);
    let row = |r: &Rig, k: usize| {
        let p = r.preview();
        let c = &p.clips[k];
        let name = r.fx["connect_db"]["ok"]["data"]["players"].as_array().unwrap().iter().find(|row| row[1] == json!(c.player)).map_or(c.player.clone(), |row| row[2].as_str().unwrap().to_string());
        format!("Clip {}: {}, {}, {name}", k + 1, event_meta(&c.event_type).0, format_duration(c.window(p.tickrate).map_or(0.0, |w| w.duration_s)))
    };
    let (first, last, next) = (row(&r, 0), row(&r, EDITING_LIST_PAGE_SIZE - 1), row(&r, EDITING_LIST_PAGE_SIZE));
    assert!(first.contains("Player "), "the tracked player reads by name: {first}");
    r.h.get_by_label(&first);
    r.h.get_by_label(&last);
    assert!(r.h.query_by_label(&next).is_none(), "100 clips per page");
    let pages = r.preview().clips.len().div_ceil(EDITING_LIST_PAGE_SIZE);
    r.h.get_by_label(&format!("1 / {pages}"));

    // A click anywhere on the row leaves the clip out; the count and the total follow.
    let before = r.header();
    assert!(r.checked(&first));
    r.click(&first);
    assert!(!r.preview().clips[0].selected);
    assert!(!r.checked(&first));
    assert_ne!(r.header(), before);
    r.h.get_by_label(&r.header());
    r.click(&first);
    r.h.get_by_label(&before);

    r.click("Next page");
    r.h.get_by_label(&next);
    assert!(r.h.query_by_label(&first).is_none());
    // Switching the view goes back to page 1.
    r.click("Editing view: Timeline");
    assert_eq!((r.tab().view, r.tab().page), (View::Timeline, 0));
}

#[test]
fn editing_04_empty_preview_explains_itself() {
    let mut r = rig(Plan { previews: vec!["empty"], ..Default::default() });
    r.click("PREVIEW");
    assert_eq!(r.h.state().active, TabId::Capture, "nothing to show: the tab does not change");
    r.click("EDITING");
    let reason = r.fx["empty"]["events"].as_array().unwrap().iter().find(|e| e["state"]["name"] == "preview_ready").unwrap()["state"]["payload"]["empty_reason"].clone();
    // The console's log says it too: at least once on screen.
    assert!(r.h.query_all_by_label(reason["headline"].as_str().unwrap()).next().is_some());
    r.h.get_by_label(reason["hint"].as_str().unwrap());
    let stages = reason["stages"].as_array().unwrap();
    assert!(!stages.is_empty());
    for stage in stages {
        r.h.get_by_label(stage["label"].as_str().unwrap());
    }
    assert!(r.h.query_by_label("No preview available. Run a PREVIEW first.").is_none(), "a preview ran: its reason replaces the first-run line");
    assert!(r.h.get_by_label("GENERATE").accesskit_node().is_disabled());
}

#[test]
fn editing_05_save_asks_a_name_and_a_preset_restores_selection_and_edits() {
    let mut r = rig(Plan { previews: vec!["preview"], load_preset: true, with_settings: true, ..Default::default() });
    r.click("PREVIEW");
    // Leave the first clip out, then SAVE: the engine asks a name and stores settings + selection.
    r.click("Editing view: List");
    r.click_containing("Clip 1:");
    r.click("SAVE");
    r.wait_label("Preset name:");
    r.h.get_by_label("Preset name:").type_text(r.fx["preset"]["name"].as_str().unwrap());
    r.h.run();
    r.click("Save");
    let saves = r.sent("save_preset");
    let Some(Command::SavePreset { selected_clips: Some(sent), ask_name: true, cats, .. }) = saves.first() else { panic!("SAVE sent no selection") };
    assert_eq!((sent.as_array().unwrap().len(), cats.as_slice()), (r.preview().clips.len() - 1, &["full".to_string()][..]));
    // The settings folder stored it for real, under the typed name, with the selection.
    let file = r.dirs[0].path().join(csdm_core::values::V5_CONFIG_SUBDIR).join(csdm_core::values::PRESETS_FILE);
    let preset = r.fx["preset"]["name"].as_str().unwrap().to_string();
    let stored = move || std::fs::read(&file).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|v| v[&preset]["selected_clips"].clone()).filter(Value::is_array);
    let start = std::time::Instant::now();
    while stored().is_none() {
        assert!(start.elapsed() < WAIT, "timed out waiting for the saved preset");
        std::thread::sleep(TICK);
        r.h.step();
    }
    assert_eq!(stored().unwrap(), *sent);

    // Loading a preset whose selection the engine matched to this preview (recorded answer):
    // exactly its clips are checked, each with its saved edits; every other clip unchecked, unedited.
    let name = r.fx["preset"]["name"].as_str().unwrap().to_string();
    r.click("SETTINGS");
    r.until("the preset list", |s| s.view::<SettingsTab>(TabId::Settings).unwrap().presets.contains_key(&name));
    r.click(&format!("Load {name}"));
    let restored: Vec<ClipEntry> = r.fx["preset"]["load_reply"]["ok"]["selected_clips"].as_array().unwrap().iter().map(|e| ClipEntry::from_json(e).unwrap()).collect();
    assert!(restored.iter().any(ClipEntry::edited), "the recorded selection carries edits");
    let p = r.preview();
    assert_eq!(p.selected_count(), restored.len());
    for clip in &p.clips {
        match restored.iter().find(|e| e.demo_path == clip.demo_path && e.start_tick == clip.start_tick) {
            Some(e) => assert_eq!((clip.selected, clip.entry()), (true, e.clone())),
            None => assert!(!clip.selected && !clip.edited()),
        }
    }
    // Same entries, in the preview's order (the engine matches them by address).
    let by_address = |v: &Value| { let mut rows: Vec<String> = v.as_array().unwrap().iter().map(Value::to_string).collect(); rows.sort(); rows };
    assert_eq!(by_address(&p.selected_clips()), by_address(&r.fx["preset"]["load_reply"]["ok"]["selected_clips"]), "GENERATE would now send the saved selection");
    r.click("EDITING");
    r.h.get_by_label(&r.header());
    r.click("CANCEL");
    assert_eq!(r.h.state().active, TabId::Capture);
}

/// `CSDM_RENDER_OUT=<folder>` saves the tab's captures there (timeline with the inspector, list,
/// empty explanation), day and night.
#[test]
fn editing_renders_headless() {
    let out = std::env::var_os("CSDM_RENDER_OUT").map(std::path::PathBuf::from);
    for ground in ["white", "dark"] {
        let cameras = fixture()["cameras"].as_array().unwrap().len();
        let mut r = rig(Plan { previews: vec!["preview", "empty"], cameras, wgpu: true, ..Default::default() });
        let now = r.h.state().link.get("theme_bg").cloned();
        if now != Some(json!(ground)) {
            let t = 0.0;
            r.h.state_mut().link.set(t, "theme_bg", json!(ground));
            r.h.run();
        }
        r.click("PREVIEW");
        let (_, lane, nth) = r.recorded_clip();
        r.open(lane, nth);
        r.h.get_by_label("Seconds after this clip's last event").focus();
        r.h.run();
        r.h.key_press(egui::Key::ArrowRight);
        r.h.run();
        let save = |r: &mut Rig, name: &str| {
            let img = r.h.render().expect("headless render");
            assert_eq!((img.width(), img.height()), (SIZE.x as u32, SIZE.y as u32));
            if let Some(dir) = &out {
                img.save(dir.join(format!("t8-{name}-{ground}.png"))).expect("save png");
            }
        };
        save(&mut r, "timeline");
        r.click("Editing view: List");
        save(&mut r, "list");
        r.click("CAPTURE");
        r.click("PREVIEW");
        r.click("EDITING");
        save(&mut r, "empty");
    }
}

/// By hand: the tab on the invented preview 3.5's own proof shows, at that proof's window size and
/// steps (fitted, five zoom steps, a clip open, the list), for a side-by-side on the same data.
/// The status line keeps the recorded preview's counts; no clip is edited (no engine answer is invented).
///
///   CSDM_REFERENCE_PREVIEW=<{"sequences": …, "cfg": …} as JSON>  CSDM_RENDER_OUT=<folder>
///   cargo test -p csdm-app --test editing -- --ignored editing_renders_the_3_5_proof_preview
#[test]
#[ignore = "needs the 3.5 proof's preview; run by hand"]
fn editing_renders_the_3_5_proof_preview() {
    let shown: Value = serde_json::from_slice(&std::fs::read(std::env::var_os("CSDM_REFERENCE_PREVIEW").expect("CSDM_REFERENCE_PREVIEW")).expect("the preview file")).expect("a JSON preview");
    let out = std::path::PathBuf::from(std::env::var_os("CSDM_RENDER_OUT").expect("CSDM_RENDER_OUT"));
    for ground in ["white", "dark"] {
        let mut r = rig(Plan { previews: vec!["preview"], wgpu: true, reference: Some(shown.clone()), ..Default::default() });
        if r.h.state().link.get("theme_bg").cloned() != Some(json!(ground)) {
            let t = 0.0;
            r.h.state_mut().link.set(t, "theme_bg", json!(ground));
            r.h.run();
        }
        r.click("PREVIEW");
        let save = |r: &mut Rig, name: &str| r.h.render().expect("headless render").save(out.join(format!("t8-ref-{name}-{ground}.png"))).expect("save png");
        save(&mut r, "01-fit");
        for _ in 0..REFERENCE_ZOOMS {
            r.click("Zoom in");
        }
        save(&mut r, "02-zoomed");
        // 3.5 opens the first clip it drew on the second lane (clip 6, in its overscan, off screen;
        // Playwright scrolls it into view before the click). The tracks here are wider (T6), so
        // the overscan covers fewer seconds: scroll left block by block until that clip is drawn.
        let lane = r.preview().lanes()[1].name.clone();
        let target = format!("{lane} clip {REFERENCE_CLIP}");
        for _ in 0..REFERENCE_CLIP {
            if r.h.query_by_label(&target).is_some() {
                break;
            }
            r.h.query_all_by_label_contains(&format!("{lane} clip ")).next().expect("a block on the second lane").scroll_to_me();
            r.h.run();
        }
        r.h.get_by_label(&target).scroll_to_me();
        r.h.run();
        r.click(&target);
        save(&mut r, "03-inspector");
        r.click("Editing view: List");
        save(&mut r, "06-list");
    }
}

/// Mean and worst time of one frame, in milliseconds (no window: layout and painting commands).
fn frame_cost(r: &mut Rig) -> (f64, f64) {
    let (mut total, mut worst) = (std::time::Duration::ZERO, std::time::Duration::ZERO);
    for _ in 0..COST_FRAMES {
        let t = std::time::Instant::now();
        r.h.step();
        let d = t.elapsed();
        total += d;
        worst = worst.max(d);
    }
    (total.as_secs_f64() * 1e3 / f64::from(COST_FRAMES), worst.as_secs_f64() * 1e3)
}

/// What the tab costs with the largest preview 3.5 met: the recorded preview repeated to 8 465
/// clips, as more demos (the real shape) then as ten demos holding them all (the worst page).
///
///   cargo test --release -p csdm-app --test editing -- --ignored --nocapture editing_cost
#[test]
#[ignore = "prints timings; run by hand"]
fn editing_cost_with_the_largest_preview() {
    for dense in [false, true] {
        let mut r = rig(Plan { previews: vec!["preview"], grow: Some((LARGE_PREVIEW, dense)), ..Default::default() });
        r.click("PREVIEW");
        let (clips, lanes) = (r.preview().clips.len(), r.preview().lanes());
        assert!(clips >= LARGE_PREVIEW);
        let on_page: usize = lanes.iter().take(EDITING_LANES_PER_PAGE).map(|l| l.indices.len()).sum();
        let t = std::time::Instant::now();
        let mut total = 0.0;
        for _ in 0..TOTAL_CALLS {
            total += std::hint::black_box(r.preview()).total_s();
        }
        let per_total = t.elapsed().as_secs_f64() * 1e3 / f64::from(TOTAL_CALLS);
        assert!(total > 0.0);
        let fit = frame_cost(&mut r);
        r.click("Zoom in");
        r.tab().zoom.pps = Some(csdm_core::ui_values::EDITING_PPS[1]);
        r.h.run();
        let zoomed = frame_cost(&mut r);
        r.click("Editing view: List");
        let list = frame_cost(&mut r);
        println!(
            "{clips} clips in {} demos ({on_page} blocks on page 1): total over every clip {per_total:.3} ms; frame mean / worst ms: timeline fitted {:.2} / {:.2}, closest zoom {:.2} / {:.2}, list {:.2} / {:.2}",
            lanes.len(), fit.0, fit.1, zoomed.0, zoomed.1, list.0, list.1
        );
    }
}
