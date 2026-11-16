//! Records what the CAPTURE tab asks the engine (`connect_db`, `describe_filters`, `list_demos`) from
//! the real engine on the author's database (read-only), then ANONYMISES it so it may enter the
//! public repository (DECISIONS D-0015): every Steam ID becomes an impossible one (below the first
//! real SteamID64), every player name `Player NNN`, every demo path and name `demo-NNN`, every tag
//! name `Tag N`; maps, weapons, match types and the schema stay (public game and CS Demo Manager
//! names). Before writing, it checks that no original Steam ID, name or path survived.
//!
//!     cargo run --release -p csdm-engine --example record_capture -- <copy of csdm_config.json> <out.json>

use csdm_engine::{Command, Engine, EngineEvent, RealEngine, Secrets};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::Duration;

const EVENT_TIMEOUT: Duration = Duration::from_secs(900);
/// Kept so the fixture stays small: enough players for several pages, enough demos for the picker.
const KEEP_PLAYERS: usize = 150;
const KEEP_DEMOS: usize = 60;
/// Fake Steam IDs start here: below 76561197960265728, the first real SteamID64.
const FAKE_STEAM_BASE: u64 = 76_561_190_000_000_000;
const FAKE_DEMO_DIR: &str = "C:\\Demos";

fn reply(engine: &mut RealEngine, command: Command) -> Value {
    let name = command.name();
    let id = engine.send(command);
    loop {
        match engine.events().recv_timeout(EVENT_TIMEOUT).expect("the engine answers") {
            EngineEvent::Reply { id: got, result } if got == id => return result.unwrap_or_else(|e| panic!("{name} refused: {e}")),
            EngineEvent::Ask(ask) => ask.reply.send(Some("ok".into())).expect("answer"),
            _ => {}
        }
    }
}

#[derive(Default)]
struct Anon {
    ids: HashMap<String, String>,
    names: HashMap<String, String>,
    demos: HashMap<String, (String, String)>,
}

impl Anon {
    fn id(&mut self, real: &str) -> String {
        let n = self.ids.len() as u64 + 1;
        self.ids.entry(real.to_string()).or_insert_with(|| (FAKE_STEAM_BASE + n).to_string()).clone()
    }
    fn name(&mut self, real: &str) -> String {
        let n = self.names.len() + 1;
        self.names.entry(real.to_string()).or_insert_with(|| format!("Player {n:03}")).clone()
    }
    fn demo(&mut self, path: &str) -> (String, String) {
        let n = self.demos.len() + 1;
        self.demos.entry(path.to_string()).or_insert_with(|| (format!("{FAKE_DEMO_DIR}\\demo-{n:03}.dem"), format!("demo-{n:03}"))).clone()
    }
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        o => o.to_string(),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let config: Value = serde_json::from_str(&std::fs::read_to_string(&args[1]).expect("config copy")).expect("config JSON");
    let out = std::path::Path::new(&args[2]);
    let mut engine = RealEngine::start(config.as_object().expect("config object").clone(), Secrets::default(), None);
    let db = reply(&mut engine, Command::ConnectDb { pg: None });
    let mut tables = reply(&mut engine, Command::DescribeFilters);
    // The paths found on this machine name its user: the same examples as the SETTINGS tests.
    tables["data"]["default_paths"] = json!({"csdm_exe": "C:\\Users\\me\\AppData\\Local\\Programs\\cs-demo-manager\\csdm.CMD", "clips_dir": "C:\\Users\\me\\Videos\\CSDM Batch Clips"});
    let demos = reply(&mut engine, Command::ListDemos);

    let mut a = Anon::default();
    let mut d = db["data"].as_object().cloned().expect("discovery data");
    // Players: the most recently seen first, so the fixture keeps active accounts.
    let mut players: Vec<Value> = d["players"].as_array().cloned().unwrap_or_default();
    players.sort_by(|x, y| text(&y[3]).cmp(&text(&x[3])));
    let players: Vec<Value> = players.into_iter().take(KEEP_PLAYERS).map(|p| {
        let (id, name) = (a.id(&text(&p[1])), a.name(&text(&p[2])));
        json!([format!("{name}  ({id})"), id, name, p[3]])
    }).collect();
    d.insert("players".into(), Value::Array(players));
    let names: Map<String, Value> = d["names"].as_object().cloned().unwrap_or_default().into_iter().filter_map(|(k, v)| {
        let id = a.ids.get(&k)?.clone();
        Some((id, json!(a.name(&text(&v)))))
    }).collect();
    d.insert("names".into(), Value::Object(names));
    let tags: Vec<Value> = d["tags"].as_array().cloned().unwrap_or_default().into_iter().enumerate().map(|(i, t)| json!([t[0], format!("Tag {}", i + 1), t[2]])).collect();
    d.insert("tags".into(), Value::Array(tags));

    let rows: Vec<Value> = demos["data"]["demos"].as_array().cloned().unwrap_or_default().into_iter().take(KEEP_DEMOS).map(|r| {
        let (path, name) = a.demo(&text(&r["path"]));
        let mut r = r.as_object().cloned().expect("demo row");
        r.insert("path".into(), json!(path));
        r.insert("name".into(), json!(name));
        Value::Object(r)
    }).collect();

    let step = |on: &str, v: Value| json!({"on": on, "reply": {"ok": v}});
    let scenario = json!({"steps": [
        step("connect_db", json!({"data": Value::Object(d)})),
        step("describe_filters", tables),
        step("list_demos", json!({"data": {"demos": rows}})),
    ]});
    let body = serde_json::to_string_pretty(&scenario).expect("JSON");
    // Nothing real may survive in what carried people and files (the other parts are the schema and
    // the game's public names, where a player called "dust2" would be a false alarm): no original
    // Steam ID, player name (3+ characters) or demo path.
    // The fake words themselves are taken out first: a real player literally named "Player 1" is
    // found inside "Player 101" without anything having leaked.
    let mut carried = serde_json::to_string(&json!([scenario["steps"][0]["reply"]["ok"]["data"]["players"], scenario["steps"][0]["reply"]["ok"]["data"]["names"], scenario["steps"][0]["reply"]["ok"]["data"]["tags"], scenario["steps"][2]])).expect("JSON");
    let mut fakes: Vec<String> = a.ids.values().chain(a.names.values()).cloned().chain(a.demos.values().flat_map(|(p, n)| [p.replace('\\', "\\\\"), n.clone()])).collect();
    fakes.sort_by_key(|f| std::cmp::Reverse(f.len()));
    for f in &fakes {
        carried = carried.replace(f.as_str(), "");
    }
    let leaks: Vec<&str> = a.ids.keys().filter(|k| !k.is_empty()).chain(a.names.keys().filter(|n| n.chars().count() >= 3)).chain(a.demos.keys())
        .filter(|k| {
            let quoted = serde_json::to_string(k).expect("quoted");
            carried.contains(&quoted[1..quoted.len() - 1])
        })
        .map(String::as_str)
        .collect();
    for l in &leaks {
        // The kind and whether it is only a piece of the fake words, never the value itself.
        let kind = if a.ids.contains_key(*l) { "steam id" } else if a.names.contains_key(*l) { "name" } else { "demo path" };
        let fake_piece = ["Player ", "Tag ", "demo-", FAKE_DEMO_DIR].iter().any(|f| f.contains(*l)) || l.chars().all(|c| c.is_ascii_digit() || c == ' ');
        let quoted = serde_json::to_string(l).expect("quoted");
        let q = &quoted[1..quoted.len() - 1];
        let data = &scenario["steps"][0]["reply"]["ok"]["data"];
        let parts = [("players", data["players"].to_string()), ("names", data["names"].to_string()), ("tags", data["tags"].to_string()), ("demo rows", scenario["steps"][2].to_string())];
        let where_: Vec<&str> = parts.iter().filter(|(_, t)| t.contains(q)).map(|(n, _)| *n).collect();
        let fields: Vec<String> = scenario["steps"][2]["reply"]["ok"]["data"]["demos"].as_array().into_iter().flatten().flat_map(|r| r.as_object().into_iter().flatten().filter(|(_, v)| v.to_string().contains(q)).map(|(k, _)| k.clone())).collect();
        eprintln!("survived: {kind}, {} characters, fake piece: {fake_piece}, in {where_:?}, demo fields {fields:?}", l.chars().count());
    }
    assert!(leaks.is_empty(), "{} original values survived anonymisation", leaks.len());
    std::fs::write(out, body).expect("write the scenario");
    println!("recorded {} players, {} demos, anonymised", a.names.len().min(KEEP_PLAYERS), a.demos.len());
}
