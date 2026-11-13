//! Scripted engine for interface tests: replays events recorded from the real
//! engine (spec « moteur scénarisé »), fast and without a database.
//!
//! Scenario file (JSON): `{"steps": [{"on": "<command name>", "events": [...],
//! "reply": {"ok": <json>} | {"err": "<text>"}}]}`. Events: `{"log": {"message",
//! "level"}}`, `{"log_parts": [["text", "level"]]}`, `{"state": {"name",
//! "payload"}}`, `{"ask": {"kind", "message", "options"}}`. Steps are consumed
//! in order; a command that is not the next step's fails explicitly.

use crate::command::Command;
use crate::error::EngineError;
use crate::event::{Ask, AskKind, EngineEvent, EventSink, Level, Secrets, StateName};
use crate::Engine;
use serde::Deserialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
enum ScriptEvent {
    Log { message: String, level: Level },
    LogParts(Vec<(String, Level)>),
    State { name: StateName, #[serde(default)] payload: Value },
    Ask { kind: AskKind, message: String, #[serde(default)] options: Vec<String> },
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
enum ScriptReply { Ok(Value), Err(String) }

#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
struct Step { on: String, #[serde(default)] events: Vec<ScriptEvent>, reply: ScriptReply }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Scenario { steps: Vec<Step> }

pub struct ScriptedEngine {
    steps: VecDeque<Step>,
    sink: EventSink,
    events: Receiver<EngineEvent>,
    asks: Vec<Receiver<Option<String>>>,
    next_id: u64,
}

impl ScriptedEngine {
    pub fn from_json(text: &str) -> Result<Self, EngineError> {
        let scenario: Scenario = serde_json::from_str(text).map_err(|e| EngineError::Scenario(format!("unreadable scenario: {e}")))?;
        let (tx, events) = channel();
        Ok(Self { steps: scenario.steps.into(), sink: EventSink::new(tx, Secrets::default()), events, asks: Vec::new(), next_id: 0 })
    }

    pub fn from_file(path: &Path) -> Result<Self, EngineError> {
        let text = std::fs::read_to_string(path).map_err(|e| EngineError::Unreadable { path: path.into(), reason: e.to_string() })?;
        Self::from_json(&text)
    }

    /// The answer given to each question asked so far: `None` = not answered yet.
    pub fn answers(&self) -> Vec<Option<Option<String>>> {
        self.asks.iter().map(|rx| rx.try_recv().ok()).collect()
    }

    pub fn remaining_steps(&self) -> usize {
        self.steps.len()
    }

    fn play(&mut self, id: u64, command: &Command) -> Result<(), EngineError> {
        let step = match self.steps.pop_front() {
            Some(s) if s.on == command.name() => s,
            Some(s) => return Err(EngineError::Scenario(format!("expected \"{}\", got \"{}\"", s.on, command.name()))),
            None => return Err(EngineError::Scenario(format!("no step left for \"{}\"", command.name()))),
        };
        for e in step.events {
            let event = match e {
                ScriptEvent::Log { message, level } => EngineEvent::Log { message, level },
                ScriptEvent::LogParts(parts) => EngineEvent::LogParts(parts),
                ScriptEvent::State { name, payload } => EngineEvent::State { name, payload },
                ScriptEvent::Ask { kind, message, options } => {
                    let (reply, rx) = channel();
                    self.asks.push(rx);
                    EngineEvent::Ask(Ask { kind, message, options, reply })
                }
            };
            self.sink.emit(event)?;
        }
        let result = match step.reply {
            ScriptReply::Ok(v) => Ok(v),
            ScriptReply::Err(e) => Err(e),
        };
        self.sink.emit(EngineEvent::Reply { id, result })
    }
}

impl Engine for ScriptedEngine {
    fn send(&mut self, command: Command) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        if let Err(e) = self.play(id, &command) {
            // A mismatch ends the command with an error the test sees, never silence.
            self.sink
                .emit(EngineEvent::Reply { id, result: Err(e.user_message()) })
                .expect("the scripted engine owns its event receiver");
        }
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        &self.events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCENARIO: &str = r#"{"steps": [
        {"on": "hello", "events": [{"log": {"message": "Engine ready", "level": "ok"}}], "reply": {"ok": {"app_version": "5.0.0-dev"}}},
        {"on": "start_preview", "events": [
            {"state": {"name": "preview_started"}},
            {"ask": {"kind": "confirm", "message": "Overwrite?", "options": ["Files exist", "Overwrite"]}},
            {"state": {"name": "preview_ready", "payload": {"events": [], "cfg": {"tickrate": 64, "pg_pass": "x"}}}}
        ], "reply": {"ok": null}}
    ]}"#;

    #[test]
    fn replays_events_in_order_and_serves_asks() {
        let mut e = ScriptedEngine::from_json(SCENARIO).unwrap();
        let id = e.send(Command::Hello);
        let got: Vec<EngineEvent> = e.events().try_iter().collect();
        assert!(matches!(&got[0], EngineEvent::Log { message, level: Level::Ok } if message == "Engine ready"));
        assert!(matches!(&got[1], EngineEvent::Reply { id: i, result: Ok(_) } if *i == id));

        e.send(Command::StartPreview { cfg: Default::default() });
        let got: Vec<EngineEvent> = e.events().try_iter().collect();
        assert_eq!(got.len(), 4);
        let EngineEvent::Ask(ask) = &got[1] else { panic!("expected an ask, got {:?}", got[1]) };
        ask.reply.send(Some("Overwrite".into())).unwrap();
        assert_eq!(e.answers(), vec![Some(Some("Overwrite".to_string()))]);
        assert!(!format!("{:?}", got[2]).contains("pg_pass"), "scripted events go through the same sink");
        assert_eq!(e.remaining_steps(), 0);
    }

    #[test]
    fn unexpected_command_fails_explicitly() {
        let mut e = ScriptedEngine::from_json(SCENARIO).unwrap();
        e.send(Command::ListDemos);
        let got: Vec<EngineEvent> = e.events().try_iter().collect();
        assert!(matches!(&got[0], EngineEvent::Reply { result: Err(msg), .. } if msg.contains("expected \"hello\"")));
    }

    #[test]
    fn bad_scenario_is_refused() {
        assert!(ScriptedEngine::from_json(r#"{"steps": [{"on": "hello", "reply": {"maybe": 1}}]}"#).is_err());
    }
}
