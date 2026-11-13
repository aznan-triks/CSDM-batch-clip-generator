//! T1 golden bench: replays every read recorded from the 3.5 engine (`rust/tools/t1_golden_refs.py`)
//! through csdm-db and compares, query by query, the statement, its parameters and every cell
//! with its type. Read-only (the crate cannot do otherwise).
//!
//!     cargo run -p csdm-db --example t1_golden -- <t1_refs.json> <copy of csdm_config.json>

use csdm_db::reads::{self, DemoKey};
use csdm_db::{Db, DbValue, Discovery, PgParams, Query};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Intended differences from 3.5, each with its reason (also in the T1 brief journal).
const EXPECTED: [(&str, &str); 2] = [
    ("tag_id_by_name", "statement built from the discovered tag columns; 3.5 wrote tags.id/tags.name by hand (research/03 §8)"),
    ("checksum_by_file_name", "`_`, `%` and `\\` escaped in the LIKE pattern; 3.5 let `_` match any character (research/03 §8)"),
];

fn enc(v: &DbValue) -> Value {
    match v {
        DbValue::Null => json!({"t": "null"}),
        DbValue::Bool(b) => json!({"t": "bool", "v": b}),
        DbValue::Int(i) => json!({"t": "int", "v": i}),
        DbValue::Float(f) => json!({"t": "float", "v": f.to_bits()}),
        DbValue::Numeric(d) => json!({"t": "decimal", "v": d.to_string()}),
        DbValue::Text(s) => json!({"t": "str", "v": s}),
        DbValue::TimestampTz(t) => json!({"t": "datetimetz", "v": t.format("%Y-%m-%dT%H:%M:%S%.6f").to_string()}),
        DbValue::Timestamp(t) => json!({"t": "datetime", "v": t.format("%Y-%m-%dT%H:%M:%S%.6f").to_string()}),
        DbValue::Date(d) => json!({"t": "date", "v": d.to_string()}),
        DbValue::Uuid(u) => json!({"t": "uuid", "v": u.to_string()}),
    }
}

/// A recorded parameter back to a value (only the types the engine sends).
fn dec(v: &Value) -> DbValue {
    match v["t"].as_str().unwrap() {
        "null" => DbValue::Null,
        "bool" => DbValue::Bool(v["v"].as_bool().unwrap()),
        "int" => DbValue::Int(v["v"].as_i64().unwrap()),
        "str" => DbValue::text(v["v"].as_str().unwrap()),
        "float" => DbValue::Float(f64::from_bits(v["v"].as_u64().unwrap())),
        t => panic!("parameter type {t} is not sent by the engine"),
    }
}

fn rows_json(rows: &[Vec<DbValue>]) -> Value {
    Value::Array(rows.iter().map(|r| Value::Array(r.iter().map(enc).collect())).collect())
}

/// Deep equality that also requires the same key order (the JSON tree rule of ticket 08).
fn same_tree(a: &Value, b: &Value, path: &str) -> Result<(), String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let kx: Vec<_> = x.keys().collect();
            let ky: Vec<_> = y.keys().collect();
            if kx != ky {
                return Err(format!("{path}: keys {kx:?} != {ky:?}"));
            }
            x.iter().try_for_each(|(k, v)| same_tree(v, &y[k], &format!("{path}.{k}")))
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Err(format!("{path}: {} items != {}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().try_for_each(|(i, (u, v))| same_tree(u, v, &format!("{path}[{i}]")))
        }
        _ if a == b => Ok(()),
        _ => Err(format!("{path}: {a} != {b}")),
    }
}

fn first_row_diff(want: &Value, got: &Value) -> String {
    let (w, g) = (want.as_array().unwrap(), got.as_array().unwrap());
    if w.len() != g.len() {
        return format!("{} rows expected, {} read", w.len(), g.len());
    }
    match w.iter().zip(g).position(|(a, b)| a != b) {
        Some(i) => format!("row {i}: 3.5 {} / Rust {}", w[i], g[i]),
        None => "same".into(),
    }
}

/// 3.5's ORDER BY often leaves ties (same demo, same tick): PostgreSQL then returns them in
/// any order (parallel scans), in 3.5 as in Rust. Equal up to ties = same rows (as a
/// multiset) and the same sequence of sort keys, the leading columns of the ORDER BY.
fn same_up_to_ties(sql: &str, want: &Value, got: &Value) -> Option<usize> {
    let keys = sort_key_columns(sql)?;
    let (w, g) = (want.as_array()?, got.as_array()?);
    if w.len() != g.len() {
        return None;
    }
    let proj = |r: &Value| keys.iter().map(|&i| r[i].clone()).collect::<Vec<_>>();
    if w.iter().zip(g).any(|(a, b)| proj(a) != proj(b)) {
        return None;
    }
    let sorted = |v: &[Value]| {
        let mut s: Vec<String> = v.iter().map(Value::to_string).collect();
        s.sort();
        s
    };
    (sorted(w) == sorted(g)).then(|| w.iter().zip(g).filter(|(a, b)| a != b).count())
}

/// Positions in the SELECT list of the ORDER BY expressions (all must be selected columns).
fn sort_key_columns(sql: &str) -> Option<Vec<usize>> {
    let (head, order) = sql.rsplit_once(" ORDER BY ")?;
    let select = head.strip_prefix("SELECT ")?.split(" FROM ").next()?;
    let cols: Vec<&str> = select.split(',').map(str::trim).collect();
    order.split(',').map(|k| cols.iter().position(|c| *c == k.trim())).collect()
}

fn build(d: &Discovery, case: &Value) -> Option<Query> {
    let params: Vec<DbValue> = case["params"].as_array().unwrap().iter().map(dec).collect();
    let text = |i: usize| params[i].as_str().unwrap().to_string();
    let by = || if case["by"] == "path" { DemoKey::Path } else { DemoKey::Checksum };
    match case["fn"].as_str().unwrap() {
        "raw_preview" => Some(Query::new(case["sql"].as_str().unwrap(), params)),
        "players_plain" => Some(csdm_db::players_plain_query()),
        "all_kills_for_demos" => reads::all_kills_for_demos(d, by(), &params),
        "roster_sizes" => reads::roster_sizes(d, &params),
        "native_clutches" => reads::native_clutches(d, by(), &params),
        "matches_with_tag" => reads::matches_with_tag(d, &params[0]),
        "tag_id_by_name" => reads::tag_id_by_name(d, &text(0)),
        "all_demos" => reads::all_demos(d),
        "checksum_by_path" => reads::checksum_by_path(d, &text(0)),
        "checksum_by_file_name" => reads::checksum_by_file_name(d, text(0).strip_prefix('%').unwrap()),
        "sample_demos" => reads::sample_demos(d),
        "tag_link_exists" => reads::tag_link_exists(d, &params[0], &params[1]),
        "checksum_exists" => reads::checksum_exists(d, &params[0]),
        "demos_with_tags" => reads::demos_with_tags(d, &params),
        "matches_with_tags" => reads::matches_with_tags(d, &params),
        "tagged_demo_dates" => reads::tagged_demo_dates(d, &params),
        "export_tag_list" => reads::export_tag_list(d),
        "export_tag_links" => reads::export_tag_links(d, &params),
        f => panic!("no builder for {f}"),
    }
}

/// The discovery with columns hidden, as the bench hid them from 3.5 to reach a branch.
fn with_hidden(d: &Discovery, hide: &Value) -> Discovery {
    let mut d = d.clone();
    if let Some(h) = hide.as_object() {
        for (table, cols) in h {
            let cols: Vec<&str> = cols.as_array().unwrap().iter().map(|c| c.as_str().unwrap()).collect();
            if let Some((_, list)) = d.schema.iter_mut().find(|(t, _)| t == table) {
                list.retain(|c| !cols.contains(&c.as_str()));
            }
        }
    }
    d
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert!(args.len() == 3, "usage: t1_golden <t1_refs.json> <copy of csdm_config.json>");
    let refs: Value = serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
    let cfg: Value = serde_json::from_str(&std::fs::read_to_string(&args[2]).unwrap()).unwrap();
    let mut db = Db::connect(&PgParams::from_settings(cfg.as_object().unwrap()).unwrap()).unwrap_or_else(|e| panic!("{e}"));

    let mut failures = 0;
    let mut ties = 0;
    let mut by_read: BTreeMap<String, (u32, u32)> = BTreeMap::new();
    let mut tally = |reads: &str, ok: bool| {
        let e = by_read.entry(reads.to_string()).or_default();
        if ok { e.0 += 1 } else { e.1 += 1 }
    };

    // Reads 1-7: the discovery, query by query, then its result tree.
    db.start_trace();
    let d = db.discover().unwrap_or_else(|e| panic!("{e}"));
    let trace = db.take_trace();
    let want = refs["discovery"]["trace"].as_array().unwrap();
    println!("== discovery: {} queries (3.5) / {} (Rust)", want.len(), trace.len());
    for (i, w) in want.iter().enumerate() {
        let Some(g) = trace.get(i) else {
            println!("DIFF discovery #{i}: missing in Rust: {}", w["sql"]);
            failures += 1;
            continue;
        };
        let gp: Vec<Value> = g.query.params.iter().map(enc).collect();
        let ok_sql = g.query.sql == w["sql"].as_str().unwrap();
        let ok_params = Value::Array(gp) == w["params"];
        let got_rows = rows_json(&g.rows);
        let ok_rows = got_rows == w["rows"];
        let ok = ok_sql && ok_params && ok_rows;
        println!("{} discovery #{i:<2} rows {:>5}  {}", if ok { "OK  " } else { "DIFF" }, g.rows.len(), w["sql"].as_str().unwrap());
        if !ok_sql {
            println!("     sql 3.5 : {}\n     sql Rust: {}", w["sql"], g.query.sql);
        }
        if !ok_params {
            println!("     params differ: 3.5 {} / Rust {:?}", w["params"], g.query.params);
        }
        if !ok_rows {
            println!("     {}", first_row_diff(&w["rows"], &got_rows));
        }
        failures += usize::from(!ok);
        tally("1-7", ok);
    }
    let tree = same_tree(&refs["discovery"]["json"], &d.to_json(), "discovery");
    println!("{} discovery result tree (discovery_to_json){}", if tree.is_ok() { "OK  " } else { "DIFF" }, tree.as_ref().err().map(|e| format!(": {e}")).unwrap_or_default());
    failures += usize::from(tree.is_err());
    tally("1-7", tree.is_ok());

    // Reads 8-38.
    println!("== reads");
    for case in refs["cases"].as_array().unwrap() {
        let fname = case["fn"].as_str().unwrap();
        let reads_no = case["reads"].as_str().unwrap();
        let dd = with_hidden(&d, &case["hide"]);
        let Some(q) = build(&dd, case) else {
            println!("DIFF {reads_no:<6} {fname}: Rust builder gave up where 3.5 ran");
            failures += 1;
            tally(reads_no, false);
            continue;
        };
        let expected = EXPECTED.iter().find(|(f, _)| *f == fname).map(|(_, why)| *why);
        let ok_sql = q.sql == case["sql"].as_str().unwrap();
        let ok_params = Value::Array(q.params.iter().map(enc).collect()) == case["params"];
        let (ok_rows, note) = match (db.run(&q), case.get("error")) {
            (Err(e), Some(err)) => {
                let same = e.detail() == err["message"].as_str().unwrap();
                (same, format!("both fail: 3.5 [{}] {} / Rust {}", err["code"], err["message"], e.detail()))
            }
            (Err(e), None) => (false, format!("Rust failed: {e} -- {}", e.detail())),
            (Ok(rows), Some(err)) => (false, format!("3.5 failed ({}), Rust read {} rows", err["message"], rows.len())),
            (Ok(rows), None) => {
                let got = rows_json(&rows);
                if got == case["rows"] {
                    (true, format!("rows {}", rows.len()))
                } else if let Some(moved) = same_up_to_ties(&q.sql, &case["rows"], &got) {
                    ties += 1;
                    (true, format!("rows {} -- same rows, same sort keys; {moved} rows of tied keys in another order", rows.len()))
                } else {
                    (false, first_row_diff(&case["rows"], &got))
                }
            }
        };
        let exact = ok_sql && ok_params && ok_rows;
        let ok = exact || (expected.is_some() && ok_rows);
        let tag = if exact { "OK  " } else if ok { "OK* " } else { "DIFF" };
        println!("{tag} {reads_no:<6} {fname:<22} {:<30} {note}", case["step"].as_str().unwrap());
        if !ok_sql {
            println!("     sql 3.5 : {}\n     sql Rust: {}", case["sql"], q.sql);
        }
        if !ok_params {
            println!("     params 3.5 : {}\n     params Rust: {:?}", case["params"], q.params);
        }
        if let (false, Some(why)) = (exact, expected) {
            println!("     intended difference: {why}");
        }
        failures += usize::from(!ok);
        tally(reads_no, ok);
    }

    println!("== by read (research/03 §1.3): ok / diff");
    for (k, (ok, bad)) in &by_read {
        println!("  {k:<6} {ok:>3} / {bad}");
    }
    println!("cases equal only up to tie order: {ties}");
    if failures > 0 {
        println!("GOLDEN RED: {failures} difference(s)");
        std::process::exit(1);
    }
    println!("GOLDEN GREEN");
}
