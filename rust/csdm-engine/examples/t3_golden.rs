//! T3 golden bench, stage 1 (decisions/08): the whole Rust preview against the 3.5 engine's, case by
//! case (`rust/tools/t3_golden_refs.py` writes the references). Read-only on the author's data.
//!
//!     cargo run --release -p csdm-engine --example t3_golden -- <refs dir> <copy of csdm_config.json> [first-last]
//!
//! Each case runs on a fresh `Ctx` (as each 3.5 reference ran on a fresh host); the demo store is
//! shared across cases, as the engine shares it across previews. Compared, as JSON trees (numbers by
//! value, `_chk` left out): refused inputs, events, sequences, empty-result explanation, summary,
//! export rows, EDITING cameras.

use csdm_core::Settings;
use csdm_db::{Db, PgParams};
use csdm_engine::event::StateName;
use csdm_engine::preview::cfg::build_run_cfg;
use csdm_engine::preview::dp2::DemoStore;
use csdm_engine::preview::{clips, worker, CollectPorts, Ctx};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;

/// serde_json's default float reader can land one or two units of the last place away from the
/// value Python wrote: such a pair is counted, not failed.
static FLOAT_READ: AtomicUsize = AtomicUsize::new(0);
const FLOAT_READ_ULPS: u64 = 2;
const SHOWN_DIFFS: usize = 80;

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

/// First difference between two JSON trees (numbers by value, key order ignored, `_chk` skipped).
fn first_diff(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let keys = |m: &serde_json::Map<String, Value>| m.keys().filter(|k| *k != "_chk").cloned().collect::<BTreeSet<_>>();
            let (kx, ky) = (keys(x), keys(y));
            if kx != ky {
                return Some(format!("{path}: keys 3.5 {kx:?} / Rust {ky:?}"));
            }
            kx.iter().find_map(|k| first_diff(&x[k], &y[k], &format!("{path}.{k}")))
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                let at = x.iter().zip(y).position(|(u, v)| first_diff(u, v, "").is_some());
                return Some(format!("{path}: {} items / Rust {} (first differing item: {at:?})", x.len(), y.len()));
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
    if s.chars().count() > 200 { format!("{}…", s.chars().take(200).collect::<String>()) } else { s }
}

#[derive(Default)]
struct Tally {
    checks: BTreeMap<&'static str, (usize, usize)>,
    diffs: Vec<String>,
    failed_cases: BTreeSet<String>,
}

impl Tally {
    fn check(&mut self, case: &str, what: &'static str, want: &Value, got: &Value) {
        let entry = self.checks.entry(what).or_default();
        entry.0 += 1;
        match first_diff(want, got, what) {
            None => entry.1 += 1,
            Some(d) => {
                self.diffs.push(format!("{case}: {d}"));
                self.failed_cases.insert(case.to_string());
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (refs, cfg_path) = (Path::new(&args[1]), &args[2]);
    let range = args.get(3).map(|r| {
        let (a, b) = r.split_once('-').unwrap_or((r, r));
        (a.parse::<usize>().expect("range start"), b.parse::<usize>().expect("range end"))
    });
    let user: Value = serde_json::from_str(&std::fs::read_to_string(cfg_path).expect("config copy")).expect("config JSON");
    let params = PgParams::from_settings(user.as_object().expect("config object")).expect("connection settings");
    let mut db = Db::connect(&params).unwrap_or_else(|e| panic!("{e}"));
    let mut reconnects = 0;
    let disc = db.discover().unwrap_or_else(|e| panic!("{e}"));
    let (store, cancel) = (DemoStore::default(), AtomicBool::new(false));

    let mut tally = Tally::default();
    let mut files: Vec<_> = std::fs::read_dir(refs.join("cases")).expect("cases folder").map(|e| e.expect("entry").path()).collect();
    files.sort();
    let started = Instant::now();
    for file in files {
        let rec: Value = serde_json::from_str(&std::fs::read_to_string(&file).expect("case file")).expect("case JSON");
        let index = rec["index"].as_u64().expect("case index") as usize;
        if range.is_some_and(|(a, b)| index < a || index > b) {
            continue;
        }
        let case = format!("{index:04} {}", rec["name"].as_str().unwrap_or(""));
        let raw: Settings = serde_json::from_value(rec["cfg"].clone()).expect("case cfg");
        let cfg = build_run_cfg(&raw);
        let result = &rec["result"];
        let t = Instant::now();
        let problem = clips::run_inputs_problem(&cfg).map_or(Value::Null, Value::String);
        tally.check(&case, "problem", result.get("problem").unwrap_or(&Value::Null), &problem);
        if result.get("events").is_none() {
            continue;
        }
        // As the engine does (3.5 `_pg`): a session the server closed is reopened before the next case.
        if db.is_closed() {
            db = Db::connect(&params).unwrap_or_else(|e| panic!("{e}"));
            reconnects += 1;
        }
        let ports = CollectPorts::default();
        let mut cx = Ctx::new(&mut db, &disc, &ports, &store, &cancel);
        let Some(outcome) = worker::run_preview(&mut cx, &cfg) else {
            let logs = ports.logs.lock().unwrap();
            let why = logs.iter().rev().find(|(_, l)| *l == csdm_engine::event::Level::Err).map_or("no outcome", |(m, _)| m.as_str());
            tally.diffs.push(format!("{case}: preview failed: {why}"));
            tally.failed_cases.insert(case.clone());
            continue;
        };
        drop(cx);
        tally.check(&case, "events", &result["events"], &outcome.payload["events"]);
        tally.check(&case, "sequences", &result["sequences"], &outcome.payload["sequences"]);
        tally.check(&case, "empty_reason", &result["empty_reason"], &outcome.payload["empty_reason"]);
        let summary = ports.states.lock().unwrap().iter().rev().find(|(n, _)| *n == StateName::Summary).map_or(Value::Null, |(_, p)| p.clone());
        tally.check(&case, "summary", &result["summary"], &summary);
        tally.check(&case, "export_rows", &result["export_rows"], &Value::Array(clips::preview_clip_rows(&outcome.last)));
        for cc in result["clip_cameras"].as_array().into_iter().flatten() {
            let got = clips::edited_clip_cameras(Some(&outcome.last), &disc, &cc["entry"]).map(|c| c.map_or(Value::Null, |s| s.iter().map(clips::Segment::to_json).collect()));
            match got {
                Ok(v) => tally.check(&case, "clip_cameras", &cc["cameras"], &v),
                Err(e) => tally.diffs.push(format!("{case}: edited_clip_cameras failed: {e}")),
            }
        }
        let ok = !tally.failed_cases.contains(&case);
        println!("{case:<52} {} {:6.1}s (3.5 {:6.1}s)", if ok { "same" } else { "DIFF" }, t.elapsed().as_secs_f64(), result["seconds"].as_f64().unwrap_or(0.0));
    }

    println!("\nall cases in {:.0}s", started.elapsed().as_secs_f64());
    for (what, (n, ok)) in &tally.checks {
        println!("{what:<14} {ok:>4} / {n:<4} same");
    }
    println!("numbers within {FLOAT_READ_ULPS} ulp (JSON float reading): {}", FLOAT_READ.load(Ordering::Relaxed));
    println!("database sessions reopened after the server closed one: {reconnects}");
    println!("cases with a difference: {}", tally.failed_cases.len());
    for d in tally.diffs.iter().take(SHOWN_DIFFS) {
        println!("DIFF {d}");
    }
}
