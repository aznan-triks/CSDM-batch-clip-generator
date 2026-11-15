//! The window's side of the engine: commands out, events in, nothing else (ticket 07).
//!
//! Holds what 3.5 kept in `motion/engineStore.ts` (button states, progress, summary,
//! preview), in `settings/store.tsx` (the settings, saved 400 ms after the last change
//! and flushed before closing) and `useRunInputsProblem.ts` (why RUN cannot start,
//! asked again whenever the settings change, one question in flight at a time).

use csdm_core::ui_values::SAVE_DEBOUNCE_S;
use csdm_core::Settings;
use csdm_engine::event::{Ask, Level, StateName};
use csdm_engine::{Command, Engine, EngineEvent};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::mpsc::TryRecvError;

/// `motion/engineStore.ts::INITIAL_ENGINE_STATE.stopLabel`.
const STOP_LABEL: &str = "⏸ Stop";

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Summary {
    pub text: String,
    pub level: String,
    pub demos: Option<f64>,
    pub clips: Option<f64>,
    pub total_s: Option<f64>,
    pub avg_s: Option<f64>,
}

/// What the engine said about itself (3.5 `EngineState`, the fields the shell reads).
#[derive(Clone, Debug, PartialEq)]
pub struct EngineState {
    pub busy: bool,
    pub progress: Option<String>,
    pub summary: Option<Summary>,
    pub run_enabled: bool,
    pub stop_enabled: bool,
    pub kill_enabled: bool,
    pub stop_label: String,
    /// One flag per preview clip: is it checked (EDITING owns the checking, T8).
    pub preview_selected: Vec<bool>,
    pub preview_serial: u64,
    pub unchecked_paths: Vec<String>,
    pub demo_entries: u64,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            busy: false,
            progress: None,
            summary: None,
            run_enabled: true,
            stop_enabled: false,
            kill_enabled: false,
            stop_label: STOP_LABEL.into(),
            preview_selected: Vec::new(),
            preview_serial: 0,
            unchecked_paths: Vec::new(),
            demo_entries: 0,
        }
    }
}

impl EngineState {
    /// `reduceEngineState` of 3.5, for the states the shell reads.
    fn apply(&mut self, name: StateName, p: &Value) {
        let b = |k: &str| p.get(k).and_then(Value::as_bool);
        let s = |k: &str| p.get(k).and_then(Value::as_str).map(String::from);
        let n = |k: &str| p.get(k).and_then(Value::as_f64);
        match name {
            StateName::ButtonsIdle => {
                *self = EngineState { preview_selected: std::mem::take(&mut self.preview_selected), preview_serial: self.preview_serial, summary: self.summary.take(), progress: self.progress.take(), unchecked_paths: std::mem::take(&mut self.unchecked_paths), demo_entries: self.demo_entries, ..Default::default() };
            }
            StateName::ButtonsBusy => self.busy = true,
            StateName::Buttons => {
                if let Some(v) = b("run") { self.run_enabled = v; }
                if let Some(v) = b("stop") { self.stop_enabled = v; }
                if let Some(v) = b("kill") { self.kill_enabled = v; }
                if let Some(v) = s("stop_label") { self.stop_label = v; }
            }
            StateName::Progress => self.progress = Some(s("text").unwrap_or_default()),
            StateName::Summary => {
                self.summary = Some(Summary {
                    text: s("text").unwrap_or_default(),
                    level: s("level").unwrap_or_default(),
                    demos: n("demos"),
                    clips: n("clips"),
                    total_s: n("total_s"),
                    avg_s: n("avg_s"),
                });
            }
            StateName::DemosUnchecked => {
                self.unchecked_paths = p.get("paths").and_then(Value::as_array).map(|a| a.iter().map(|x| x.as_str().map(String::from).unwrap_or_else(|| x.to_string())).collect()).unwrap_or_default();
            }
            StateName::DemoEntry => self.demo_entries += 1,
            StateName::PreviewReady => {
                let count = p.get("sequences").and_then(Value::as_object).map(|m| m.values().filter_map(Value::as_array).map(Vec::len).sum()).unwrap_or(0);
                self.preview_selected = vec![true; count];
                self.preview_serial += 1;
            }
            StateName::RunStarted | StateName::PreviewStarted | StateName::StopRequested | StateName::KillRequested | StateName::ProcessExited => {}
        }
    }
}

/// The shared database connection, as the top bar's DB pill shows it.
#[derive(Clone, Debug, PartialEq)]
pub enum DbState { Pending, Ok, Error(String) }

/// What a reply is the answer to.
#[derive(Clone, Debug, PartialEq)]
enum Pending { Hello, LoadConfig, SaveConfig, ConnectDb, RunInputsProblem(u64), ExportPreview, InjectionPreview, Kept, Other(&'static str) }

/// Something the engine said that the console, the weapon band or the shell react to.
#[derive(Debug)]
pub enum Notice {
    Log { message: String, level: Level },
    LogParts(Vec<(String, Level)>),
    State { name: StateName, payload: Value },
    Ask(Ask),
    /// A command failed: the engine's own sentence.
    Failed(String),
    /// `export_preview` answered: the file, ready to save.
    PreviewExport { content: String, filename: String, clips: u64 },
    /// `injection_preview` answered: `[text, kind]` lines.
    Injection(Vec<(String, String)>),
    /// The engine stopped answering.
    Lost,
}

/// Commands, answers and events, time-stamped, when DEBUG is on (3.5 `debug/trace.ts`).
#[derive(Default)]
pub struct Trace {
    pub on: bool,
    pub lines: Vec<String>,
}

impl Trace {
    fn note(&mut self, now: f64, what: String) {
        if self.on {
            self.lines.push(format!("{now:>10.3} s  {what}"));
        }
    }
}

pub struct Link {
    engine: Box<dyn Engine>,
    pending: HashMap<u64, Pending>,
    pub state: EngineState,
    pub settings: Settings,
    pub settings_loaded: bool,
    pub version: Option<String>,
    pub db: DbState,
    /// What the last successful `connect_db` read (3.5 `useDatabase().database`: players, tags, maps…).
    pub database: Option<Value>,
    pub inputs_problem: Option<String>,
    pub lost: bool,
    pub trace: Trace,
    generation: u64,
    saved_generation: u64,
    last_edit: f64,
    problem_in_flight: bool,
    /// Settings generation the RUN question was last asked for (`None`: never asked).
    problem_asked: Option<u64>,
    /// Answers to `request`, until the tab takes them.
    replies: HashMap<u64, Result<Value, String>>,
}

impl Link {
    pub fn new(engine: Box<dyn Engine>) -> Self {
        Self {
            engine,
            pending: HashMap::new(),
            state: EngineState::default(),
            settings: csdm_core::settings::defaults(None),
            settings_loaded: false,
            version: None,
            db: DbState::Pending,
            database: None,
            inputs_problem: None,
            lost: false,
            trace: Trace::default(),
            generation: 0,
            saved_generation: 0,
            last_edit: 0.0,
            problem_in_flight: false,
            problem_asked: None,
            replies: HashMap::new(),
        }
    }

    fn send_as(&mut self, now: f64, command: Command, what: Pending) -> u64 {
        self.trace.note(now, format!("-> {}", command.name()));
        let id = self.engine.send(command);
        self.pending.insert(id, what);
        id
    }

    /// Any command whose answer the shell only needs for its failure sentence.
    pub fn send(&mut self, now: f64, command: Command) -> u64 {
        let name = command.name();
        self.send_as(now, command, Pending::Other(name))
    }

    /// A command whose answer the tab reads itself with `take_reply` (no console line on failure).
    pub fn request(&mut self, now: f64, command: Command) -> u64 {
        self.send_as(now, command, Pending::Kept)
    }

    /// The answer to a `request`, once it has come (taken once).
    pub fn take_reply(&mut self, id: u64) -> Option<Result<Value, String>> {
        self.replies.remove(&id)
    }

    /// A `connect_db` that succeeded, whoever sent it (start-up, a card's reload, SETTINGS
    /// Test & Reload): the pill and every card's view of the database follow.
    pub fn connected(&mut self, reply: &Value) {
        self.db = DbState::Ok;
        self.database = Some(reply.get("data").cloned().unwrap_or(Value::Null));
    }

    /// Reads the database again (3.5 `useDatabase().reload()`): the shared state follows.
    pub fn reconnect(&mut self, now: f64) {
        self.send_as(now, Command::ConnectDb { pg: None }, Pending::ConnectDb);
    }

    /// Start-up, in 3.5's order: greeting, settings, the shared connection.
    pub fn boot(&mut self, now: f64) {
        self.send_as(now, Command::Hello, Pending::Hello);
        self.send_as(now, Command::LoadConfig, Pending::LoadConfig);
    }

    pub fn export_preview(&mut self, now: f64, format: &str) {
        self.send_as(now, Command::ExportPreview { format: format.into() }, Pending::ExportPreview);
    }

    pub fn injection_preview(&mut self, now: f64) {
        let cfg = self.settings.clone();
        self.send_as(now, Command::InjectionPreview { cfg }, Pending::InjectionPreview);
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.settings.get(key)
    }

    /// Changes a setting; it is saved `SAVE_DEBOUNCE_S` after the last change.
    pub fn set(&mut self, now: f64, key: &str, value: Value) {
        if self.settings.get(key) == Some(&value) {
            return;
        }
        self.settings.insert(key.into(), value);
        self.generation += 1;
        self.last_edit = now;
    }

    pub fn dirty(&self) -> bool {
        self.generation != self.saved_generation
    }

    /// Saves now if anything changed (window closing).
    pub fn flush(&mut self, now: f64) {
        if self.dirty() && self.settings_loaded {
            self.saved_generation = self.generation;
            let cfg = self.settings.clone();
            self.send_as(now, Command::SaveConfig { cfg }, Pending::SaveConfig);
        }
    }

    /// Seconds until the pending save, if one is pending.
    pub fn save_due_in(&self, now: f64) -> Option<f64> {
        (self.dirty() && self.settings_loaded).then(|| (self.last_edit + SAVE_DEBOUNCE_S - now).max(0.0))
    }

    /// Once per frame: debounced save, the RUN question, then every waiting event.
    pub fn pump(&mut self, now: f64) -> Vec<Notice> {
        if self.save_due_in(now) == Some(0.0) {
            self.flush(now);
        }
        if self.settings_loaded && !self.problem_in_flight && self.problem_asked != Some(self.generation) && !self.lost {
            self.problem_in_flight = true;
            self.problem_asked = Some(self.generation);
            let cfg = self.settings.clone();
            let generation = self.generation;
            self.send_as(now, Command::RunInputsProblem { cfg }, Pending::RunInputsProblem(generation));
        }
        let mut out = Vec::new();
        loop {
            match self.engine.events().try_recv() {
                Ok(e) => self.take(now, e, &mut out),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    if !self.lost {
                        self.lost = true;
                        out.push(Notice::Lost);
                    }
                    break;
                }
            }
        }
        out
    }

    fn take(&mut self, now: f64, event: EngineEvent, out: &mut Vec<Notice>) {
        match event {
            EngineEvent::Log { message, level } => {
                self.trace.note(now, format!("log {level:?}: {message}"));
                out.push(Notice::Log { message, level });
            }
            EngineEvent::LogParts(parts) => {
                self.trace.note(now, format!("log_parts {parts:?}"));
                out.push(Notice::LogParts(parts));
            }
            EngineEvent::State { name, payload } => {
                self.trace.note(now, format!("state {name:?} {payload}"));
                self.state.apply(name, &payload);
                out.push(Notice::State { name, payload });
            }
            EngineEvent::Ask(ask) => {
                self.trace.note(now, format!("ask {:?}: {}", ask.kind, ask.message));
                out.push(Notice::Ask(ask));
            }
            EngineEvent::Reply { id, result } => {
                let what = self.pending.remove(&id).unwrap_or(Pending::Other("unknown"));
                self.trace.note(now, format!("<- {what:?} {}", if result.is_ok() { "ok" } else { "failed" }));
                self.answer(now, id, what, result, out);
            }
        }
    }

    fn answer(&mut self, now: f64, id: u64, what: Pending, result: Result<Value, String>, out: &mut Vec<Notice>) {
        let data = |v: &Value| v.get("data").cloned().unwrap_or(Value::Null);
        match (what, result) {
            (Pending::Hello, Ok(v)) => self.version = data(&v).get("app_version").and_then(Value::as_str).map(String::from),
            (Pending::LoadConfig, Ok(v)) => {
                // Every key the engine left out keeps its default (the real engine sends them all).
                if let Value::Object(cfg) = data(&v) {
                    self.settings.extend(cfg);
                }
                self.settings_loaded = true;
                self.saved_generation = self.generation;
                // The connection follows the settings it reads (3.5 DatabaseProvider).
                self.send_as(now, Command::ConnectDb { pg: None }, Pending::ConnectDb);
            }
            (Pending::ConnectDb, Ok(v)) => self.connected(&v),
            (Pending::ConnectDb, Err(e)) => {
                self.db = DbState::Error(e.clone());
                out.push(Notice::Failed(e));
            }
            (Pending::RunInputsProblem(asked), r) => {
                self.problem_in_flight = false;
                if asked == self.generation {
                    // Unknown never blocks: a failed check leaves the buttons usable (3.5).
                    self.inputs_problem = r.ok().and_then(|v| v.get("problem").and_then(Value::as_str).map(String::from));
                }
            }
            (Pending::ExportPreview, Ok(v)) => {
                let d = data(&v);
                let text = |k: &str| d.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
                out.push(Notice::PreviewExport { content: text("content"), filename: text("filename"), clips: d.get("clips").and_then(Value::as_u64).unwrap_or(0) });
            }
            (Pending::InjectionPreview, Ok(v)) => {
                let lines = v.get("lines").and_then(Value::as_array).map(|a| {
                    a.iter().map(|l| (l.get(0).and_then(Value::as_str).unwrap_or_default().to_string(), l.get(1).and_then(Value::as_str).unwrap_or_default().to_string())).collect()
                });
                out.push(Notice::Injection(lines.unwrap_or_default()));
            }
            (Pending::Kept, r) => {
                self.replies.insert(id, r);
            }
            (_, Err(e)) => out.push(Notice::Failed(e)),
            (_, Ok(_)) => {}
        }
    }

    pub fn preview_count(&self) -> usize {
        self.state.preview_selected.len()
    }

    pub fn selected_count(&self) -> usize {
        self.state.preview_selected.iter().filter(|s| **s).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use csdm_engine::scripted::ScriptedEngine;
    use serde_json::json;

    fn link(steps: &str) -> Link {
        Link::new(Box::new(ScriptedEngine::from_json(&format!("{{\"steps\": [{steps}]}}")).unwrap()))
    }

    const BOOT: &str = r#"{"on": "hello", "reply": {"ok": {"data": {"app_version": "5.0.0-dev"}}}},
        {"on": "load_config", "reply": {"ok": {"data": {"theme_bg": "white"}}}},
        {"on": "connect_db", "reply": {"ok": {"data": {}}}},
        {"on": "run_inputs_problem", "reply": {"ok": {"problem": "Pick a player first"}}}"#;

    #[test]
    fn boot_reads_version_settings_connection_and_the_run_question() {
        let mut l = link(BOOT);
        l.boot(0.0);
        l.pump(0.0);
        l.pump(0.0);
        assert_eq!(l.version.as_deref(), Some("5.0.0-dev"));
        assert_eq!(l.get("theme_bg"), Some(&json!("white")));
        assert_eq!(l.db, DbState::Ok);
        assert_eq!(l.inputs_problem.as_deref(), Some("Pick a player first"));
    }

    #[test]
    fn save_waits_for_quiet_then_sends_once() {
        // The RUN question follows the change at once (3.5); the save waits for quiet.
        let mut l = link(&format!(r#"{BOOT}, {{"on": "run_inputs_problem", "reply": {{"ok": {{"problem": null}}}}}}, {{"on": "save_config", "reply": {{"ok": {{}}}}}}"#));
        l.boot(0.0);
        l.pump(0.0);
        l.pump(0.0);
        l.set(1.0, "ui_split_pct", json!(50));
        l.set(1.2, "ui_split_pct", json!(55));
        l.pump(1.3);
        assert!(l.dirty(), "saved before the debounce");
        l.pump(1.2 + SAVE_DEBOUNCE_S);
        assert!(!l.dirty());
        l.pump(2.0);
        assert_eq!(l.inputs_problem, None, "asked again after the change");
    }

    #[test]
    fn button_states_follow_the_engine() {
        let mut s = EngineState::default();
        s.apply(StateName::ButtonsBusy, &Value::Null);
        s.apply(StateName::Buttons, &json!({"run": false, "stop": true, "kill": true, "stop_label": "⏸ Stop preview"}));
        assert!(s.busy && !s.run_enabled && s.stop_enabled && s.kill_enabled);
        s.apply(StateName::PreviewReady, &json!({"sequences": {"a.dem": [{}, {}], "b.dem": [{}]}}));
        assert_eq!((s.preview_selected.len(), s.preview_serial), (3, 1));
        s.apply(StateName::ButtonsIdle, &Value::Null);
        assert!(!s.busy && s.run_enabled && !s.stop_enabled && s.stop_label == STOP_LABEL);
        assert_eq!(s.preview_selected.len(), 3, "idle keeps the preview");
    }
}
