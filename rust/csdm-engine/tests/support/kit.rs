//! Shared by the process tests: a throwaway folder with the fake tool copied as a CLI (`fakecli.exe`
//! behind a `csdm.CMD`), a CS2 under a name no real program has, and an FFmpeg.
// Each test binary uses part of the kit.
#![allow(dead_code)]

use csdm_core::Settings;
use csdm_engine::process::send_to_back::WatchSpec;
use csdm_engine::process::{win, Machine};
use csdm_engine::run::ExitWait;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

const IMAGE_CHARS: usize = 1024;
static NEXT_KIT: AtomicUsize = AtomicUsize::new(0);

pub struct Kit {
    pub dir: tempfile::TempDir,
    /// The fake CS2's file name: unique, so no test can touch a real CS2 or another test's.
    pub cs2: String,
}

impl Kit {
    pub fn new(roles: Value) -> Kit {
        let dir = tempfile::Builder::new().prefix("csdm t4 % kit ").tempdir().expect("temp folder");
        // Unique per kit, not per test binary: KILL and the recording timeout stop CS2 by name, and
        // the tests of one binary run side by side.
        let cs2 = format!("fakecs2_{}_{}.exe", std::process::id(), NEXT_KIT.fetch_add(1, Ordering::Relaxed));
        let tool = Path::new(env!("CARGO_BIN_EXE_csdm_fake_tool"));
        for name in ["fakecli.exe", cs2.as_str(), "ffmpeg.exe"] {
            std::fs::copy(tool, dir.path().join(name)).expect("copy the fake tool");
        }
        std::fs::write(dir.path().join("csdm.CMD"), "@echo off\r\n\"%~dp0fakecli.exe\" %*\r\nexit /b %errorlevel%\r\n").expect("fake csdm.CMD");
        let mut roles = roles;
        // The CS2 role is named after its unique file, and so is every program that starts it.
        if let Some(r) = roles.as_object_mut().and_then(|o| o.remove("cs2")) {
            roles[cs2.trim_end_matches(".exe")] = r;
        }
        for role in roles.as_object_mut().into_iter().flat_map(|o| o.values_mut()) {
            if role.get("spawn").and_then(Value::as_str) == Some("cs2.exe") {
                role["spawn"] = Value::from(cs2.as_str());
            }
        }
        std::fs::write(dir.path().join("fake_tool.json"), roles.to_string()).expect("fake_tool.json");
        Kit { dir, cs2 }
    }

    pub fn cli(&self) -> String {
        self.dir.path().join("csdm.CMD").to_string_lossy().into_owned()
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    pub fn machine(&self) -> Machine {
        Machine { cs2_process: self.cs2.clone(), watch: WatchSpec::default(), exit_wait: ExitWait { timeout: Duration::from_secs(10), interval: Duration::from_millis(50) } }
    }

    /// Every process the copies started (they write their id first thing).
    pub fn pids(&self) -> Vec<u32> {
        std::fs::read_to_string(self.path("pids.txt")).unwrap_or_default().lines().filter_map(|l| l.trim().parse().ok()).collect()
    }

    /// Waits until `n` fake processes have started.
    pub fn wait_started(&self, n: usize) {
        let end = Instant::now() + Duration::from_secs(20);
        while self.pids().len() < n {
            assert!(Instant::now() < end, "the fake programs did not start: {} of {n} wrote their id", self.pids().len());
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Process `pid` is alive and runs one of this kit's copies (an id Windows gave to another
    /// program since is never touched).
    fn ours(&self, pid: u32) -> bool {
        let dir = self.dir.path().to_string_lossy().to_lowercase();
        win::process_alive(pid) && win::image_name(pid, IMAGE_CHARS).starts_with(&dir)
    }

    /// No process of the tree survives (a short grace: termination is not instant).
    pub fn assert_none_alive(&self) {
        let end = Instant::now() + Duration::from_secs(5);
        loop {
            let alive: Vec<u32> = self.pids().into_iter().filter(|&p| self.ours(p)).collect();
            if alive.is_empty() {
                return;
            }
            assert!(Instant::now() < end, "processes survived: {alive:?}");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

impl Drop for Kit {
    /// A failed test must not leave a fake program running.
    fn drop(&mut self) {
        for p in self.pids().into_iter().filter(|&p| self.ours(p)) {
            let _ = win::kill_pid(p, 1, 1000);
        }
    }
}

pub fn cfg(v: Value) -> Settings {
    v.as_object().expect("settings object").clone()
}

pub fn quiet() -> Settings {
    cfg(json!({"cs2_send_to_back": false, "close_game_after": true}))
}
