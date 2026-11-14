//! Records the batch-run scenarios of the scripted engine (`src/scripted.rs` format) from the real
//! engine, never by hand (spec « moteur scénarisé »): a run that records, a run whose CLI fails, a
//! run stopped (STOP), a run killed (KILL). The CLI is the test stand-in (`csdm_fake_tool`, built
//! by `cargo build -p csdm-engine --bin csdm_fake_tool`) behind a fake `csdm.CMD`; its CS2 has a
//! name no real program has, so a KILL can never reach a real CS2. Each file is replayed through
//! `ScriptedEngine` to prove it plays. Recorded on the author's database: written outside the
//! repository (DECISIONS D-0015).
//!
//!     cargo run --release -p csdm-engine --example record_batch_scenario -- <csdm_fake_tool.exe> <copy of csdm_config.json> <T4 golden case JSON> <out dir>

use csdm_core::Settings;
use csdm_engine::event::StateName;
use csdm_engine::scripted::ScriptedEngine;
use csdm_engine::{Command, Engine, EngineEvent, RealEngine, Secrets};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Longest wait for one event (the first run reads every demo file it needs).
const EVENT_TIMEOUT: Duration = Duration::from_secs(900);
const ROOT_MARK: &str = "{ROOT}";
/// The log line that says a demo's CLI is about to start.
const CMD_MARK: &str = "  CMD: ";
/// Time left to the fake CLI and CS2 to start before STOP / KILL.
const SETTLE: Duration = Duration::from_millis(1500);

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn swap_root(v: &Value, root: &str) -> Value {
    match v {
        Value::String(s) => Value::String(s.replace(ROOT_MARK, root)),
        Value::Array(a) => Value::Array(a.iter().map(|x| swap_root(x, root)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), swap_root(x, root))).collect()),
        other => other.clone(),
    }
}

fn event_json(e: EngineEvent) -> Option<Value> {
    Some(match e {
        EngineEvent::Log { message, level } => json!({"log": {"message": message, "level": level}}),
        EngineEvent::LogParts(parts) => json!({"log_parts": parts}),
        EngineEvent::State { name, payload } => json!({"state": {"name": name, "payload": payload}}),
        EngineEvent::Ask(ask) => {
            let v = json!({"ask": {"kind": ask.kind, "message": ask.message, "options": ask.options}});
            // Every question of these runs is an error notice: its answer is "ok".
            ask.reply.send(Some("ok".into())).expect("the engine waits for the answer");
            v
        }
        EngineEvent::Reply { .. } => return None,
    })
}

fn step(on: &str, events: Vec<Value>, reply: &Result<Value, String>) -> Value {
    json!({"on": on, "events": events, "reply": match reply { Ok(v) => json!({"ok": v}), Err(e) => json!({"err": e}) }})
}

/// Sends `command` and keeps events until its reply and `idle` busy-state ends.
fn until_idle(engine: &mut RealEngine, command: Command, idle: usize, stop_at_cmd: bool) -> (Vec<Value>, Option<Result<Value, String>>, bool) {
    let id = engine.send(command);
    let (mut events, mut reply, mut idles) = (Vec::new(), None, 0);
    let end = Instant::now() + EVENT_TIMEOUT;
    loop {
        let e = engine.events().recv_timeout(end.saturating_duration_since(Instant::now())).expect("the engine answers");
        if let EngineEvent::Reply { id: got, result } = &e {
            assert_eq!(*got, id, "one command at a time");
            reply = Some(result.clone());
        }
        let cmd_started = matches!(&e, EngineEvent::Log { message, .. } if message.starts_with(CMD_MARK));
        if matches!(&e, EngineEvent::State { name: StateName::ButtonsIdle, .. }) {
            idles += 1;
        }
        events.extend(event_json(e));
        if stop_at_cmd && cmd_started {
            return (events, reply, true);
        }
        // A refused run (`started: false`) never gets busy.
        let refused = reply.as_ref().is_some_and(|r| r.as_ref().is_ok_and(|v| v["started"] == json!(false)));
        if reply.is_some() && (idles >= idle || refused) {
            return (events, reply, false);
        }
    }
}

/// Collects the rest of a run after STOP / KILL: until the command's reply and `idle` busy-state ends.
fn rest(engine: &mut RealEngine, command: Command, idle: usize) -> (Vec<Value>, Result<Value, String>) {
    let id = engine.send(command);
    let (mut events, mut reply, mut idles) = (Vec::new(), None, 0);
    let end = Instant::now() + EVENT_TIMEOUT;
    while reply.is_none() || idles < idle {
        match engine.events().recv_timeout(end.saturating_duration_since(Instant::now())).expect("the engine answers") {
            EngineEvent::Reply { id: got, result } if got == id => reply = Some(result),
            EngineEvent::Reply { .. } => {}
            e => {
                if matches!(&e, EngineEvent::State { name: StateName::ButtonsIdle, .. }) {
                    idles += 1;
                }
                events.extend(event_json(e));
            }
        }
    }
    (events, reply.expect("a reply"))
}

struct Kit {
    dir: PathBuf,
    cs2: String,
}

fn kit(tool: &Path, base: &Path, name: &str, roles: Value) -> Kit {
    let dir = base.join(format!("kit {name} %"));
    std::fs::create_dir_all(dir.join("clips")).expect("kit folder");
    std::fs::create_dir_all(dir.join("cs2cfg")).expect("kit folder");
    let cs2 = format!("fakecs2_{}.exe", std::process::id());
    for exe in ["fakecli.exe", cs2.as_str()] {
        std::fs::copy(tool, dir.join(exe)).expect("copy the fake tool");
    }
    std::fs::write(dir.join("csdm.CMD"), "@echo off\r\n\"%~dp0fakecli.exe\" %*\r\nexit /b %errorlevel%\r\n").expect("fake csdm.CMD");
    let mut roles = roles;
    if let Some(r) = roles.as_object_mut().and_then(|o| o.remove("cs2")) {
        roles[cs2.trim_end_matches(".exe")] = r;
    }
    if roles["fakecli"]["spawn"] == json!("cs2.exe") {
        roles["fakecli"]["spawn"] = Value::from(cs2.as_str());
    }
    std::fs::write(dir.join("fake_tool.json"), roles.to_string()).expect("fake_tool.json");
    Kit { dir, cs2 }
}

fn settings(case: &Value, kit: &Kit) -> Settings {
    let root = kit.dir.to_string_lossy().into_owned();
    let mut cfg: Settings = serde_json::from_value(swap_root(&case["cfg"], &root)).expect("case cfg");
    for (k, v) in [
        ("csdm_exe", json!(kit.dir.join("csdm.CMD"))),
        ("output_dir_clips", json!(kit.dir.join("clips"))),
        ("cs2_cfg_dir", json!(kit.dir.join("cs2cfg"))),
        ("cs2_process_name", json!(kit.cs2)),
        ("cs2_send_to_back", json!(false)),
        ("close_game_after", json!(true)),
        ("tag_enabled", json!(false)),
        ("assemble_after", json!(false)),
        ("delay_between_demos", json!(0)),
        ("retry_count", json!(0)),
    ] {
        cfg.insert(k.into(), v);
    }
    cfg
}

fn replay(path: &Path, steps: &[Value], cfg: &Settings) {
    let mut scripted = ScriptedEngine::from_file(path).expect("the scenario loads");
    for s in steps {
        let command = match s["on"].as_str().unwrap() {
            "connect_db" => Command::ConnectDb { pg: None },
            "start_run" => Command::StartRun { cfg: cfg.clone(), selected_clips: None },
            "request_stop" => Command::RequestStop,
            "request_kill" => Command::RequestKill,
            other => panic!("unexpected step {other}"),
        };
        let id = scripted.send(command);
        let got = loop {
            match scripted.events().recv_timeout(EVENT_TIMEOUT).expect("the scripted engine answers") {
                EngineEvent::Reply { id: g, result } if g == id => break result,
                EngineEvent::Ask(ask) => ask.reply.send(Some("ok".into())).expect("answer"),
                _ => {}
            }
        };
        assert_eq!(got.map_or_else(|e| json!({"err": e}), |v| json!({"ok": v})), s["reply"], "replay of {}", s["on"]);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (tool, config, case, out) = (Path::new(&args[1]), read_json(Path::new(&args[2])), read_json(Path::new(&args[3])), Path::new(&args[4]));
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("repository root");
    std::fs::create_dir_all(out).expect("output folder");
    let out = out.canonicalize().expect("output folder");
    assert!(!out.starts_with(&repo), "a scenario recorded on the author's data stays outside the repository");
    let base = tempfile::Builder::new().prefix("csdm t4 scenarios ").tempdir().expect("throwaway folder");

    let quick = json!({"fakecli": {"lines": ["Recording sequence 1…", "Done"], "spawn": "cs2.exe"}, "cs2": {"sleep_ms": 200}});
    let failing = json!({"fakecli": {"lines": ["Error: Counter-Strike executable not found"], "exit": 1}});
    let slow = json!({"fakecli": {"lines": ["Recording sequence 1…"], "spawn": "cs2.exe", "sleep_ms": 60000}, "cs2": {"sleep_ms": 60000}});
    for (name, roles, stop) in [("batch-ok", quick, None), ("batch-error", failing, None), ("batch-stop", slow.clone(), Some(Command::RequestStop)), ("batch-kill", slow, Some(Command::RequestKill))] {
        let k = kit(tool, base.path(), name, roles);
        let cfg = settings(&case, &k);
        let mut engine = RealEngine::start(config.as_object().expect("config object").clone(), Secrets::default(), None);
        let mut steps = Vec::new();
        let (events, reply, _) = until_idle(&mut engine, Command::ConnectDb { pg: None }, 0, false);
        steps.push(step("connect_db", events, &reply.expect("a reply")));
        match stop {
            None => {
                let (events, reply, _) = until_idle(&mut engine, Command::StartRun { cfg: cfg.clone(), selected_clips: None }, 1, false);
                steps.push(step("start_run", events, &reply.expect("a reply")));
            }
            Some(command) => {
                let (events, reply, reached) = until_idle(&mut engine, Command::StartRun { cfg: cfg.clone(), selected_clips: None }, 1, true);
                assert!(reached, "{name}: the run ended before its first demo started");
                // The run keeps its first demo's events until the window is told it is stopped.
                std::thread::sleep(SETTLE);
                let mut events = events;
                events.extend(engine.events().try_iter().filter_map(event_json));
                steps.push(step("start_run", events, &reply.expect("the run answered before its first demo")));
                let on = command.name();
                // KILL ends the busy state twice: its own end and the run's.
                let idles = if matches!(command, Command::RequestKill) { 2 } else { 1 };
                let (events, reply) = rest(&mut engine, command, idles);
                steps.push(step(on, events, &reply));
            }
        }
        let path = out.join(format!("scenario-{name}.json"));
        std::fs::write(&path, serde_json::to_string_pretty(&json!({"steps": steps})).expect("scenario JSON")).expect("write the scenario");
        replay(&path, &steps, &cfg);
        let alive = csdm_engine::process::is_running(&k.cs2) || csdm_engine::process::is_running("fakecli.exe");
        println!("{name:<12} {} steps, replayed, fake programs left running: {alive}", steps.len());
        assert!(!alive, "{name}: a fake program survived the run");
    }
}
