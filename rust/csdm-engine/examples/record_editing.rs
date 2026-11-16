//! Records what the EDITING tab's driven tests replay (`csdm-app/tests/fixtures/editing.json`),
//! from the real engine, never by hand (spec « moteur scénarisé »): the shared connection, the
//! run-inputs check, one preview, the cameras of one clip after each of three edits, a preset saved with an EDITING
//! selection then loaded, and a preview that finds nothing.
//!
//! The database is only read; settings and presets live in a throwaway copy of the given 3.5
//! settings folder. What is written is anonymised (demo paths, SteamIDs, names) and reduced to
//! the fields the tab reads; the run fails if anything of the source data is left in it.
//!
//!     cargo run -p csdm-engine --example record_editing -- <3.5 settings folder> <out.json> [settings to override, as JSON]
//!
//! The preview must hold more than 10 demos and 100 clips (two pages of each view): when the
//! folder's own settings find fewer, widen them with the third argument, e.g. `{"date_from": "", "date_to": ""}`.

use csdm_core::values::{CONFIG_FILES, CONFIG_SUBDIR};
use csdm_core::Settings;
use csdm_engine::event::StateName;
use csdm_engine::import35::SearchPlaces;
use csdm_engine::settings_home::SettingsHome;
use csdm_engine::{Command, Engine, EngineEvent, RealEngine, Secrets};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

/// Longest wait for one event (a first preview reads every demo file it needs).
const EVENT_TIMEOUT: Duration = Duration::from_secs(1800);
/// Enough for two pages of lanes and two pages of the list.
const MIN_DEMOS: usize = 12;
const MIN_CLIPS: usize = 110;
const MAX_DEMOS: usize = 60;
/// Below every real SteamID64 (the first is 76561197960265728).
const FAKE_ID_BASE: u64 = 76_561_197_000_000_000;
const FIRST_REAL_ID: u64 = 76_561_197_960_265_728;
const ID_DIGITS: usize = 17;
const EVENT_FIELDS: [&str; 5] = ["tick", "type", "killer_sid", "victim_sid", "attacker_sid"];
const KEPT_STATES: [StateName; 6] = [StateName::PreviewStarted, StateName::ButtonsBusy, StateName::Buttons, StateName::Summary, StateName::PreviewReady, StateName::ButtonsIdle];
const PRESET: &str = "t8-editing";
const NO_DEMO_DATE: &str = "01-01-1990";

/// Sends `command`; returns its reply and the states it emitted (a started preview: until idle).
fn ask(engine: &mut RealEngine, command: Command) -> (Result<Value, String>, Vec<(StateName, Value)>) {
    let is_preview = matches!(command, Command::StartPreview { .. });
    let id = engine.send(command);
    let (mut states, mut reply) = (Vec::new(), None);
    loop {
        match engine.events().recv_timeout(EVENT_TIMEOUT).expect("the engine answers") {
            EngineEvent::Reply { id: got, result } if got == id => {
                let started = result.as_ref().is_ok_and(|v| v["started"] == json!(true));
                reply = Some(result);
                if !(is_preview && started) {
                    break;
                }
            }
            EngineEvent::State { name, payload } => {
                let idle = name == StateName::ButtonsIdle;
                states.push((name, payload));
                if idle && reply.is_some() {
                    break;
                }
            }
            EngineEvent::Ask(ask) => ask.reply.send(Some("ok".into())).expect("the engine waits for the answer"),
            _ => {}
        }
    }
    (reply.expect("a reply"), states)
}

#[derive(Default)]
struct Anon {
    ids: HashMap<String, String>,
    names: HashMap<String, String>,
    demos: HashMap<String, String>,
}

impl Anon {
    fn id(&mut self, real: &str) -> String {
        if real.is_empty() {
            return String::new();
        }
        let n = self.ids.len() as u64 + 1;
        self.ids.entry(real.to_string()).or_insert_with(|| (FAKE_ID_BASE + n).to_string()).clone()
    }

    fn name(&mut self, real: &str) -> String {
        if real.is_empty() {
            return String::new();
        }
        let n = self.names.len() + 1;
        self.names.entry(real.to_string()).or_insert_with(|| format!("Player {n}")).clone()
    }

    fn demo(&mut self, real: &str) -> String {
        let n = self.demos.len() + 1;
        self.demos.entry(real.to_string()).or_insert_with(|| format!("C:/demos/match-{n:02}.dem")).clone()
    }

    /// `event_key`: "tick:type:victim".
    fn key(&mut self, real: &str) -> String {
        let mut parts: Vec<String> = real.splitn(3, ':').map(String::from).collect();
        if let Some(victim) = parts.get(2).cloned() {
            parts[2] = self.id(&victim);
        }
        parts.join(":")
    }

    fn event(&mut self, e: &Value) -> Value {
        let mut out = Map::new();
        for f in EVENT_FIELDS {
            match e.get(f) {
                None | Some(Value::Null) => {}
                Some(v) if f.ends_with("_sid") => {
                    out.insert(f.into(), self.id(&text(v)).into());
                }
                Some(v) => {
                    out.insert(f.into(), v.clone());
                }
            }
        }
        Value::Object(out)
    }

    fn cameras(&mut self, spans: &Value) -> Value {
        spans.as_array().map_or(Value::Null, |a| a.iter().map(|c| json!({"from_tick": c["from_tick"], "to_tick": c["to_tick"], "steam_id": self.id(&text(&c["steam_id"])), "name": self.name(&text(&c["name"]))})).collect())
    }

    fn entry(&mut self, e: &Value) -> Value {
        let mut out = e.as_object().expect("an entry").clone();
        out.insert("demo_path".into(), self.demo(e["demo_path"].as_str().expect("demo_path")).into());
        if let Some(keys) = e.get("excluded_events").and_then(Value::as_array) {
            out.insert("excluded_events".into(), keys.iter().map(|k| Value::from(self.key(k.as_str().expect("an event key")))).collect());
        }
        Value::Object(out)
    }

    /// The preview payload, reduced to `demos` and to the fields the tab reads.
    fn payload(&mut self, p: &Value, demos: &[String]) -> Value {
        let (mut events, mut sequences) = (Map::new(), Map::new());
        for dp in demos {
            let name = self.demo(dp);
            let pool: Vec<Value> = p["events"][dp].as_array().into_iter().flatten().map(|e| self.event(e)).collect();
            let mut rows = Vec::new();
            for s in p["sequences"][dp].as_array().into_iter().flatten() {
                let evs: Vec<Value> = s["events"].as_array().into_iter().flatten().map(|e| if e.is_number() { e.clone() } else { json!({"copy": self.event(&e["copy"])}) }).collect();
                let keys: Vec<Value> = s["event_keys"].as_array().into_iter().flatten().map(|k| Value::from(self.key(k.as_str().unwrap_or_default()))).collect();
                let mut row = json!({"start_tick": s["start_tick"], "end_tick": s["end_tick"], "event_type": s["event_type"], "event_keys": keys, "camera_segments": self.cameras(&s["camera_segments"]), "events": evs});
                if let Some(types) = s.get("event_types") {
                    row["event_types"] = types.clone();
                }
                rows.push(row);
            }
            events.insert(name.clone(), pool.into());
            sequences.insert(name, rows.into());
        }
        json!({"cfg": {"tickrate": p["cfg"]["tickrate"]}, "events": events, "sequences": sequences, "empty_reason": p["empty_reason"]})
    }
}

fn text(v: &Value) -> String {
    v.as_str().map_or_else(|| if v.is_null() { String::new() } else { v.to_string() }, String::from)
}

fn states_json(states: &[(StateName, Value)], ready: &Value) -> Value {
    states
        .iter()
        .filter(|(n, _)| KEPT_STATES.contains(n))
        .map(|(n, p)| json!({"state": {"name": n, "payload": if *n == StateName::PreviewReady { ready.clone() } else { p.clone() }}}))
        .collect()
}

fn ready(states: &[(StateName, Value)]) -> &Value {
    &states.iter().find(|(n, _)| *n == StateName::PreviewReady).expect("the preview finished (see the engine's console lines)").1
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (source, out) = (Path::new(&args[1]), Path::new(&args[2]));
    // A throwaway profile: the 3.5 files are copied, the 5.x folder is created beside the copy.
    let profile = tempfile::tempdir().expect("a temporary folder");
    let old = profile.path().join(CONFIG_SUBDIR);
    std::fs::create_dir_all(&old).expect("profile folder");
    for f in CONFIG_FILES {
        if source.join(f).is_file() {
            std::fs::copy(source.join(f), old.join(f)).expect("copy of a 3.5 settings file");
        }
    }
    let places = SearchPlaces { explicit_root: Some(profile.path().into()), exe_dir: None, local_app_data: Some(profile.path().join("lad")) };
    let (home, _) = SettingsHome::open(&places, Secrets::default()).expect("the throwaway settings folder opens");
    let mut cfg: Settings = home.load_config().expect("settings")["data"].as_object().expect("settings object").clone();
    if let Some(overrides) = args.get(3) {
        let overrides: Value = serde_json::from_str(overrides).expect("the overrides are a JSON object");
        cfg.extend(overrides.as_object().expect("the overrides are a JSON object").clone());
    }
    let mut engine = RealEngine::start_with_home(cfg.clone(), Secrets::default(), None, Some(home));
    let mut anon = Anon::default();

    let (connected, _) = ask(&mut engine, Command::ConnectDb { pg: None });
    let connected = connected.expect("the database answers (read-only)");
    println!("connect_db       ok");
    let (inputs, _) = ask(&mut engine, Command::RunInputsProblem { cfg: cfg.clone() });
    let inputs = inputs.expect("the run-inputs check answers");
    assert!(inputs["problem"].is_null(), "these settings cannot start a preview: {}", inputs["problem"]);

    let (reply, states) = ask(&mut engine, Command::StartPreview { cfg: cfg.clone() });
    let preview_reply = reply.expect("the preview starts");
    let real = ready(&states).clone();
    let all: Vec<(String, usize)> = real["sequences"].as_object().expect("sequences").iter().map(|(dp, s)| (dp.clone(), s.as_array().map_or(0, Vec::len))).filter(|(_, n)| *n > 0).collect();
    let (mut demos, mut clips) = (Vec::new(), 0);
    for (dp, n) in &all {
        if (demos.len() >= MIN_DEMOS && clips >= MIN_CLIPS) || demos.len() >= MAX_DEMOS {
            break;
        }
        demos.push(dp.clone());
        clips += n;
    }
    println!("start_preview    ok: {} demos / {} clips in the preview, {} / {clips} kept", all.len(), all.iter().map(|d| d.1).sum::<usize>(), demos.len());
    assert!(demos.len() > 10 && clips > 100, "the preview is too small for two pages of lanes and of the list: record with wider settings");

    // The clip the tests edit: the first kept one with two events or more (else the first one).
    let rate = real["cfg"]["tickrate"].as_i64().expect("tickrate") as f64;
    let candidates: Vec<(&String, &Value)> = demos.iter().flat_map(|dp| real["sequences"][dp].as_array().into_iter().flatten().map(move |s| (dp, s))).collect();
    let (dp, seq) = candidates.iter().find(|(_, s)| s["events"].as_array().is_some_and(|e| e.len() > 1)).unwrap_or(&candidates[0]);
    let tick_of = |e: &Value| if e.is_number() { real["events"][dp.as_str()][e.as_u64().expect("a position") as usize]["tick"].as_i64() } else { e["copy"]["tick"].as_i64() }.expect("an event tick");
    let events = seq["events"].as_array().expect("events");
    let (start, end) = (seq["start_tick"].as_i64().expect("start"), seq["end_tick"].as_i64().expect("end"));
    let lead_s = ((tick_of(&events[0]) - start) as f64 / rate).round() as i64;
    let tail_s = ((end - tick_of(&events[events.len() - 1])) as f64 / rate).round() as i64;
    let address = json!({"demo_path": dp, "start_tick": start});
    let mut edits = vec![json!({"after_s": tail_s + 1}), json!({"after_s": tail_s + 1, "before_s": lead_s + 1})];
    if events.len() > 1 {
        edits.push(json!({"after_s": tail_s + 1, "before_s": lead_s + 1, "excluded_events": [seq["event_keys"][0]]}));
    }
    let mut cameras = Vec::new();
    let mut last_entry = address.clone();
    for edit in &edits {
        let mut entry = address.as_object().expect("address").clone();
        entry.extend(edit.as_object().expect("edit").clone());
        last_entry = Value::Object(entry);
        let (reply, _) = ask(&mut engine, Command::ClipCameras { clip: last_entry.clone() });
        let reply = reply.expect("the cameras of the edited clip");
        cameras.push(json!({"clip": anon.entry(&last_entry), "reply": {"ok": {"cameras": anon.cameras(&reply["cameras"])}}}));
    }
    println!("clip_cameras     ok: {} edits of a clip with {} event(s)", edits.len(), events.len());

    // A preset holding the edited clip and one plain clip, then loaded against this preview.
    let other = candidates.iter().find(|(d, s)| !(d == dp && s["start_tick"] == seq["start_tick"])).expect("a second clip");
    let saved = json!([last_entry, {"demo_path": other.0, "start_tick": other.1["start_tick"]}]);
    let (reply, _) = ask(&mut engine, Command::SavePreset { preset: PRESET.into(), cats: vec!["full".into()], cfg: cfg.clone(), selected_clips: Some(saved.clone()), ask_name: false });
    reply.expect("the preset is saved in the throwaway folder");
    let (reply, _) = ask(&mut engine, Command::LoadPreset { preset: PRESET.into() });
    let loaded = reply.expect("the preset loads");
    let restored: Vec<Value> = loaded["selected_clips"].as_array().expect("the selection is restored against the last preview").iter().map(|e| anon.entry(e)).collect();
    println!("save/load preset ok: {} clip(s) restored", restored.len());

    // A preview that finds nothing: no demo is that old.
    let mut none = cfg.clone();
    none.insert("date_from".into(), NO_DEMO_DATE.into());
    none.insert("date_to".into(), NO_DEMO_DATE.into());
    let (reply, empty_states) = ask(&mut engine, Command::StartPreview { cfg: none });
    let empty_reply = reply.expect("the empty preview starts");
    let empty = ready(&empty_states);
    assert!(empty["sequences"].as_object().is_none_or(|s| s.values().all(|v| v.as_array().is_none_or(Vec::is_empty))), "the dated preview found clips");
    assert!(empty["empty_reason"]["headline"].is_string(), "an empty preview explains itself");
    println!("empty preview    ok: {}", empty["empty_reason"]["headline"]);

    let payload = anon.payload(&real, &demos);
    let known: Vec<(String, String)> = connected["data"]["players"].as_array().into_iter().flatten().map(|row| (text(&row[1]), text(&row[2]))).filter(|(id, _)| anon.ids.contains_key(id)).collect();
    let mut players = Vec::new();
    for (id, name) in known {
        let name = anon.name(&name);
        players.push(json!([name, anon.id(&id), name, ""]));
    }
    let load_reply = json!({"ok": {"data": {"before": loaded["data"]["before"], "after": loaded["data"]["after"]}, "keys": ["before", "after"], "selected_clips": restored}});
    let empty_payload = json!({"cfg": {"tickrate": empty["cfg"]["tickrate"]}, "events": {}, "sequences": {}, "empty_reason": empty["empty_reason"]});
    let saved_anon: Vec<Value> = saved.as_array().expect("entries").iter().map(|e| anon.entry(e)).collect();
    let fixture = json!({
        "about": "Recorded from the real engine by csdm-engine/examples/record_editing.rs, anonymised and reduced to the fields the EDITING tab reads. Do not edit by hand: record again.",
        "connect_db": {"ok": {"data": {"players": players}}},
        "run_inputs_problem": {"ok": inputs},
        "preview": {"events": states_json(&states, &payload), "reply": {"ok": preview_reply}},
        "clip": {"address": anon.entry(&address), "lead_s": lead_s, "tail_s": tail_s, "events": events.len()},
        "cameras": cameras,
        "preset": {"name": PRESET, "saved": saved_anon, "load_reply": load_reply},
        "empty": {"events": states_json(&empty_states, &empty_payload), "reply": {"ok": empty_reply}},
    });
    let written = serde_json::to_string_pretty(&fixture).expect("fixture JSON");

    // Nothing of the source data may be left: no real SteamID, name or demo path.
    let digits: Vec<char> = written.chars().collect();
    let mut at = 0;
    while at < digits.len() {
        let run: String = digits[at..].iter().take_while(|c| c.is_ascii_digit()).collect();
        assert!(!(run.len() == ID_DIGITS && run.parse::<u64>().is_ok_and(|n| n >= FIRST_REAL_ID)), "a real SteamID is left in the fixture");
        at += run.len().max(1);
    }
    for real_name in anon.names.keys().filter(|n| n.chars().count() > 3) {
        assert!(!written.contains(real_name.as_str()), "a player name is left in the fixture");
    }
    for real_demo in anon.demos.keys() {
        let stem = Path::new(real_demo).file_stem().and_then(|s| s.to_str()).unwrap_or(real_demo);
        assert!(!written.contains(stem), "a demo name is left in the fixture");
    }
    std::fs::write(out, written).expect("write the fixture");
    println!("recorded {} demos, {clips} clips, {} players to {}", demos.len(), players.len(), out.display());
}
