//! Shared harness for the driven tests: the shell on a scripted engine, no window,
//! clicks by accessible label, a throwaway export folder.
#![allow(dead_code)]

use csdm_app::grid::{CardCx, CardDecl, TabView};
use csdm_app::{Motion, Shell, ShellOptions};
use csdm_engine::scripted::ScriptedEngine;
use csdm_engine::{Command, Engine, EngineEvent};
use eframe::egui;
use egui_kittest::Harness;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

pub const SIZE: egui::Vec2 = egui::Vec2::new(1600.0, 900.0);
/// One frame of app time per step (kittest's default is a quarter second: debounces would elapse between pointer moves).
/// Frames a full-motion rig gets to boot.
pub const SETTLE_STEPS: usize = 30;
pub const STEP_DT: f32 = 1.0 / 60.0;

/// The start-up every scenario begins with: greeting, settings, connection, RUN check.
pub fn boot(settings: &str) -> String {
    format!(
        r#"{{"on": "hello", "events": [{{"log": {{"message": "engine ready", "level": "ok"}}}}], "reply": {{"ok": {{"data": {{"app_version": "5.0.0-dev"}}}}}}}},
        {{"on": "load_config", "reply": {{"ok": {{"data": {settings}}}}}}},
        {{"on": "connect_db", "reply": {{"ok": {{"data": {{}}}}}}}},
        {{"on": "run_inputs_problem", "reply": {{"ok": {{"problem": null}}}}}}"#
    )
}

pub fn scenario(steps: &[&str]) -> String {
    format!("{{\"steps\": [{}]}}", steps.join(","))
}

/// The scripted engine behind a lock, so a test can read the answers given to its questions.
pub struct Shared {
    pub script: Arc<Mutex<ScriptedEngine>>,
    tx: Sender<EngineEvent>,
    rx: Receiver<EngineEvent>,
    pub sent: Arc<Mutex<Vec<String>>>,
}

impl Shared {
    pub fn new(json: &str) -> Self {
        let (tx, rx) = channel();
        Self { script: Arc::new(Mutex::new(ScriptedEngine::from_json(json).expect("valid scenario"))), tx, rx, sent: Arc::default() }
    }
}

impl Engine for Shared {
    fn send(&mut self, command: Command) -> u64 {
        self.sent.lock().unwrap().push(command.name().to_string());
        let mut s = self.script.lock().unwrap();
        let id = s.send(command);
        for e in s.events().try_iter() {
            self.tx.send(e).unwrap();
        }
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        &self.rx
    }
}

pub struct Rig {
    pub h: Harness<'static, Shell>,
    pub script: Arc<Mutex<ScriptedEngine>>,
    pub sent: Arc<Mutex<Vec<String>>>,
    pub export: tempfile::TempDir,
}

pub fn rig_with(json: &str, motion: Motion, tab: Option<(csdm_app::tabs::TabId, Box<dyn TabView>)>, wgpu: bool) -> Rig {
    let engine = Shared::new(json);
    let (script, sent) = (engine.script.clone(), engine.sent.clone());
    let export = tempfile::tempdir().unwrap();
    let dir = export.path().to_path_buf();
    let mut b = Harness::builder().with_size(SIZE).with_step_dt(STEP_DT).with_max_steps(400);
    if wgpu {
        // wgpu's default DX12 backend crashes (access violation) headless on the dev machine;
        // GL is also what the app's own window renders with.
        if std::env::var_os("WGPU_BACKEND").is_none() {
            std::env::set_var("WGPU_BACKEND", "gl");
        }
        b = b.wgpu();
    }
    let h = b.build_eframe(move |cc| {
        let shell = Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions { motion, export_dir: dir });
        match tab {
            Some((id, view)) => shell.with_tab(id, view),
            None => shell,
        }
    });
    let mut r = Rig { h, script, sent, export };
    // Full motion never comes to rest (the primary ring turns): a fixed number of frames instead.
    if motion == Motion::Still {
        r.h.run();
    } else {
        r.h.run_steps(SETTLE_STEPS);
    }
    r
}

pub fn rig(json: &str) -> Rig {
    rig_with(json, Motion::Still, None, false)
}

impl Rig {
    pub fn sent(&self) -> Vec<String> {
        self.sent.lock().unwrap().clone()
    }

    pub fn remaining(&self) -> usize {
        self.script.lock().unwrap().remaining_steps()
    }

    pub fn answers(&self) -> Vec<Option<Option<String>>> {
        self.script.lock().unwrap().answers()
    }

    pub fn click(&mut self, label: &str) {
        use egui_kittest::kittest::Queryable;
        self.h.get_by_label(label).click();
        self.h.run();
    }

    pub fn setting(&self, key: &str) -> Option<serde_json::Value> {
        self.h.state().link.get(key).cloned()
    }

    /// Lets `seconds` of app time pass (the harness clock advances one step at a time).
    pub fn wait(&mut self, seconds: f32) {
        for _ in 0..((seconds / STEP_DT).ceil() as usize) {
            self.h.step();
        }
        self.h.run();
    }

    pub fn drag(&mut self, from: egui::Pos2, to: egui::Pos2) {
        self.h.hover_at(from);
        self.h.run();
        self.h.drag_at(from);
        self.h.run();
        for k in 1..=8 {
            self.h.hover_at(from + (to - from) * (k as f32 / 8.0));
            self.h.run();
        }
        self.h.drop_at(to);
        self.h.run();
    }
}

/// A test tab: cards whose bodies hold what a test needs (lines that grow, a reset button,
/// a control with a tip, a confirm dialog).
pub struct Cards {
    pub decls: Vec<(&'static str, &'static str, bool)>,
    pub lines: usize,
    /// Content height of the first frames, to simulate transient start-up measurements.
    pub tall_frames: usize,
    pub confirm_open: bool,
    pub confirm: Option<csdm_app::widgets::Confirm>,
}

impl Cards {
    pub fn new(decls: &[(&'static str, &'static str, bool)]) -> Self {
        Self { decls: decls.to_vec(), lines: 0, tall_frames: 0, confirm_open: false, confirm: None }
    }
}

impl TabView for Cards {
    fn as_any_mut(&mut self) -> Option<&mut dyn std::any::Any> {
        Some(self)
    }

    fn cards(&self) -> Vec<CardDecl> {
        self.decls.iter().map(|(id, title, wide)| CardDecl { id, title: title.to_string(), icon: Some("killFilters"), count: Some("2 rules".into()), wide: *wide }).collect()
    }

    fn body(&mut self, id: &str, ui: &mut egui::Ui, cx: &mut CardCx) {
        if self.tall_frames > 0 && id == "a" {
            ui.add_space(800.0);
            self.tall_frames -= 1;
        }
        match id {
            "log" => {
                for n in 0..self.lines {
                    ui.monospace(format!("line {}: clip saved", n + 1));
                }
                if ui.button("Add line").clicked() {
                    self.lines += 1;
                }
            }
            "a" => {
                ui.label("Short body.");
                if ui.button("Reset card layout").clicked() {
                    cx.reset_cards = true;
                }
            }
            "b" => {
                let r = ui.button("Wallbang");
                csdm_app::widgets::tip(ui, cx.theme, r, "Kills through a wall", cx.always_tips);
                if ui.button("Delete preset").clicked() {
                    self.confirm_open = true;
                }
                if self.confirm_open {
                    let c = csdm_app::widgets::confirm_dialog(ui.ctx(), cx.theme, "Delete preset?", "The preset \"night\" will be removed.", true);
                    if c != csdm_app::widgets::Confirm::Pending {
                        self.confirm = Some(c);
                        self.confirm_open = false;
                    }
                }
                csdm_app::widgets::database_pending(ui, cx.theme, match &cx.link.db {
                    csdm_app::link::DbState::Error(e) => Some(e.as_str()),
                    _ => None,
                });
            }
            _ => {
                for k in 0..12 {
                    ui.label(format!("Row {k} of a long card body that wraps when the card is narrow enough to need it."));
                }
            }
        }
    }
}

