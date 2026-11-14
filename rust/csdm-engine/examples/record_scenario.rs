//! Records a scripted-engine scenario (`src/scripted.rs` format) from the real engine, never by hand
//! (spec « moteur scénarisé »): connect, demo list, filter tables, one preview, the first clip's
//! cameras, an HTML export. Then replays it through `ScriptedEngine` to prove the file plays.
//! Recorded on the author's database it holds their data: it is written outside the repository
//! (DECISIONS D-0015 decides how scenarios reach the repository).
//!
//!     cargo run --release -p csdm-engine --example record_scenario -- <copy of csdm_config.json> <settings or golden case JSON> <out.json>

use csdm_core::Settings;
use csdm_engine::event::StateName;
use csdm_engine::scripted::ScriptedEngine;
use csdm_engine::{Command, Engine, EngineEvent, RealEngine, Secrets};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

/// Longest wait for one event (a first preview reads every demo file it needs).
const EVENT_TIMEOUT: Duration = Duration::from_secs(900);

fn read_json(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"))).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// Sends `command`, keeps every event until its reply (a started preview: until the busy state ends).
fn record(engine: &mut impl Engine, command: Command, steps: &mut Vec<Value>) -> Result<Value, String> {
    let (name, is_preview) = (command.name(), matches!(command, Command::StartPreview { .. }));
    let id = engine.send(command);
    let (mut events, mut reply) = (Vec::new(), None);
    loop {
        match engine.events().recv_timeout(EVENT_TIMEOUT).expect("the engine answers") {
            EngineEvent::Reply { id: got, result } if got == id => {
                let started = result.as_ref().is_ok_and(|v| v["started"] == json!(true));
                reply = Some(result);
                if !(is_preview && started) {
                    break;
                }
            }
            EngineEvent::Reply { .. } => unreachable!("one command at a time"),
            EngineEvent::Log { message, level } => events.push(json!({"log": {"message": message, "level": level}})),
            EngineEvent::LogParts(parts) => events.push(json!({"log_parts": parts})),
            EngineEvent::State { name, payload } => {
                events.push(json!({"state": {"name": name, "payload": payload}}));
                if name == StateName::ButtonsIdle && reply.is_some() {
                    break;
                }
            }
            EngineEvent::Ask(ask) => {
                events.push(json!({"ask": {"kind": ask.kind, "message": ask.message, "options": ask.options}}));
                ask.reply.send(Some("ok".into())).expect("the engine waits for the answer");
            }
        }
    }
    let reply = reply.expect("a reply");
    steps.push(json!({"on": name, "events": events, "reply": match &reply { Ok(v) => json!({"ok": v}), Err(e) => json!({"err": e}) }}));
    reply
}

fn commands(cfg: &Settings, clip: &Value) -> Vec<Command> {
    vec![
        Command::ConnectDb { pg: None },
        Command::ListDemos,
        Command::DescribeFilters,
        Command::StartPreview { cfg: cfg.clone() },
        Command::ClipCameras { clip: clip.clone() },
        Command::ExportPreview { format: "html".into() },
    ]
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (config, settings, out) = (read_json(&args[1]), read_json(&args[2]), Path::new(&args[3]));
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("repository root");
    let out_dir = out.parent().expect("an output folder").canonicalize().expect("output folder exists");
    assert!(!out_dir.starts_with(&repo), "a scenario recorded on the author's data stays outside the repository");
    let cfg: Settings = serde_json::from_value(settings.get("cfg").unwrap_or(&settings).clone()).expect("settings object");

    let mut engine = RealEngine::start(config.as_object().expect("config object").clone(), Secrets::default(), None);
    let mut steps = Vec::new();
    let mut clip = Value::Null;
    for command in commands(&cfg, &Value::Null) {
        let command = match command {
            Command::ClipCameras { .. } => Command::ClipCameras { clip: clip.clone() },
            other => other,
        };
        let is_preview = matches!(command, Command::StartPreview { .. });
        let reply = record(&mut engine, command, &mut steps);
        println!("{:<16} {}", steps.last().unwrap()["on"].as_str().unwrap(), if reply.is_ok() { "ok" } else { "refused" });
        if is_preview {
            let ready = steps.last().unwrap()["events"].as_array().unwrap().iter().find(|e| e["state"]["name"] == "preview_ready").cloned();
            let first = ready.as_ref().and_then(|r| r["state"]["payload"]["sequences"].as_object()?.iter().next().map(|(dp, s)| (dp.clone(), s[0]["start_tick"].clone())));
            clip = first.map_or(json!({}), |(dp, tick)| json!({"demo_path": dp, "start_tick": tick}));
        }
    }
    let scenario = json!({"steps": steps});
    std::fs::write(out, serde_json::to_string_pretty(&scenario).expect("scenario JSON")).expect("write the scenario");

    // Replay: the scripted engine must accept every step and give the same replies.
    let mut scripted = ScriptedEngine::from_file(out).expect("the scenario loads");
    for step in &steps {
        let on = step["on"].as_str().unwrap();
        let command = commands(&cfg, &clip).into_iter().find(|c| c.name() == on).expect("a recorded command");
        let id = scripted.send(command);
        let got = loop {
            match scripted.events().recv_timeout(EVENT_TIMEOUT).expect("the scripted engine answers") {
                EngineEvent::Reply { id: g, result } if g == id => break result,
                EngineEvent::Ask(ask) => ask.reply.send(Some("ok".into())).expect("answer"),
                _ => {}
            }
        };
        let want = &step["reply"];
        assert_eq!(got.map_or_else(|e| json!({"err": e}), |v| json!({"ok": v})), *want, "replay of {on}");
    }
    println!("recorded {} steps to {} and replayed them", steps.len(), out.display());
}
