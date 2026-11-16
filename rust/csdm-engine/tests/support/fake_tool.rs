//! Test stand-in for CS Demo Manager's CLI, CS2 and FFmpeg (T4 process tests). One binary, copied
//! under several names; what each name does is read from `fake_tool.json` beside the copy, so it
//! survives a launch through cmd.exe. Never shipped: only `tests/process.rs` starts it.
//!
//! `fake_tool.json`: `{ "<file stem>": {"lines": […], "spawn": "<file beside>", "sleep_ms": N,
//! "exit": N, "write_last_arg": bool} }`. Every copy appends its process id to `pids.txt`.

use serde::Deserialize;
use std::io::Write;
use std::time::Duration;

#[derive(Deserialize, Default)]
#[serde(default)]
struct Role {
    lines: Vec<String>,
    spawn: Option<String>,
    sleep_ms: u64,
    exit: i32,
    write_last_arg: bool,
}

fn append(path: &std::path::Path, text: &str) {
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).expect("pids file");
    f.write_all(text.as_bytes()).expect("pids file");
}

fn main() {
    let exe = std::env::current_exe().expect("own path");
    let dir = exe.parent().expect("own folder").to_path_buf();
    let stem = exe.file_stem().expect("own name").to_string_lossy().to_lowercase();
    let all: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("fake_tool.json")).expect("fake_tool.json")).expect("fake_tool.json");
    let role: Role = serde_json::from_value(all.get(&stem).cloned().unwrap_or_default()).expect("role");
    append(&dir.join("pids.txt"), &format!("{}\n", std::process::id()));
    if let Some(name) = &role.spawn {
        // Inherits this program's output: the CLI's pipe, as CS2 inherits it from CS Demo Manager.
        // Never waited for: CS2 outlives the CLI that started it.
        #[allow(clippy::zombie_processes)]
        let _child = std::process::Command::new(dir.join(name)).spawn().unwrap_or_else(|e| {
            // On stdout: the tests read it, a panic message on stderr never reaches them.
            println!("fake tool: could not start {name}: {e}");
            std::process::exit(101)
        });
    }
    let mut out = std::io::stdout();
    for line in &role.lines {
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
    if role.write_last_arg {
        if let Some(p) = std::env::args().next_back() {
            std::fs::write(p, b"fake").expect("output file");
        }
    }
    std::thread::sleep(Duration::from_millis(role.sleep_ms));
    std::process::exit(role.exit);
}
