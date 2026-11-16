//! T4 « Processus »: the real runner (job object, pipe, threads) on real Windows processes. A fake
//! `csdm.CMD` (in a folder with spaces and `%`) starts a fake CLI, which starts a fake CS2 that
//! inherits its pipe, as CS Demo Manager starts CS2. Each test checks that no process of the tree
//! survives. The fake CS2 has a unique name: no test can stop a real CS2.

#[path = "support/kit.rs"]
mod kit;

use csdm_engine::batch::record::{record, Pacing};
use csdm_engine::event::{Level, StateName};
use csdm_engine::preview::CollectPorts;
use csdm_engine::process::{Exec, ProcessExec};
use csdm_engine::run::{request_kill, request_stop, RunControl};
use kit::{cfg, quiet, Kit};
use serde_json::json;
use std::time::{Duration, Instant};

fn cmd(kit: &Kit, job: &str) -> Vec<String> {
    vec![kit.cli(), "video".into(), "--config-file".into(), kit.path(job).to_string_lossy().into_owned()]
}

#[test]
fn output_is_read_line_by_line_and_errors_are_kept() {
    let kit = Kit::new(json!({
        "fakecli": {"lines": ["Starting", "Error: something broke", "done"], "spawn": "cs2.exe"},
        "cs2": {"lines": ["cs2 says hi"], "sleep_ms": 100}
    }));
    let ports = CollectPorts::default();
    let control = RunControl::default();
    control.begin(kit.machine());
    let machine = kit.machine();
    // The game kept open: the run reads to the end of the pipe, so CS2's line always arrives (closing
    // it after would end the tree as soon as the CLI exits, maybe before CS2 speaks).
    let keep_game = cfg(json!({"cs2_send_to_back": false, "close_game_after": false}));
    let out = ProcessExec { ports: &ports, control: &control, machine: &machine }.exec(&cmd(&kit, "job file.json"), &keep_game, 0);
    assert!(!out.success, "an error line fails the demo");
    let logs: Vec<String> = ports.logs.lock().unwrap().iter().map(|(m, _)| m.clone()).collect();
    // A fake program that panics says why on the pipe: show it.
    assert_eq!(out.rc, 0, "{logs:?}");
    assert_eq!(out.errs, vec!["Error: something broke".to_string()]);
    assert!(logs.contains(&"  > Starting".to_string()) && logs.contains(&"  > cs2 says hi".to_string()), "{logs:?}");
    kit.assert_none_alive();
}

#[test]
fn the_end_of_the_cli_ends_the_tree_when_the_game_closes_after() {
    // CS2 would hold the pipe for a minute: the run must not wait for it.
    let kit = Kit::new(json!({"fakecli": {"lines": ["recorded"], "spawn": "cs2.exe"}, "cs2": {"sleep_ms": 60000}}));
    let ports = CollectPorts::default();
    let control = RunControl::default();
    control.begin(kit.machine());
    let machine = kit.machine();
    let t0 = Instant::now();
    let out = ProcessExec { ports: &ports, control: &control, machine: &machine }.exec(&cmd(&kit, "j.json"), &quiet(), 0);
    assert!(out.success, "{out:?}");
    assert!(t0.elapsed() < Duration::from_secs(20), "waited for CS2: {:?}", t0.elapsed());
    kit.assert_none_alive();
}

#[test]
fn the_recording_timeout_kills_the_tree_and_allows_a_retry() {
    let kit = Kit::new(json!({"fakecli": {"spawn": "cs2.exe", "sleep_ms": 60000}, "cs2": {"sleep_ms": 60000}}));
    let ports = CollectPorts::default();
    let control = RunControl::default();
    control.begin(kit.machine());
    let machine = kit.machine();
    let t0 = Instant::now();
    let out = ProcessExec { ports: &ports, control: &control, machine: &machine }.exec(&cmd(&kit, "j.json"), &quiet(), 1);
    assert!(!out.success && out.retryable, "{out:?}");
    assert!(t0.elapsed() < Duration::from_secs(20));
    assert!(ports.logs.lock().unwrap().iter().any(|(m, l)| m.contains("Recording timeout (0m01s)") && *l == Level::Warn));
    kit.assert_none_alive();
}

#[test]
fn stop_kills_the_whole_tree_now() {
    let kit = Kit::new(json!({"fakecli": {"spawn": "cs2.exe", "sleep_ms": 60000}, "cs2": {"sleep_ms": 60000}}));
    let ports = CollectPorts::default();
    let control = RunControl::default();
    control.begin(kit.machine());
    let machine = kit.machine();
    let out = std::thread::scope(|s| {
        let run = s.spawn(|| ProcessExec { ports: &ports, control: &control, machine: &machine }.exec(&cmd(&kit, "j.json"), &quiet(), 0));
        kit.wait_started(2);
        request_stop(&control, &ports);
        run.join().unwrap()
    });
    assert!(!out.success);
    assert!(control.stop_requested() && !control.running());
    let states: Vec<StateName> = ports.states.lock().unwrap().iter().map(|(n, _)| *n).collect();
    assert_eq!(states.first(), Some(&StateName::StopRequested), "announced before the work");
    kit.assert_none_alive();
}

#[test]
fn kill_stops_everything_and_announces_the_exit_only_once_cs2_is_gone() {
    let kit = Kit::new(json!({"fakecli": {"spawn": "cs2.exe", "sleep_ms": 60000}, "cs2": {"sleep_ms": 60000}}));
    let ports = CollectPorts::default();
    let control = RunControl::default();
    control.begin(kit.machine());
    let machine = kit.machine();
    let gone = std::thread::scope(|s| {
        let run = s.spawn(|| ProcessExec { ports: &ports, control: &control, machine: &machine }.exec(&cmd(&kit, "j.json"), &quiet(), 0));
        kit.wait_started(2);
        let gone = request_kill(&control, &ports, &machine);
        // At the moment KILL says CS2 exited, it really is gone.
        assert!(!csdm_engine::process::is_running(&kit.cs2));
        run.join().unwrap();
        gone
    });
    assert!(gone);
    assert!(control.killed());
    let states: Vec<StateName> = ports.states.lock().unwrap().iter().map(|(n, _)| *n).collect();
    let exited = states.iter().position(|n| *n == StateName::ProcessExited).expect("process_exited");
    assert_eq!(states.first(), Some(&StateName::KillRequested));
    assert_eq!(states.last(), Some(&StateName::ButtonsIdle));
    assert!(exited < states.len() - 1);
    kit.assert_none_alive();
}

#[test]
fn a_kill_that_comes_before_the_program_starts_still_reaches_it() {
    let kit = Kit::new(json!({"fakecli": {"spawn": "cs2.exe", "sleep_ms": 60000}, "cs2": {"sleep_ms": 60000}}));
    let ports = CollectPorts::default();
    let control = RunControl::default();
    control.begin(kit.machine());
    control.kill_triggered.store(true, std::sync::atomic::Ordering::SeqCst);
    let machine = kit.machine();
    let t0 = Instant::now();
    let out = ProcessExec { ports: &ports, control: &control, machine: &machine }.exec(&cmd(&kit, "j.json"), &quiet(), 0);
    assert!(!out.success);
    assert!(t0.elapsed() < Duration::from_secs(20));
    kit.assert_none_alive();
}

#[test]
fn a_retryable_error_is_retried_after_the_delay_then_reported() {
    let kit = Kit::new(json!({"fakecli": {"lines": ["Game crashed"], "exit": 1}}));
    let ports = CollectPorts::default();
    let control = RunControl::default();
    control.begin(kit.machine());
    let machine = kit.machine();
    let mut exec = ProcessExec { ports: &ports, control: &control, machine: &machine };
    std::fs::write(kit.path("j.json"), "{}").unwrap();
    let pacing = Pacing { retry_count: 1, retry_delay: 1, delay_between_demos: 0, recording_timeout: 0 };
    let t0 = Instant::now();
    let rec = record(&ports, &control, &mut exec, &quiet(), &cmd(&kit, "j.json"), pacing, 0);
    assert!(!rec.ok);
    assert_eq!((rec.attempts, rec.retried), (2, 1));
    assert_eq!(rec.error, "Game crashed");
    assert!(t0.elapsed() >= Duration::from_secs(1), "the retry waited its delay");
    assert!(ports.logs.lock().unwrap().iter().any(|(m, _)| m == "  ↻ Retry 1 — 1s..."));
    assert_eq!(kit.pids().len(), 2, "two attempts, two CLI processes");
    kit.assert_none_alive();
}

#[test]
fn true_view_off_is_tried_once_when_raw_files_are_missing() {
    let kit = Kit::new(json!({"fakecli": {"lines": ["Raw files not found"], "exit": 1}}));
    let ports = CollectPorts::default();
    let control = RunControl::default();
    control.begin(kit.machine());
    let machine = kit.machine();
    let mut exec = ProcessExec { ports: &ports, control: &control, machine: &machine };
    std::fs::write(kit.path("j.json"), r#"{"trueView": true, "demoPath": "x"}"#).unwrap();
    let pacing = Pacing { retry_count: 0, retry_delay: 0, delay_between_demos: 0, recording_timeout: 0 };
    let rec = record(&ports, &control, &mut exec, &cfg(json!({"cs2_send_to_back": false, "close_game_after": true, "true_view": true})), &cmd(&kit, "j.json"), pacing, 0);
    assert!(!rec.ok);
    let job: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(kit.path("j.json")).unwrap()).unwrap();
    assert_eq!(job["trueView"], json!(false));
    assert_eq!(job["demoPath"], json!("x"), "the rest of the job is kept");
    assert_eq!(kit.pids().len(), 2);
    kit.assert_none_alive();
}

#[test]
fn a_program_that_cannot_start_is_a_clear_failure() {
    let ports = CollectPorts::default();
    let control = RunControl::default();
    let kit = Kit::new(json!({}));
    control.begin(kit.machine());
    let machine = kit.machine();
    let missing = kit.path("no such tool.exe").to_string_lossy().into_owned();
    let out = ProcessExec { ports: &ports, control: &control, machine: &machine }.exec(&[missing], &quiet(), 0);
    assert!(!out.success);
    assert!(out.errs[0].starts_with("Could not start") && out.errs[0].contains("SETTINGS › Paths"), "{:?}", out.errs);
}

#[test]
fn a_cli_path_windows_would_expand_is_refused_before_launch() {
    let ports = CollectPorts::default();
    let control = RunControl::default();
    let kit = Kit::new(json!({}));
    control.begin(kit.machine());
    let machine = kit.machine();
    let tricky = std::env::temp_dir().join("no kit").join("%PATH%").join("csdm.CMD").to_string_lossy().into_owned();
    let out = ProcessExec { ports: &ports, control: &control, machine: &machine }.exec(&[tricky], &quiet(), 0);
    assert!(!out.success);
    assert!(out.errs[0].contains("%PATH%"), "{:?}", out.errs);
    assert!(kit.pids().is_empty(), "nothing started");
}
