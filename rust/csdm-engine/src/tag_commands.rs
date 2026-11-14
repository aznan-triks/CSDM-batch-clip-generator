//! The engine's tag commands (T9): the ten `Command::Tag*` of the 3.5 bridge (`host.py`
//! `_cmd_tags_*` / `_cmd_tag_*`) turned into replies, over csdm-db's `TagSession` (T5).
//!
//! No thread of its own: the real engine (`real.rs`) routes a command for which `is_tag_command`
//! holds to `TagState::serve`, lending its connection, discovery and ports through `TagCx`. Two
//! pieces come from the preview (T3) and run in a preview context (`Ctx`) on the same connection:
//! the demo date (3.5 `_demo_sort_key`, `preview::dates`) and the config-filtered search
//! (`build_run_cfg`, `run_inputs_problem`, `_query_events`, `_build_sequences`).
//!
//! Replies have 3.5's shape: `{"data": …}`.

use crate::command::Command;
use crate::error::EngineError;
use crate::preview::cfg::build_run_cfg;
use crate::preview::clips::{build_sequences, effective_before, run_inputs_problem, whole};
use crate::preview::dates::demo_sort_key;
use crate::preview::dp2::DemoStore;
use crate::preview::{sql, Ctx, Ports};
use chrono::{Days, Local, TimeZone};
use csdm_core::Settings;
use csdm_db::tags::{tag_id_from_json, TagSession, TagWriter};
use csdm_db::{reads, Db, DbError, DbValue, Discovery, PgParams};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

/// `calc_tag_date_range`: `strftime("%d-%m-%Y")`, the date filter's own spelling.
const RANGE_DATE: &str = "%d-%m-%Y";
/// `_demo_sort_key`'s first member when the date is known.
const DATE_KNOWN: u8 = 0;

/// One demo of the config-filtered search, as 3.5 lists it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FoundDemo {
    pub path: String,
    pub name: String,
    pub n_events: usize,
    pub n_seq: usize,
}

/// What the engine lends a tag command.
pub struct TagCx<'a> {
    pub db: &'a mut Db,
    pub disc: &'a mut Discovery,
    /// The connection settings of `db`: the write door opens with the same ones.
    pub params: &'a PgParams,
    /// The preview's ports, demo store and stop flag (`.info` read warnings, config search).
    pub ports: &'a dyn Ports,
    pub demos: &'a DemoStore,
    pub cancel: &'a AtomicBool,
}

/// What the tag commands keep between calls.
#[derive(Default)]
pub struct TagState {
    /// The write door, opened on the first tag command and kept (3.5 opened one per write).
    writer: Option<TagWriter>,
    /// `_tags_active`: the batch's auto-tag on export reads it (T4).
    pub active: Vec<Value>,
    /// `_demo_checksums` of the tag commands, keyed by the current connection.
    checksums: HashMap<String, DbValue>,
}

/// Whether the command is one of the ten tag commands.
pub fn is_tag_command(c: &Command) -> bool {
    use Command::*;
    matches!(
        c,
        TagsSearch { .. } | TagsCalcRange { .. } | TagsSetActive { .. } | TagsApply { .. } | TagsRemove { .. } | TagCreate { .. } | TagDelete { .. } | TagsExport { .. } | TagsImportScan { .. } | TagsImportApply { .. }
    )
}

/// Whether the command reads or writes the database (`tags_set_active` does not).
pub fn needs_database(c: &Command) -> bool {
    is_tag_command(c) && !matches!(c, Command::TagsSetActive { .. })
}

fn ids(values: &[Value]) -> Vec<DbValue> {
    values.iter().map(tag_id_from_json).collect()
}

fn data<T: Serialize>(v: T) -> Value {
    json!({ "data": serde_json::to_value(v).expect("a reply always serializes") })
}

fn select_tag() -> DbError {
    DbError::Invalid("Select at least one tag.".into())
}

/// 3.5 `sorted(set(ids))`: numbers in order, then texts in order (one kind per database).
fn sorted_ids(values: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for v in values {
        if !out.contains(v) {
            out.push(v.clone());
        }
    }
    out.sort_by(|a, b| match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64().partial_cmp(&y.as_f64()).unwrap_or(std::cmp::Ordering::Equal),
        (Value::Number(_), _) => std::cmp::Ordering::Less,
        (_, Value::Number(_)) => std::cmp::Ordering::Greater,
        _ => a.to_string().cmp(&b.to_string()),
    });
    out
}

/// `set_active_tags`: the new selection and the names of its tags, in tag-list order.
pub fn active_reply(active: &[Value], disc: Option<&Discovery>) -> Value {
    let wanted = ids(active);
    let names: Vec<String> = disc.map(|d| d.tags.iter().filter(|t| wanted.contains(&t.id)).map(|t| t.name.py_str()).collect()).unwrap_or_default();
    json!({"data": {"active_tag_ids": sorted_ids(active), "active_tag_names": names}})
}

fn local_date(seconds: f64) -> Option<chrono::NaiveDate> {
    Local.timestamp_opt(seconds.floor() as i64, 0).earliest().map(|d| d.date_naive())
}

/// `calc_tag_date_range` once the tagged demos' sort keys are known: the first and last demo by
/// date, the day after the last, and the count.
pub fn range_reply(mut keys: Vec<(u8, f64)>) -> Value {
    if keys.is_empty() {
        return json!({"data": {"date_start": null, "date_end": null, "date_after": null, "demo_count": 0}});
    }
    // Python `sorted` on (known, seconds): stable, unknown dates last.
    keys.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)));
    let day = |k: &(u8, f64)| if k.0 == DATE_KNOWN { local_date(k.1) } else { None };
    let (start, end) = (day(&keys[0]), day(&keys[keys.len() - 1]));
    let after = end.and_then(|d| d.checked_add_days(Days::new(1)));
    let text = |d: Option<chrono::NaiveDate>| d.map_or(Value::Null, |d| Value::String(d.format(RANGE_DATE).to_string()));
    json!({"data": {"date_start": text(start), "date_end": text(end), "date_after": text(after), "demo_count": keys.len()}})
}

impl TagState {
    /// Forget the write door: the next tag command opens one with the new settings (`connect_db`).
    pub fn reset(&mut self) {
        self.writer = None;
        self.checksums.clear();
    }

    /// Serves a tag command. `cx` is `None` when the database is not connected; only
    /// `tags_set_active` answers then. A command that is not a tag command is refused.
    pub fn serve(&mut self, command: Command, cx: Option<TagCx>) -> Result<Value, EngineError> {
        if let Command::TagsSetActive { tag_ids } = command {
            self.active = tag_ids;
            return Ok(active_reply(&self.active, cx.map(|c| &*c.disc)));
        }
        if !is_tag_command(&command) {
            return Err(EngineError::User(format!("\"{}\" is not a tag command.", command.name())));
        }
        let cx = cx.ok_or_else(|| EngineError::User(format!("Not connected to the database yet. Check {}.", csdm_db::WHERE_DB)))?;
        if self.writer.is_none() {
            self.writer = Some(TagWriter::connect(cx.params)?);
        }
        let writer = self.writer.as_mut().expect("opened above");
        // The tag list lives in the discovery; the session edits it while reading the rest.
        let mut tags = std::mem::take(&mut cx.disc.tags);
        let disc: &Discovery = cx.disc;
        let mut s = TagSession { db: cx.db, writer, disc, tags: &mut tags, checksums: &mut self.checksums };
        let preview = (cx.ports, cx.demos, cx.cancel);
        let out: Result<Value, EngineError> = match command {
            Command::TagsSearch { tag_ids, cfg: None } => s.search_tagged_demos(&ids(&tag_ids)).map(data).map_err(Into::into),
            Command::TagsSearch { tag_ids, cfg: Some(cfg) } => search_by_config(&mut s, &ids(&tag_ids), &cfg, preview),
            Command::TagsCalcRange { tag_ids } => calc_range(&mut s, &ids(&tag_ids), preview),
            Command::TagsApply { demo_paths, tag_names } => s.apply_tags(&demo_paths, &tag_names).map(data).map_err(Into::into),
            Command::TagsRemove { demo_paths, tag_names } => s.remove_tags(&demo_paths, &tag_names).map(data).map_err(Into::into),
            Command::TagCreate { tag_name, color } => s.create_tag(&tag_name, &color).map(data).map_err(Into::into),
            Command::TagDelete { tag_id } => s.delete_tag(&tag_id_from_json(&tag_id)).map(|()| data(json!({"ok": true}))).map_err(Into::into),
            Command::TagsExport { path, tag_ids } => s.export_tags(&path, &ids(&tag_ids.unwrap_or_default())).map(data).map_err(Into::into),
            Command::TagsImportScan { path } => s.scan_tag_import(&path).map(data).map_err(Into::into),
            Command::TagsImportApply { path, tags_to_create } => s.apply_tag_import(&path, &tags_to_create).map(data).map_err(Into::into),
            _ => unreachable!("checked by is_tag_command"),
        };
        cx.disc.tags = tags;
        if matches!(out, Err(EngineError::Db(DbError::Connect { .. } | DbError::Lost { .. }))) {
            // A broken write connection is not reused; the next command opens a fresh one.
            self.writer = None;
        }
        out
    }
}

/// The preview's ports, demo store and stop flag, lent to a preview context.
type Preview<'a> = (&'a dyn Ports, &'a DemoStore, &'a AtomicBool);

/// `search_tagged_demos` with a config: the preview's demos, kept when they carry one of the tags.
fn search_by_config(s: &mut TagSession, tag_ids: &[DbValue], cfg: &Settings, (ports, store, cancel): Preview) -> Result<Value, EngineError> {
    // Read through the run model PREVIEW uses (3.5 audit E17), refused on the same input problems.
    let run = build_run_cfg(cfg);
    if let Some(problem) = run_inputs_problem(&run) {
        return Err(EngineError::User(problem));
    }
    let tagged_query = reads::matches_with_tags(s.disc, tag_ids);
    if !tag_ids.is_empty() && tagged_query.is_none() {
        return Err(EngineError::User("Insufficient DB schema for tag filter.".into()));
    }
    // 3.5 empties the checksum cache before a config search.
    s.checksums.clear();
    let tagged: Option<Vec<DbValue>> = match tagged_query {
        Some(q) => Some(s.db.run(&q)?.into_iter().filter_map(|r| r.into_iter().next()).collect()),
        None => None,
    };
    let (tickrate, before, after) = (whole(&run, "tickrate", None)?, effective_before(&run)?, whole(&run, "after", None)?);
    let mut found = Vec::new();
    {
        let mut cx = Ctx::new(&mut *s.db, s.disc, ports, store, cancel);
        let evts = sql::query_events(&mut cx, &run)?;
        let mut order: Vec<(String, (u8, f64))> = evts.keys().map(|dp| (dp.clone(), (0, 0.0))).collect();
        for (dp, key) in order.iter_mut() {
            *key = demo_sort_key(&mut cx, dp);
        }
        // Python `sorted(key=_demo_sort_key)`: stable.
        order.sort_by(|a, b| a.1 .0.cmp(&b.1 .0).then(a.1 .1.partial_cmp(&b.1 .1).unwrap_or(std::cmp::Ordering::Equal)));
        for (dp, _) in order {
            let evs = &evts[&dp];
            let n_seq = build_sequences(&cx.arena, evs, tickrate, before, after).len();
            found.push(FoundDemo { name: reads::basename(&dp).to_string(), n_events: evs.len(), n_seq, path: dp });
        }
    }
    let mut demos = Vec::new();
    for d in found {
        if let Some(tagged) = &tagged {
            match s.checksum_of(&d.path)? {
                Some(c) if c.is_truthy() && tagged.contains(&c) => {}
                _ => continue,
            }
        }
        demos.push(d);
    }
    let tag_names: Vec<String> = s.tags.iter().filter(|t| tag_ids.contains(&t.id)).map(|t| t.name.py_str()).collect();
    Ok(json!({"data": {"demos": demos, "tag_names": tag_names}}))
}

/// `calc_tag_date_range`: read 32, the caches it fills, then each demo's date (`_demo_sort_key`:
/// `.info` match time, the file date, then the database date read with it).
fn calc_range(s: &mut TagSession, tag_ids: &[DbValue], (ports, store, cancel): Preview) -> Result<Value, EngineError> {
    if tag_ids.is_empty() {
        return Err(select_tag().into());
    }
    let q = reads::tagged_demo_dates(s.disc, tag_ids).ok_or_else(|| EngineError::User("Insufficient DB schema for tags.".into()))?;
    let rows = s.db.run(&q)?;
    let mut cx = Ctx::new(&mut *s.db, s.disc, ports, store, cancel);
    let mut keys = Vec::with_capacity(rows.len());
    for r in rows {
        let path = r[0].py_str();
        if r[1].is_truthy() && !s.checksums.contains_key(&path) {
            s.checksums.insert(path.clone(), r[1].clone());
        }
        if let Some(raw) = r.get(2).filter(|v| !v.is_null()) {
            cx.host.demo_dates.entry(path.clone()).or_insert_with(|| raw.clone());
        }
        keys.push(demo_sort_key(&mut cx, &path));
    }
    Ok(range_reply(keys))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use std::path::PathBuf;

    fn noon(y: i32, m: u32, d: u32) -> f64 {
        let day = NaiveDate::from_ymd_opt(y, m, d).unwrap().and_hms_opt(12, 0, 0).unwrap();
        Local.from_local_datetime(&day).earliest().unwrap().timestamp() as f64
    }

    #[test]
    fn range_spans_first_to_last_dated_demo_and_the_day_after() {
        let r = range_reply(vec![(0, noon(2024, 3, 9)), (1, 0.0), (0, noon(2023, 12, 31)), (0, noon(2024, 2, 29))]);
        // The undated demo sorts last (3.5 `(1, 0)`), so it is the "last demo": no end date.
        assert_eq!(r["data"], json!({"date_start": "31-12-2023", "date_end": null, "date_after": null, "demo_count": 4}));
        let r = range_reply(vec![(0, noon(2024, 2, 28)), (0, noon(2023, 12, 31))]);
        assert_eq!(r["data"], json!({"date_start": "31-12-2023", "date_end": "28-02-2024", "date_after": "29-02-2024", "demo_count": 2}));
    }

    #[test]
    fn range_without_demo_is_all_null() {
        assert_eq!(range_reply(vec![])["data"], json!({"date_start": null, "date_end": null, "date_after": null, "demo_count": 0}));
    }

    #[test]
    fn active_reply_sorts_ids_and_names_follow_the_tag_list() {
        let mut d = Discovery::default();
        for (id, name) in [(7, "Clutch"), (3, "Aces"), (9, "Unused")] {
            d.tags.push(csdm_db::Tag { id: DbValue::Int(id), name: DbValue::text(name), color: DbValue::text("#fff") });
        }
        let r = active_reply(&[json!(3), json!(7), json!(3)], Some(&d));
        assert_eq!(r["data"], json!({"active_tag_ids": [3, 7], "active_tag_names": ["Clutch", "Aces"]}));
        let r = active_reply(&[json!("b"), json!("a")], None);
        assert_eq!(r["data"], json!({"active_tag_ids": ["a", "b"], "active_tag_names": []}));
    }

    #[test]
    fn set_active_needs_no_database_and_other_commands_do() {
        let mut st = TagState::default();
        let r = st.serve(Command::TagsSetActive { tag_ids: vec![json!(4)] }, None).unwrap();
        assert_eq!(r["data"]["active_tag_ids"], json!([4]));
        assert_eq!(st.active, vec![json!(4)]);
        let e = st.serve(Command::TagsCalcRange { tag_ids: vec![json!(4)] }, None).unwrap_err();
        assert!(e.to_string().contains("SETTINGS"), "says where to set the database: {e}");
        let e = st.serve(Command::Hello, None).unwrap_err();
        assert!(e.to_string().contains("not a tag command"));
    }

    #[test]
    fn routing_covers_exactly_the_ten_tag_commands() {
        let p = PathBuf::new();
        let tags = [
            Command::TagsSearch { tag_ids: vec![], cfg: None },
            Command::TagsCalcRange { tag_ids: vec![] },
            Command::TagsSetActive { tag_ids: vec![] },
            Command::TagsApply { demo_paths: vec![], tag_names: vec![] },
            Command::TagsRemove { demo_paths: vec![], tag_names: vec![] },
            Command::TagCreate { tag_name: String::new(), color: String::new() },
            Command::TagDelete { tag_id: Value::Null },
            Command::TagsExport { path: p.clone(), tag_ids: None },
            Command::TagsImportScan { path: p.clone() },
            Command::TagsImportApply { path: p, tags_to_create: Value::Null },
        ];
        assert!(tags.iter().all(is_tag_command));
        assert_eq!(tags.iter().filter(|c| needs_database(c)).count(), 9);
        let tag_names = crate::command::COMMAND_NAMES.iter().filter(|n| n.starts_with("tag")).count();
        assert_eq!(tag_names, tags.len(), "a tag command of the bridge is not routed here");
        assert!(!is_tag_command(&Command::ListDemos));
    }
}
