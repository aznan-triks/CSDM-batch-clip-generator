//! Demo-file stage of the preview on real demos (read only): the readers and every demo filter run,
//! and where a golden case's database query equals the Mate POV case's (filters that only read the
//! demo files), the events kept per demo are compared with the 3.5 reference.
//!
//! The Mate POV case keeps every kill (Mate POV only tags), so its events minus `_mf` and
//! `_mate_pov_sid` are the database query's output, the input of this stage.
//!
//! Usage: t3_dp2 <golden refs dir> [number of demos, default 6] [text the demo paths contain]
//! (refs from rust/tools/t3_golden_refs.py; nothing is written, the database is not used.)

use csdm_engine::preview::cfg::build_run_cfg;
use csdm_engine::preview::dp2::{gate_events, Cache, DemoStore, Stage};
use csdm_engine::preview::{Arena, CollectPorts, DemoEvents, Event};
use csdm_engine::event::Level;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

const BASE_CASE: &str = "filter:kill_mod_mate_pov";
/// Cases whose only difference with the base is a filter that reads the demo files.
const COMPARED: &[&str] = &[
    "filter:kill_mod_airborne",
    "filter:kill_mod_collateral",
    "filter:kill_mod_trois_shot",
    "filter:kill_mod_spray_transfer",
    "filter:kill_mod_high_velocity",
    "filter:kill_mod_flick",
    "filter:kill_mod_savior",
    "filter:kill_mod_mate_pov",
    "mixed:mixed_both_mate_pov",
];
/// Filters whose golden case has another database query (SQL clause): run only, not compared.
const RUN_ONLY: &[&str] = &["kill_mod_wall_bang", "kill_mod_attacker_blind", "kill_mod_one_tap", "kill_mod_trois_tap"];

fn load(path: &Path) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Case name → file, from generate.log ("<index> <name> ...").
fn case_files(refs: &Path) -> BTreeMap<String, PathBuf> {
    let log = std::fs::read_to_string(refs.join("generate.log")).expect("generate.log in the refs folder");
    log.lines()
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let index: usize = parts.next()?.parse().ok()?;
            Some((parts.next()?.to_string(), refs.join("cases").join(format!("{index:04}.json"))))
        })
        .collect()
}

fn events_of(case: &Value) -> &Map<String, Value> {
    case["result"]["events"].as_object().expect("a preview case has events")
}

fn input_events(base: &Map<String, Value>, demos: &[String], arena: &mut Arena) -> DemoEvents {
    let mut evts = DemoEvents::new();
    for dp in demos {
        let ids = base[dp]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                let mut fields = e.as_object().unwrap().clone();
                fields.remove("_mate_pov_sid");
                let mf: Option<std::collections::BTreeSet<String>> = fields.remove("_mf").map(|m| {
                    m.as_array().unwrap().iter().filter_map(Value::as_str).filter(|k| *k != "kill_mod_mate_pov").map(str::to_string).collect()
                });
                arena.add(Event { fields, mf: mf.filter(|m| !m.is_empty()) })
            })
            .collect();
        evts.insert(dp.clone(), ids);
    }
    evts
}

struct Run {
    out: DemoEvents,
    arena: Arena,
    warns: Vec<String>,
    ms: u128,
}

fn run(store: &DemoStore, base: &Map<String, Value>, demos: &[String], cfg: &Map<String, Value>) -> Run {
    let run_cfg = build_run_cfg(cfg);
    let mut arena = Arena::default();
    let evts = input_events(base, demos, &mut arena);
    let (mut cache, ports) = (Cache::default(), CollectPorts::default());
    let t0 = Instant::now();
    let mut st = Stage::new(&ports, store, &mut cache, &mut arena);
    st.preparse(&run_cfg, demos);
    let filtered = st.apply_filters(evts, &run_cfg).unwrap_or_else(|e| panic!("demo filters failed: {e:?}"));
    let out: DemoEvents = filtered.into_iter().filter_map(|(dp, ev)| gate_events(&arena, &ev, &run_cfg).map(|g| (dp, g))).collect();
    let ms = t0.elapsed().as_millis();
    let warns = ports.logs.lock().unwrap().iter().filter(|(_, l)| *l == Level::Warn).map(|(m, _)| m.clone()).collect();
    Run { out, arena, warns, ms }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let refs = PathBuf::from(args.get(1).expect("usage: t3_dp2 <golden refs dir> [demos]"));
    let wanted: usize = args.get(2).map_or(6, |n| n.parse().expect("number of demos"));
    let only = args.get(3).map(String::as_str).unwrap_or("");
    let files = case_files(&refs);
    let base_case = load(&files[BASE_CASE]);
    let base = events_of(&base_case);
    let cases: Vec<(&str, Value)> = COMPARED.iter().map(|n| (*n, load(&files[*n]))).collect();
    // Demos present on disk (paths containing `only`), those the compared cases keep events in first.
    let mut demos: Vec<(usize, String)> = base
        .keys()
        .filter(|dp| dp.contains(only) && Path::new(dp).is_file())
        .map(|dp| (cases.iter().filter(|(_, c)| events_of(c).get(dp).is_some_and(|e| !e.as_array().unwrap().is_empty())).count(), dp.clone()))
        .collect();
    demos.sort_by_key(|d| std::cmp::Reverse(d.0));
    let demos: Vec<String> = demos.into_iter().take(wanted).map(|(_, dp)| dp).collect();
    let on_disk = base.keys().filter(|dp| Path::new(dp).is_file()).count();
    println!("{} demos in the base case, {on_disk} on disk, {} used", base.len(), demos.len());

    let store = DemoStore::default();
    let mut differing = 0;
    for (name, case) in &cases {
        let cfg = case["cfg"].as_object().expect("a case has its settings");
        let r = run(&store, base, &demos, cfg);
        let expected = events_of(case);
        let mut first_diff = None;
        let (mut n_expected, mut n_ours) = (0, 0);
        for dp in &demos {
            let exp: Vec<Value> = expected.get(dp).and_then(Value::as_array).cloned().unwrap_or_default();
            let ours: Vec<Value> = r.out.get(dp).map(|ids| ids.iter().map(|&id| r.arena.get(id).to_json()).collect()).unwrap_or_default();
            n_expected += exp.len();
            n_ours += ours.len();
            if first_diff.is_none() && exp != ours {
                let i = exp.iter().zip(&ours).position(|(a, b)| a != b).unwrap_or(exp.len().min(ours.len()));
                first_diff = Some(format!("{} at #{i}: expected {} / ours {}", Path::new(dp).file_name().unwrap().to_string_lossy(), exp.get(i).map_or("nothing".into(), Value::to_string), ours.get(i).map_or("nothing".into(), Value::to_string)));
            }
        }
        let verdict = match &first_diff {
            None => "same".to_string(),
            Some(d) => {
                differing += 1;
                format!("DIFFERS — {d}")
            }
        };
        println!("{name:<34} events expected {n_expected:>4} / ours {n_ours:>4}  {:>5} ms  warnings {}  {verdict}", r.ms, r.warns.len());
    }
    for key in RUN_ONLY {
        let mut cfg = cases[0].1["cfg"].as_object().unwrap().clone();
        cfg.retain(|k, _| !k.starts_with("kill_mod_airborne"));
        cfg.insert((*key).to_string(), Value::Bool(true));
        let r = run(&store, base, &demos, &cfg);
        let kept: usize = r.out.values().map(Vec::len).sum();
        println!("{key:<34} run only (other database query): {kept} events kept, {} ms, warnings {}", r.ms, r.warns.len());
    }
    // What the readers gave, per demo (a fresh preview reading every section through the store).
    let mut cfg = cases[0].1["cfg"].as_object().unwrap().clone();
    for k in ["kill_mod_trois_shot", "kill_mod_flick", "kill_mod_savior"] {
        cfg.insert(k.into(), Value::Bool(true));
    }
    let run_cfg = build_run_cfg(&cfg);
    let (mut cache, ports, mut arena) = (Cache::default(), CollectPorts::default(), Arena::default());
    Stage::new(&ports, &store, &mut cache, &mut arena).preparse(&run_cfg, &demos);
    for dp in &demos {
        let name = Path::new(dp).file_name().unwrap().to_string_lossy();
        let shots: usize = cache.fire(dp).map_or(0, |f| f.ticks.values().map(Vec::len).sum());
        let (angles, flags) = cache.death(dp).map_or((0, 0), |d| (d.view_angles.values().map(Vec::len).sum(), d.flags.len()));
        let hurts: usize = cache.hurt(dp).map_or(0, |h| h.values().map(Vec::len).sum());
        let names = cache.demo_names(dp).map_or(0, |n| n.len());
        println!("  {name}: {shots} shots, {angles} kill angles, {flags} death flags, {hurts} hurts, {names} names");
    }
    for (m, l) in ports.logs.lock().unwrap().iter().filter(|(_, l)| *l == Level::Warn) {
        println!("  {l:?}: {m}");
    }
    println!("store: {} demo files kept; {differing} compared case(s) differ", store.len());
    if differing > 0 {
        std::process::exit(1);
    }
}
