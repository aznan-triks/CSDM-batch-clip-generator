//! The TAGS tab (T9): Tags, Tag Range and Operations (3.5 `tabs/TagsTab.tsx`, `tabs/tagCards/`).
//!
//! The three cards share the active-tag selection through the persisted `ui_active_tags`
//! setting, never through state of their own (3.5 spec Section C); the engine's own active set
//! follows it (`tags_set_active`). The tag list is what the last `connect_db` read
//! (`Link::database`); every write is followed by a fresh read so each reader agrees.
//! Search text, sort, found demos and picks are view state: kept while the app runs, never saved.
//!
//! Drawn in the default card style (`timeline`); the two other styles are T12's.

mod ops_card;
mod parts;
mod range_card;
mod tags_card;

use crate::grid::{CardCx, CardDecl, TabView};
use crate::link::DbState;
use csdm_core::ui_values::{TAG_EXPORT_FILE, TAG_PRESET_COLORS};
use csdm_engine::Command;
use eframe::egui;
use serde_json::{json, Value};
use std::path::PathBuf;

/// A tag as the database lists it: id (number or text), name, colour.
#[derive(Clone, Debug, PartialEq)]
pub struct TagRow {
    pub id: Value,
    pub name: String,
    pub color: String,
}

/// Sort orders of the tag palette (`useTagGrid.ts::TAG_SORTS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sort { Name, Color, ActiveFirst }

pub const SORTS: [(Sort, &str); 3] = [(Sort::Name, "name"), (Sort::Color, "color"), (Sort::ActiveFirst, "active-first")];

/// How the found list was found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum By { Tag, Config }

/// A demo the Operations search found.
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub path: String,
    pub name: String,
}

/// The computed range (`tags_calc_range`).
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Range {
    pub start: Option<String>,
    pub end: Option<String>,
    pub after: Option<String>,
    pub count: u64,
}

/// What a request in flight is for.
#[derive(Clone, Debug)]
enum Job {
    Active,
    Create(String),
    Delete(Value, String),
    Range,
    Search(By),
    Apply(usize),
    Remove(usize),
    Export,
    ImportScan(PathBuf),
    ImportApply,
}

/// The Tags card's view state (`useTagGrid.ts`).
pub struct GridModel {
    pub search: String,
    pub sort: Sort,
    pub status: String,
    pub form_open: bool,
    pub name: String,
    pub color: String,
    pub pending_delete: Option<(Value, String)>,
}

/// The Tag Range card's view state (`useTagRange.ts`).
#[derive(Default)]
pub struct RangeModel {
    pub busy: bool,
    pub range: Option<Range>,
    pub status: String,
}

/// The Operations card's view state (`useTagOps.ts`).
#[derive(Default)]
pub struct OpsModel {
    pub found: Vec<Found>,
    pub found_by: Option<By>,
    /// Picked paths, in the order they were picked.
    pub picked: Vec<String>,
    pub pending_remove: bool,
    pub status: String,
}

/// Where the export goes and which file the import reads: the native dialogs, or a test's own.
pub type OpenPicker = Box<dyn FnMut() -> Option<PathBuf>>;
pub type SavePicker = Box<dyn FnMut(&str) -> Option<PathBuf>>;

pub struct TagsTab {
    pick_open: OpenPicker,
    pick_save: SavePicker,
    /// The selection last told to the engine.
    sent_active: Option<Value>,
    waiting: Vec<(u64, Job)>,
    pub grid: GridModel,
    pub range: RangeModel,
    pub ops: OpsModel,
    /// Header counts, refreshed by the bodies (`cards()` cannot read the settings).
    in_use: usize,
}

impl Default for TagsTab {
    fn default() -> Self {
        Self::new()
    }
}

impl TagsTab {
    /// The tab with the native file dialogs.
    pub fn new() -> Self {
        Self::with_pickers(
            Box::new(|| rfd::FileDialog::new().add_filter("JSON", &["json"]).pick_file()),
            Box::new(|name| rfd::FileDialog::new().add_filter("JSON", &["json"]).set_file_name(name).save_file()),
        )
    }

    pub fn with_pickers(pick_open: OpenPicker, pick_save: SavePicker) -> Self {
        Self {
            pick_open,
            pick_save,
            sent_active: None,
            waiting: Vec::new(),
            grid: GridModel { search: String::new(), sort: Sort::Name, status: String::new(), form_open: false, name: String::new(), color: TAG_PRESET_COLORS[0].into(), pending_delete: None },
            range: RangeModel::default(),
            ops: OpsModel::default(),
            in_use: 0,
        }
    }

    /// Whether a request of the tab is still waiting for its answer.
    pub fn busy(&self) -> bool {
        !self.waiting.is_empty()
    }

    fn ask(&mut self, cx: &mut CardCx, command: Command, job: Job) {
        let id = cx.link.request(cx.now, command);
        self.waiting.push((id, job));
    }

    /// Once per body: tell the engine a new selection, then read the answers that came.
    fn poll(&mut self, cx: &mut CardCx) {
        let active = active_ids(cx);
        self.in_use = names_of(&tags(cx), &active).len();
        let current = Value::Array(active);
        if cx.link.settings_loaded && self.sent_active.as_ref() != Some(&current) {
            let tag_ids = current.as_array().cloned().unwrap_or_default();
            self.sent_active = Some(current);
            self.ask(cx, Command::TagsSetActive { tag_ids }, Job::Active);
        }
        let mut still = Vec::new();
        for (id, job) in std::mem::take(&mut self.waiting) {
            match cx.link.take_reply(id) {
                Some(result) => self.finish(cx, job, result),
                None => still.push((id, job)),
            }
        }
        self.waiting.extend(still);
    }

    fn finish(&mut self, cx: &mut CardCx, job: Job, result: Result<Value, String>) {
        let data = result.map(|v| v.get("data").cloned().unwrap_or(Value::Null));
        let num = |d: &Value, k: &str| d.get(k).and_then(Value::as_u64).unwrap_or(0);
        match (job, data) {
            (Job::Active, Ok(_)) => {}
            (Job::Active, Err(e)) => self.grid.status = e,
            (Job::Create(name), Ok(_)) => {
                let g = &mut self.grid;
                g.name.clear();
                g.color = TAG_PRESET_COLORS[0].into();
                g.form_open = false;
                g.status = format!("Created \"{name}\".");
                cx.link.reconnect(cx.now);
            }
            (Job::Delete(id, name), Ok(_)) => {
                let kept: Vec<Value> = active_ids(cx).into_iter().filter(|a| *a != id).collect();
                cx.link.set(cx.now, "ui_active_tags", Value::Array(kept));
                self.grid.status = format!("Deleted \"{name}\".");
                cx.link.reconnect(cx.now);
            }
            (Job::Create(_) | Job::Delete(..), Err(e)) => self.grid.status = e,
            (Job::Range, r) => {
                self.range.busy = false;
                match r {
                    Ok(d) => {
                        let text = |k: &str| d.get(k).and_then(Value::as_str).map(String::from);
                        let range = Range { start: text("date_start"), end: text("date_end"), after: text("date_after"), count: num(&d, "demo_count") };
                        // The dates themselves are drawn; only a gap is news.
                        self.range.status = if range.start.is_some() && range.end.is_some() { String::new() } else { format!("{} demo(s) -- dates unavailable.", range.count) };
                        self.range.range = Some(range);
                    }
                    Err(e) => self.range.status = e,
                }
            }
            (Job::Search(by), Ok(d)) => {
                let demos: Vec<Found> = d
                    .get("demos")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().map(|x| Found { path: str_of(x, "path"), name: str_of(x, "name") }).collect())
                    .unwrap_or_default();
                self.ops.status = format!("{} demo(s) found.", demos.len());
                self.ops.found = demos;
                self.ops.found_by = Some(by);
                self.ops.picked.clear();
            }
            (Job::Apply(n), Ok(d)) => self.ops.status = counts(&d, &format!("Tagged {n} demo(s).")),
            (Job::Remove(n), Ok(d)) => self.ops.status = counts(&d, &format!("Removed from {n} demo(s).")),
            (Job::Export, Ok(d)) => self.ops.status = format!("Exported {} tag(s), {} demo(s).", num(&d, "tag_count"), num(&d, "demo_count")),
            (Job::ImportScan(path), Ok(d)) => {
                let tags_to_create = d.get("missing_tags").cloned().unwrap_or_else(|| json!([]));
                self.ask(cx, Command::TagsImportApply { path, tags_to_create }, Job::ImportApply);
            }
            (Job::ImportApply, Ok(d)) => {
                self.ops.status = format!("Imported: {} OK, {} skipped, {} failed.", num(&d, "ok_count"), num(&d, "skip_count"), num(&d, "fail_count"));
                cx.link.reconnect(cx.now);
            }
            (Job::Search(_) | Job::Apply(_) | Job::Remove(_) | Job::Export | Job::ImportScan(_) | Job::ImportApply, Err(e)) => self.ops.status = e,
        }
    }

    // ---- Tags card actions (useTagGrid.ts) ----

    fn toggle(&mut self, cx: &mut CardCx, id: &Value) {
        let mut active = active_ids(cx);
        match active.iter().position(|a| a == id) {
            Some(i) => {
                active.remove(i);
            }
            None => active.push(id.clone()),
        }
        cx.link.set(cx.now, "ui_active_tags", Value::Array(active));
    }

    fn deselect_all(&mut self, cx: &mut CardCx) {
        cx.link.set(cx.now, "ui_active_tags", json!([]));
    }

    fn reload(&mut self, cx: &mut CardCx) {
        cx.link.reconnect(cx.now);
        self.grid.status = "Reloaded.".into();
    }

    fn submit(&mut self, cx: &mut CardCx) {
        let name = self.grid.name.trim().to_string();
        if name.is_empty() {
            self.grid.status = "The new tag needs a name.".into();
            return;
        }
        let color = self.grid.color.clone();
        self.ask(cx, Command::TagCreate { tag_name: name.clone(), color }, Job::Create(name));
    }

    fn delete(&mut self, cx: &mut CardCx, id: Value, name: String) {
        self.ask(cx, Command::TagDelete { tag_id: id.clone() }, Job::Delete(id, name));
    }

    // ---- Tag Range actions (useTagRange.ts) ----

    fn calc(&mut self, cx: &mut CardCx) {
        let active = active_ids(cx);
        if active.is_empty() {
            self.range.status = "Select at least one tag.".into();
            return;
        }
        self.range.busy = true;
        self.range.status = "Computing…".into();
        self.ask(cx, Command::TagsCalcRange { tag_ids: active }, Job::Range);
    }

    // ---- Operations actions (useTagOps.ts) ----

    fn search(&mut self, cx: &mut CardCx, by: By) {
        let active = active_ids(cx);
        if by == By::Tag && active.is_empty() {
            self.ops.status = "Select at least one tag.".into();
            return;
        }
        // "By config" sends the window's whole settings, the run model PREVIEW uses (3.5 E17).
        let cfg = (by == By::Config).then(|| cx.link.settings.clone());
        self.ask(cx, Command::TagsSearch { tag_ids: active, cfg }, Job::Search(by));
    }

    fn tag_demos(&mut self, cx: &mut CardCx, paths: Vec<String>) {
        let names = names_of(&tags(cx), &active_ids(cx));
        if names.is_empty() {
            self.ops.status = "Select at least one tag.".into();
        } else if paths.is_empty() {
            self.ops.status = "Select demos from the list.".into();
        } else {
            let n = paths.len();
            self.ask(cx, Command::TagsApply { demo_paths: paths, tag_names: names }, Job::Apply(n));
        }
    }

    fn remove_picked(&mut self, cx: &mut CardCx) {
        let names = names_of(&tags(cx), &active_ids(cx));
        let paths = self.ops.picked.clone();
        if names.is_empty() {
            self.ops.status = "Select at least one tag.".into();
        } else if paths.is_empty() {
            self.ops.status = "Select demos.".into();
        } else {
            let n = paths.len();
            self.ask(cx, Command::TagsRemove { demo_paths: paths, tag_names: names }, Job::Remove(n));
        }
    }

    fn export(&mut self, cx: &mut CardCx) {
        let Some(path) = (self.pick_save)(TAG_EXPORT_FILE) else { return };
        let active = active_ids(cx);
        let tag_ids = (!active.is_empty()).then_some(active);
        self.ask(cx, Command::TagsExport { path, tag_ids }, Job::Export);
    }

    fn import(&mut self, cx: &mut CardCx) {
        let Some(path) = (self.pick_open)() else { return };
        self.ask(cx, Command::TagsImportScan { path: path.clone() }, Job::ImportScan(path));
    }
}

fn str_of(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or_default().to_string()
}

/// `ok_count === total ? done : "ok/total OK -- first error"`.
fn counts(d: &Value, done: &str) -> String {
    let n = |k: &str| d.get(k).and_then(Value::as_u64).unwrap_or(0);
    if n("ok_count") == n("total") {
        done.to_string()
    } else {
        format!("{}/{} OK -- {}", n("ok_count"), n("total"), str_of(d, "first_error"))
    }
}

/// The tag list of the last database read (`[[id, name, colour], …]`).
pub fn tags(cx: &CardCx) -> Vec<TagRow> {
    let list = cx.link.database.as_ref().and_then(|d| d.get("tags")).and_then(Value::as_array);
    list.map(|a| {
        a.iter()
            .filter_map(|t| {
                let t = t.as_array()?;
                let text = |i: usize| t.get(i).and_then(Value::as_str).unwrap_or_default().to_string();
                Some(TagRow { id: t.first()?.clone(), name: text(1), color: text(2) })
            })
            .collect()
    })
    .unwrap_or_default()
}

/// The persisted selection, shared by the three cards (`useActiveTags`).
pub fn active_ids(cx: &CardCx) -> Vec<Value> {
    cx.link.get("ui_active_tags").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// The names of the active tags, in list order: what `tags_apply` takes.
pub fn names_of(tags: &[TagRow], active: &[Value]) -> Vec<String> {
    tags.iter().filter(|t| active.contains(&t.id)).map(|t| t.name.clone()).collect()
}

/// The tags matching the search, in the chosen order (`useTagGrid.ts::visible`).
pub fn visible(tags: &[TagRow], search: &str, sort: Sort, active: &[Value]) -> Vec<TagRow> {
    let needle = search.to_lowercase();
    let mut out: Vec<TagRow> = tags.iter().filter(|t| t.name.to_lowercase().contains(&needle)).cloned().collect();
    let key = |s: &str| s.to_lowercase();
    match sort {
        Sort::Name => out.sort_by(|a, b| key(&a.name).cmp(&key(&b.name))),
        Sort::Color => out.sort_by(|a, b| key(&a.color).cmp(&key(&b.color))),
        Sort::ActiveFirst => out.sort_by(|a, b| {
            let rank = |t: &TagRow| usize::from(!active.contains(&t.id));
            rank(a).cmp(&rank(b)).then(key(&a.name).cmp(&key(&b.name)))
        }),
    }
    out
}

/// The cards wait for the database and say where to set it (3.5 `DatabasePending`).
fn database_ready(ui: &mut egui::Ui, cx: &CardCx) -> bool {
    match &cx.link.db {
        DbState::Ok if cx.link.database.is_some() => true,
        DbState::Error(e) => {
            crate::widgets::database_pending(ui, cx.theme, Some(e));
            false
        }
        _ => {
            crate::widgets::database_pending(ui, cx.theme, None);
            false
        }
    }
}

impl TabView for TagsTab {
    fn as_any_mut(&mut self) -> Option<&mut dyn std::any::Any> {
        Some(self)
    }

    fn cards(&self) -> Vec<CardDecl> {
        let picked = (!self.ops.found.is_empty()).then(|| format!("{}/{} picked", self.ops.picked.len(), self.ops.found.len()));
        vec![
            CardDecl { id: "tag-grid", title: "Tags".into(), icon: Some("tags"), count: Some(format!("{} in use", self.in_use)), wide: true },
            CardDecl { id: "tag-range", title: "Tag Range".into(), icon: Some("tagRange"), count: None, wide: false },
            CardDecl { id: "operations", title: "Operations".into(), icon: Some("operations"), count: picked, wide: false },
        ]
    }

    fn body(&mut self, id: &str, ui: &mut egui::Ui, cx: &mut CardCx) {
        self.poll(cx);
        if !database_ready(ui, cx) {
            return;
        }
        match id {
            "tag-grid" => tags_card::show(self, ui, cx),
            "tag-range" => range_card::show(self, ui, cx),
            "operations" => ops_card::show(self, ui, cx),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: i64, name: &str, color: &str) -> TagRow {
        TagRow { id: json!(id), name: name.into(), color: color.into() }
    }

    #[test]
    fn visible_filters_by_name_and_sorts_three_ways() {
        let t = vec![row(1, "clutch", "#ef4444"), row(2, "Aces", "#f97316"), row(3, "Wallbang", "#22c55e")];
        let names = |v: Vec<TagRow>| v.into_iter().map(|t| t.name).collect::<Vec<_>>();
        assert_eq!(names(visible(&t, "", Sort::Name, &[])), ["Aces", "clutch", "Wallbang"]);
        assert_eq!(names(visible(&t, "", Sort::Color, &[])), ["Wallbang", "clutch", "Aces"]);
        assert_eq!(names(visible(&t, "", Sort::ActiveFirst, &[json!(3)])), ["Wallbang", "Aces", "clutch"]);
        assert_eq!(names(visible(&t, "AC", Sort::Name, &[])), ["Aces"]);
    }

    #[test]
    fn names_follow_the_list_order_not_the_selection_order() {
        let t = vec![row(1, "a", ""), row(2, "b", ""), row(3, "c", "")];
        assert_eq!(names_of(&t, &[json!(3), json!(1)]), ["a", "c"]);
    }

    #[test]
    fn counts_say_done_or_the_first_error() {
        assert_eq!(counts(&json!({"ok_count": 2, "total": 2, "first_error": ""}), "Tagged 2 demo(s)."), "Tagged 2 demo(s).");
        assert_eq!(counts(&json!({"ok_count": 1, "total": 2, "first_error": "Checksum not found for b.dem"}), "x"), "1/2 OK -- Checksum not found for b.dem");
    }
}
