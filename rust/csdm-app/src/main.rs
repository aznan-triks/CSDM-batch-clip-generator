//! Desktop app entry point.
//!
//! The real engine does not exist yet in `csdm-engine` (T3/T4 build it): until then the
//! window runs on a development stand-in (`DevEngine`): the scripted engine plays the
//! start-up scenario (`CSDM_SCENARIO` file, or the built-in one), then saves and RUN checks
//! are accepted and any other command answers that it is not available in this build.
//! shortcut: replace `DevEngine` by the real engine at T13 (one line in `main`).
#![windows_subsystem = "windows"]

use csdm_app::{Shell, ShellOptions};
use csdm_core::ui_values::{APP_TITLE, WINDOW_MIN};
use csdm_engine::scripted::ScriptedEngine;
use csdm_engine::{Command, Engine, EngineEvent};
use eframe::egui;
use serde_json::json;
use std::sync::mpsc::{channel, Receiver, Sender};

const SCENARIO_ENV: &str = "CSDM_SCENARIO";
/// Bench and scripted runs: `x,y` parks the window there, never activated, off the taskbar.
const OFFSCREEN_ENV: &str = "CSDM_OFFSCREEN";
/// Bench: a file written once the first frames are drawn.
const READY_ENV: &str = "CSDM_READY_FILE";
/// Bench: a PNG of the window saved after `SHOT_AFTER_S`, on the tab named by `CSDM_SHOT_TAB`.
const SHOT_ENV: &str = "CSDM_SHOT";
const SHOT_TAB_ENV: &str = "CSDM_SHOT_TAB";
const SHOT_AFTER_S: f64 = 3.0;
const READY_AFTER_FRAMES: u64 = 2;
const BOOT_SCENARIO: &str = include_str!("../scenarios/boot.json");
const UNAVAILABLE: &str = "This development build has no engine yet: the action is not available.";

struct DevEngine {
    script: ScriptedEngine,
    tx: Sender<EngineEvent>,
    rx: Receiver<EngineEvent>,
    next: u64,
}

impl Engine for DevEngine {
    fn send(&mut self, command: Command) -> u64 {
        self.next += 1;
        let id = self.next;
        if self.script.remaining_steps() > 0 {
            let inner = self.script.send(command);
            for e in self.script.events().try_iter() {
                let e = match e {
                    EngineEvent::Reply { id: i, result } if i == inner => EngineEvent::Reply { id, result },
                    other => other,
                };
                let _ = self.tx.send(e);
            }
            return id;
        }
        let result = match command {
            Command::SaveConfig { .. } => Ok(json!({})),
            Command::RunInputsProblem { .. } => Ok(json!({"problem": null})),
            _ => Err(UNAVAILABLE.to_string()),
        };
        let _ = self.tx.send(EngineEvent::Reply { id, result });
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        &self.rx
    }
}

struct App {
    shell: Shell,
    frames: u64,
    ready: Option<String>,
    shot: Option<String>,
    shot_asked: bool,
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        if let Ok(tab) = std::env::var(SHOT_TAB_ENV) {
            if let Some(t) = csdm_app::tabs::TABS.iter().find(|t| t.key == tab) {
                self.shell.active = t.id;
            }
        }
        self.shell.frame(ui);
        let ctx = ui.ctx().clone();
        self.frames += 1;
        if self.frames == READY_AFTER_FRAMES {
            if let Some(path) = self.ready.take() {
                let _ = std::fs::write(path, "ready");
            }
        }
        if let Some(path) = self.shot.clone() {
            if !self.shot_asked && ctx.input(|i| i.time) > SHOT_AFTER_S {
                self.shot_asked = true;
                self.shot = None;
                ctx.request_screenshot(move |img| save_png(&path, &img));
            } else {
                ctx.request_repaint_after_secs(1.0);
            }
        }
    }

    fn on_exit(&mut self, gl: Option<&eframe::glow::Context>) {
        eframe::App::on_exit(&mut self.shell, gl);
    }
}

fn save_png(path: &str, img: &egui::ColorImage) {
    use csdm_app::paint::png;
    let rgba: Vec<u8> = img.pixels.iter().flat_map(|c| c.to_srgba_unmultiplied()).collect();
    png(path, img.size[0] as u32, img.size[1] as u32, rgba);
}

fn main() -> eframe::Result {
    let script = match std::env::var_os(SCENARIO_ENV) {
        Some(path) => ScriptedEngine::from_file(std::path::Path::new(&path)),
        None => ScriptedEngine::from_json(BOOT_SCENARIO),
    }
    .unwrap_or_else(|e| panic!("{}", e.user_message()));
    let (tx, rx) = channel();
    let engine = DevEngine { script, tx, rx, next: 0 };
    // The window opens at the settings' default size; the saved size is applied once they load.
    let defaults = csdm_core::settings::defaults(None);
    let size = |k: &str| defaults.get(k).and_then(serde_json::Value::as_f64).unwrap_or_default() as f32;
    let mut vp = egui::ViewportBuilder::default().with_title(APP_TITLE).with_inner_size([size("ui_window_w"), size("ui_window_h")]).with_min_inner_size(WINDOW_MIN);
    if let Some((x, y)) = std::env::var(OFFSCREEN_ENV).ok().and_then(|v| v.split_once(',').and_then(|(x, y)| Some((x.trim().parse::<f32>().ok()?, y.trim().parse::<f32>().ok()?)))) {
        vp = vp.with_position([x, y]).with_active(false).with_taskbar(false);
    }
    let options = eframe::NativeOptions { viewport: vp, ..Default::default() };
    let (ready, shot) = (std::env::var(READY_ENV).ok(), std::env::var(SHOT_ENV).ok());
    eframe::run_native(
        APP_TITLE,
        options,
        Box::new(move |cc| Ok(Box::new(App { shell: Shell::new(&cc.egui_ctx, Box::new(engine), ShellOptions::from_env()).with_tab(csdm_app::tabs::TabId::Settings, Box::new(csdm_app::tabs::settings::SettingsTab::new())), frames: 0, ready, shot, shot_asked: false }))),
    )
}
