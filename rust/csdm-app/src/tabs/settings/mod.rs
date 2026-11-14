//! The SETTINGS tab (T11, 3.5 `tabs/SettingsTab.tsx`): PostgreSQL Connection, Paths,
//! Configuration Folder, Presets, UI Theme, UI Layout, Performance, Injection Preview.
//! Each card is drawn in the `timeline` style (the default card style); T12 adds the other two.
//!
//! The tab asks the engine only through `Link`: settings by `get`/`set`, and the answers it
//! needs itself (presets, folder, connection test, defaults) by `request`/`take_reply`.

pub mod controls;
mod cards;
pub mod font;

use crate::grid::{CardCx, CardDecl, TabView};
use controls::{native_picker, Picker};
use csdm_engine::Command;
use serde_json::{Map, Value};

/// What the tab is waiting for from the engine.
#[derive(Clone, Debug, PartialEq)]
enum Req {
    Describe,
    Presets,
    /// A preset command; its success sentence.
    PresetDone(String),
    LoadPreset(String),
    Probe,
    /// A switch's probe: the location's label and its `config_dir` value.
    SwitchProbe { value: String, label: String },
    Apply(String),
    Connect,
    Injection,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum PgState { #[default] Idle, Busy, Ok, Bad }

/// A folder switch waiting on the user (3.5 `PendingSwitch`).
#[derive(Clone, Debug, PartialEq)]
pub struct PendingSwitch {
    pub value: String,
    pub label: String,
    pub target_dir: String,
    pub conflicts: Vec<String>,
    /// 1 = files exist, first warning; 2 = confirm overwrite with backup.
    pub step: u8,
    pub busy: bool,
}

pub struct SettingsTab {
    pick: Picker,
    started: bool,
    waiting: Vec<(u64, Req)>,
    /// `describe_filters`: the paths an empty setting resolves to, the preset categories.
    pub default_csdm_exe: Option<String>,
    pub default_clips_dir: Option<String>,
    pub categories: Vec<String>,
    // PostgreSQL
    pub pg_status: String,
    pub pg_state: PgState,
    // Presets
    pub presets: Map<String, Value>,
    pub preset_name: String,
    pub preset_cats: Vec<String>,
    pub preset_error: String,
    pub preset_status: String,
    pub pending_delete: Option<String>,
    // Configuration folder
    pub folder: Option<Value>,
    pub folder_error: String,
    pub switch: Option<PendingSwitch>,
    // Injection preview
    pub injection: Option<Result<Vec<(String, String)>, String>>,
}

impl SettingsTab {
    pub fn new() -> Self {
        Self::with_picker(native_picker())
    }

    /// Tests give a picker that answers without a window.
    pub fn with_picker(pick: Picker) -> Self {
        Self {
            pick,
            started: false,
            waiting: Vec::new(),
            default_csdm_exe: None,
            default_clips_dir: None,
            categories: default_categories(),
            pg_status: String::new(),
            pg_state: PgState::Idle,
            presets: Map::new(),
            preset_name: String::new(),
            preset_cats: Vec::new(),
            preset_error: String::new(),
            preset_status: String::new(),
            pending_delete: None,
            folder: None,
            folder_error: String::new(),
            switch: None,
            injection: None,
        }
    }

    fn ask(&mut self, cx: &mut CardCx, command: Command, req: Req) {
        let id = cx.link.request(cx.now, command);
        self.waiting.push((id, req));
    }

    fn waiting_for(&self, req: &Req) -> bool {
        self.waiting.iter().any(|(_, r)| r == req)
    }

    /// Takes the engine's answers that arrived, once per card drawn (cheap when none).
    fn collect(&mut self, cx: &mut CardCx) {
        let mut i = 0;
        while i < self.waiting.len() {
            let (id, _) = self.waiting[i];
            match cx.link.take_reply(id) {
                Some(result) => {
                    let (_, req) = self.waiting.remove(i);
                    self.answer(cx, req, result);
                }
                None => i += 1,
            }
        }
    }

    fn answer(&mut self, cx: &mut CardCx, req: Req, result: Result<Value, String>) {
        let data = |v: &Value| v.get("data").cloned().unwrap_or(Value::Null);
        match (req, result) {
            (Req::Describe, Ok(v)) => {
                let d = data(&v);
                let text = |k: &str| d["default_paths"].get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from);
                self.default_csdm_exe = text("csdm_exe");
                self.default_clips_dir = text("clips_dir");
                if let Some(cats) = d.get("preset_categories").and_then(Value::as_array) {
                    self.categories = cats.iter().filter_map(Value::as_str).map(String::from).collect();
                }
            }
            // Without the engine's defaults the boxes say so in general words; nothing else depends on it.
            (Req::Describe, Err(_)) => {}
            (Req::Presets, Ok(v)) => self.presets = data(&v).as_object().cloned().unwrap_or_default(),
            (Req::PresetDone(status), Ok(v)) => {
                if v.get("cancelled").is_none() {
                    self.presets = data(&v).as_object().cloned().unwrap_or_default();
                    self.preset_status = status;
                }
            }
            (Req::LoadPreset(name), Ok(v)) => {
                let values = data(&v);
                // Only the keys the preset was saved with (3.5 `preset_payload`); `null` = every key it holds.
                let keys: Vec<String> = match v.get("keys").and_then(Value::as_array) {
                    Some(ks) => ks.iter().filter_map(Value::as_str).map(String::from).collect(),
                    None => values.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default(),
                };
                for k in keys {
                    if let Some(val) = values.get(&k) {
                        cx.link.set(cx.now, &k, val.clone());
                    }
                }
                self.preset_status = format!("Loaded \"{name}\".");
            }
            (Req::Presets | Req::PresetDone(_) | Req::LoadPreset(_), Err(e)) => {
                self.preset_status.clear();
                self.preset_error = e;
            }
            (Req::Probe, Ok(v)) => self.folder = Some(data(&v)),
            (Req::SwitchProbe { value, label }, Ok(v)) => {
                let p = data(&v);
                if p["same"] != Value::Bool(true) {
                    let conflicts = p["conflicts"].as_array().map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
                    let target_dir = p["target"].as_str().unwrap_or_default().to_string();
                    self.switch = Some(PendingSwitch { value, label, target_dir, conflicts, step: 1, busy: false });
                }
            }
            (Req::Apply(value), Ok(v)) => {
                // The engine works from the new folder now; the stored pointer follows it.
                cx.link.set(cx.now, "config_dir", Value::String(value));
                self.folder = Some(data(&v));
                self.switch = None;
            }
            (Req::Probe | Req::SwitchProbe { .. }, Err(e)) => self.folder_error = e,
            (Req::Apply(_), Err(e)) => {
                self.folder_error = e;
                self.switch = None;
            }
            (Req::Connect, Ok(_)) => {
                self.pg_status = "Connected".into();
                self.pg_state = PgState::Ok;
                // The window now uses what came back (3.5 `reload()`).
                cx.link.db = crate::link::DbState::Ok;
            }
            (Req::Connect, Err(e)) => {
                self.pg_status = e.clone();
                self.pg_state = PgState::Bad;
                cx.link.db = crate::link::DbState::Error(e);
            }
            (Req::Injection, r) => {
                self.injection = Some(r.map(|v| {
                    v.get("lines").and_then(Value::as_array).map(|a| {
                        a.iter().map(|l| (l.get(0).and_then(Value::as_str).unwrap_or_default().to_string(), l.get(1).and_then(Value::as_str).unwrap_or_default().to_string())).collect()
                    }).unwrap_or_default()
                }));
            }
        }
    }

    /// First draw: what the cards need from the engine (3.5 cards' `useEffect`s).
    fn start(&mut self, cx: &mut CardCx) {
        if self.started {
            return;
        }
        self.started = true;
        self.ask(cx, Command::DescribeFilters, Req::Describe);
        self.ask(cx, Command::ProbeConfigDir { target: None }, Req::Probe);
        self.ask(cx, Command::ListPresets, Req::Presets);
    }
}

impl Default for SettingsTab {
    fn default() -> Self {
        Self::new()
    }
}

/// "full" + the categories grouped by tab (3.5 `_PRESET_ALL_CATS`), until the engine sends its list.
fn default_categories() -> Vec<String> {
    let r = csdm_core::settings::reference();
    let mut cats = vec!["full".to_string()];
    for group in r.presets.tab_groups.as_array().into_iter().flatten() {
        for pair in group.get(1).and_then(Value::as_array).into_iter().flatten() {
            if let Some(c) = pair.get(0).and_then(Value::as_str) {
                cats.push(c.to_string());
            }
        }
    }
    cats
}

impl TabView for SettingsTab {
    fn cards(&self) -> Vec<CardDecl> {
        let n = self.presets.len();
        let decl = |id, title: &str, icon, count: Option<String>, wide| CardDecl { id, title: title.into(), icon: Some(icon), count, wide };
        vec![
            decl("postgresql", "PostgreSQL Connection", "postgresql", (self.pg_state == PgState::Ok).then(|| "connected".into()), true),
            decl("paths", "Paths", "paths", None, true),
            decl("config-folder", "Configuration Folder", "paths", None, true),
            decl("presets", "Presets", "presets", Some(format!("{n} saved")), false),
            decl("ui-theme", "UI Theme", "uiTheme", None, false),
            decl("ui-layout", "UI Layout", "uiLayout", None, false),
            decl("performance", "Performance", "performance", None, false),
            decl("injection-preview", "Injection Preview", "injectionPreview", None, false),
        ]
    }

    fn body(&mut self, id: &str, ui: &mut eframe::egui::Ui, cx: &mut CardCx) {
        self.start(cx);
        self.collect(cx);
        match id {
            "postgresql" => cards::postgres(self, ui, cx),
            "paths" => cards::paths(self, ui, cx),
            "config-folder" => cards::config_folder(self, ui, cx),
            "presets" => cards::presets(self, ui, cx),
            "ui-theme" => cards::ui_theme(ui, cx),
            "ui-layout" => cards::ui_layout(ui, cx),
            "performance" => cards::performance(ui, cx),
            "injection-preview" => cards::injection(self, ui, cx),
            _ => {}
        }
    }

    fn as_any_mut(&mut self) -> Option<&mut dyn std::any::Any> {
        Some(self)
    }
}
