//! Tag on export during a run (3.5 `_tag_demo`, the already-tagged check, the rollback), through
//! T5's `TagSession`: the schema is the discovered one, and a rollback removes only the links this
//! run inserted (3.5 removed links the user had set before; research/03 §8).

use crate::preview::Ctx;
use csdm_db::tags::{Linked, RollbackReport, TagSession, TagWriter};
use csdm_db::{reads, DbValue, PgParams, Tag};
use std::collections::HashSet;

/// What the run asks of tags. The run passes its own context: reads go through its connection.
pub trait RunTags {
    /// The demos of `paths` that already carry `tag_name`. `Err` = why it could not be read.
    fn already_tagged(&mut self, cx: &mut Ctx, tag_name: &str, paths: &[String]) -> Result<HashSet<String>, String>;
    /// `_tag_demo`. `Err` = the sentence for this demo.
    fn tag_demo(&mut self, cx: &mut Ctx, demo_path: &str, tag_name: &str) -> Result<Linked, String>;
    fn rollback(&mut self, cx: &mut Ctx, links: &[Linked]) -> RollbackReport;
    /// `_get_active_tag_names`: the TAGS tab's selection, which replaces `tag_on_export`.
    fn active_names(&self) -> Vec<String>;
}

/// Tags over the database: the write door opens on the first write only.
pub struct DbRunTags {
    params: PgParams,
    writer: Option<TagWriter>,
    tags: Vec<Tag>,
    active: Vec<String>,
}

impl DbRunTags {
    /// `tags` = the discovered tag list; `active` = the TAGS tab's selection (empty: `tag_on_export`).
    pub fn new(params: PgParams, tags: Vec<Tag>, active: Vec<String>) -> Self {
        DbRunTags { params, writer: None, tags, active }
    }

    fn session<'s>(&'s mut self, cx: &'s mut Ctx) -> Result<TagSession<'s>, String> {
        if self.writer.is_none() {
            self.writer = Some(TagWriter::connect(&self.params).map_err(|e| e.to_string())?);
        }
        let writer = self.writer.as_mut().expect("opened above");
        Ok(TagSession { db: cx.db, writer, disc: cx.disc, tags: &mut self.tags, checksums: &mut cx.host.demo_checksums })
    }
}

impl RunTags for DbRunTags {
    fn already_tagged(&mut self, cx: &mut Ctx, tag_name: &str, paths: &[String]) -> Result<HashSet<String>, String> {
        let Some(tag_id) = self.tags.iter().find(|t| t.name.as_str() == Some(tag_name)).map(|t| t.id.clone()) else {
            return Ok(HashSet::new());
        };
        // 3.5 also needed the match key and demo path columns; `checksum_of` checks them itself.
        let Some(q) = reads::matches_with_tag(cx.disc, &tag_id) else {
            return Ok(HashSet::new());
        };
        let tagged: Vec<DbValue> = cx.db.run(&q).map_err(|e| e.to_string())?.into_iter().filter_map(|r| r.into_iter().next()).collect();
        let mut found = HashSet::new();
        // `checksum_of` only reads, but the session holds the write door: it opens here (3.5 opened
        // a fresh connection for this check too).
        let mut s = self.session(cx)?;
        for dp in paths {
            let chk = s.checksum_of(dp).map_err(|e| e.to_string())?;
            if chk.is_some_and(|c| c.is_truthy() && tagged.contains(&c)) {
                found.insert(dp.clone());
            }
        }
        Ok(found)
    }

    fn tag_demo(&mut self, cx: &mut Ctx, demo_path: &str, tag_name: &str) -> Result<Linked, String> {
        self.session(cx)?.tag_demo(demo_path, tag_name)
    }

    fn rollback(&mut self, cx: &mut Ctx, links: &[Linked]) -> RollbackReport {
        match self.session(cx) {
            Ok(mut s) => s.rollback(links),
            Err(e) => {
                cx.ports.trace(&format!("tag rollback: {e}"));
                RollbackReport { rolled_back: 0, failed: links.iter().filter(|l| l.inserted).count(), kept: links.iter().filter(|l| !l.inserted).count() }
            }
        }
    }

    fn active_names(&self) -> Vec<String> {
        self.active.clone()
    }
}
