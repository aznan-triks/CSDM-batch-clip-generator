//! Self-check of the T3 SQL stage: `sql::query_events` against the 3.5 golden previews, on every
//! case whose demo-file stage and ★ gate cannot change the events. Read-only.
//!
//!     cargo run --release -p csdm-engine --example t3_sql_check -- <refs dir> <copy of csdm_config.json> [case numbers]
//!
//! A case qualifies when (from `_apply_dp2_filters_to_events` / `_apply_global_filter_gate_events`):
//! - dp2 is a no-op: TROIS TAP off, no filter with a dp2 function on, none excluded (outside
//!   `no_auto_exclude`): the function then returns its input unchanged;
//! - the gate is a no-op: every filter on is required (★), applies to kills only, and is one the
//!   SQL stage always stamps on the kills it keeps (a `kills` column mod present in the database,
//!   or a database post-filter); every excluded filter applies to kills only. Kills then always
//!   carry every required key, and no non-kill event meets a filter that applies to it.

use csdm_core::preview::preview;
use csdm_core::registries::registries;
use csdm_core::Settings;
use csdm_db::{Db, Discovery, PgParams};
use csdm_engine::preview::cfg::{build_run_cfg, on};
use csdm_engine::preview::dp2::DemoStore;
use csdm_engine::preview::{sql, CollectPorts, Ctx};
use serde_json::Value;
use std::sync::atomic::AtomicBool;

fn qualifies(cfg: &Settings, disc: &Discovery) -> bool {
    let reg = &registries().kill_filters;
    let no_auto: Vec<&str> = registries().no_auto_exclude.iter().map(String::as_str).collect();
    if on(cfg, "kill_mod_trois_tap") {
        return false;
    }
    for f in reg {
        let excl = on(cfg, &format!("{}_exclude", f.key));
        if f.dp2_filter.is_some() && (on(cfg, &f.key) || (excl && !no_auto.contains(&f.key.as_str()))) {
            return false;
        }
        let kill_only = f.applies_to == ["kill"];
        if excl && !kill_only {
            return false;
        }
        if on(cfg, &f.key) {
            let col = f.sql_cols.iter().flatten().any(|c| disc.columns("kills").contains(c));
            let stamped = (f.category == "mods" && col) || f.category == "db";
            if !(on(cfg, &format!("{}_req", f.key)) && kill_only && stamped) {
                return false;
            }
        }
    }
    true
}

/// dp2 alone is a no-op (first condition of `qualifies`).
fn dp2_noop(cfg: &Settings) -> bool {
    let no_auto: Vec<&str> = registries().no_auto_exclude.iter().map(String::as_str).collect();
    !on(cfg, "kill_mod_trois_tap")
        && registries().kill_filters.iter().all(|f| {
            f.dp2_filter.is_none() || !(on(cfg, &f.key) || (on(cfg, &format!("{}_exclude", f.key)) && !no_auto.contains(&f.key.as_str())))
        })
}

/// Test-only copy of 3.5 `_apply_global_filter_gate_events` on JSON events, for the second,
/// wider check (cases where only dp2 is a no-op): the gate is the dp2 port's, not this stage's.
fn gate(events: &[Value], cfg: &Settings) -> Option<Vec<Value>> {
    let reg = &registries().kill_filters;
    let active: Vec<&str> = reg.iter().filter(|f| on(cfg, &f.key)).map(|f| f.key.as_str()).collect();
    let excluded: Vec<&str> = reg.iter().filter(|f| on(cfg, &format!("{}_exclude", f.key))).map(|f| f.key.as_str()).collect();
    if active.is_empty() && excluded.is_empty() {
        return Some(events.to_vec());
    }
    let applies = |k: &str, cat: &str| reg.iter().find(|f| f.key == k).unwrap().applies_to.iter().any(|a| a == cat);
    let req: Vec<&str> = active.iter().copied().filter(|k| on(cfg, &format!("{k}_req"))).collect();
    let opt: Vec<&str> = active.iter().copied().filter(|k| !on(cfg, &format!("{k}_req"))).collect();
    let (mut kept, mut non_kill) = (Vec::new(), Vec::new());
    for e in events {
        let etype = e.get("type").and_then(Value::as_str);
        let matched: Vec<&str> = e.get("_mf").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        let has = |k: &&str| matched.contains(k);
        let of = |keys: &[&str], cat: &str| -> Vec<String> { keys.iter().filter(|k| applies(k, cat)).map(|k| k.to_string()).collect() };
        if etype == Some("kill") {
            let (kr, ko) = (of(&req, "kill"), of(&opt, "kill"));
            if (!kr.is_empty() && !kr.iter().all(|k| has(&k.as_str()))) || (!ko.is_empty() && !ko.iter().any(|k| has(&k.as_str()))) {
                continue;
            }
            kept.push(e.clone());
            continue;
        }
        let cat = etype.and_then(|t| preview()["event_categories"].get(t)).and_then(Value::as_str);
        let Some(cat) = cat.filter(|_| etype != Some("death")) else {
            non_kill.push(e.clone());
            continue;
        };
        let (r, o, x) = (of(&req, cat), of(&opt, cat), of(&excluded, cat));
        if (!r.is_empty() && !r.iter().all(|k| has(&k.as_str()))) || (!o.is_empty() && !o.iter().any(|k| has(&k.as_str()))) || x.iter().any(|k| has(&k.as_str())) {
            continue;
        }
        let dup = e.get("_grp").and_then(Value::as_object).is_some_and(|g| g.iter().any(|(k, role)| role == "dup" && (r.contains(k) || o.contains(k))));
        if dup {
            continue;
        }
        non_kill.push(e.clone());
    }
    kept.extend(non_kill);
    (!kept.is_empty()).then_some(kept)
}

/// The event as the reference canonicalises it: without `_chk`, here and in `_clutch_kills`.
fn canon(mut v: Value) -> Value {
    if let Value::Object(m) = &mut v {
        m.shift_remove("_chk");
        if let Some(Value::Array(ks)) = m.get_mut("_clutch_kills") {
            for k in ks.iter_mut() {
                *k = canon(std::mem::take(k));
            }
        }
    }
    v
}

/// Equality with numbers compared by value (3 == 3.0); `strict` also requires the same type.
fn same(a: &Value, b: &Value, strict: bool) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) if !strict => x.as_f64() == y.as_f64(),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w, strict))),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(u, w)| same(u, w, strict)),
        _ => a == b,
    }
}

fn first_diff(want: &Value, got: &Value) -> Option<String> {
    let (w, g) = (want.as_object().unwrap(), got.as_object().unwrap());
    let wk: Vec<&String> = w.keys().collect();
    let gk: Vec<&String> = g.keys().collect();
    if wk != gk {
        return Some(format!("demos/order differ: 3.5 {} demos, Rust {}; first 3.5 {:?} / Rust {:?}", wk.len(), gk.len(), wk.first(), gk.first()));
    }
    for (dp, wl) in w {
        let (wl, gl) = (wl.as_array().unwrap(), g[dp].as_array().unwrap());
        if let Some(i) = (0..wl.len().min(gl.len())).find(|&i| !same(&wl[i], &gl[i], false)) {
            return Some(format!("{dp} event {i}: 3.5 {} / Rust {}", wl[i], gl[i]));
        }
        if wl.len() != gl.len() {
            return Some(format!("{dp}: 3.5 {} events, Rust {}", wl.len(), gl.len()));
        }
    }
    None
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert!(args.len() >= 3, "usage: t3_sql_check <refs dir> <copy of csdm_config.json> [n,n,…]");
    let only: Option<Vec<usize>> = args.get(3).map(|s| s.split(',').map(|x| x.parse().unwrap()).collect());
    let settings: Value = serde_json::from_str(&std::fs::read_to_string(&args[2]).unwrap()).unwrap();
    let mut db = Db::connect(&PgParams::from_settings(settings.as_object().unwrap()).unwrap()).unwrap_or_else(|e| panic!("{e}"));
    let disc = db.discover().unwrap_or_else(|e| panic!("{e}"));
    let _ = preview();

    let mut dir: Vec<_> = std::fs::read_dir(std::path::Path::new(&args[1]).join("cases")).unwrap().map(|e| e.unwrap().path()).collect();
    dir.sort();
    let (mut total, mut qualifying, mut matched, mut strict_matched, mut gated, mut gated_matched, mut repeat_ok, mut others_ran) = (0, 0, 0, 0, 0, 0, 0, 0);
    let mut diffs = Vec::new();
    for path in dir {
        let idx: usize = path.file_stem().unwrap().to_str().unwrap().parse().unwrap();
        if only.as_ref().is_some_and(|o| !o.contains(&idx)) {
            continue;
        }
        let case: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        total += 1;
        let Some(want) = case["result"].get("events") else { continue };
        let cfg: Settings = case["cfg"].as_object().unwrap().clone();
        let strict_case = qualifies(&cfg, &disc);
        if !strict_case && !dp2_noop(&cfg) {
            // Not comparable here (the demo-file stage changes the events): it must still run.
            let ports = CollectPorts::default();
            let store = DemoStore::default();
            let cancel = AtomicBool::new(false);
            let mut cx = Ctx::new(&mut db, &disc, &ports, &store, &cancel);
            match sql::query_events(&mut cx, &build_run_cfg(&cfg)) {
                Ok(_) => others_ran += 1,
                Err(e) => {
                    println!("{idx:4} other {:<40} ERROR {e}", case["name"].as_str().unwrap());
                    diffs.push(idx);
                }
            }
            continue;
        }
        let tag = if strict_case { "no-op" } else { "gated" };
        if strict_case {
            qualifying += 1;
        } else {
            gated += 1;
        }
        let ports = CollectPorts::default();
        let store = DemoStore::default();
        let cancel = AtomicBool::new(false);
        let mut cx = Ctx::new(&mut db, &disc, &ports, &store, &cancel);
        let t0 = std::time::Instant::now();
        let run_cfg = build_run_cfg(&cfg);
        let raw = |cx: &mut Ctx| -> Result<Vec<(String, Vec<Value>)>, String> {
            let evts = sql::query_events(cx, &run_cfg).map_err(|e| e.to_string())?;
            Ok(evts.iter().map(|(dp, ids)| (dp.clone(), ids.iter().map(|&id| canon(cx.arena.get(id).to_json())).collect())).collect())
        };
        let first = match raw(&mut cx) {
            Ok(r) => r,
            Err(e) => {
                println!("{idx:4} {tag} {:<40} ERROR {e}", case["name"].as_str().unwrap());
                diffs.push(idx);
                continue;
            }
        };
        // A second call in the same preview (as `explain_empty_result` makes) gives the same events.
        if raw(&mut cx).as_ref() != Ok(&first) {
            println!("{idx:4} {tag} a second call in the same preview gives other events");
            diffs.push(idx);
        } else {
            repeat_ok += 1;
        }
        let mut out = serde_json::Map::new();
        for (dp, list) in first {
            let list = if strict_case { Some(list) } else { gate(&list, &run_cfg) };
            if let Some(list) = list {
                out.insert(dp, Value::Array(list));
            }
        }
        let got = Value::Object(out);
        let n: usize = got.as_object().unwrap().values().map(|v| v.as_array().unwrap().len()).sum();
        match first_diff(want, &got) {
            None => {
                if strict_case {
                    matched += 1;
                } else {
                    gated_matched += 1;
                }
                let strict = same(want, &got, true);
                strict_matched += usize::from(strict);
                println!("{idx:4} {tag} {:<40} OK   events={n:<6} {:.1}s{}", case["name"].as_str().unwrap(), t0.elapsed().as_secs_f64(), if strict { "" } else { " (types differ)" });
            }
            Some(d) => {
                println!("{idx:4} {tag} {:<40} DIFF events={n:<6} {d}", case["name"].as_str().unwrap());
                diffs.push(idx);
            }
        }
    }
    println!("cases {total}; no-op qualifying {qualifying}, matched {matched}; dp2-no-op + test gate {gated}, matched {gated_matched}; same types too: {strict_matched}; repeated call identical: {repeat_ok}; other previews run without error: {others_ran}; differing {:?}", diffs);
}
