//! The SETTINGS tab's commands (T11): settings, presets and the settings folder
//! (3.5 `config.py` + `bridge/host.py` `_cmd_*_config`, `_cmd_*_preset`, `_cmd_*_config_dir`).
//!
//! 5.x keeps its own folder (`V5_CONFIG_SUBDIR`) under the app root, `%LOCALAPPDATA%` or a
//! chosen parent, and never writes into the 3.5 folder: on first launch the 3.5 state is read
//! (`import35`, read-only) and written into the 5.x folder. A folder switch COPIES the files,
//! backing up any it would overwrite, and the default folder keeps the pointer (`config_dir`)
//! for the next launch, as 3.5 did.
//!
//! `SettingsHome::handle` answers the commands it owns; the real engine loop calls it for them
//! (merge with T3). `SettingsEngine` serves those commands alone, for tests and recorded scenarios.

use crate::command::Command;
use crate::error::EngineError;
use crate::event::{Ask, AskKind, EngineEvent, EventSink, Level, Secrets};
use crate::import35::{import_dir, locate, SearchPlaces};
use crate::journal::{civil_from_days, SECS_PER_DAY, SECS_PER_HOUR, SECS_PER_MINUTE};
use crate::Engine;
use csdm_core::presets::{excludes, keys_for, normalize, payload};
use csdm_core::values::{ASM_NAMES_FILE, CONFIG_BACKUP_PREFIX, CONFIG_DIR_APPDATA, CONFIG_DIR_DEFAULT, CONFIG_FILE, CONFIG_FILES, PRESETS_FILE, V5_CONFIG_SUBDIR};
use csdm_core::Settings;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::time::{SystemTime, UNIX_EPOCH};

const FULL: &str = "full";
/// 3.5 `PRESET_NAME_QUESTION`: the question panel's title and its confirm word.
const PRESET_NAME_QUESTION: [&str; 2] = ["Preset name:", "Save"];
const PRESET_NAME_MESSAGE: &str = "Name for this preset";

/// Where the settings live and how to reach the other places a switch can target.
pub struct SettingsHome {
    /// The app root: its `V5_CONFIG_SUBDIR` is the default folder and keeps the pointer.
    root: PathBuf,
    local_app_data: Option<PathBuf>,
    /// The folder holding the files now.
    active: PathBuf,
    secrets: Secrets,
}

/// What opening the settings found, for the start-up console line.
#[derive(Debug, PartialEq)]
pub enum Opened {
    /// The 5.x folder was there.
    Existing,
    /// First launch: the 3.5 folder was read and its state written into the 5.x folder.
    Imported { from: PathBuf, notices: Vec<String> },
    /// First launch, nothing to import: defaults until the first save.
    Fresh,
}

fn io(path: &Path, e: std::io::Error) -> String {
    format!("Could not write {} ({e}). Your changes are not saved: choose a configuration folder you can write to in SETTINGS › Configuration Folder.", path.display())
}

fn write_json(path: &Path, v: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| io(dir, e))?;
    }
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| io(path, e))
}

fn read_object(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let bytes = std::fs::read(path).map_err(|e| EngineError::Unreadable { path: path.into(), reason: e.to_string() }.user_message())?;
    let text = bytes.strip_prefix("\u{feff}".as_bytes()).unwrap_or(&bytes);
    match serde_json::from_slice(text) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err(format!("{} is not a settings object. It was left untouched.", path.display())),
        Err(e) => Err(EngineError::Damaged { path: path.into(), reason: e.to_string() }.user_message()),
    }
}

/// `backup-YYYYMMDD-HHMMSS` (UTC; 3.5 used local time).
fn backup_name() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (y, m, d) = civil_from_days((secs / SECS_PER_DAY) as i64);
    let t = secs % SECS_PER_DAY;
    format!("{CONFIG_BACKUP_PREFIX}{y:04}{m:02}{d:02}-{:02}{:02}{:02}", t / SECS_PER_HOUR, t % SECS_PER_HOUR / SECS_PER_MINUTE, t % SECS_PER_MINUTE)
}

/// Windows paths compare without case (3.5 `os.path.normcase`).
fn same_dir(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().replace('/', std::path::MAIN_SEPARATOR_STR).trim_end_matches(std::path::MAIN_SEPARATOR).to_lowercase();
    norm(a) == norm(b)
}

/// 3.5 `build_preset`: the keys of the categories (every key for `full`), personal keys never.
pub fn build_preset(cfg: &Settings, cats: &[String], selected_clips: Option<&Value>) -> Value {
    let cats_value = json!(cats);
    let keys = keys_for(&cats_value);
    let data: Map<String, Value> = match &keys {
        None => cfg.iter().filter(|(k, _)| !excludes(k)).map(|(k, v)| (k.clone(), v.clone())).collect(),
        Some(ks) => ks.iter().filter(|k| !excludes(k)).filter_map(|k| cfg.get(k).map(|v| (k.clone(), v.clone()))).collect(),
    };
    let mut preset = Map::new();
    preset.insert("cats".into(), if keys.is_none() { json!([FULL]) } else { cats_value });
    preset.insert("data".into(), Value::Object(data));
    if let Some(clips) = selected_clips.filter(|c| c.as_array().is_some_and(|a| !a.is_empty())) {
        preset.insert("selected_clips".into(), clips.clone());
    }
    Value::Object(preset)
}

impl SettingsHome {
    /// Finds the 5.x folder (following its pointer), or imports the 3.5 state on first launch.
    /// The root is the explicit root (tests, scripted launches), else the exe's folder.
    pub fn open(places: &SearchPlaces, secrets: Secrets) -> Result<(Self, Opened), String> {
        let root = places.explicit_root.clone().or_else(|| places.exe_dir.clone()).ok_or("The app's own folder could not be found.")?;
        let mut home = SettingsHome { active: root.join(V5_CONFIG_SUBDIR), root, local_app_data: places.local_app_data.clone(), secrets };
        let pointer_file = home.default_dir().join(CONFIG_FILE);
        if pointer_file.is_file() {
            let pointer = read_object(&pointer_file)?.get("config_dir").and_then(Value::as_str).unwrap_or(CONFIG_DIR_DEFAULT).to_string();
            // A pointed folder that lost its settings falls back to the default one (3.5 `_bootstrap_dir`).
            if let Ok(dir) = home.resolve(&pointer) {
                if dir.join(CONFIG_FILE).is_file() {
                    home.active = dir;
                }
            }
            return Ok((home, Opened::Existing));
        }
        let from = match locate(places) {
            Ok(dir) => dir,
            Err(EngineError::NoSettingsFound { .. }) => return Ok((home, Opened::Fresh)),
            Err(e) => return Err(e.user_message()),
        };
        let imported = import_dir(&from).map_err(|e| e.user_message())?;
        let mut settings = imported.settings;
        // The 3.5 pointer names 3.5 folders: the 5.x copy starts in its own default folder.
        settings.insert("config_dir".into(), json!(CONFIG_DIR_DEFAULT));
        home.secrets.add(settings.get("pg_pass").and_then(Value::as_str).unwrap_or_default());
        write_json(&home.active.join(CONFIG_FILE), &Value::Object(settings))?;
        if !imported.presets.is_empty() {
            write_json(&home.active.join(PRESETS_FILE), &Value::Object(imported.presets))?;
        }
        if !imported.asm_names.is_empty() {
            write_json(&home.active.join(ASM_NAMES_FILE), &json!(imported.asm_names))?;
        }
        Ok((home, Opened::Imported { from, notices: imported.notices }))
    }

    pub fn active(&self) -> &Path {
        &self.active
    }

    fn default_dir(&self) -> PathBuf {
        self.root.join(V5_CONFIG_SUBDIR)
    }

    /// 3.5 `resolve_config_dir`: `""` the app folder, `appdata` Local AppData, else a parent folder.
    fn resolve(&self, value: &str) -> Result<PathBuf, String> {
        match value {
            CONFIG_DIR_DEFAULT => Ok(self.default_dir()),
            CONFIG_DIR_APPDATA => self.local_app_data.as_ref().map(|d| d.join(V5_CONFIG_SUBDIR)).ok_or_else(|| "Windows did not say where your Local AppData folder is: choose a folder instead.".to_string()),
            path => Ok(Path::new(path).join(V5_CONFIG_SUBDIR)),
        }
    }

    fn kind(&self, dir: &Path) -> &'static str {
        if same_dir(dir, &self.default_dir()) {
            "app"
        } else if self.resolve(CONFIG_DIR_APPDATA).is_ok_and(|d| same_dir(dir, &d)) {
            "appdata"
        } else {
            "custom"
        }
    }

    /// Every key of the table, migrated and typed (3.5 `load_config`).
    pub fn load_config(&self) -> Result<Value, String> {
        let imported = import_dir(&self.active).map_err(|e| e.user_message())?;
        self.secrets.add(imported.settings.get("pg_pass").and_then(Value::as_str).unwrap_or_default());
        Ok(json!({"data": imported.settings, "notices": imported.notices}))
    }

    /// Writes the settings the window holds. `config_dir` stays the engine's: a save racing a
    /// folder switch never points the app back to the old folder (3.5 `ConfigFolderCard`).
    pub fn save_config(&self, cfg: &Settings) -> Result<Value, String> {
        let mut cfg = cfg.clone();
        let pointer = self.pointer_value();
        cfg.insert("config_dir".into(), json!(pointer));
        self.secrets.add(cfg.get("pg_pass").and_then(Value::as_str).unwrap_or_default());
        write_json(&self.active.join(CONFIG_FILE), &Value::Object(cfg))?;
        Ok(json!({}))
    }

    /// The `config_dir` value naming the active folder.
    fn pointer_value(&self) -> String {
        match self.kind(&self.active) {
            "app" => CONFIG_DIR_DEFAULT.into(),
            "appdata" => CONFIG_DIR_APPDATA.into(),
            _ => self.active.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        }
    }

    fn presets(&self) -> Result<Map<String, Value>, String> {
        normalize(&Value::Object(read_object(&self.active.join(PRESETS_FILE))?)).map_err(|e| e.to_string())
    }

    pub fn list_presets(&self) -> Result<Value, String> {
        Ok(json!({"data": self.presets()?}))
    }

    /// 3.5 `_cmd_save_preset`. `ask_name` asks the name through the console's question panel.
    pub fn save_preset(&self, name: &str, cats: &[String], cfg: &Settings, selected_clips: Option<&Value>, ask_name: bool, sink: &EventSink) -> Result<Value, String> {
        let name = if ask_name {
            let (reply, rx) = channel();
            let options = PRESET_NAME_QUESTION.iter().map(|s| s.to_string()).collect();
            sink.emit(EngineEvent::Ask(Ask { kind: AskKind::Text, message: PRESET_NAME_MESSAGE.into(), options, reply })).map_err(|e| e.user_message())?;
            match rx.recv().ok().flatten() {
                Some(n) => n,
                None => {
                    let _ = sink.emit(EngineEvent::Log { message: "Preset not saved: no name was given.".into(), level: Level::Dim });
                    return Ok(json!({"cancelled": true}));
                }
            }
        } else {
            name.to_string()
        };
        let name = name.trim();
        if name.is_empty() {
            return Err("Type a name for the preset first.".into());
        }
        if cats.is_empty() {
            return Err("Tick at least one category to include in the preset.".into());
        }
        let mut presets = self.presets()?;
        let preset = build_preset(cfg, cats, selected_clips);
        let settings = preset["data"].as_object().map_or(0, Map::len);
        let clips = preset.get("selected_clips").and_then(Value::as_array).map_or(0, Vec::len);
        presets.insert(name.to_string(), preset);
        write_json(&self.active.join(PRESETS_FILE), &Value::Object(presets.clone()))?;
        let extra = if clips > 0 { format!(", {clips} EDITING clip(s) with their edits") } else { String::new() };
        let _ = sink.emit(EngineEvent::Log { message: format!("Preset '{name}' saved ({settings} settings{extra})."), level: Level::Ok });
        Ok(json!({"data": presets, "preset": name}))
    }

    /// 3.5 `_cmd_load_preset`: the values, and the keys it may overwrite (`null` = every key).
    /// shortcut: the stored EDITING selection is returned as stored (`stored_clips`); matching it to
    /// the current preview (3.5 `preset_clip_selection`) belongs to the preview's owner (T8).
    pub fn load_preset(&self, name: &str) -> Result<Value, String> {
        let presets = self.presets()?;
        let preset = presets.get(name).and_then(Value::as_object).ok_or_else(|| format!("There is no preset named '{name}' any more. Reload the preset list."))?;
        let (data, keys, clips) = payload(preset);
        Ok(json!({"data": data, "keys": keys, "stored_clips": clips}))
    }

    pub fn delete_preset(&self, name: &str) -> Result<Value, String> {
        let mut presets = self.presets()?;
        if presets.remove(name).is_none() {
            return Err(format!("There is no preset named '{name}' any more. Reload the preset list."));
        }
        write_json(&self.active.join(PRESETS_FILE), &Value::Object(presets.clone()))?;
        Ok(json!({"data": presets}))
    }

    /// 3.5 `probe_config_dir`: where the files are, and what copying them to `target` would overwrite.
    pub fn probe(&self, target: Option<&str>) -> Result<Value, String> {
        let target_dir = match target {
            Some(t) => self.resolve(t)?,
            None => self.active.clone(),
        };
        let same = same_dir(&target_dir, &self.active);
        let conflicts: Vec<&str> = if same { Vec::new() } else { CONFIG_FILES.iter().copied().filter(|n| target_dir.join(n).exists()).collect() };
        Ok(json!({"data": {
            "current": self.active.to_string_lossy(),
            "target": target_dir.to_string_lossy(),
            "conflicts": conflicts,
            "same": same,
            "kind": self.kind(&self.active),
        }}))
    }

    /// 3.5 `apply_config_dir`: COPY (never move) the files to `target`, after backing up the ones
    /// there, then work from it; the default folder keeps the pointer for the next launch.
    pub fn apply(&mut self, target: &str) -> Result<Value, String> {
        let target_dir = self.resolve(target)?;
        if same_dir(&target_dir, &self.active) {
            return self.probe(Some(target));
        }
        std::fs::create_dir_all(&target_dir).map_err(|e| format!("Could not create the folder {} ({e}). Choose a folder on a drive that exists and that you can write to.", target_dir.display()))?;
        let backup = target_dir.join(backup_name());
        for name in CONFIG_FILES {
            let dst = target_dir.join(name);
            if dst.exists() {
                std::fs::create_dir_all(&backup)
                    .and_then(|_| std::fs::copy(&dst, backup.join(name)))
                    .map_err(|e| format!("Could not back up {} ({e}). Nothing was copied; close any program using it and try again.", dst.display()))?;
            }
        }
        for name in CONFIG_FILES {
            let src = self.active.join(name);
            if src.exists() {
                std::fs::copy(&src, target_dir.join(name)).map_err(|e| format!("Could not copy {name} to {} ({e}). Choose a folder you can write to.", target_dir.display()))?;
            }
        }
        let mut cfg = read_object(&target_dir.join(CONFIG_FILE))?;
        cfg.insert("config_dir".into(), json!(target));
        write_json(&target_dir.join(CONFIG_FILE), &Value::Object(cfg.clone()))?;
        self.active = target_dir.clone();
        let default_dir = self.default_dir();
        if !same_dir(&default_dir, &target_dir) {
            let pointer_file = default_dir.join(CONFIG_FILE);
            let mut pointer = read_object(&pointer_file).unwrap_or_default();
            if pointer.is_empty() {
                pointer = cfg;
            }
            pointer.insert("config_dir".into(), json!(target));
            write_json(&pointer_file, &Value::Object(pointer))?;
        }
        self.probe(Some(target))
    }

    /// The commands this module owns; `None` for any other.
    pub fn handle(&mut self, command: &Command, sink: &EventSink) -> Option<Result<Value, String>> {
        Some(match command {
            Command::LoadConfig => self.load_config(),
            Command::SaveConfig { cfg } => self.save_config(cfg),
            Command::ProbeConfigDir { target } => self.probe(target.as_deref()),
            Command::ApplyConfigDir { target } => self.apply(target),
            Command::ListPresets => self.list_presets(),
            Command::SavePreset { preset, cats, cfg, selected_clips, ask_name } => self.save_preset(preset, cats, cfg, selected_clips.as_ref(), *ask_name, sink),
            Command::LoadPreset { preset } => self.load_preset(preset),
            Command::DeletePreset { preset } => self.delete_preset(preset),
            _ => return None,
        })
    }
}

/// An engine that serves the settings commands for real and `hello`, and refuses the rest in
/// words. Driven tests and the scenario recorder use it until the real loop serves them (T3).
pub struct SettingsEngine {
    home: SettingsHome,
    sink: EventSink,
    events: Receiver<EngineEvent>,
    next_id: u64,
}

impl SettingsEngine {
    pub fn new(home: SettingsHome, secrets: Secrets) -> Self {
        let (tx, events) = channel();
        Self { home, sink: EventSink::new(tx, secrets), events, next_id: 0 }
    }

    pub fn home(&self) -> &SettingsHome {
        &self.home
    }
}

impl Engine for SettingsEngine {
    fn send(&mut self, command: Command) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        let result = match &command {
            Command::Hello => Ok(json!({"data": {"app_version": env!("CARGO_PKG_VERSION")}})),
            c => self.home.handle(c, &self.sink).unwrap_or_else(|| Err(format!("\"{}\" is not served by the settings engine.", c.name()))),
        };
        let _ = self.sink.emit(EngineEvent::Reply { id, result });
        id
    }

    fn events(&self) -> &Receiver<EngineEvent> {
        &self.events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use csdm_core::values::{CONFIG_SUBDIR, PLAYERS_FILE};
    use std::fs;

    const SECRET: &str = "pw-t11-not-shown";

    fn places(root: &Path, lad: Option<&Path>) -> SearchPlaces {
        SearchPlaces { explicit_root: Some(root.into()), exe_dir: None, local_app_data: lad.map(Into::into) }
    }

    fn write(path: &Path, v: Value) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_vec_pretty(&v).unwrap()).unwrap();
    }

    fn sink() -> (EventSink, Receiver<EngineEvent>) {
        let (tx, rx) = channel();
        (EventSink::new(tx, Secrets::default()), rx)
    }

    fn cfg(pairs: Value) -> Settings {
        let mut s = csdm_core::settings::defaults(Some(4));
        s.extend(pairs.as_object().unwrap().clone());
        s
    }

    fn hashes(dir: &Path) -> Vec<(String, Vec<u8>)> {
        let mut v: Vec<_> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.is_file()).map(|p| (p.file_name().unwrap().to_string_lossy().into_owned(), fs::read(&p).unwrap())).collect();
        v.sort();
        v
    }

    #[test]
    fn first_launch_imports_35_into_its_own_folder_and_leaves_35_untouched() {
        let t = tempfile::tempdir().unwrap();
        let old = t.path().join(CONFIG_SUBDIR);
        write(&old.join(CONFIG_FILE), json!({"pg_pass": SECRET, "crf": 21, "config_dir": ""}));
        write(&old.join(PRESETS_FILE), json!({"p": {"type": "full", "data": {"pg_pass": SECRET, "crf": 20}}}));
        write(&old.join(PLAYERS_FILE), json!([{"steam_id": "7", "name": "a", "label": ""}]));
        write(&old.join(ASM_NAMES_FILE), json!(["night"]));
        let before = hashes(&old);
        let (home, opened) = SettingsHome::open(&places(t.path(), None), Secrets::default()).unwrap();
        assert!(matches!(opened, Opened::Imported { ref from, .. } if *from == old));
        assert_eq!(home.active(), t.path().join(V5_CONFIG_SUBDIR));
        assert_eq!(hashes(&old), before, "the 3.5 folder is never written");
        let loaded = home.load_config().unwrap();
        assert_eq!(loaded["data"]["crf"], json!(21));
        assert_eq!(loaded["data"]["saved_players"][0]["steam_id"], json!("7"));
        let presets = home.list_presets().unwrap();
        assert_eq!(presets["data"]["p"]["data"], json!({"crf": 20}), "the password never reaches a 5.x preset");
        let names: Value = serde_json::from_slice(&fs::read(home.active().join(ASM_NAMES_FILE)).unwrap()).unwrap();
        assert_eq!(names, json!(["night"]));
        // Second launch reads the 5.x folder, no re-import.
        let (again, opened) = SettingsHome::open(&places(t.path(), None), Secrets::default()).unwrap();
        assert_eq!((opened, again.active()), (Opened::Existing, home.active()));
    }

    #[test]
    fn fresh_start_writes_nothing_until_the_first_save() {
        let t = tempfile::tempdir().unwrap();
        let (home, opened) = SettingsHome::open(&places(t.path(), None), Secrets::default()).unwrap();
        assert_eq!(opened, Opened::Fresh);
        assert_eq!(fs::read_dir(t.path()).unwrap().count(), 0);
        assert_eq!(home.load_config().unwrap()["data"]["pg_db"], json!("csdm"));
        home.save_config(&cfg(json!({"crf": 30}))).unwrap();
        assert_eq!(read_object(&home.active().join(CONFIG_FILE)).unwrap()["crf"], json!(30));
    }

    #[test]
    fn presets_save_by_category_load_only_their_keys_and_never_hold_credentials() {
        let t = tempfile::tempdir().unwrap();
        let (home, _) = SettingsHome::open(&places(t.path(), None), Secrets::default()).unwrap();
        let (s, rx) = sink();
        let c = cfg(json!({"pg_pass": SECRET, "pg_host": "10.0.0.9", "before": 7, "crf": 19, "theme_bg": "white", "csdm_exe": "C:/x/csdm.CMD", "ui_split_pct": 50}));
        home.save_preset("timing only", &["timing".into()], &c, None, false, &s).unwrap();
        home.save_preset("all", &[FULL.into()], &c, None, false, &s).unwrap();
        let file = fs::read_to_string(home.active().join(PRESETS_FILE)).unwrap();
        let stored: Value = serde_json::from_str(&file).unwrap();
        for (name, p) in stored.as_object().unwrap() {
            let data = p["data"].as_object().unwrap();
            for k in data.keys() {
                assert!(!excludes(k), "{name} stored personal key {k}");
            }
            assert!(data.values().all(|v| v != SECRET), "{name} stored the password");
        }
        assert_eq!(stored["all"]["cats"], json!(["full"]));
        assert!(stored["timing only"]["data"].get("crf").is_none(), "a timing preset keeps only timing keys");
        let loaded = home.load_preset("timing only").unwrap();
        let keys: Vec<&str> = loaded["keys"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        assert!(keys.contains(&"before") && !keys.contains(&"crf"));
        assert_eq!(home.load_preset("all").unwrap()["keys"], Value::Null, "a full preset overwrites every key it holds");
        let logs: Vec<String> = rx.try_iter().filter_map(|e| if let EngineEvent::Log { message, .. } = e { Some(message) } else { None }).collect();
        assert!(logs[0].starts_with("Preset 'timing only' saved ("), "{logs:?}");
        home.delete_preset("all").unwrap();
        assert!(home.list_presets().unwrap()["data"].get("all").is_none());
        assert!(home.delete_preset("all").unwrap_err().contains("no preset named 'all'"));
        assert!(home.load_preset("gone").is_err());
    }

    #[test]
    fn preset_refusals_and_asked_name() {
        let t = tempfile::tempdir().unwrap();
        let (home, _) = SettingsHome::open(&places(t.path(), None), Secrets::default()).unwrap();
        let (s, rx) = sink();
        let c = cfg(json!({}));
        assert_eq!(home.save_preset("  ", &[FULL.into()], &c, None, false, &s).unwrap_err(), "Type a name for the preset first.");
        assert_eq!(home.save_preset("x", &[], &c, None, false, &s).unwrap_err(), "Tick at least one category to include in the preset.");
        let answer = std::thread::spawn(move || {
            for e in rx.iter() {
                if let EngineEvent::Ask(a) = e {
                    assert_eq!((a.kind, a.options[0].as_str()), (AskKind::Text, "Preset name:"));
                    a.reply.send(Some(" asked ".into())).unwrap();
                    return;
                }
            }
        });
        let r = home.save_preset("", &["players".into()], &c, Some(&json!([{"demo_path": "a.dem", "start_tick": 5}])), true, &s).unwrap();
        answer.join().unwrap();
        assert_eq!(r["preset"], json!("asked"));
        assert_eq!(r["data"]["asked"]["selected_clips"][0]["start_tick"], json!(5));
    }

    #[test]
    fn folder_switch_copies_backs_up_asks_and_points() {
        let (t, lad, custom) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (mut home, _) = SettingsHome::open(&places(t.path(), Some(lad.path())), Secrets::default()).unwrap();
        home.save_config(&cfg(json!({"crf": 23}))).unwrap();
        let (s, _rx) = sink();
        home.save_preset("p", &[FULL.into()], &cfg(json!({})), None, false, &s).unwrap();
        let status = home.probe(None).unwrap();
        assert_eq!((&status["data"]["kind"], &status["data"]["same"]), (&json!("app"), &json!(true)));

        // A custom folder already holding a config: the probe names it, the switch backs it up.
        let target = custom.path().join(V5_CONFIG_SUBDIR);
        write(&target.join(CONFIG_FILE), json!({"crf": 99}));
        let target_value = custom.path().to_str().unwrap();
        let p = home.probe(Some(target_value)).unwrap();
        assert_eq!((&p["data"]["conflicts"], &p["data"]["same"]), (&json!([CONFIG_FILE]), &json!(false)));
        let source_before = hashes(home.active());
        let r = home.apply(target_value).unwrap();
        assert_eq!((&r["data"]["kind"], &r["data"]["same"]), (&json!("custom"), &json!(true)));
        assert_eq!(hashes(&t.path().join(V5_CONFIG_SUBDIR)).into_iter().filter(|(n, _)| n != CONFIG_FILE).collect::<Vec<_>>(), source_before.into_iter().filter(|(n, _)| n != CONFIG_FILE).collect::<Vec<_>>(), "the source files stay in place");
        let backups: Vec<PathBuf> = fs::read_dir(&target).unwrap().map(|e| e.unwrap().path()).filter(|p| p.is_dir()).collect();
        assert_eq!(backups.len(), 1);
        assert!(backups[0].file_name().unwrap().to_string_lossy().starts_with(CONFIG_BACKUP_PREFIX));
        assert_eq!(read_object(&backups[0].join(CONFIG_FILE)).unwrap()["crf"], json!(99), "the overwritten file is kept");
        assert_eq!(read_object(&target.join(CONFIG_FILE)).unwrap()["crf"], json!(23));
        assert!(target.join(PRESETS_FILE).is_file());
        assert_eq!(read_object(&t.path().join(V5_CONFIG_SUBDIR).join(CONFIG_FILE)).unwrap()["config_dir"], json!(target_value), "the default folder points to the new one");

        // Saves now land in the new folder and keep its pointer.
        home.save_config(&cfg(json!({"crf": 24, "config_dir": ""}))).unwrap();
        assert_eq!(read_object(&target.join(CONFIG_FILE)).unwrap()["config_dir"], json!(target_value));
        // Next launch follows the pointer.
        let (again, opened) = SettingsHome::open(&places(t.path(), Some(lad.path())), Secrets::default()).unwrap();
        assert_eq!((opened, again.active()), (Opened::Existing, target.as_path()));

        // To Local AppData: no conflict, kind follows.
        let r = home.apply(CONFIG_DIR_APPDATA).unwrap();
        assert_eq!(r["data"]["kind"], json!("appdata"));
        assert!(lad.path().join(V5_CONFIG_SUBDIR).join(CONFIG_FILE).is_file());
        // Same place again: nothing to do.
        assert_eq!(home.probe(Some(CONFIG_DIR_APPDATA)).unwrap()["data"]["same"], json!(true));
    }

    #[test]
    fn damaged_files_are_refused_in_words_and_left_alone() {
        let t = tempfile::tempdir().unwrap();
        let (home, _) = SettingsHome::open(&places(t.path(), None), Secrets::default()).unwrap();
        fs::create_dir_all(home.active()).unwrap();
        fs::write(home.active().join(PRESETS_FILE), b"{ nope").unwrap();
        let e = home.list_presets().unwrap_err();
        assert!(e.contains("damaged") && e.contains(PRESETS_FILE), "{e}");
        assert_eq!(fs::read(home.active().join(PRESETS_FILE)).unwrap(), b"{ nope");
    }

    #[test]
    fn engine_serves_settings_and_refuses_the_rest() {
        let t = tempfile::tempdir().unwrap();
        let secrets = Secrets::default();
        let (home, _) = SettingsHome::open(&places(t.path(), None), secrets.clone()).unwrap();
        let mut e = SettingsEngine::new(home, secrets);
        e.send(Command::SaveConfig { cfg: cfg(json!({"pg_pass": SECRET})) });
        e.send(Command::ListDemos);
        let got: Vec<EngineEvent> = e.events().try_iter().collect();
        assert!(matches!(&got[0], EngineEvent::Reply { result: Ok(_), .. }));
        assert!(matches!(&got[1], EngineEvent::Reply { result: Err(m), .. } if m.contains("list_demos")));
        e.send(Command::LoadConfig);
        let shown = format!("{:?}", e.events().try_iter().collect::<Vec<_>>());
        assert!(!shown.contains(SECRET), "the password is masked in what is shown");
    }
}
