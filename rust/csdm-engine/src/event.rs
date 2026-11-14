//! What the engine tells the interface: its only output (3.5's four ports
//! `log`/`log_parts`/`state`/`ask`, plus the answer to each command).
//!
//! Every event leaves through `EventSink::emit`, which removes secrets first:
//! no event reaching the UI and no line of the journal carries the database
//! password (3.5 `for_pipe` and trace masking, ticket 07).

use crate::error::EngineError;
use csdm_core::values::{PREVIEW_CFG_KEYS, SECRET_KEYS, SECRET_MASK};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::sync::mpsc::Sender;
use std::sync::{Arc, RwLock};

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Level { Info, Warn, Err, Ok, Dim, Plain }

/// The 13 states 3.5's engine emits (research/03 §5.2).
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StateName {
    Progress, Summary, Buttons, ButtonsIdle, ButtonsBusy, RunStarted, PreviewStarted,
    PreviewReady, DemoEntry, DemosUnchecked, StopRequested, KillRequested, ProcessExited,
}

pub const STATE_NAMES: [&str; 13] = [
    "progress", "summary", "buttons", "buttons_idle", "buttons_busy", "run_started", "preview_started",
    "preview_ready", "demo_entry", "demos_unchecked", "stop_requested", "kill_requested", "process_exited",
];

/// `error`: no option, answered "ok"; `confirm`: options[0] is the title, Cancel → `None`;
/// `text`: a typed answer (preset name). The reply channel must always be served.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AskKind { Error, Confirm, Text }

#[derive(Debug)]
pub struct Ask {
    pub kind: AskKind,
    pub message: String,
    pub options: Vec<String>,
    pub reply: Sender<Option<String>>,
}

pub enum EngineEvent {
    Log { message: String, level: Level },
    LogParts(Vec<(String, Level)>),
    State { name: StateName, payload: Value },
    Ask(Ask),
    /// The end of command `id`. shortcut: the payload is untyped JSON until each
    /// tranche types its own replies (ticket 07 « réponse typée »).
    Reply { id: u64, result: Result<Value, String> },
}

/// Debug never shows a secret, even in a reply that legitimately carries the
/// settings (the Settings card edits the password).
impl fmt::Debug for EngineEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineEvent::Log { message, level } => f.debug_struct("Log").field("message", message).field("level", level).finish(),
            EngineEvent::LogParts(parts) => f.debug_tuple("LogParts").field(parts).finish(),
            EngineEvent::State { name, payload } => f.debug_struct("State").field("name", name).field("payload", payload).finish(),
            EngineEvent::Ask(ask) => f.debug_tuple("Ask").field(ask).finish(),
            EngineEvent::Reply { id, result } => {
                let mut shown = result.clone();
                if let Ok(v) = &mut shown {
                    mask_secret_keys(v);
                }
                f.debug_struct("Reply").field("id", id).field("result", &shown).finish()
            }
        }
    }
}

/// Secret values known to the engine (the password once settings are loaded).
/// Shared by the event sink and the journal.
#[derive(Clone, Default)]
pub struct Secrets(Arc<RwLock<Vec<String>>>);

impl Secrets {
    pub fn add(&self, secret: &str) {
        if secret.is_empty() {
            return;
        }
        let mut list = self.0.write().unwrap_or_else(|p| p.into_inner());
        if !list.iter().any(|s| s == secret) {
            list.push(secret.to_string());
        }
    }

    /// `text` with every known secret replaced by the mask.
    pub fn scrub(&self, text: &str) -> String {
        let list = self.0.read().unwrap_or_else(|p| p.into_inner());
        list.iter().fold(text.to_string(), |t, s| t.replace(s.as_str(), SECRET_MASK))
    }

}

/// Removes every secret key, at any depth.
fn drop_secret_keys(v: &mut Value) {
    match v {
        Value::Object(o) => {
            o.retain(|k, _| !SECRET_KEYS.contains(&k.as_str()));
            o.values_mut().for_each(drop_secret_keys);
        }
        Value::Array(a) => a.iter_mut().for_each(drop_secret_keys),
        _ => {}
    }
}

/// Replaces the value of every secret key by the mask, at any depth.
fn mask_secret_keys(v: &mut Value) {
    match v {
        Value::Object(o) => {
            for (k, x) in o.iter_mut() {
                if SECRET_KEYS.contains(&k.as_str()) {
                    *x = Value::from(SECRET_MASK);
                } else {
                    mask_secret_keys(x);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(mask_secret_keys),
        _ => {}
    }
}

/// The engine's single exit: secrets are removed before an event leaves.
#[derive(Clone)]
pub struct EventSink {
    tx: Sender<EngineEvent>,
    secrets: Secrets,
}

impl EventSink {
    pub fn new(tx: Sender<EngineEvent>, secrets: Secrets) -> Self {
        Self { tx, secrets }
    }

    pub fn emit(&self, event: EngineEvent) -> Result<(), EngineError> {
        let s = &self.secrets;
        let clean = match event {
            EngineEvent::Log { message, level } => EngineEvent::Log { message: s.scrub(&message), level },
            EngineEvent::LogParts(parts) => EngineEvent::LogParts(parts.into_iter().map(|(t, l)| (s.scrub(&t), l)).collect()),
            EngineEvent::State { name, mut payload } => {
                // The run cfg is the UI's business only for these keys (3.5 `for_pipe`).
                if let Some(Value::Object(cfg)) = payload.get_mut("cfg") {
                    cfg.retain(|k, _| PREVIEW_CFG_KEYS.contains(&k.as_str()));
                }
                // Data, not text: secrets go by key (3.5 `for_pipe` + trace `secret_keys`). Masking by
                // substring here would also rewrite filter keys or demo names that merely contain a
                // short password (a filter key in `_mf` reached the window as `kill_mod_***_…`).
                drop_secret_keys(&mut payload);
                EngineEvent::State { name, payload }
            }
            EngineEvent::Ask(ask) => EngineEvent::Ask(Ask {
                message: s.scrub(&ask.message),
                options: ask.options.iter().map(|o| s.scrub(o)).collect(),
                ..ask
            }),
            EngineEvent::Reply { id, result } => EngineEvent::Reply { id, result: result.map_err(|e| s.scrub(&e)) },
        };
        self.tx.send(clean).map_err(|_| EngineError::Disconnected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::mpsc::channel;

    const SECRET: &str = "pw-7f3a9-not-shown";

    #[test]
    fn no_event_carries_the_password() {
        let (tx, rx) = channel();
        let secrets = Secrets::default();
        secrets.add(SECRET);
        let sink = EventSink::new(tx, secrets);
        let cfg = json!({"pg_pass": SECRET, "tickrate": 64, "player_name": "me", "pg_host": "h"});
        let (reply_tx, _reply_rx) = channel();
        let events = vec![
            EngineEvent::Log { message: format!("connecting with {SECRET}"), level: Level::Info },
            EngineEvent::LogParts(vec![(SECRET.into(), Level::Err)]),
            EngineEvent::State { name: StateName::PreviewReady, payload: json!({"cfg": cfg, "events": []}) },
            EngineEvent::State { name: StateName::DemoEntry, payload: json!({"nested": {"password": "x", "list": [{"pass": SECRET}]}}) },
            EngineEvent::Ask(Ask { kind: AskKind::Confirm, message: SECRET.into(), options: vec![SECRET.into()], reply: reply_tx }),
            EngineEvent::Reply { id: 1, result: Err(format!("failed: {SECRET}")) },
            EngineEvent::Reply { id: 2, result: Ok(json!({"pg_pass": SECRET, "crf": 18})) },
        ];
        let n = events.len();
        for e in events {
            sink.emit(e).unwrap();
        }
        let shown: Vec<String> = rx.try_iter().map(|e| format!("{e:?}")).collect();
        assert_eq!(shown.len(), n);
        for line in &shown {
            assert!(!line.contains(SECRET), "secret leaked in an event");
        }
        assert!(!shown[2].contains("pg_pass") && !shown[2].contains("pg_host"), "preview cfg not trimmed");
        assert!(shown[2].contains("tickrate") && shown[2].contains("player_name"));
        assert!(!shown[3].contains("password") && !shown[3].contains("\"pass\""));
    }

    #[test]
    fn state_data_that_merely_contains_a_short_secret_is_untouched() {
        let (tx, rx) = channel();
        let secrets = Secrets::default();
        secrets.add("smoke");
        let sink = EventSink::new(tx, secrets);
        let payload = json!({"events": {"a.dem": [{"_mf": ["kill_mod_through_smoke"]}]}});
        sink.emit(EngineEvent::State { name: StateName::PreviewReady, payload: payload.clone() }).unwrap();
        match rx.try_recv().unwrap() {
            EngineEvent::State { payload: got, .. } => assert_eq!(got, payload),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn emitting_to_a_closed_interface_is_an_error() {
        let (tx, rx) = channel();
        drop(rx);
        let sink = EventSink::new(tx, Secrets::default());
        assert!(matches!(sink.emit(EngineEvent::Log { message: String::new(), level: Level::Plain }), Err(EngineError::Disconnected)));
    }
}
