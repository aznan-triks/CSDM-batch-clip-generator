//! Orchestration: the only API the UI talks to (commands in, events out).
//! Threads and channels, no async runtime (ticket 07).

pub mod command;
pub mod error;
pub mod event;
pub mod import35;
pub mod journal;
pub mod preview;
pub mod real;
pub mod scripted;

pub use command::Command;
pub use error::EngineError;
pub use event::{EngineEvent, EventSink, Secrets};
pub use real::RealEngine;

use std::sync::mpsc::Receiver;

/// What the interface holds: the real engine, or `scripted::ScriptedEngine` in tests.
pub trait Engine {
    /// Starts a command; its end arrives as `EngineEvent::Reply` with the returned id.
    fn send(&mut self, command: Command) -> u64;
    /// Every event, drained by the interface once per frame.
    fn events(&self) -> &Receiver<EngineEvent>;
}
