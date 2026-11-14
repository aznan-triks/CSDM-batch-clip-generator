//! T4: the batch run's tag-on-export flow (3.5 `_run_batch`: already-tagged question, tagging after
//! each recorded demo, rollback after an early stop), on the author's database read-only. The tags
//! are a stand-in that records every call: nothing is written. `DbRunTags` itself is T5's
//! `TagSession` behind a trait (T5 bench); this checks what the run asks of it.
//!
//!     cargo run --release -p csdm-engine --example t4_tags_flow -- <copy of csdm_config.json> <T4 golden case JSON with 2+ jobs>

use csdm_core::Settings;
use csdm_db::tags::{Linked, RollbackReport};
use csdm_db::{Db, DbValue, PgParams};
use csdm_engine::batch::{self, RunIo, RunTags};
use csdm_engine::event::{AskKind, StateName};
use csdm_engine::preview::cfg::build_run_cfg;
use csdm_engine::preview::dp2::DemoStore;
use csdm_engine::preview::{CollectPorts, Ctx};
use csdm_engine::process::{Exec, ExecOutcome, Machine};
use csdm_engine::run::RunControl;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
struct FakeTags {
    already: HashSet<String>,
    active: Vec<String>,
    tagged: Vec<(String, String)>,
    rolled_back: Vec<Linked>,
}

impl RunTags for FakeTags {
    fn already_tagged(&mut self, _cx: &mut Ctx, _tag: &str, paths: &[String]) -> Result<HashSet<String>, String> {
        Ok(paths.iter().filter(|p| self.already.contains(*p)).cloned().collect())
    }
    fn tag_demo(&mut self, _cx: &mut Ctx, demo_path: &str, tag_name: &str) -> Result<Linked, String> {
        self.tagged.push((demo_path.to_string(), tag_name.to_string()));
        Ok(Linked { checksum: DbValue::text(demo_path), tag_id: DbValue::text(tag_name), inserted: true })
    }
    fn rollback(&mut self, _cx: &mut Ctx, links: &[Linked]) -> RollbackReport {
        self.rolled_back.extend(links.iter().cloned());
        RollbackReport { rolled_back: links.len(), failed: 0, kept: 0 }
    }
    fn active_names(&self) -> Vec<String> {
        self.active.clone()
    }
}

/// Captures jobs; with `stop_after` set, asks STOP once that many jobs ran (as the window would).
struct Capture<'a> {
    jobs: Vec<String>,
    stop_after: Option<usize>,
    control: &'a RunControl,
}

impl Exec for Capture<'_> {
    fn exec(&mut self, cmd: &[String], _cfg: &Settings, _t: u64) -> ExecOutcome {
        let job: Value = serde_json::from_str(&std::fs::read_to_string(&cmd[cmd.len() - 1]).expect("job")).expect("job JSON");
        self.jobs.push(job["demoPath"].as_str().unwrap_or_default().to_string());
        if self.stop_after == Some(self.jobs.len()) {
            self.control.stop_after_current.store(true, Ordering::SeqCst);
            self.control.running.store(false, Ordering::SeqCst);
        }
        ExecOutcome { success: true, ..Default::default() }
    }
}

struct Outcome {
    tags: FakeTags,
    jobs: Vec<String>,
    asked: usize,
    logs: Vec<String>,
    states: Vec<(StateName, Value)>,
    preview: bool,
}

fn run(db: &mut Db, disc: &csdm_db::Discovery, store: &DemoStore, cfg: &Settings, tags: FakeTags, answer: Option<&str>, stop_after: Option<usize>) -> Outcome {
    let (ports, control, cancel) = (CollectPorts::default(), RunControl::default(), AtomicBool::new(false));
    control.begin(Machine::from_settings(cfg));
    let mut tags = tags;
    let mut capture = Capture { jobs: Vec::new(), stop_after, control: &control };
    let asked = RefCell::new(0);
    let ask = |kind: AskKind, _m: &str, options: &[String]| {
        assert_eq!(kind, AskKind::Confirm);
        assert_eq!(options, ["Already tagged demos", "include", "ignore"]);
        *asked.borrow_mut() += 1;
        answer.map(str::to_string)
    };
    let home = tempfile::tempdir().expect("home");
    let last = {
        let mut cx = Ctx::new(db, disc, &ports, store, &cancel);
        let mut io = RunIo { control: &control, exec: &mut capture, tags: Some(&mut tags), ask: &ask, selected: None, home: home.path().to_path_buf() };
        batch::run_batch(&mut cx, &mut io, cfg).expect("the run")
    };
    let logs = ports.logs.lock().unwrap().iter().map(|(m, _)| m.clone()).collect();
    let states = ports.states.lock().unwrap().clone();
    let asked = *asked.borrow();
    Outcome { tags, jobs: capture.jobs, asked, logs, states, preview: last.is_some() }
}

fn has(logs: &[String], text: &str) -> bool {
    logs.iter().any(|l| l.contains(text))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let user: Value = serde_json::from_str(&std::fs::read_to_string(&args[1]).expect("config copy")).expect("config JSON");
    let case: Value = serde_json::from_str(&std::fs::read_to_string(&args[2]).expect("case")).expect("case JSON");
    let params = PgParams::from_settings(user.as_object().expect("config object")).expect("connection settings");
    let mut db = Db::connect(&params).unwrap_or_else(|e| panic!("{e}"));
    let disc = db.discover().unwrap_or_else(|e| panic!("{e}"));
    let store = DemoStore::default();
    let root = tempfile::tempdir().expect("root");
    for sub in ["cli", "clips", "cs2cfg"] {
        std::fs::create_dir_all(root.path().join(sub)).expect("root folders");
    }
    std::fs::write(root.path().join("cli").join("csdm.CMD"), "").expect("stand-in CLI");
    let text = case["cfg"].to_string().replace("{ROOT}", &root.path().to_string_lossy().replace('\\', "\\\\"));
    let mut raw: Settings = serde_json::from_str(&text).expect("case cfg");
    raw.insert("tag_enabled".into(), json!(true));
    raw.insert("tag_on_export".into(), json!("Exported"));
    let cfg = build_run_cfg(&raw);

    // Which demos the run records, in order (plain run, no tag already set).
    let plain = run(&mut db, &disc, &store, &cfg, FakeTags::default(), Some("include"), None);
    assert!(plain.jobs.len() >= 2, "the case must record 2 demos or more");
    assert_eq!(plain.asked, 0, "nothing already tagged: no question");
    let recorded: Vec<String> = plain.tags.tagged.iter().map(|(d, _)| d.clone()).collect();
    assert_eq!(recorded.len(), plain.jobs.len(), "each recorded demo is tagged once");
    assert!(plain.tags.tagged.iter().all(|(_, t)| t == "Exported"));
    assert!(plain.tags.rolled_back.is_empty(), "a full run rolls nothing back");
    assert!(has(&plain.logs, &format!("Tagged:{}", plain.jobs.len())));
    println!("plain run        : {} demos recorded and tagged \"Exported\", no question, no rollback", recorded.len());
    let first = recorded[0].clone();
    let already = || FakeTags { already: HashSet::from([first.clone()]), ..Default::default() };

    let inc = run(&mut db, &disc, &store, &cfg, already(), Some("include"), None);
    assert_eq!(inc.asked, 1);
    assert_eq!(inc.jobs.len(), plain.jobs.len(), "include: every demo recorded");
    assert!(has(&inc.logs, "already-tagged demo(s) → included anyway"));
    println!("include          : asked once, {} demos recorded", inc.jobs.len());

    let ign = run(&mut db, &disc, &store, &cfg, already(), Some("ignore"), None);
    assert_eq!(ign.asked, 1);
    assert_eq!(ign.jobs.len(), plain.jobs.len() - 1, "ignore: the tagged demo is skipped");
    assert!(!ign.tags.tagged.iter().any(|(d, _)| *d == first));
    assert!(has(&ign.logs, "SKIP (already tagged)"));
    assert!(ign.states.iter().any(|(n, p)| *n == StateName::DemosUnchecked && p["paths"] == json!([first])));
    println!("ignore           : skipped, unchecked in the picker, {} demos recorded", ign.jobs.len());

    let can = run(&mut db, &disc, &store, &cfg, already(), None, None);
    assert_eq!(can.asked, 1);
    assert!(can.jobs.is_empty(), "cancel: nothing recorded");
    assert!(can.preview, "cancel: the preview is redone");
    let ready = can.states.iter().find(|(n, _)| *n == StateName::PreviewReady).map(|(_, p)| p).expect("preview_ready");
    assert!(ready["sequences"].get(&first).is_none() && ready["events"].get(&first).is_none(), "the tagged demo is out of the new preview");
    assert!(ready["timings"].is_null());
    assert_eq!(can.states.last().map(|(n, _)| *n), Some(StateName::ButtonsIdle));
    println!("cancel           : nothing recorded, preview redone without the tagged demo");

    let stop = run(&mut db, &disc, &store, &cfg, FakeTags::default(), Some("include"), Some(1));
    assert_eq!(stop.jobs.len(), 1, "STOP after the first demo");
    assert_eq!(stop.tags.rolled_back.len(), 1, "the first demo's tag is rolled back");
    assert!(has(&stop.logs, "Rolling back 1 tag(s)") && has(&stop.logs, "Rolled back 1 tag(s)"));
    println!("stop + rollback  : 1 demo recorded, its tag rolled back");

    let act = run(&mut db, &disc, &store, &cfg, FakeTags { active: vec!["A".into(), "B".into()], ..Default::default() }, Some("include"), None);
    assert!(act.tags.tagged.iter().all(|(_, t)| t == "A" || t == "B"));
    assert_eq!(act.tags.tagged.len(), 2 * act.jobs.len(), "the TAGS tab's selection replaces tag_on_export");
    println!("active selection : tags A and B on every recorded demo");
    println!("tag flow: all checks passed (nothing written to the database)");
}
