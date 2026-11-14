//! T3 clips stage self-check: replays the clips half of every golden preview (`rust/tools/t3_golden_refs.py`)
//! from the events 3.5 handed to `_preview_sequences`, and compares sequences, payload, summary,
//! empty-result explanation, export rows, EDITING cameras and run-input problems. Read-only.
//!
//!     cargo run --release -p csdm-engine --example t3_clips_check -- <refs dir> <copy of csdm_config.json>
//!
//! Demo dates come from the real demo files and the database (`list_all_demos` fills the dates the
//! SQL stage would). Names read in a demo are taken where 3.5 parsed the demo files (a dp2 filter on).
//! With `CSDM_REFERENCE_PYTHON` set, `describe_filters` is also compared with 3.5's.

use csdm_core::preview::preview;
use csdm_core::registries::registries;
use csdm_core::Settings;
use csdm_db::{Db, PgParams};
use csdm_demo::Demo;
use csdm_engine::preview::cfg::build_run_cfg;
use csdm_engine::preview::clips::{self, LastPreview};
use csdm_engine::preview::dp2::DemoStore;
use csdm_engine::preview::{Ctx, DemoEvents, Event, NoPorts};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// Filters 3.5 reads in the demo files besides those with sections in the table (correction (e)).
const DEATH_SECTION_FILTERS: [&str; 2] = ["kill_mod_wall_bang", "kill_mod_attacker_blind"];

/// serde_json's default float reader (no `float_roundtrip` feature in the workspace) can land one or
/// two units of the last place away from the value Python wrote: such a pair is counted, not failed.
static FLOAT_READ: AtomicUsize = AtomicUsize::new(0);
const FLOAT_READ_ULPS: u64 = 2;

fn same_number(x: &serde_json::Number, y: &serde_json::Number) -> bool {
    let (Some(a), Some(b)) = (x.as_f64(), y.as_f64()) else { return x == y };
    if a == b {
        return true;
    }
    let near = a.is_sign_positive() == b.is_sign_positive() && a.to_bits().abs_diff(b.to_bits()) <= FLOAT_READ_ULPS;
    if near {
        FLOAT_READ.fetch_add(1, Ordering::Relaxed);
    }
    near
}

/// Equal as JSON trees, numbers by value (`3 == 3.0`), key order ignored.
fn first_diff(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let (kx, ky): (BTreeSet<_>, BTreeSet<_>) = (x.keys().collect(), y.keys().collect());
            if kx != ky {
                return Some(format!("{path}: keys {kx:?} != {ky:?}"));
            }
            x.iter().find_map(|(k, v)| first_diff(v, &y[k], &format!("{path}.{k}")))
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{path}: {} items != {}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().find_map(|(i, (u, v))| first_diff(u, v, &format!("{path}[{i}]")))
        }
        (Value::Number(x), Value::Number(y)) if same_number(x, y) => None,
        _ if a == b => None,
        _ => Some(format!("{path}: 3.5 {} / Rust {}", short(a), short(b))),
    }
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    if s.chars().count() > 160 { format!("{}…", s.chars().take(160).collect::<String>()) } else { s }
}

/// A golden event back into the arena (`_mf` list → set).
fn to_event(v: &Value) -> Event {
    let mut fields = v.as_object().expect("an event is an object").clone();
    let mf = fields.remove("_mf").map(|m| m.as_array().expect("_mf is a list").iter().map(|k| k.as_str().expect("a filter key").to_string()).collect());
    Event { fields, mf }
}

/// Whether 3.5 parsed the demo files in this preview (`_dp2_required_sections` non-empty).
fn reads_demo_files(cfg: &Settings) -> bool {
    let table = &preview()["filters"];
    registries().kill_filters.iter().any(|f| {
        let on = |k: &str| cfg.get(k).is_some_and(csdm_core::migrate::truthy);
        let sections = !table[&f.key]["dp2_sections"].as_array().is_none_or(Vec::is_empty) || DEATH_SECTION_FILTERS.contains(&f.key.as_str());
        sections && (on(&f.key) || on(&format!("{}_exclude", f.key)))
    })
}

/// 3.5 `parse_player_info` names: SteamID text → name, both non-empty. `None` when unreadable.
fn demo_names(path: &str, cache: &mut HashMap<String, Option<HashMap<String, String>>>, odd: &mut usize) -> Option<HashMap<String, String>> {
    cache
        .entry(path.to_string())
        .or_insert_with(|| {
            let players = Demo::open(Path::new(path)).and_then(|d| d.players()).ok()?;
            if players.iter().any(|p| p.steamid.is_none()) {
                *odd += 1; // pandas would turn the whole column into floats: not reproduced, counted
            }
            Some(
                players
                    .into_iter()
                    .filter_map(|p| Some((p.steamid?.to_string(), p.name.filter(|n| !n.is_empty())?)))
                    .filter(|(s, _)| !s.is_empty())
                    .collect(),
            )
        })
        .clone()
}

#[derive(Default)]
struct Tally {
    cases: usize,
    checks: BTreeMap<&'static str, (usize, usize)>,
    diffs: Vec<String>,
}

impl Tally {
    fn check(&mut self, case: &str, what: &'static str, want: &Value, got: &Value) {
        let e = self.checks.entry(what).or_default();
        e.0 += 1;
        match first_diff(want, got, what) {
            None => e.1 += 1,
            Some(d) => self.diffs.push(format!("{case}: {d}")),
        }
    }
}

fn describe_filters_check(tally: &mut Tally) {
    let Ok(python) = std::env::var("CSDM_REFERENCE_PYTHON") else {
        println!("describe_filters: skipped (CSDM_REFERENCE_PYTHON unset)");
        return;
    };
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let profile = std::env::temp_dir().join("csdm_t3_clips_check_profile");
    let out = std::process::Command::new(python)
        .arg("-c")
        .arg("import json, sys; sys.path.insert(0, sys.argv[1]); from csdm.bridge.tables import describe_filters; sys.stdout.buffer.write(json.dumps(describe_filters()).encode())")
        .arg(&repo)
        .env("CSDM_PROFILE_ROOT", &profile)
        .output()
        .expect("python runs");
    assert!(out.status.success(), "describe_filters in 3.5 failed: {}", String::from_utf8_lossy(&out.stderr));
    let want: Value = serde_json::from_slice(&out.stdout).expect("3.5 describe_filters is JSON");
    tally.check("describe_filters", "describe_filters", &want, &clips::describe_filters());
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (refs, cfg_path) = (Path::new(&args[1]), &args[2]);
    let user: Value = serde_json::from_str(&std::fs::read_to_string(cfg_path).expect("config copy")).expect("config JSON");
    let mut db = Db::connect(&PgParams::from_settings(user.as_object().expect("config object")).expect("connection settings")).unwrap_or_else(|e| panic!("{e}"));
    let disc = db.discover().unwrap_or_else(|e| panic!("{e}"));
    let (store, cancel) = (DemoStore::default(), AtomicBool::new(false));

    // The dates the SQL stage would cache, from the demo list (which this also exercises).
    let (dates, maps, ts, n_demos) = {
        let mut cx = Ctx::new(&mut db, &disc, &NoPorts, &store, &cancel);
        let listed = clips::list_all_demos(&mut cx).unwrap_or_else(|e| panic!("{e}"));
        (cx.host.demo_dates.clone(), cx.host.demo_maps.clone(), cx.host.ts.clone(), listed.len())
    };
    println!("list_all_demos: {n_demos} demos listed");

    let mut tally = Tally::default();
    describe_filters_check(&mut tally);
    let mut names_cache = HashMap::new();
    let mut odd_names = 0;
    // Camera spans whose 3.5 name is the in-demo one and differs from the database's: proof the
    // demo-name path is exercised, not only the database fallback.
    let db_names: HashMap<&str, &str> = disc.names.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let mut demo_named = 0;
    let mut files: Vec<_> = std::fs::read_dir(refs.join("cases")).expect("cases folder").map(|e| e.expect("entry").path()).collect();
    files.sort();
    for file in files {
        let rec: Value = serde_json::from_str(&std::fs::read_to_string(&file).expect("case file")).expect("case JSON");
        let case = format!("{} {}", file.file_stem().unwrap().to_string_lossy(), rec["name"].as_str().unwrap_or(""));
        let raw: Settings = serde_json::from_value(rec["cfg"].clone()).expect("case cfg");
        let cfg = build_run_cfg(&raw);
        let result = &rec["result"];
        tally.cases += 1;
        let problem = clips::run_inputs_problem(&cfg).map_or(Value::Null, Value::String);
        tally.check(&case, "problem", result.get("problem").unwrap_or(&Value::Null), &problem);
        let Some(events) = result.get("events").and_then(Value::as_object) else { continue };

        let mut cx = Ctx::new(&mut db, &disc, &NoPorts, &store, &cancel);
        // 3.5 caches database dates from the kills and rounds queries only (core.py `_query_events`),
        // never from the damages or shots queries.
        let on = |k: &str| cfg.get(k).is_some_and(csdm_core::migrate::truthy);
        if on("_events_lethal") || on("_events_rounds") {
            cx.host.demo_dates = dates.clone();
        }
        cx.host.demo_maps = maps.clone();
        cx.host.ts = ts.clone();
        let mut evts = DemoEvents::new();
        for (dp, evs) in events {
            evts.insert(dp.clone(), evs.as_array().expect("events list").iter().map(|e| cx.arena.add(to_event(e))).collect());
        }
        if reads_demo_files(&cfg) {
            for dp in evts.keys().filter(|dp| Path::new(dp).is_file()) {
                if let Some(n) = demo_names(dp, &mut names_cache, &mut odd_names) {
                    for seg in result["sequences"][dp].as_array().into_iter().flatten().flat_map(|s| s["camera_segments"].as_array().into_iter().flatten()) {
                        let (sid, name) = (seg["steam_id"].as_str().unwrap_or(""), seg["name"].as_str().unwrap_or(""));
                        if n.get(sid).is_some_and(|d| d == name && db_names.get(sid).is_none_or(|b| *b != name)) {
                            demo_named += 1;
                        }
                    }
                    cx.host.demo_names.insert(dp.clone(), n);
                }
            }
        }
        let seqs = match clips::preview_sequences(&mut cx, &evts, &cfg) {
            Ok(s) => s,
            Err(e) => {
                tally.diffs.push(format!("{case}: preview_sequences failed: {e}"));
                continue;
            }
        };
        let payload = clips::payload(&cx, &evts, &seqs);
        tally.check(&case, "events", &json!(events), &payload["events"]);
        tally.check(&case, "sequences", &result["sequences"], &payload["sequences"]);

        let tickrate = cfg["tickrate"].as_i64().expect("tickrate");
        let (nb_clips, total, avg) = clips::sequence_totals(&seqs, tickrate);
        if nb_clips > 0 {
            let nb_demos = seqs.values().filter(|s| !s.is_empty()).count();
            let mut summary = json!({"text": clips::fmt_summary(nb_demos, nb_clips, total, avg), "level": "ok"});
            summary.as_object_mut().unwrap().extend(clips::summary_counts(nb_demos, nb_clips, total, avg).as_object().unwrap().clone());
            tally.check(&case, "summary", &result["summary"], &summary);
            tally.check(&case, "empty_reason", &result["empty_reason"], &Value::Null);
        } else {
            let stages: Vec<(String, usize)> = result["empty_reason"]["stages"]
                .as_array()
                .expect("an empty preview is explained")
                .iter()
                .map(|s| (s["label"].as_str().unwrap().to_string(), s["count"].as_u64().unwrap() as usize))
                .collect();
            let split = stages[0].0 != "database query";
            let counts = if split { vec![("database query".to_string(), 0)] } else { stages.clone() };
            // The SQL stage counts each query stage; 3.5's counts are replayed in order.
            let rest = preview()["empty_result"]["rest_label"].as_str().expect("rest_label");
            let mut replay = stages.iter().filter(|s| s.0 != rest).map(|s| s.1);
            let got = clips::explain_empty_result_with(&NoPorts, &cfg, &counts, &mut |_| Ok(replay.next().expect("no more queries than 3.5 ran")));
            match got {
                Ok(v) => {
                    tally.check(&case, "empty_reason", &result["empty_reason"], &v);
                    tally.check(&case, "summary", &result["summary"], &json!({"text": v["headline"], "level": "muted"}));
                }
                Err(e) => tally.diffs.push(format!("{case}: explain_empty_result failed: {e}")),
            }
        }

        let last = LastPreview::new(&mut cx, seqs, &cfg);
        let rows = clips::preview_clip_rows(&last);
        let want_rows = result["export_rows"].as_array().expect("export rows");
        if let Some(i) = want_rows.iter().zip(&rows).position(|(w, g)| w["demo_path"] != g["demo_path"]) {
            let (w, g) = (&want_rows[i], &rows[i]);
            println!("{case}: demo order differs at row {i}: 3.5 {} ({}) / Rust {} ({})", w["demo_path"], w["date"], g["demo_path"], g["date"]);
        }
        tally.check(&case, "export_rows", &result["export_rows"], &Value::Array(rows));
        for cc in result["clip_cameras"].as_array().into_iter().flatten() {
            let got = clips::edited_clip_cameras(Some(&last), &disc, &cc["entry"]).map(|c| c.map_or(Value::Null, |s| s.iter().map(clips::Segment::to_json).collect()));
            match got {
                Ok(v) => tally.check(&case, "clip_cameras", &cc["cameras"], &v),
                Err(e) => tally.diffs.push(format!("{case}: edited_clip_cameras failed: {e}")),
            }
        }
    }

    println!("cases: {}", tally.cases);
    for (what, (n, ok)) in &tally.checks {
        println!("{what:<16} {ok:>4} / {n:<4} match");
    }
    println!("camera spans named from the demo (not the database) in 3.5: {demo_named}");
    if odd_names > 0 {
        println!("demos whose player list has a missing SteamID (3.5 names differ there): {odd_names}");
    }
    println!("numbers within {FLOAT_READ_ULPS} ulp (JSON float reading): {}", FLOAT_READ.load(Ordering::Relaxed));
    println!("differences: {}", tally.diffs.len());
    for d in tally.diffs.iter().take(60) {
        println!("DIFF {d}");
    }
}
