//! External programs of the batch run (3.5 `_exec`): CS Demo Manager's CLI and FFmpeg, each started
//! suspended inside a job object so that STOP, KILL, the recording timeout and the end of the CLI
//! reach the whole tree (cmd.exe → CLI → HLAE / CS2), never just its first process.

pub mod send_to_back;
pub mod win;

pub use win::Job;

use crate::batch::cli_json::got;
use csdm_core::migrate::truthy;
use crate::preview::Ports;
use crate::event::Level;
use crate::run::RunControl;
use csdm_core::batch::{ERROR_MARKS, EXEC_POLL_MS, FATAL, RAW_FILES_NOT_FOUND, RETRYABLE, CSDM_CLI_RULES, SECONDS_PER_MINUTE, STOPPED_EXIT_CODE, WHERE_PATHS};
use csdm_core::Settings;
use send_to_back::WatchSpec;
use std::io::{self, Read};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;
use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};

/// Read size of the output pipe.
const READ_CHUNK: usize = 4096;

/// Starts `cmd` suspended, puts it in a new job, then lets it run: nothing it starts can escape
/// the job. No console window (3.5 ran under a hidden console its children shared).
pub fn spawn_in_job(cmd: &mut Command) -> io::Result<(Child, Arc<Job>)> {
    let job = Job::new()?;
    let mut child = cmd.creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW).spawn()?;
    if let Err(e) = job.assign(&child).and_then(|()| win::resume_main_thread(child.id())) {
        // Never leave a suspended child behind.
        let _ = child.kill();
        let _ = child.wait();
        return Err(e);
    }
    Ok((child, Arc::new(job)))
}

/// A `%NAME%` in a script path, `NAME` a defined variable: cmd.exe would expand it (rust-lang
/// #164943) and run another path. Returns it. Every text between two `%` is checked, whatever
/// the pairing cmd.exe would make of the `%` signs before it: a rare false refusal beats running
/// another program.
pub fn expanding_pair(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split('%').collect();
    let inner = parts.get(1..parts.len().saturating_sub(1)).unwrap_or_default();
    inner.iter().find(|name| !name.is_empty() && std::env::var_os(name).is_some()).map(|name| format!("%{name}%")) // allow-hardcode: cmd.exe variable syntax
}

/// Splits bytes into lines the way Python's text mode reads them: `\n`, `\r\n` or a lone `\r`
/// ends a line; bytes are decoded as UTF-8 with replacement (3.5 `errors="replace"`).
#[derive(Default)]
pub struct LineSplitter {
    buf: Vec<u8>,
    after_cr: bool,
}

impl LineSplitter {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        for &b in bytes {
            if self.after_cr {
                self.after_cr = false;
                if b == b'\n' {
                    continue;
                }
            }
            match b {
                b'\n' => out.push(self.take()),
                b'\r' => {
                    out.push(self.take());
                    self.after_cr = true;
                }
                _ => self.buf.push(b),
            }
        }
        out
    }

    pub fn finish(mut self) -> Option<String> {
        (!self.buf.is_empty()).then(|| self.take())
    }

    fn take(&mut self) -> String {
        let line = String::from_utf8_lossy(&self.buf).into_owned();
        self.buf.clear();
        line
    }
}

/// 3.5 `csdm_cli_message`: the sentence for a CS Demo Manager CLI line, or `None` if unknown.
pub fn csdm_cli_message(line: &str) -> Option<&'static str> {
    let low = line.to_lowercase();
    CSDM_CLI_RULES.iter().find(|(fragments, _)| fragments.iter().all(|f| low.contains(f))).map(|(_, s)| *s)
}

/// What `_exec` returns: success (exit 0 and no error line), exit code, error texts, whether a
/// retry may help, and whether TrueView found no raw files (3.5 `_last_raw_not_found`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ExecOutcome {
    pub success: bool,
    pub rc: i64,
    pub errs: Vec<String>,
    pub retryable: bool,
    pub raw_not_found: bool,
}

/// Running an external program for the batch (3.5 `_exec`). The real runner starts processes; the
/// golden bench captures the CLI job file instead.
pub trait Exec {
    fn exec(&mut self, cmd: &[String], cfg: &Settings, timeout_s: u64) -> ExecOutcome;
}

/// Reads one output line the way `_exec` does, logging it and updating `out`.
pub fn take_line(ports: &dyn Ports, line: &str, out: &mut ExecOutcome) {
    if line.is_empty() {
        return;
    }
    let ll = line.to_lowercase();
    let mut is_e = RETRYABLE.iter().chain(FATAL.iter()).chain(ERROR_MARKS.iter()).any(|k| ll.contains(&k.to_lowercase()));
    if ll.contains(RAW_FILES_NOT_FOUND) {
        is_e = true;
        out.raw_not_found = true;
    }
    let retryable = RETRYABLE.iter().any(|k| ll.contains(k));
    if let Some(known) = csdm_cli_message(line) {
        out.errs.push(known.to_string());
        out.retryable |= retryable;
        ports.log(&format!("  > {line}"), Level::Dim);
        ports.log(&format!("  ✗ {known}"), Level::Err);
    } else if is_e {
        out.errs.push(line.to_string());
        out.retryable |= retryable;
        ports.log(&format!("  > {line}"), Level::Err);
    } else {
        ports.log(&format!("  > {line}"), Level::Dim);
    }
}

/// What the run needs to know about the machine: the CS2 program name it may kill (setting
/// `cs2_process_name`) and how the CS2 window watcher finds CS2.
#[derive(Clone, Debug)]
pub struct Machine {
    pub cs2_process: String,
    pub watch: WatchSpec,
    pub exit_wait: crate::run::ExitWait,
}

impl Machine {
    /// From the settings `cs2_process_name`, `process_exit_timeout`, `process_exit_poll_interval`
    /// (3.5 `_host_cfg`: the table default when the host has none).
    pub fn from_settings(cfg: &Settings) -> Machine {
        let secs = |key: &str| {
            let v = got(cfg, key).as_f64().filter(|s| s.is_finite() && *s >= 0.0);
            Duration::from_secs_f64(v.or_else(|| got(&Settings::new(), key).as_f64()).unwrap_or_default())
        };
        Machine {
            cs2_process: crate::preview::cfg::py_str(got(cfg, "cs2_process_name")),
            watch: WatchSpec::default(),
            exit_wait: crate::run::ExitWait { timeout: secs("process_exit_timeout"), interval: secs("process_exit_poll_interval") },
        }
    }
}

/// Kills every process named `name` and waits for each to be gone (3.5 `taskkill /F /IM`, which it
/// ran blocking). Returns how many were killed. A list that cannot be read kills nothing.
pub fn kill_named(name: &str, wait_ms: u32) -> io::Result<usize> {
    let pids = win::processes_named(name)?;
    let mut killed = 0;
    for pid in pids {
        // A process that ended between the snapshot and the kill is not an error.
        if win::kill_pid(pid, STOPPED_EXIT_CODE, wait_ms).unwrap_or(false) {
            killed += 1;
        }
    }
    Ok(killed)
}

/// 3.5 `process_is_running`: a list that cannot be read answers "running" (never a death assumed).
pub fn is_running(name: &str) -> bool {
    win::processes_named(name).map_or(true, |p| !p.is_empty())
}

/// The real runner: processes in a job, output read on a thread, recording timeout, CS2 watcher.
pub struct ProcessExec<'a> {
    pub ports: &'a dyn Ports,
    pub control: &'a RunControl,
    pub machine: &'a Machine,
}

impl Exec for ProcessExec<'_> {
    fn exec(&mut self, cmd: &[String], cfg: &Settings, timeout_s: u64) -> ExecOutcome {
        let failed = |message: String| ExecOutcome { success: false, rc: -1, errs: vec![message], retryable: false, raw_not_found: false };
        let program = &cmd[0];
        if let Some(pair) = expanding_pair(program) {
            return failed(format!("{program} cannot be started: Windows would read {pair} in its path as a variable. Move it to a folder without % in its path, then set it in {WHERE_PATHS}."));
        }
        let (reader, writer) = match io::pipe() {
            Ok(p) => p,
            Err(e) => return failed(format!("Could not start {program} ({e}). Check {WHERE_PATHS}.")),
        };
        let mut command = Command::new(program);
        command.args(&cmd[1..]).stdin(Stdio::null());
        let spawned = writer.try_clone().and_then(|w2| {
            command.stdout(writer).stderr(w2);
            spawn_in_job(&mut command)
        });
        // The pipe's write ends live in `command` until it drops: only the tree may hold them.
        drop(command);
        let (mut child, job) = match spawned {
            Ok(x) => x,
            Err(e) => {
                self.ports.trace(&format!("starting {program}: {e:?}"));
                return failed(format!("Could not start {program} ({e}). Check {WHERE_PATHS}."));
            }
        };
        self.control.set_job(Some(job.clone()));
        // Flags the helper threads read: they must outlive the scope those threads run in.
        let flags = Flags { done: AtomicBool::new(false), timed_out: AtomicBool::new(false) };
        let out = std::thread::scope(|s| self.watch(s, &mut child, &job, reader, cfg, timeout_s, &flags));
        self.control.set_job(None);
        out
    }
}

/// `done`: the CLI's output ended (the CS2 watcher stops); `timed_out`: the recording timeout fired.
struct Flags {
    done: AtomicBool,
    timed_out: AtomicBool,
}

impl ProcessExec<'_> {
    /// Reads the tree's output until it ends, with the recording timeout and the CS2 watcher beside.
    #[allow(clippy::too_many_arguments)] // allow-too-many-arguments: one call site, the scope's pieces
    fn watch<'s>(&'s self, s: &'s std::thread::Scope<'s, '_>, child: &mut Child, job: &'s Job, reader: io::PipeReader, cfg: &Settings, timeout_s: u64, flags: &'s Flags) -> ExecOutcome {
        let (done, timed_out) = (&flags.done, &flags.timed_out);
        if truthy(got(cfg, "cs2_send_to_back")) {
            let watch = &self.machine.watch;
            s.spawn(move || send_to_back::watch(self.ports, watch, done));
        }
        let (stop_watchdog, watchdog_wait) = channel::<()>();
        if timeout_s > 0 {
            let name = &self.machine.cs2_process;
            s.spawn(move || {
                if !matches!(watchdog_wait.recv_timeout(Duration::from_secs(timeout_s)), Err(RecvTimeoutError::Timeout)) {
                    return; // finished in time
                }
                timed_out.store(true, Ordering::SeqCst);
                self.ports.log(&format!("  ⏱ Recording timeout ({}m{:02}s) — killing CS2 and retrying…", timeout_s / SECONDS_PER_MINUTE, timeout_s % SECONDS_PER_MINUTE), Level::Warn);
                if let Err(e) = job.terminate(STOPPED_EXIT_CODE) {
                    self.ports.trace(&format!("terminating the job: {e:?}"));
                }
                if let Err(e) = kill_named(name, u32::MAX) {
                    self.ports.log(&format!("  ⚠ Could not list the running programs to stop {name}: {e}"), Level::Warn);
                }
            });
        }
        let (lines, inbox) = channel::<String>();
        s.spawn(move || {
            let mut reader = reader;
            let mut split = LineSplitter::default();
            let mut chunk = [0u8; READ_CHUNK];
            // A read error ends the output like its end does (the tree is gone or closed it).
            while let Ok(n @ 1..) = reader.read(&mut chunk) {
                for l in split.push(&chunk[..n]) {
                    if lines.send(l).is_err() {
                        return;
                    }
                }
            }
            if let Some(l) = split.finish() {
                let _ = lines.send(l);
            }
        });
        let mut out = ExecOutcome::default();
        let mut cli_ended = false;
        let close_game = truthy(got(cfg, "close_game_after"));
        loop {
            match inbox.recv_timeout(Duration::from_millis(EXEC_POLL_MS)) {
                Ok(line) => take_line(self.ports, &line, &mut out),
                Err(RecvTimeoutError::Timeout) => {
                    if !cli_ended && matches!(child.try_wait(), Ok(Some(_))) {
                        cli_ended = true;
                        // CS2 inherited the pipe: the output only ends when it dies. The CLI is done;
                        // unless the user keeps the game open, what is left of the tree goes.
                        if close_game {
                            if let Err(e) = job.terminate(STOPPED_EXIT_CODE) {
                                self.ports.trace(&format!("terminating the job: {e:?}"));
                            }
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        let status = child.wait();
        done.store(true, Ordering::SeqCst);
        drop(stop_watchdog);
        out.rc = match status {
            Ok(st) => st.code().map_or(-1, i64::from),
            Err(e) => {
                self.ports.trace(&format!("waiting for the program: {e:?}"));
                -1
            }
        };
        out.success = out.rc == 0 && out.errs.is_empty();
        out.retryable |= timed_out.load(Ordering::SeqCst);
        out
    }
}
