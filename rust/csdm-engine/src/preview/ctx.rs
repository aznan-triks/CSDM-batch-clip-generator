//! What every preview stage works with: the database, its discovery, the demo store, the event
//! arena, the engine's output (3.5 `log` / `state` ports) and the per-preview caches.

use super::event::Arena;
use super::{clips, dp2, sql};
use crate::event::{Level, StateName};
use csdm_db::{DbValue, Db, Discovery};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// The engine's output, as 3.5's `log` and `state` ports.
pub trait Ports: Sync {
    fn log(&self, message: &str, level: Level);
    fn state(&self, name: StateName, payload: Value);
}

/// Drops everything (unit tests).
pub struct NoPorts;

impl Ports for NoPorts {
    fn log(&self, _message: &str, _level: Level) {}
    fn state(&self, _name: StateName, _payload: Value) {}
}

/// Keeps everything, in order (golden bench, tests).
#[derive(Default)]
pub struct CollectPorts {
    pub logs: Mutex<Vec<(String, Level)>>,
    pub states: Mutex<Vec<(StateName, Value)>>,
}

impl Ports for CollectPorts {
    fn log(&self, message: &str, level: Level) {
        self.logs.lock().expect("log list lock").push((message.to_string(), level));
    }
    fn state(&self, name: StateName, payload: Value) {
        self.states.lock().expect("state list lock").push((name, payload));
    }
}

/// Host attributes several stages share (3.5 `_demo_checksums`, `_demo_dates`, `_demo_map_cache`,
/// `_ts_cache`). The SQL stage fills the first three; `clips::dates` the last.
#[derive(Debug, Default)]
pub struct HostCache {
    /// Demo path → match checksum.
    pub demo_checksums: HashMap<String, DbValue>,
    /// Demo path → raw date column value (`_demo_sort_key` may normalise it to an `Int`).
    pub demo_dates: HashMap<String, DbValue>,
    /// Demo path → raw map name.
    pub demo_maps: HashMap<String, String>,
    /// Demo path → `_get_demo_ts` result.
    pub ts: HashMap<String, Option<f64>>,
    /// Demo path → SteamID → name read in the demo (3.5 `_dp2_cache[path]["demo_names"]`): the
    /// demo-file stage fills it when it reads a demo, the clip cameras name players from it.
    pub demo_names: HashMap<String, HashMap<String, String>>,
}

/// One preview's working set. Each preview starts from fresh caches (T3 Conception, D (f)): the
/// result never depends on an earlier preview. Only the demo store outlives a preview, and it never
/// changes a result (it shows each preview only the sections that preview asked for).
pub struct Ctx<'a> {
    pub db: &'a mut Db,
    pub disc: &'a Discovery,
    pub ports: &'a dyn Ports,
    pub demos: &'a dp2::DemoStore,
    pub cancel: &'a AtomicBool,
    pub arena: Arena,
    pub host: HostCache,
    pub sql: sql::Cache,
    pub dp2: dp2::Cache,
    pub clips: clips::Cache,
}

impl<'a> Ctx<'a> {
    pub fn new(db: &'a mut Db, disc: &'a Discovery, ports: &'a dyn Ports, demos: &'a dp2::DemoStore, cancel: &'a AtomicBool) -> Self {
        Ctx {
            db,
            disc,
            ports,
            demos,
            cancel,
            arena: Arena::default(),
            host: HostCache::default(),
            sql: sql::Cache::default(),
            dp2: dp2::Cache::default(),
            clips: clips::Cache::default(),
        }
    }

    pub fn log(&self, message: &str, level: Level) {
        self.ports.log(message, level);
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}
