//! The CAPTURE tab (T7, 3.5 `tabs/CaptureTab.tsx`): Player, Demo Selection, Weapon Filter,
//! Capture & Timing, Timing & Retries, Kill / Damage / Shot Filters, Match Types, Map Filter.
//! Each card is drawn in the `timeline` style (the default card style); T12 adds the other two.
//!
//! What the cards read: the settings (`Link::get`/`set`), the database the shell connected
//! (`Link::database`: players, maps, weapons) and the engine's tables (`describe_filters`:
//! filters, match types, weapon categories), asked once for the whole tab as 3.5's
//! `TablesProvider` did. Filter rows come from the registry only: a new registry entry is a new
//! row without touching this code.

mod art;
mod demos;
mod filters;
pub mod kit;
pub mod model;
mod player;
mod sets;
pub mod timeline;
mod timing;

use crate::grid::{CardCx, CardDecl, TabView};
use crate::link::DbState;
use chrono::NaiveDate;
use csdm_engine::Command;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Req { Describe, Demos }

/// Player card state that 3.5 kept in the component (never saved).
#[derive(Default)]
pub struct PlayerUi {
    pub search: String,
    pub order: model::Order,
    pub page: usize,
    /// Registered-account drag: (from, over).
    pub drag: Option<(usize, usize)>,
}

/// One row of `list_demos` (3.5 `DemoRow`).
#[derive(Clone, Debug, PartialEq)]
pub struct DemoRow {
    pub path: String,
    pub name: String,
    pub date: String,
    pub map: String,
    /// "ok" / "warn" / "missing", the breaking update, its explanation.
    pub status: String,
    pub brk: String,
    pub tip: String,
}

/// Demo Selection state that 3.5 kept in the component (Manual mode and the picker are
/// session-only there too).
#[derive(Default)]
pub struct DemosUi {
    pub manual: bool,
    pub rows: Option<Vec<DemoRow>>,
    pub checked: HashMap<String, bool>,
    pub selected: BTreeSet<String>,
    pub anchor: Option<usize>,
    pub error: Option<String>,
    /// A strip handle being dragged ("from" / "to") and the strip's first day, frozen.
    pub strip_drag: Option<(bool, NaiveDate)>,
}

pub struct CaptureTab {
    started: bool,
    waiting: Vec<(u64, Req)>,
    /// `describe_filters`' data.
    pub tables: Option<Value>,
    pub tables_error: Option<String>,
    pub player: PlayerUi,
    pub demos: DemosUi,
    art: art::Art,
    /// Header counts read from the settings at the last draw.
    counts: HashMap<&'static str, String>,
    /// Tests pin the calendar.
    pub today: Option<NaiveDate>,
}

impl Default for CaptureTab {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureTab {
    pub fn new() -> Self {
        Self { started: false, waiting: Vec::new(), tables: None, tables_error: None, player: PlayerUi::default(), demos: DemosUi::default(), art: art::Art::default(), counts: HashMap::new(), today: None }
    }

    fn today(&self) -> NaiveDate {
        self.today.unwrap_or_else(|| chrono::Local::now().date_naive())
    }

    fn ask(&mut self, cx: &mut CardCx, command: Command, req: Req) {
        let id = cx.link.request(cx.now, command);
        self.waiting.push((id, req));
    }

    fn collect(&mut self, cx: &mut CardCx) {
        let mut i = 0;
        while i < self.waiting.len() {
            let (id, req) = self.waiting[i];
            match cx.link.take_reply(id) {
                Some(result) => {
                    self.waiting.remove(i);
                    self.answer(req, result);
                }
                None => i += 1,
            }
        }
    }

    fn answer(&mut self, req: Req, result: Result<Value, String>) {
        match (req, result) {
            (Req::Describe, Ok(v)) => self.tables = Some(v.get("data").cloned().unwrap_or(Value::Null)),
            (Req::Describe, Err(e)) => self.tables_error = Some(e),
            (Req::Demos, Ok(v)) => {
                let s = |r: &Value, k: &str| r.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
                let rows: Vec<DemoRow> = v.get("data").and_then(|d| d.get("demos")).and_then(Value::as_array).into_iter().flatten().map(|r| {
                    let c = r.get("compat").cloned().unwrap_or(Value::Null);
                    DemoRow { path: s(r, "path"), name: s(r, "name"), date: s(r, "date"), map: s(r, "map"), status: s(&c, "status"), brk: s(&c, "break"), tip: s(&c, "tip") }
                }).collect();
                // Every row starts checked (`_demo_picker_populate`: `prev_state.get(dp, True)`).
                self.demos.checked = rows.iter().map(|r| (r.path.clone(), true)).collect();
                self.demos.selected.clear();
                self.demos.anchor = None;
                self.demos.rows = Some(rows);
            }
            (Req::Demos, Err(e)) => self.demos.error = Some(e),
        }
    }

    fn start(&mut self, cx: &mut CardCx) {
        if !self.started {
            self.started = true;
            self.ask(cx, Command::DescribeFilters, Req::Describe);
        }
    }

    /// Manual mode on: every demo of the database (`_on_picker_mode_change`).
    fn load_demos(&mut self, cx: &mut CardCx) {
        self.demos.error = None;
        self.ask(cx, Command::ListDemos, Req::Demos);
    }

    fn database<'a>(cx: &'a CardCx) -> Option<&'a Value> {
        if cx.link.db == DbState::Ok { cx.link.database.as_ref() } else { None }
    }
}

/// "Waiting for DB…" or where to connect it.
fn pending(ui: &mut eframe::egui::Ui, cx: &CardCx) {
    let err = match &cx.link.db {
        DbState::Error(e) => Some(e.as_str()),
        _ => None,
    };
    crate::widgets::database_pending(ui, cx.theme, err);
}

impl TabView for CaptureTab {
    fn cards(&self) -> Vec<CardDecl> {
        let count = |id: &str| self.counts.get(id).cloned();
        let decl = |id: &'static str, title: &str, icon: &'static str, wide: bool| CardDecl { id, title: title.into(), icon: Some(icon), count: count(id), wide };
        vec![
            decl("player", "Player", "player", true),
            decl("demo-selection", "Demo Selection", "demoSelection", false),
            decl("weapon-filter", "Weapon Filter", "weaponFilter", true),
            decl("capture-timing", "Capture & Timing", "captureTiming", false),
            decl("timing-retries", "Timing & Retries", "captureTiming", false),
            decl("kill-filters", "Kill Filters", "killFilters", false),
            decl("damage-filters", "Damage Filters", "damageFilters", false),
            decl("shot-filters", "Shot Filters", "shotFilters", false),
            decl("match-types", "Match Types", "matchTypes", false),
            decl("map-filter", "Map Filter", "mapFilter", false),
        ]
    }

    fn body(&mut self, id: &str, ui: &mut eframe::egui::Ui, cx: &mut CardCx) {
        self.start(cx);
        self.collect(cx);
        let count = match id {
            "player" => player::card(self, ui, cx),
            "demo-selection" => demos::card(self, ui, cx),
            "weapon-filter" => sets::weapons(self, ui, cx),
            "capture-timing" => timing::capture(ui, cx),
            "timing-retries" => timing::retries(ui, cx),
            "kill-filters" => filters::kill(self, ui, cx),
            "damage-filters" => filters::events(self, ui, cx, "damage"),
            "shot-filters" => filters::events(self, ui, cx, "shot"),
            "match-types" => sets::match_types(self, ui, cx),
            "map-filter" => sets::maps(ui, cx),
            _ => None,
        };
        let key = self.cards().into_iter().map(|d| d.id).find(|d| *d == id);
        if let Some(k) = key {
            match count {
                Some(c) => {
                    self.counts.insert(k, c);
                }
                None => {
                    self.counts.remove(k);
                }
            }
        }
    }

    fn as_any_mut(&mut self) -> Option<&mut dyn std::any::Any> {
        Some(self)
    }
}
