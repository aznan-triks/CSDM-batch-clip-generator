//! Tags (T5): the only part of csdm-db that changes the database.
//!
//! `Db` stays read-only by construction. Writes go through a separate, explicit door,
//! `TagWriter`: its own connection without the read-only session lock, statements built
//! only in this file from the discovered schema (`_tags_schema`, never table names by hand),
//! every statement still checked against the discovery tables. One transaction per write,
//! committed on success, as 3.5 commits once per write.
//!
//! `TagSession` carries the engine's tag operations, one per `Command::Tags*` of the bridge
//! (`core.py` `apply_tags` … `apply_tag_import`), over the engine's own state
//! (`_tags_list`, `_demo_checksums`). Intended differences from 3.5 (research/03 §8):
//! - a new tag takes its id from the column default (CSDM's `tags_id_seq`); 3.5 drew a random
//!   number and never advanced the sequence. The 3.5 draw stays only for a column without default;
//! - `rollback` removes only the links the batch inserted, by the discovered schema; 3.5 wrote
//!   `checksum_tags` / `tags.id` by hand and also removed links the user had set before the batch;
//! - database errors fail loudly instead of reading as "checksum not found" / "not in database".

use crate::conn::{fetch, writable_config, Db, PgParams, Query};
use crate::discovery::{Discovery, Tag, TagsSchema};
use crate::error::DbError;
use crate::reads::{self, basename};
use crate::value::DbValue;
use postgres::{Client, NoTls, Transaction};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;

/// Colour of a tag created without one (`create_tag`, `scan_tag_import`).
pub const DEFAULT_TAG_COLOR: &str = "#f97316";
/// Version written in an export file (`export_tags`).
const EXPORT_VERSION: u32 = 1;
/// `datetime.now().isoformat(timespec="seconds")`.
const EXPORTED_AT_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";
/// 3.5 `_generate_id_for_type` range, used only when the id column has no default.
const RANDOM_ID_MIN: i64 = 100_000_000;
const RANDOM_ID_MAX: i64 = 9_999_999_999;

/// The write door. Separate connection; nothing else in the crate can write.
pub struct TagWriter {
    client: Client,
}

impl TagWriter {
    pub fn connect(p: &PgParams) -> Result<TagWriter, DbError> {
        // shortcut: no TLS, same as `Db::connect` (CSDM's server sits on the LAN).
        let client = writable_config(p)?
            .connect(NoTls)
            .map_err(|e| DbError::connect(&e, format!("{}:{}", p.host, p.port), p.db.clone(), p.user.clone()))?;
        Ok(TagWriter { client })
    }

    /// One `READ WRITE` transaction: committed when `f` succeeds, rolled back otherwise.
    fn write<T>(&mut self, f: impl FnOnce(&mut Transaction<'_>) -> Result<T, DbError>) -> Result<T, DbError> {
        let mut tx = self.client.build_transaction().read_only(false).start().map_err(|e| DbError::query(&e, "BEGIN"))?;
        let out = f(&mut tx)?;
        tx.commit().map_err(|e| DbError::query(&e, "COMMIT"))?;
        Ok(out)
    }

    /// Writes 23-24 / 27-28: links a match to a tag unless already linked. `true` = inserted.
    pub fn link(&mut self, d: &Discovery, checksum: &DbValue, tag_id: &DbValue) -> Result<bool, DbError> {
        let exists = reads::tag_link_exists(d, checksum, tag_id).ok_or_else(no_junction)?;
        let insert = link_query(d, checksum, tag_id)?;
        self.write(|tx| {
            if !fetch(tx, &exists)?.1.is_empty() {
                return Ok(false);
            }
            fetch(tx, &insert)?;
            Ok(true)
        })
    }

    /// Write 26: removes one link (no error when it is absent, like 3.5).
    pub fn unlink(&mut self, d: &Discovery, checksum: &DbValue, tag_id: &DbValue) -> Result<(), DbError> {
        let q = unlink_query(d, checksum, tag_id)?;
        self.write(|tx| fetch(tx, &q).map(|_| ()))
    }

    /// Write 33: inserts a tag row, returns its id.
    pub fn insert_tag(&mut self, ts: &TagsSchema, name: &str, color: &str) -> Result<DbValue, DbError> {
        let id_col = ts.id_col.as_deref().ok_or_else(no_tag_schema)?;
        let probe = id_default_query(id_col);
        self.write(|tx| {
            let has_default = fetch(tx, &probe)?.1.first().is_some_and(|r| r.first().is_some_and(|v| !v.is_null()));
            let q = insert_tag_query(ts, has_default, name, color)?;
            let rows = fetch(tx, &q)?.1;
            rows.into_iter().next().and_then(|r| r.into_iter().next()).ok_or_else(|| DbError::Server {
                detail: "the new tag row returned no id".into(),
            })
        })
    }

    /// Writes 34-35: removes a tag's links, then the tag.
    pub fn delete_tag(&mut self, ts: &TagsSchema, tag_id: &DbValue) -> Result<(), DbError> {
        let qs = delete_tag_queries(ts, tag_id)?;
        self.write(|tx| qs.iter().try_for_each(|q| fetch(tx, q).map(|_| ())))
    }
}

fn no_junction() -> DbError {
    DbError::Invalid("The tag tables of the database were not found (no table links demos to tags). Check that Base in SETTINGS is CS Demo Manager's database.".into())
}

fn no_tag_schema() -> DbError {
    DbError::Invalid("Tag schema not detected.".into())
}

fn junction(d: &Discovery) -> Result<(&str, &str, &str), DbError> {
    let ts = d.tags_schema.as_ref().ok_or_else(no_junction)?;
    match (ts.junction_table.as_deref(), ts.jt_tag_col.as_deref(), ts.jt_match_col.as_deref()) {
        (Some(t), Some(tag), Some(m)) => Ok((t, tag, m)),
        _ => Err(no_junction()),
    }
}

fn link_query(d: &Discovery, checksum: &DbValue, tag_id: &DbValue) -> Result<Query, DbError> {
    let (jt, tag, m) = junction(d)?;
    Ok(Query::new(format!(r#"INSERT INTO "{jt}" ("{m}","{tag}") VALUES ($1,$2)"#), vec![checksum.clone(), tag_id.clone()]))
}

fn unlink_query(d: &Discovery, checksum: &DbValue, tag_id: &DbValue) -> Result<Query, DbError> {
    let (jt, tag, m) = junction(d)?;
    Ok(Query::new(format!(r#"DELETE FROM "{jt}" WHERE "{m}"=$1 AND "{tag}"=$2"#), vec![checksum.clone(), tag_id.clone()]))
}

fn id_default_query(id_col: &str) -> Query {
    Query::new(
        "SELECT column_default FROM information_schema.columns WHERE table_name='tags' AND column_name=$1",
        vec![DbValue::text(id_col)],
    )
}

/// 3.5 `_generate_id_for_type`, drawn by the server: integer types get a number, uuid and text a UUID.
fn random_id_sql(id_col_type: &str) -> String {
    let t = id_col_type.to_lowercase();
    if t.contains("uuid") {
        "gen_random_uuid()".into()
    } else if ["text", "char"].iter().any(|k| t.contains(k)) && !t.contains("int") {
        "gen_random_uuid()::text".into()
    } else {
        format!("(floor(random() * ({RANDOM_ID_MAX} - {RANDOM_ID_MIN} + 1))::bigint + {RANDOM_ID_MIN})")
    }
}

fn insert_tag_query(ts: &TagsSchema, id_has_default: bool, name: &str, color: &str) -> Result<Query, DbError> {
    let id = ts.id_col.as_deref().ok_or_else(no_tag_schema)?;
    let name_col = ts.name_col.as_deref().ok_or_else(no_tag_schema)?;
    let mut cols = vec![format!(r#""{name_col}""#)];
    let mut vals = vec!["$1".to_string()];
    let mut params = vec![DbValue::text(name)];
    if let Some(c) = ts.color_col.as_deref() {
        cols.push(format!(r#""{c}""#));
        vals.push("$2".into());
        params.push(DbValue::text(color));
    }
    if !id_has_default {
        cols.insert(0, format!(r#""{id}""#));
        vals.insert(0, random_id_sql(&ts.id_col_type));
    }
    Ok(Query::new(format!(r#"INSERT INTO tags ({}) VALUES ({}) RETURNING "{id}""#, cols.join(","), vals.join(",")), params))
}

fn delete_tag_queries(ts: &TagsSchema, tag_id: &DbValue) -> Result<Vec<Query>, DbError> {
    let id = ts.id_col.as_deref().ok_or_else(no_tag_schema)?;
    let mut qs = Vec::new();
    if let (Some(jt), Some(tag)) = (ts.junction_table.as_deref(), ts.jt_tag_col.as_deref()) {
        qs.push(Query::new(format!(r#"DELETE FROM "{jt}" WHERE "{tag}"=$1"#), vec![tag_id.clone()]));
    }
    qs.push(Query::new(format!(r#"DELETE FROM tags WHERE "{id}"=$1"#), vec![tag_id.clone()]));
    Ok(qs)
}

/// A tag id sent by the interface (number or text, `useTagGrid.ts::TagId`).
pub fn tag_id_from_json(v: &Value) -> DbValue {
    match v {
        Value::Null => DbValue::Null,
        Value::Number(n) => n.as_i64().map(DbValue::Int).unwrap_or_else(|| DbValue::text(n.to_string())),
        Value::String(s) => DbValue::text(s.clone()),
        other => DbValue::text(other.to_string()),
    }
}

/// One link a batch asked for; `inserted` = it did not exist before.
#[derive(Debug, Clone, PartialEq)]
pub struct Linked {
    pub checksum: DbValue,
    pub tag_id: DbValue,
    pub inserted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TagCounts {
    pub ok_count: usize,
    pub total: usize,
    pub first_error: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CreatedTag {
    pub tag_id: Value,
    pub tag_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TaggedDemo {
    pub path: String,
    pub name: String,
    pub n_events: usize,
    pub n_seq: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TaggedDemos {
    pub demos: Vec<TaggedDemo>,
    pub tag_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExportReport {
    pub tag_count: usize,
    pub demo_count: usize,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportScan {
    pub missing_tags: Vec<Value>,
    pub assignment_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportReport {
    pub ok_count: usize,
    pub skip_count: usize,
    pub fail_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RollbackReport {
    pub rolled_back: usize,
    pub failed: usize,
    /// Links that existed before the batch, left in place.
    pub kept: usize,
}

/// The engine's tag operations over its own state, borrowed for the call.
pub struct TagSession<'a> {
    pub db: &'a mut Db,
    pub writer: &'a mut TagWriter,
    pub disc: &'a Discovery,
    /// `_tags_list`: kept current by `create_tag` / `delete_tag`.
    pub tags: &'a mut Vec<Tag>,
    /// `_demo_checksums`: demo path -> match key, shared with the preview.
    pub checksums: &'a mut HashMap<String, DbValue>,
}

fn select_one(what: &str) -> DbError {
    DbError::Invalid(format!("Select at least one {what}."))
}

fn first_cell(rows: Vec<Vec<DbValue>>) -> Option<DbValue> {
    rows.into_iter().next().and_then(|r| r.into_iter().next())
}

impl TagSession<'_> {
    fn tag_id_of(&self, name: &str) -> Option<DbValue> {
        self.tags.iter().find(|t| t.name.as_str() == Some(name)).map(|t| t.id.clone())
    }

    /// `_get_demo_checksum`: cache, then each spelling of the path, then the file name.
    pub fn checksum_of(&mut self, demo_path: &str) -> Result<Option<DbValue>, DbError> {
        if let Some(c) = self.checksums.get(demo_path) {
            return Ok(Some(c.clone()));
        }
        if reads::checksum_by_path(self.disc, demo_path).is_none() {
            log::error!(target: "csdm_db", "checksum: matches has no demo path or key column");
            return Ok(None);
        }
        let abs = std::path::absolute(demo_path).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| demo_path.to_string());
        let spellings = [demo_path.to_string(), abs.clone(), abs.replace('\\', "/"), abs.replace('/', "\\")];
        let mut queries: Vec<Query> = spellings.iter().filter_map(|p| reads::checksum_by_path(self.disc, p)).collect();
        queries.extend(reads::checksum_by_file_name(self.disc, basename(demo_path)));
        for q in queries {
            if let Some(c) = first_cell(self.db.run(&q)?) {
                self.checksums.insert(demo_path.to_string(), c.clone());
                return Ok(Some(c));
            }
        }
        log::warn!(target: "csdm_db", "checksum not found for {demo_path:?}");
        if let Some(q) = reads::sample_demos(self.disc) {
            for r in self.db.run(&q)? {
                log::warn!(target: "csdm_db", "  sample: {:?}", r);
            }
        }
        Ok(None)
    }

    /// The demo's match key, or the per-item sentence 3.5 reports.
    fn require_checksum(&mut self, demo_path: &str) -> Result<DbValue, String> {
        match self.checksum_of(demo_path).map_err(|e| e.to_string())? {
            Some(c) if c.is_truthy() => Ok(c),
            _ => Err(format!("Checksum not found for {}", basename(demo_path))),
        }
    }

    fn require_tag(&self, tag_name: &str) -> Result<DbValue, String> {
        self.tag_id_of(tag_name).ok_or_else(|| format!("Tag '{tag_name}' is not in the tag list. Reload the tags."))
    }

    /// `_tag_demo`: one tag on one demo. `Err` = the sentence for this item.
    pub fn tag_demo(&mut self, demo_path: &str, tag_name: &str) -> Result<Linked, String> {
        junction(self.disc).map_err(|e| e.to_string())?;
        let tag_id = self.require_tag(tag_name)?;
        let checksum = self.require_checksum(demo_path)?;
        let inserted = self.writer.link(self.disc, &checksum, &tag_id).map_err(|e| e.to_string())?;
        log::info!(target: "csdm_db", "tag {tag_name:?} on {}: {}", basename(demo_path), if inserted { "inserted" } else { "already there" });
        Ok(Linked { checksum, tag_id, inserted })
    }

    /// `_untag_demo`.
    pub fn untag_demo(&mut self, demo_path: &str, tag_name: &str) -> Result<(), String> {
        junction(self.disc).map_err(|e| e.to_string())?;
        let tag_id = self.require_tag(tag_name)?;
        let checksum = self.require_checksum(demo_path)?;
        self.writer.unlink(self.disc, &checksum, &tag_id).map_err(|e| e.to_string())
    }

    /// `apply_tags` (command `tags_apply`): every tag on every demo, tag by tag.
    pub fn apply_tags(&mut self, demo_paths: &[String], tag_names: &[String]) -> Result<TagCounts, DbError> {
        check_selection(demo_paths, tag_names)?;
        let mut counts = TagCounts { ok_count: 0, total: demo_paths.len() * tag_names.len(), first_error: String::new() };
        for tag in tag_names {
            for dp in demo_paths {
                let r = self.tag_demo(dp, tag).map(|_| ());
                counts.add(r);
            }
        }
        Ok(counts)
    }

    /// `remove_tags` (command `tags_remove`): demo by demo.
    pub fn remove_tags(&mut self, demo_paths: &[String], tag_names: &[String]) -> Result<TagCounts, DbError> {
        check_selection(demo_paths, tag_names)?;
        let mut counts = TagCounts { ok_count: 0, total: demo_paths.len() * tag_names.len(), first_error: String::new() };
        for dp in demo_paths {
            for tag in tag_names {
                let r = self.untag_demo(dp, tag);
                counts.add(r);
            }
        }
        Ok(counts)
    }

    /// `create_tag` (command `tag_create`).
    pub fn create_tag(&mut self, name: &str, color: &str) -> Result<CreatedTag, DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("A tag needs a name.".into()));
        }
        let ts = self.disc.tags_schema.as_ref().filter(|t| t.name_col.is_some()).ok_or_else(no_tag_schema)?;
        let stored = if color.is_empty() { DEFAULT_TAG_COLOR } else { color };
        let id = self.writer.insert_tag(ts, name, stored)?;
        self.tags.push(Tag { id: id.clone(), name: DbValue::text(name), color: DbValue::text(color) });
        Ok(CreatedTag { tag_id: id.to_json_scalar(), tag_name: name.to_string() })
    }

    /// `delete_tag` (command `tag_delete`).
    pub fn delete_tag(&mut self, tag_id: &DbValue) -> Result<(), DbError> {
        if tag_id.is_null() {
            return Err(DbError::Invalid("A tag id is required.".into()));
        }
        let ts = self.disc.tags_schema.as_ref().filter(|t| t.id_col.is_some()).ok_or_else(no_tag_schema)?;
        self.writer.delete_tag(ts, tag_id)?;
        self.tags.retain(|t| &t.id != tag_id);
        Ok(())
    }

    /// Batch stopped early (`_run_batch` rollback): removes only the links the batch inserted.
    pub fn rollback(&mut self, links: &[Linked]) -> RollbackReport {
        let mut r = RollbackReport { rolled_back: 0, failed: 0, kept: 0 };
        for l in links {
            if !l.inserted {
                r.kept += 1;
                continue;
            }
            match self.writer.unlink(self.disc, &l.checksum, &l.tag_id) {
                Ok(()) => r.rolled_back += 1,
                Err(e) => {
                    log::error!(target: "csdm_db", "tag rollback failed: {}", e.detail());
                    r.failed += 1;
                }
            }
        }
        r
    }

    fn names_of(&self, tag_ids: &[DbValue]) -> Vec<String> {
        self.tags.iter().filter(|t| tag_ids.contains(&t.id)).map(|t| t.name.py_str()).collect()
    }

    /// `search_tagged_demos` without a config (command `tags_search`, `cfg` absent).
    /// The config-filtered search runs the preview query (T3) and belongs to the engine.
    pub fn search_tagged_demos(&mut self, tag_ids: &[DbValue]) -> Result<TaggedDemos, DbError> {
        if tag_ids.is_empty() {
            return Err(select_one("tag"));
        }
        let q = reads::demos_with_tags(self.disc, tag_ids).ok_or_else(|| DbError::Invalid("Insufficient DB schema for tags.".into()))?;
        let mut demos = Vec::new();
        for r in self.db.run(&q)? {
            let dp = r[0].py_str();
            if r[1].is_truthy() && !self.checksums.contains_key(&dp) {
                self.checksums.insert(dp.clone(), r[1].clone());
            }
            demos.push(TaggedDemo { name: basename(&dp).to_string(), path: dp, n_events: 0, n_seq: 0 });
        }
        Ok(TaggedDemos { demos, tag_names: self.names_of(tag_ids) })
    }

    /// `export_tags` (command `tags_export`): every tag, or `tag_ids` when not empty.
    pub fn export_tags(&mut self, path: &Path, tag_ids: &[DbValue]) -> Result<ExportReport, DbError> {
        let ts = self.disc.tags_schema.as_ref().ok_or_else(no_tag_schema)?;
        junction(self.disc).map_err(|_| no_tag_schema())?;
        if ts.id_col.is_none() || ts.name_col.is_none() {
            return Err(no_tag_schema());
        }
        let color_col = ts.color_col.is_some();
        let list = reads::export_tag_list(self.disc).ok_or_else(no_tag_schema)?;
        let tag_rows: Vec<_> = self.db.run(&list)?.into_iter().filter(|r| tag_ids.is_empty() || tag_ids.contains(&r[0])).collect();
        let tag_map: Vec<(DbValue, Value)> = tag_rows
            .iter()
            .map(|r| {
                let color = match r.get(2) {
                    Some(c) if color_col && c.is_truthy() => c.to_json_scalar(),
                    _ => json!(""),
                };
                (r[0].clone(), json!({"name": r[1].to_json_scalar(), "color": color}))
            })
            .collect();
        let links = reads::export_tag_links(self.disc, tag_ids).ok_or_else(no_tag_schema)?;
        let mut by_chk: Vec<(String, Map<String, Value>)> = Vec::new();
        for row in self.db.run(&links)? {
            let Some((_, tag)) = tag_map.iter().find(|(id, _)| id == &row[1]) else { continue };
            let chk = row[0].py_str();
            let pos = match by_chk.iter().position(|(c, _)| c == &chk) {
                Some(p) => p,
                None => {
                    let demo_name = match row.get(2) {
                        Some(v) if v.is_truthy() => basename(&v.py_str()).to_string(),
                        _ => String::new(),
                    };
                    let mut a = Map::new();
                    a.insert("checksum".into(), json!(chk));
                    a.insert("demo_name".into(), json!(demo_name));
                    a.insert("tags".into(), json!([]));
                    by_chk.push((chk, a));
                    by_chk.len() - 1
                }
            };
            let names = by_chk[pos].1["tags"].as_array_mut().expect("tags is a list");
            if !names.contains(&tag["name"]) {
                names.push(tag["name"].clone());
            }
        }
        let out = json!({
            "version": EXPORT_VERSION,
            "exported_at": chrono::Local::now().format(EXPORTED_AT_FORMAT).to_string(),
            "tags": tag_map.iter().map(|(_, t)| t.clone()).collect::<Vec<_>>(),
            "assignments": by_chk.iter().map(|(_, a)| Value::Object(a.clone())).collect::<Vec<_>>(),
        });
        let text = serde_json::to_string_pretty(&out).expect("a JSON tree always serializes");
        std::fs::write(path, text).map_err(|e| {
            DbError::Invalid(format!("Could not write {}: {e}. Pick a folder you can write to.", path.display()))
        })?;
        Ok(ExportReport { tag_count: tag_map.len(), demo_count: by_chk.len(), path: path.display().to_string() })
    }

    /// `scan_tag_import` (command `tags_import_scan`): tags the file names that do not exist yet.
    pub fn scan_tag_import(&self, path: &Path) -> Result<ImportScan, DbError> {
        let data = read_import_file(path)?;
        let assignments = list(&data, "assignments");
        let mut wanted: Vec<String> =
            assignments.iter().flat_map(|a| list(a, "tags")).filter_map(|t| t.as_str().map(str::to_string)).collect();
        wanted.sort();
        wanted.dedup();
        let defs = list(&data, "tags");
        let missing_tags = wanted
            .into_iter()
            .filter(|n| self.tag_id_of(n).is_none())
            .map(|n| {
                let color = defs
                    .iter()
                    .find(|t| t.get("name").and_then(Value::as_str) == Some(n.as_str()))
                    .and_then(|t| t.get("color"))
                    .filter(|c| truthy_json(c))
                    .cloned()
                    .unwrap_or_else(|| json!(DEFAULT_TAG_COLOR));
                json!({"name": n, "color": color})
            })
            .collect();
        Ok(ImportScan { missing_tags, assignment_count: assignments.len() })
    }

    /// `apply_tag_import` (command `tags_import_apply`): creates `tags_to_create`, then replays
    /// the file's assignments by checksum.
    pub fn apply_tag_import(&mut self, path: &Path, tags_to_create: &Value) -> Result<ImportReport, DbError> {
        for t in tags_to_create.as_array().map(Vec::as_slice).unwrap_or_default() {
            let name = t.get("name").and_then(Value::as_str).unwrap_or_default().trim();
            if name.is_empty() || self.tag_id_of(name).is_some() {
                continue;
            }
            let color = t.get("color").and_then(Value::as_str).unwrap_or_default();
            self.create_tag(name, color)?;
        }
        let data = read_import_file(path)?;
        if self.disc.find_col("matches", &["checksum", "id", "match_id"]).is_none() {
            return Err(DbError::Invalid("Cannot find checksum column in matches table.".into()));
        }
        let mut r = ImportReport { ok_count: 0, skip_count: 0, fail_count: 0 };
        for a in list(&data, "assignments") {
            let chk = py_text(a.get("checksum")).trim().to_string();
            let key = DbValue::text(chk.clone());
            let known = match reads::checksum_exists(self.disc, &key) {
                Some(q) if !chk.is_empty() => !self.db.run(&q)?.is_empty(),
                _ => false,
            };
            if !known {
                r.skip_count += 1;
                continue;
            }
            for name in list(a, "tags") {
                let Some(tag_id) = name.as_str().and_then(|n| self.tag_id_of(n)) else {
                    r.fail_count += 1;
                    continue;
                };
                match self.writer.link(self.disc, &key, &tag_id) {
                    Ok(_) => r.ok_count += 1,
                    Err(e) => {
                        log::error!(target: "csdm_db", "import: tag link failed: {}", e.detail());
                        r.fail_count += 1;
                    }
                }
            }
        }
        Ok(r)
    }
}

impl TagCounts {
    fn add(&mut self, r: Result<(), String>) {
        match r {
            Ok(()) => self.ok_count += 1,
            Err(e) => {
                log::warn!(target: "csdm_db", "tag item failed: {e}");
                if self.first_error.is_empty() {
                    self.first_error = e;
                }
            }
        }
    }
}

fn check_selection(demo_paths: &[String], tag_names: &[String]) -> Result<(), DbError> {
    if demo_paths.is_empty() {
        return Err(select_one("demo"));
    }
    if tag_names.is_empty() {
        return Err(select_one("tag"));
    }
    Ok(())
}

fn list<'v>(v: &'v Value, key: &str) -> &'v [Value] {
    v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

fn truthy_json(v: &Value) -> bool {
    !matches!(v, Value::Null | Value::Bool(false)) && v.as_str() != Some("")
}

/// Python `str(value)` of a checksum read from an import file.
fn py_text(v: Option<&Value>) -> String {
    match v {
        None => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "None".into(),
        Some(other) => other.to_string(),
    }
}

/// `_read_tags_import_file`: an object with "assignments", or a sentence saying what to pick.
fn read_import_file(path: &Path) -> Result<Value, DbError> {
    let p = path.display();
    let text = std::fs::read_to_string(path)
        .map_err(|e| DbError::Invalid(format!("Could not read {p}: {e}. Pick an existing tags export file.")))?;
    let data: Value = serde_json::from_str(&text).map_err(|_| {
        DbError::Invalid(format!("{p} is not a tags export file (it is not valid JSON). Pick a file made with Export."))
    })?;
    if !data.get("assignments").is_some_and(|_| data.is_object()) {
        return Err(DbError::Invalid(format!("{p} is not a tags export file. Pick a file made with Export.")));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discovery::Dict;
    use crate::guard::check_tables;

    fn schema(junction: Option<&str>) -> TagsSchema {
        TagsSchema {
            id_col: Some("id".into()),
            id_col_type: "bigint".into(),
            name_col: Some("name".into()),
            color_col: Some("color".into()),
            junction_table: junction.map(Into::into),
            jt_tag_col: junction.map(|_| "tag_id".into()),
            jt_match_col: junction.map(|_| "checksum".into()),
            jt_col_types: Dict::new(),
        }
    }

    fn disc(junction: &str) -> Discovery {
        Discovery { tags_schema: Some(schema(Some(junction))), ..Default::default() }
    }

    #[test]
    fn writes_follow_the_discovered_junction() {
        let (c, t) = (DbValue::text("abc"), DbValue::Int(7));
        for jt in ["checksum_tags", "match_tags"] {
            let d = disc(jt);
            let link = link_query(&d, &c, &t).unwrap();
            assert_eq!(link.sql, format!(r#"INSERT INTO "{jt}" ("checksum","tag_id") VALUES ($1,$2)"#));
            let unlink = unlink_query(&d, &c, &t).unwrap();
            assert_eq!(unlink.sql, format!(r#"DELETE FROM "{jt}" WHERE "checksum"=$1 AND "tag_id"=$2"#));
            for q in [link, unlink] {
                check_tables(&q.sql).unwrap();
                assert_eq!(q.params, vec![c.clone(), t.clone()]);
            }
        }
        assert!(matches!(link_query(&Discovery::default(), &c, &t), Err(DbError::Invalid(_))));
    }

    #[test]
    fn new_tag_takes_the_column_default_when_there_is_one() {
        let ts = schema(Some("checksum_tags"));
        let q = insert_tag_query(&ts, true, "clutch", "#112233").unwrap();
        assert_eq!(q.sql, r#"INSERT INTO tags ("name","color") VALUES ($1,$2) RETURNING "id""#);
        assert_eq!(q.params, vec![DbValue::text("clutch"), DbValue::text("#112233")]);
        let q = insert_tag_query(&ts, false, "clutch", "#112233").unwrap();
        assert!(q.sql.starts_with(r#"INSERT INTO tags ("id","name","color") VALUES ((floor(random()"#), "{}", q.sql);
        let no_color = TagsSchema { color_col: None, ..ts.clone() };
        assert_eq!(insert_tag_query(&no_color, true, "x", "#1").unwrap().params, vec![DbValue::text("x")]);
        for q in [insert_tag_query(&ts, true, "a", "b").unwrap(), id_default_query("id")] {
            check_tables(&q.sql).unwrap();
        }
    }

    #[test]
    fn random_id_follows_the_column_type_like_3_5() {
        assert_eq!(random_id_sql("uuid"), "gen_random_uuid()");
        assert_eq!(random_id_sql("character varying"), "gen_random_uuid()::text");
        assert!(random_id_sql("bigint").contains(&RANDOM_ID_MIN.to_string()));
        assert!(random_id_sql("integer").contains("bigint"));
        assert!(random_id_sql("whatever").contains("random()"));
    }

    #[test]
    fn deleting_a_tag_clears_its_links_first() {
        let qs = delete_tag_queries(&schema(Some("checksum_tags")), &DbValue::Int(3)).unwrap();
        let sql: Vec<_> = qs.iter().map(|q| q.sql.as_str()).collect();
        assert_eq!(sql, [r#"DELETE FROM "checksum_tags" WHERE "tag_id"=$1"#, r#"DELETE FROM tags WHERE "id"=$1"#]);
        let alone = delete_tag_queries(&schema(None), &DbValue::Int(3)).unwrap();
        assert_eq!(alone.len(), 1);
    }

    #[test]
    fn interface_ids_and_import_checksums_read_like_3_5() {
        assert_eq!(tag_id_from_json(&json!(42)), DbValue::Int(42));
        assert_eq!(tag_id_from_json(&json!("u-1")), DbValue::text("u-1"));
        assert_eq!(tag_id_from_json(&Value::Null), DbValue::Null);
        assert_eq!(py_text(Some(&json!(123))), "123");
        assert_eq!(py_text(Some(&json!(" ab "))), " ab ");
        assert_eq!(py_text(None), "");
    }

    #[test]
    fn import_file_errors_say_what_to_pick() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("none.json");
        let e = read_import_file(&missing).unwrap_err().to_string();
        assert!(e.contains("Pick an existing tags export file."), "{e}");
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, "{nope").unwrap();
        assert!(read_import_file(&bad).unwrap_err().to_string().contains("(it is not valid JSON)"));
        std::fs::write(&bad, r#"{"tags": []}"#).unwrap();
        assert!(read_import_file(&bad).unwrap_err().to_string().ends_with("is not a tags export file. Pick a file made with Export."));
        std::fs::write(&bad, r#"[{"assignments": []}]"#).unwrap();
        assert!(read_import_file(&bad).is_err());
        std::fs::write(&bad, r#"{"assignments": []}"#).unwrap();
        assert!(read_import_file(&bad).is_ok());
    }
}
