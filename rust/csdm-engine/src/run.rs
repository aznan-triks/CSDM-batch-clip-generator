//! STOP and KILL of a batch run (3.5 `request_stop` / `_stop_graceful`, `request_kill`,
//! `_await_process_exit`). They come from the window while the engine thread is busy recording, so
//! they act on a [`RunControl`] the run shares: flags it reads between steps, and the job object of
//! the program it is running.

use crate::event::{EngineEvent, EventSink, Level, StateName};
use crate::preview::Ports;
use crate::process::{self, Job, Machine};
use csdm_core::batch::{STOPPED_EXIT_CODE, CSDM_HOME_DIR, CSDM_HOME_SUBDIRS};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// What a run and the STOP / KILL requests share (3.5 `_running`, `_stop_after_current`,
/// `_kill_triggered`, `_current_demo`, `_proc`).
#[derive(Default)]
pub struct RunControl {
    pub running: AtomicBool,
    pub stop_after_current: AtomicBool,
    pub kill_triggered: AtomicBool,
    job: Mutex<Option<Arc<Job>>>,
    current_demo: Mutex<String>,
    machine: Mutex<Option<Machine>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

impl RunControl {
    /// A new run: flags cleared, running.
    pub fn begin(&self, machine: Machine) {
        self.running.store(true, Ordering::SeqCst);
        self.stop_after_current.store(false, Ordering::SeqCst);
        self.kill_triggered.store(false, Ordering::SeqCst);
        *lock(&self.current_demo) = String::new();
        *lock(&self.machine) = Some(machine);
    }

    pub fn running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn stop_requested(&self) -> bool {
        self.stop_after_current.load(Ordering::SeqCst)
    }

    pub fn killed(&self) -> bool {
        self.kill_triggered.load(Ordering::SeqCst)
    }

    /// The program the run is waiting for (its whole tree). A KILL that came before it started
    /// reaches it as soon as it is registered.
    pub fn set_job(&self, job: Option<Arc<Job>>) {
        let killed = self.killed();
        let mut slot = lock(&self.job);
        *slot = job;
        if killed {
            if let Some(j) = slot.as_ref() {
                let _ = j.terminate(STOPPED_EXIT_CODE);
            }
        }
    }

    /// Kills the running program's whole tree, if any. `Err` = Windows refused.
    pub fn kill_job(&self) -> std::io::Result<()> {
        match lock(&self.job).as_ref() {
            Some(j) => j.terminate(STOPPED_EXIT_CODE),
            None => Ok(()),
        }
    }

    pub fn set_current_demo(&self, name: &str) {
        *lock(&self.current_demo) = name.to_string();
    }

    fn current_demo(&self) -> String {
        let d = lock(&self.current_demo).clone();
        if d.is_empty() { "current demo".into() } else { d }
    }

    fn machine(&self) -> Option<Machine> {
        lock(&self.machine).clone()
    }
}

/// The engine's sink as the ports STOP / KILL write to (they run beside the engine thread).
impl Ports for EventSink {
    fn log(&self, message: &str, level: Level) {
        // A closed window: nobody left to tell.
        let _ = self.emit(EngineEvent::Log { message: message.to_string(), level });
    }
    fn state(&self, name: StateName, payload: Value) {
        let _ = self.emit(EngineEvent::State { name, payload });
    }
    fn log_parts(&self, parts: &[(String, Level)]) {
        let _ = self.emit(EngineEvent::LogParts(parts.to_vec()));
    }
}

fn clock() -> String {
    chrono::Local::now().format(csdm_core::preview::BANNER_TIME_FORMAT).to_string()
}

/// 3.5 `_stop_graceful`: the program of the current demo is stopped now (its whole tree), the
/// demo counts as failed, no other demo starts.
pub fn request_stop(control: &RunControl, ports: &dyn Ports) {
    control.stop_after_current.store(true, Ordering::SeqCst);
    control.running.store(false, Ordering::SeqCst);
    // Announced before the work: the window stages its animation on this event, not on its click.
    ports.state(StateName::StopRequested, Value::Null);
    ports.log(&format!("\n⏸ STOP — {}\n  Killing CSDM for: {}\n  Remaining demos will be skipped.", clock(), control.current_demo()), Level::Warn);
    ports.state(StateName::Buttons, json!({"stop": false}));
    if let Err(e) = control.kill_job() {
        ports.log(&format!("  ⚠ Windows refused to stop CS Demo Manager: {e}"), Level::Warn);
    }
}

/// How KILL waits for CS2 to be gone: the settings `process_exit_timeout` and
/// `process_exit_poll_interval` (seconds).
#[derive(Clone, Copy, Debug)]
pub struct ExitWait {
    pub timeout: Duration,
    pub interval: Duration,
}

/// 3.5 `request_kill`: everything stops now, CS2 is killed by name, then the run waits until it is
/// really gone before saying so (`process_exited` only on an absence seen, D17/D18).
pub fn request_kill(control: &RunControl, ports: &dyn Ports, machine: &Machine) -> bool {
    let (cs2_process, wait) = (machine.cs2_process.as_str(), machine.exit_wait);
    control.kill_triggered.store(true, Ordering::SeqCst);
    control.running.store(false, Ordering::SeqCst);
    control.stop_after_current.store(true, Ordering::SeqCst);
    ports.state(StateName::KillRequested, Value::Null);
    ports.log(
        &format!(
            "\n⛔ KILL — {}\n  Hard-killing CSDM process and cs2.exe.\n  Aborted on: {}\n  Assembly and remaining demos cancelled.\n  Any tags applied this batch will be reverted.",
            clock(),
            control.current_demo()
        ),
        Level::Err,
    );
    if let Err(e) = control.kill_job() {
        ports.log(&format!("  ⚠ Windows refused to stop CS Demo Manager: {e}"), Level::Warn);
    }
    if let Err(e) = process::kill_named(cs2_process, u32::MAX) {
        ports.log(&format!("  ⚠ Could not list the running programs to stop {cs2_process}: {e}"), Level::Warn);
    }
    let gone = await_process_exit(ports, cs2_process, wait, &|n| process::is_running(n));
    ports.state(StateName::ButtonsIdle, Value::Null);
    gone
}

/// The CS2 process name and exit wait a KILL uses: the running batch's, else `fallback`.
pub fn kill_target(control: &RunControl, fallback: &Machine) -> Machine {
    control.machine().unwrap_or_else(|| fallback.clone())
}

/// 3.5 `_await_process_exit`: an open wait, never a countdown that would let the window announce
/// an exit nobody saw. `probe` answers "still running?" (a list that cannot be read: yes).
pub fn await_process_exit(ports: &dyn Ports, name: &str, wait: ExitWait, probe: &dyn Fn(&str) -> bool) -> bool {
    let deadline = Instant::now() + wait.timeout;
    loop {
        if !probe(name) {
            ports.state(StateName::ProcessExited, json!({"name": name}));
            return true;
        }
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(wait.interval);
    }
    ports.log(&format!("  ⚠ {name} did not exit within {}s", wait.timeout.as_secs()), Level::Warn);
    false
}

/// 3.5 `ensure_csdm_dirs`: CS Demo Manager's own folders under `home`, created when missing.
pub fn ensure_csdm_dirs(home: &Path) -> std::io::Result<Vec<String>> {
    let mut created = Vec::new();
    for sub in CSDM_HOME_SUBDIRS {
        let d = if sub.is_empty() { home.join(CSDM_HOME_DIR) } else { home.join(CSDM_HOME_DIR).join(sub) };
        if !d.exists() {
            std::fs::create_dir_all(&d)?;
            created.push(d.to_string_lossy().into_owned());
        }
    }
    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::CollectPorts;
    use std::cell::Cell;

    #[test]
    fn the_exit_is_announced_only_once_seen() {
        let ports = CollectPorts::default();
        let polls = Cell::new(0);
        let wait = ExitWait { timeout: Duration::from_secs(5), interval: Duration::from_millis(1) };
        assert!(await_process_exit(&ports, "x.exe", wait, &|_| {
            polls.set(polls.get() + 1);
            polls.get() < 3
        }));
        assert_eq!(polls.get(), 3);
        let states = ports.states.lock().unwrap();
        assert_eq!(states.len(), 1);
        assert_eq!(states[0], (StateName::ProcessExited, json!({"name": "x.exe"})));
    }

    #[test]
    fn a_process_that_never_goes_is_never_announced() {
        let ports = CollectPorts::default();
        let wait = ExitWait { timeout: Duration::from_millis(30), interval: Duration::from_millis(5) };
        assert!(!await_process_exit(&ports, "x.exe", wait, &|_| true));
        assert!(ports.states.lock().unwrap().is_empty());
        assert!(ports.logs.lock().unwrap().iter().any(|(m, l)| m.contains("did not exit") && *l == Level::Warn));
    }

    #[test]
    fn csdm_folders_are_created_once() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(ensure_csdm_dirs(home.path()).unwrap().len(), CSDM_HOME_SUBDIRS.len());
        assert!(home.path().join(CSDM_HOME_DIR).join("hlae").is_dir());
        assert!(ensure_csdm_dirs(home.path()).unwrap().is_empty());
    }
}
