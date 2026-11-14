//! The real engine. One thread owns the database connection, its discovery, the demo store and the
//! last preview; commands run in arrival order and their events leave through the sink. T3 gives the
//! preview commands their behaviour; a command whose tranche has not landed is refused in words.

use crate::command::Command;
use crate::event::{Ask, AskKind, EngineEvent, EventSink, Level, Secrets, StateName};
use crate::journal::Journal;
use crate::preview::clips::{self, LastPreview, Segment};
use crate::preview::dp2::DemoStore;
use crate::preview::{cfg::build_run_cfg, worker, Ctx, Ports};
use crate::{Engine, EngineError};
use csdm_core::Settings;
use csdm_db::{Db, Discovery, PgParams};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

/// The rule drawn above and below the preview banner (3.5 `'─' * 60`).
const BANNER_WIDTH: usize = 60;

pub struct RealEngine {
    commands: Sender<(u64, Command)>,
    events: Receiver<EngineEvent>,
    sink: EventSink,
    cancel: Arc<AtomicBool>,
    next_id: u64,
}

impl RealEngine {
    /// Starts the engine thread. `settings` gives the connection (`pg_*`) until `connect_db` brings
    /// other values; `journal` receives the detail of every failure.
    pub fn start(settings: Settings, secrets: Secrets, journal: Option<Journal>) -> Self {
        let (tx, events) = channel();
        let sink = EventSink::new(tx, secrets.clone());
        let (commands, inbox) = channel::<(u64, Command)>();
        let cancel = Arc::new(AtomicBool::new(false));
        let mut state = State { sink: sink.clone(), secrets, journal, settings, db: None, demos: DemoStore::default(), last: None, cancel: cancel.clone() };
        std::thread::spawn(move || {
            for (id, command) in inbox {
                state.serve(id, command);
            }
        });
        RealEngine { commands, events, sink, cancel, next_id: 0 }
    }
}

impl Engine for RealEngine {
    fn send(&mut self, command: Command) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        // The engine thread may be busy with the very preview to stop: the flag acts now, the queued
        // command then says so and resets it.
        if matches!(command, Command::CancelPreview) {
            self.cancel.store(true, Ordering::Relaxed);
        }
        if self.commands.send((id, command)).is_err() {
            // The engine thread is gone; if the window is gone too there is nobody left to tell.
            let _ = self.sink.emit(EngineEvent::Reply { id, result: Err("The engine stopped. Restart the app.".into()) });
        }
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        &self.events
    }
}

/// The engine's output as the preview's ports. A closed window stops the work in progress.
struct SinkPorts<'a> {
    sink: &'a EventSink,
    journal: Option<&'a Journal>,
    cancel: &'a AtomicBool,
}

impl SinkPorts<'_> {
    fn emit(&self, event: EngineEvent) {
        if self.sink.emit(event).is_err() {
            self.cancel.store(true, Ordering::Relaxed);
        }
    }
}

impl Ports for SinkPorts<'_> {
    fn log(&self, message: &str, level: Level) {
        self.emit(EngineEvent::Log { message: message.to_string(), level });
    }
    fn state(&self, name: StateName, payload: Value) {
        self.emit(EngineEvent::State { name, payload });
    }
    fn trace(&self, detail: &str) {
        if let Some(Err(e)) = self.journal.map(|j| j.write(detail)) {
            self.log(&e.user_message(), Level::Warn);
        }
    }
}

struct State {
    sink: EventSink,
    secrets: Secrets,
    journal: Option<Journal>,
    settings: Settings,
    db: Option<(Db, Discovery)>,
    demos: DemoStore,
    last: Option<LastPreview>,
    cancel: Arc<AtomicBool>,
}

impl State {
    fn ports(&self) -> SinkPorts<'_> {
        SinkPorts { sink: &self.sink, journal: self.journal.as_ref(), cancel: &self.cancel }
    }

    fn serve(&mut self, id: u64, command: Command) {
        let name = command.name();
        let result = match command {
            Command::StartPreview { cfg } => self.start_preview(id, &cfg),
            other => self.handle(other),
        };
        if let Some(result) = result.transpose() {
            let result = result.map_err(|e| {
                self.ports().trace(&format!("{name}: {e:?}"));
                e.user_message()
            });
            self.ports().emit(EngineEvent::Reply { id, result });
        }
    }

    /// `Ok(None)`: the reply has already gone out.
    fn handle(&mut self, command: Command) -> Result<Option<Value>, EngineError> {
        let no_db = Discovery::default();
        let reply = match command {
            Command::DescribeFilters => clips::describe_filters(),
            Command::ConnectDb { pg } => self.connect(pg)?,
            Command::ListDemos => {
                self.ensure_connected()?;
                let ports = SinkPorts { sink: &self.sink, journal: self.journal.as_ref(), cancel: &self.cancel };
                let (db, disc) = self.db.as_mut().expect("connected above");
                let mut cx = Ctx::new(db, disc, &ports, &self.demos, &self.cancel);
                json!({"data": {"demos": clips::list_all_demos(&mut cx)?}})
            }
            Command::RunInputsProblem { cfg } => json!({"problem": clips::run_inputs_problem(&build_run_cfg(&cfg))}),
            Command::CancelPreview => {
                self.cancel.store(false, Ordering::Relaxed);
                let ports = self.ports();
                ports.log("\n⏸ Preview cancelled.", Level::Warn);
                ports.state(StateName::Summary, json!({"text": "  Preview cancelled.", "level": "muted"}));
                ports.state(StateName::Buttons, json!({"stop": false, "stop_label": "⏸ Stop"}));
                json!({})
            }
            Command::ClipCameras { clip } => {
                if !clip.is_object() {
                    return Err(EngineError::User("clip_cameras needs a `clip` object.".into()));
                }
                let disc = self.db.as_ref().map_or(&no_db, |(_, d)| d);
                let cameras = clips::edited_clip_cameras(self.last.as_ref(), disc, &clip)?;
                json!({"cameras": cameras.map(|s| s.iter().map(Segment::to_json).collect::<Vec<_>>())})
            }
            Command::ExportPreview { format } => {
                let disc = self.db.as_ref().map_or(&no_db, |(_, d)| d);
                json!({"data": clips::preview_export(self.last.as_ref(), disc, &format)?})
            }
            other => return Err(EngineError::User(format!("\"{}\" is not available in this build yet.", other.name()))),
        };
        Ok(Some(reply))
    }

    /// `_cmd_connect_db`: `pg` over the engine's settings, connect, read the database, adopt it.
    fn connect(&mut self, pg: Option<Settings>) -> Result<Value, EngineError> {
        let mut params = self.settings.clone();
        params.extend(pg.unwrap_or_default());
        let p = PgParams::from_settings(&params)?;
        self.secrets.add(&p.pass);
        let mut db = Db::connect(&p)?;
        let disc = db.discover()?;
        let data = disc.to_json();
        self.settings = params;
        self.db = Some((db, disc));
        Ok(json!({"data": data}))
    }

    /// 3.5 connected on first use with the saved settings (`_pg`).
    fn ensure_connected(&mut self) -> Result<(), EngineError> {
        if self.db.is_none() {
            self.connect(None)?;
        }
        Ok(())
    }

    /// `start_preview` + `_preview_worker`. Replies `{"started": …}` before the preview runs, as 3.5.
    fn start_preview(&mut self, id: u64, cfg: &Settings) -> Result<Option<Value>, EngineError> {
        let run = build_run_cfg(cfg);
        if let Some(problem) = clips::run_inputs_problem(&run) {
            self.ask_error(&problem);
            return Ok(Some(json!({"started": false})));
        }
        self.ensure_connected()?;
        let rule = "─".repeat(BANNER_WIDTH);
        {
            let ports = self.ports();
            ports.log(&format!("\n{rule}"), Level::Dim);
            ports.log(&format!("  🔍 PREVIEW  —  {}", chrono::Local::now().format("%H:%M:%S")), Level::Info);
            ports.log(&rule, Level::Dim);
            ports.state(StateName::Summary, json!({"text": "  Computing…", "level": "running"}));
            ports.state(StateName::Buttons, json!({"stop": true, "stop_label": "⏸ Stop Preview"}));
            ports.emit(EngineEvent::Reply { id, result: Ok(json!({"started": true})) });
        }
        let ports = SinkPorts { sink: &self.sink, journal: self.journal.as_ref(), cancel: &self.cancel };
        let (db, disc) = self.db.as_mut().expect("connected above");
        let mut cx = Ctx::new(db, disc, &ports, &self.demos, &self.cancel);
        if let Some(outcome) = worker::run_preview(&mut cx, &run) {
            self.last = Some(outcome.last);
        }
        Ok(None)
    }

    /// `ask("error", …)`: waits for the window's "ok", as 3.5's bridge did.
    fn ask_error(&self, message: &str) {
        let (reply, answer) = channel();
        self.ports().emit(EngineEvent::Ask(Ask { kind: AskKind::Error, message: message.to_string(), options: vec![], reply }));
        // The answer to an error is always "ok"; a closed window answers nothing, which ends the wait too.
        let _ = answer.recv();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn reply(engine: &RealEngine, id: u64) -> Result<Value, String> {
        loop {
            match engine.events().recv_timeout(Duration::from_secs(10)).expect("an event") {
                EngineEvent::Reply { id: got, result } if got == id => return result,
                _ => {}
            }
        }
    }

    #[test]
    fn preview_commands_answer_without_a_database() {
        let mut engine = RealEngine::start(Settings::new(), Secrets::default(), None);
        let id = engine.send(Command::DescribeFilters);
        assert!(reply(&engine, id).unwrap().is_object());
        let id = engine.send(Command::ClipCameras { clip: json!({"demo_path": "a.dem", "start_tick": 1}) });
        assert!(reply(&engine, id).unwrap_err().contains("PREVIEW"), "asks for a preview first");
        let id = engine.send(Command::ExportPreview { format: "html".into() });
        assert!(reply(&engine, id).unwrap_err().contains("PREVIEW"));
        let id = engine.send(Command::Hello);
        assert!(reply(&engine, id).unwrap_err().contains("not available"));
    }

    #[test]
    fn a_refused_preview_asks_and_answers_started_false() {
        let mut engine = RealEngine::start(Settings::new(), Secrets::default(), None);
        let id = engine.send(Command::StartPreview { cfg: Settings::new() });
        loop {
            match engine.events().recv_timeout(Duration::from_secs(10)).expect("an event") {
                EngineEvent::Ask(ask) => {
                    assert_eq!(ask.kind, AskKind::Error);
                    ask.reply.send(Some("ok".into())).unwrap();
                }
                EngineEvent::Reply { id: got, result } if got == id => {
                    assert_eq!(result.unwrap(), json!({"started": false}));
                    break;
                }
                _ => {}
            }
        }
    }
}
