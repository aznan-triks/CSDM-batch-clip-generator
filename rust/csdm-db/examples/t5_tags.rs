//! T5 bench, Rust half: replays a tag scenario through csdm-db on the throwaway local copy and
//! writes each step's result. Driven by `rust/tools/t5_tags_bench.py`, which also runs the 3.5
//! engine on the same scenario and compares the database contents table by table.
//!
//!     cargo run -p csdm-db --example t5_tags -- <scenario.json> <target.json> <out.json>
//!
//! Refuses any target that is not the loopback (the author's server is never written to).

use csdm_db::tags::{tag_id_from_json, Linked, TagSession, TagWriter};
use csdm_db::{Db, DbError, DbValue, PgParams, Query, Tag};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

/// The only hosts the bench may write to.
const LOOPBACK: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

fn load(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read {path}: {e}")))
        .unwrap_or_else(|e| panic!("{path} is not JSON: {e}"))
}

fn names(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

fn res<T: serde::Serialize>(r: Result<T, DbError>) -> Value {
    match r {
        Ok(v) => serde_json::to_value(v).expect("result serializes"),
        Err(e) => json!({"error": e.to_string()}),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [scenario, target, out] = args.as_slice() else {
        panic!("usage: t5_tags <scenario.json> <target.json> <out.json>");
    };
    let scenario = load(scenario);
    let target = load(target);
    let params = PgParams::from_settings(target.as_object().expect("target is an object")).expect("pg_* keys");
    assert!(LOOPBACK.contains(&params.host.as_str()), "refusing to write to a non-loopback server");

    let mut db = Db::connect(&params).expect("connect (read)");
    let mut writer = TagWriter::connect(&params).expect("connect (tag writer)");
    let disc = db.discover().expect("discovery");

    // The read path still refuses to write, on this very server.
    let count = Query::new("SELECT count(*) FROM tags", vec![]);
    let before = db.run(&count).expect("count tags");
    let refused = db.run(&Query::new("INSERT INTO tags (name, color) VALUES ('t5 read path', '#000000')", vec![]));
    let read_path = json!({
        "refused": matches!(&refused, Err(DbError::Server { detail }) if detail.contains("read-only transaction")),
        "sentence": refused.err().map(|e| e.to_string()),
        "unchanged": db.run(&count).expect("count tags") == before,
    });

    let mut tags: Vec<Tag> = disc.tags.clone();
    let mut checksums: HashMap<String, DbValue> = HashMap::new();
    let mut s = TagSession { db: &mut db, writer: &mut writer, disc: &disc, tags: &mut tags, checksums: &mut checksums };
    let id_of = |s: &TagSession, name: &str| s.tags.iter().find(|t| t.name.as_str() == Some(name)).map(|t| t.id.clone());

    let mut results = Vec::new();
    for step in scenario["steps"].as_array().expect("steps") {
        let op = step["op"].as_str().expect("op");
        let r = match op {
            "create_tag" => res(s.create_tag(step["name"].as_str().unwrap(), step["color"].as_str().unwrap_or_default())),
            "apply_tags" => res(s.apply_tags(&names(&step["paths"]), &names(&step["tags"]))),
            "remove_tags" => res(s.remove_tags(&names(&step["paths"]), &names(&step["tags"]))),
            "search" => {
                let ids: Vec<DbValue> = names(&step["tags"]).iter().filter_map(|n| id_of(&s, n)).collect();
                res(s.search_tagged_demos(&ids))
            }
            "export" => {
                let ids: Vec<DbValue> = names(&step["tags"]).iter().filter_map(|n| id_of(&s, n)).collect();
                res(s.export_tags(Path::new(step["file"].as_str().unwrap()), &ids))
            }
            "delete_tag" => {
                let id = id_of(&s, step["tag"].as_str().unwrap()).unwrap_or(tag_id_from_json(&Value::Null));
                res(s.delete_tag(&id).map(|()| json!({"ok": true})))
            }
            "import_scan" => res(s.scan_tag_import(Path::new(step["file"].as_str().unwrap()))),
            "import_apply" => res(s.apply_tag_import(Path::new(step["file"].as_str().unwrap()), &step["create"])),
            "batch_rollback" => {
                let tag = step["tag"].as_str().unwrap();
                let links: Vec<Linked> = names(&step["paths"]).iter().filter_map(|p| s.tag_demo(p, tag).ok()).collect();
                serde_json::to_value(s.rollback(&links)).unwrap()
            }
            other => panic!("unknown step {other}"),
        };
        results.push(json!({"op": op, "result": r}));
    }
    let report = json!({"read_path": read_path, "steps": results});
    std::fs::write(out, serde_json::to_string_pretty(&report).unwrap()).expect("write results");
}
