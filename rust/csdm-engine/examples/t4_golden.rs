//! T4 golden bench (decisions/08): the whole Rust batch run against the 3.5 engine's, case by case
//! (`rust/tools/t4_golden_refs.py` writes the references). Read-only on the author's data: the CLI
//! is never started, each job file is captured instead, and every path the run writes to is a
//! throwaway folder (written `{ROOT}` on both sides).
//!
//!     cargo run --release -p csdm-engine --example t4_golden -- <refs dir> <copy of csdm_config.json> [first-last]
//!
//! Compared as JSON trees **with key order** (the CLI's contract): refused inputs, every job
//! (arguments, job file, recording timeout), each demo's `demo_entry`, the final counts, the
//! error lines, the CS2 files of RecSys CS.

use csdm_core::Settings;
use csdm_db::{Db, PgParams};
use csdm_engine::batch::{self, RunIo};
use csdm_engine::event::{Level, StateName};
use csdm_engine::preview::cfg::build_run_cfg;
use csdm_engine::preview::clips::{normalize_clip_selection, run_inputs_problem};
use csdm_engine::preview::dp2::DemoStore;
use csdm_engine::preview::{CollectPorts, Ctx};
use csdm_engine::process::{Exec, ExecOutcome, Machine};
use csdm_engine::run::RunControl;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;

const ROOT_MARK: &str = "{ROOT}";
const SHOWN_DIFFS: usize = 80;
/// serde_json's float reader can land a unit or two of the last place away from Python's value.
const FLOAT_READ_ULPS: u64 = 2;
static FLOAT_READ: AtomicUsize = AtomicUsize::new(0);
const RUNTIME_FILES: [&str; 2] = ["csdm_batch_runtime.cfg", "autoexec.cfg"];

fn same_number(x: &serde_json::Number, y: &serde_json::Number) -> bool {
    if x == y {
        return true;
    }
    // An integer and a float are different types in the job file.
    if x.is_f64() != y.is_f64() {
        return false;
    }
    let (Some(a), Some(b)) = (x.as_f64(), y.as_f64()) else { return false };
    let near = a == b || (a.is_sign_positive() == b.is_sign_positive() && a.to_bits().abs_diff(b.to_bits()) <= FLOAT_READ_ULPS);
    if near && a != b {
        FLOAT_READ.fetch_add(1, Ordering::Relaxed);
    }
    near
}

/// First difference between two JSON trees: keys in order, types, values.
fn first_diff(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let (kx, ky): (Vec<&String>, Vec<&String>) = (x.keys().collect(), y.keys().collect());
            if kx != ky {
                return Some(format!("{path}: keys 3.5 {kx:?} / Rust {ky:?}"));
            }
            kx.iter().find_map(|k| first_diff(&x[*k], &y[*k], &format!("{path}.{k}")))
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

/// `v` with `from` replaced by `to` in every text.
fn swap_root(v: &Value, from: &str, to: &str) -> Value {
    match v {
        Value::String(s) => Value::String(s.replace(from, to)),
        Value::Array(a) => Value::Array(a.iter().map(|x| swap_root(x, from, to)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), swap_root(x, from, to))).collect()),
        other => other.clone(),
    }
}

/// Captures the job file instead of starting the CLI (3.5 bench `capture`).
#[derive(Default)]
struct Capture {
    jobs: Vec<Value>,
}

impl Exec for Capture {
    fn exec(&mut self, cmd: &[String], _cfg: &Settings, timeout_s: u64) -> ExecOutcome {
        let job: Value = serde_json::from_str(&std::fs::read_to_string(&cmd[cmd.len() - 1]).expect("job file")).expect("job JSON");
        let mut args = vec![Value::from(Path::new(&cmd[0]).file_name().expect("CLI name").to_string_lossy().into_owned())];
        args.extend(cmd[1..cmd.len() - 1].iter().map(|a| Value::from(a.as_str())));
        self.jobs.push(json!({"args": args, "json": job, "timeout_s": timeout_s}));
        ExecOutcome { success: true, ..Default::default() }
    }
}

#[derive(Default)]
struct Tally {
    checks: BTreeMap<&'static str, (usize, usize)>,
    diffs: Vec<String>,
    failed_cases: BTreeSet<String>,
    jobs: usize,
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

/// The counts line of the summary (3.5 bench `COUNTS`).
fn counts(line: &str) -> Option<String> {
    let rest = line.strip_prefix("  OK:")?;
    let end = rest.find(" Retries:")?;
    let digits = rest[end + " Retries:".len()..].chars().take_while(char::is_ascii_digit).count();
    Some(format!("OK:{}", &rest[..end + " Retries:".len() + digits]))
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
    let disc = db.discover().unwrap_or_else(|e| panic!("{e}"));
    let (store, cancel) = (DemoStore::default(), AtomicBool::new(false));
    let home = tempfile::tempdir().expect("throwaway home");

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
        let t = Instant::now();
        for (ri, run) in rec["runs"].as_array().expect("runs").iter().enumerate() {
            let label = format!("{case} run{ri}");
            let want = &run["result"];
            if want.get("generator_error").is_some() {
                tally.diffs.push(format!("{label}: the 3.5 reference failed, not compared"));
                continue;
            }
            let root = tempfile::tempdir().expect("throwaway root");
            let root_text = root.path().to_string_lossy().into_owned();
            for sub in ["cli", "clips", "cs2cfg"] {
                std::fs::create_dir_all(root.path().join(sub)).expect("root folders");
            }
            std::fs::write(root.path().join("cli").join("csdm.CMD"), "").expect("stand-in CLI file");
            let raw: Settings = serde_json::from_value(swap_root(&rec["cfg"], ROOT_MARK, &root_text)).expect("case cfg");
            let cfg = build_run_cfg(&raw);
            let problem = run_inputs_problem(&cfg).map_or(Value::Null, Value::String);
            tally.check(&label, "problem", want.get("problem").unwrap_or(&Value::Null), &problem);
            if want.get("jobs").is_none() {
                continue;
            }
            if db.is_closed() {
                db = Db::connect(&params).unwrap_or_else(|e| panic!("{e}"));
            }
            let selected = normalize_clip_selection(Some(&run["selection"]).filter(|s| !s.is_null())).expect("selection");
            let ports = CollectPorts::default();
            let control = RunControl::default();
            control.begin(Machine::from_settings(&cfg));
            let mut capture = Capture::default();
            let never_asked = |_: csdm_engine::event::AskKind, m: &str, _: &[String]| -> Option<String> { panic!("the run asked: {m}") };
            {
                let mut cx = Ctx::new(&mut db, &disc, &ports, &store, &cancel);
                let mut io = RunIo { control: &control, exec: &mut capture, tags: None, ask: &never_asked, selected: selected.as_deref(), home: home.path().to_path_buf() };
                if let Err(e) = batch::run_batch(&mut cx, &mut io, &cfg) {
                    tally.diffs.push(format!("{label}: run failed: {}", e.user_message()));
                    tally.failed_cases.insert(case.clone());
                    continue;
                }
            }
            let states = ports.states.lock().unwrap();
            let logs = ports.logs.lock().unwrap();
            let entries: Vec<Value> = states
                .iter()
                .filter(|(n, _)| *n == StateName::DemoEntry)
                .map(|(_, p)| json!({"date_str": p["date_str"], "demo_name": p["demo_name"], "seq_count": p["seq_count"], "idx": p["idx"], "total": p["total"]}))
                .collect();
            let count_lines: Vec<Value> = logs.iter().filter_map(|(m, _)| counts(m)).map(Value::from).collect();
            let errors: Vec<Value> = logs.iter().filter(|(_, l)| *l == Level::Err).map(|(m, _)| Value::from(m.as_str())).collect();
            let mut runtime = serde_json::Map::new();
            for name in RUNTIME_FILES {
                if let Ok(text) = std::fs::read_to_string(root.path().join("cs2cfg").join(name)) {
                    runtime.insert(name.into(), text.into());
                }
            }
            tally.jobs += capture.jobs.len();
            let got = swap_root(&json!({"jobs": capture.jobs, "demo_entries": entries, "counts": count_lines, "errors": errors, "cs_runtime": runtime}), &root_text, ROOT_MARK);
            for what in ["jobs", "demo_entries", "counts", "errors", "cs_runtime"] {
                let key: &'static str = what;
                tally.check(&label, key, &want[what], &got[what]);
            }
        }
        let ok = !tally.failed_cases.contains(&case);
        println!("{case:<52} {} {:6.2}s", if ok { "same" } else { "DIFF" }, t.elapsed().as_secs_f64());
    }

    println!("\nall cases in {:.0}s, {} jobs compared", started.elapsed().as_secs_f64(), tally.jobs);
    for (what, (n, ok)) in &tally.checks {
        println!("{what:<14} {ok:>4} / {n:<4} same");
    }
    println!("numbers within {FLOAT_READ_ULPS} ulp (JSON float reading): {}", FLOAT_READ.load(Ordering::Relaxed));
    println!("cases with a difference: {}", tally.failed_cases.len());
    for d in tally.diffs.iter().take(SHOWN_DIFFS) {
        println!("DIFF {d}");
    }
}
