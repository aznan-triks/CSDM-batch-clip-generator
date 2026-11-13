//! What the interface can ask the engine: the 31 useful commands of the 3.5
//! bridge (`csdm/bridge/host.py::COMMANDS` minus the 5 diagnostic ones).
//! Signatures only in T0; each tranche gives its commands their behaviour.

use csdm_core::Settings;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub enum Command {
    Hello,
    DescribeFilters,
    LoadConfig,
    SaveConfig { cfg: Settings },
    ProbeConfigDir { target: Option<String> },
    ApplyConfigDir { target: String },
    ListPresets,
    SavePreset { preset: String, cats: Vec<String>, cfg: Settings, selected_clips: Option<Value>, ask_name: bool },
    LoadPreset { preset: String },
    DeletePreset { preset: String },
    ConnectDb { pg: Option<Settings> },
    ListDemos,
    StartRun { cfg: Settings, selected_clips: Option<Value> },
    StartPreview { cfg: Settings },
    RunInputsProblem { cfg: Settings },
    RequestStop,
    RequestKill,
    CancelPreview,
    ClipCameras { clip: Value },
    ExportPreview { format: String },
    InjectionPreview { cfg: Settings },
    /// Tag ids are a number or a text in 3.5 (`useTagGrid.ts::TagId`).
    TagsSearch { tag_ids: Vec<Value>, cfg: Option<Settings> },
    TagsCalcRange { tag_ids: Vec<Value> },
    TagsSetActive { tag_ids: Vec<Value> },
    TagsApply { demo_paths: Vec<String>, tag_names: Vec<String> },
    TagsRemove { demo_paths: Vec<String>, tag_names: Vec<String> },
    TagCreate { tag_name: String, color: String },
    TagDelete { tag_id: Value },
    TagsExport { path: PathBuf, tag_ids: Option<Vec<Value>> },
    TagsImportScan { path: PathBuf },
    TagsImportApply { path: PathBuf, tags_to_create: Value },
}

/// Every command's name, as 3.5's bridge and the capability table spell it.
pub const COMMAND_NAMES: [&str; 31] = [
    "hello", "describe_filters", "load_config", "save_config", "probe_config_dir", "apply_config_dir",
    "list_presets", "save_preset", "load_preset", "delete_preset", "connect_db", "list_demos",
    "start_run", "start_preview", "run_inputs_problem", "request_stop", "request_kill", "cancel_preview",
    "clip_cameras", "export_preview", "injection_preview", "tags_search", "tags_calc_range",
    "tags_set_active", "tags_apply", "tags_remove", "tag_create", "tag_delete", "tags_export",
    "tags_import_scan", "tags_import_apply",
];

impl Command {
    pub fn name(&self) -> &'static str {
        use Command::*;
        match self {
            Hello => "hello",
            DescribeFilters => "describe_filters",
            LoadConfig => "load_config",
            SaveConfig { .. } => "save_config",
            ProbeConfigDir { .. } => "probe_config_dir",
            ApplyConfigDir { .. } => "apply_config_dir",
            ListPresets => "list_presets",
            SavePreset { .. } => "save_preset",
            LoadPreset { .. } => "load_preset",
            DeletePreset { .. } => "delete_preset",
            ConnectDb { .. } => "connect_db",
            ListDemos => "list_demos",
            StartRun { .. } => "start_run",
            StartPreview { .. } => "start_preview",
            RunInputsProblem { .. } => "run_inputs_problem",
            RequestStop => "request_stop",
            RequestKill => "request_kill",
            CancelPreview => "cancel_preview",
            ClipCameras { .. } => "clip_cameras",
            ExportPreview { .. } => "export_preview",
            InjectionPreview { .. } => "injection_preview",
            TagsSearch { .. } => "tags_search",
            TagsCalcRange { .. } => "tags_calc_range",
            TagsSetActive { .. } => "tags_set_active",
            TagsApply { .. } => "tags_apply",
            TagsRemove { .. } => "tags_remove",
            TagCreate { .. } => "tag_create",
            TagDelete { .. } => "tag_delete",
            TagsExport { .. } => "tags_export",
            TagsImportScan { .. } => "tags_import_scan",
            TagsImportApply { .. } => "tags_import_apply",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One value of every variant: `name()` is exhaustive, this list must be too.
    fn every_command() -> Vec<Command> {
        use Command::*;
        let (s, v, p) = (Settings::new(), Value::Null, PathBuf::new());
        vec![
            Hello, DescribeFilters, LoadConfig, SaveConfig { cfg: s.clone() }, ProbeConfigDir { target: None },
            ApplyConfigDir { target: String::new() }, ListPresets,
            SavePreset { preset: String::new(), cats: vec![], cfg: s.clone(), selected_clips: None, ask_name: false },
            LoadPreset { preset: String::new() }, DeletePreset { preset: String::new() }, ConnectDb { pg: None }, ListDemos,
            StartRun { cfg: s.clone(), selected_clips: None }, StartPreview { cfg: s.clone() }, RunInputsProblem { cfg: s.clone() },
            RequestStop, RequestKill, CancelPreview, ClipCameras { clip: v.clone() }, ExportPreview { format: String::new() },
            InjectionPreview { cfg: s }, TagsSearch { tag_ids: vec![], cfg: None }, TagsCalcRange { tag_ids: vec![] },
            TagsSetActive { tag_ids: vec![] }, TagsApply { demo_paths: vec![], tag_names: vec![] },
            TagsRemove { demo_paths: vec![], tag_names: vec![] }, TagCreate { tag_name: String::new(), color: String::new() },
            TagDelete { tag_id: v.clone() }, TagsExport { path: p.clone(), tag_ids: None }, TagsImportScan { path: p.clone() },
            TagsImportApply { path: p, tags_to_create: v },
        ]
    }

    #[test]
    fn names_match_the_variants() {
        let names: Vec<&str> = every_command().iter().map(Command::name).collect();
        assert_eq!(names, COMMAND_NAMES);
    }
}
