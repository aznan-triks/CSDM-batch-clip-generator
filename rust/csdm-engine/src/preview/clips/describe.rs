//! The static tables the Capture and Video tabs build their rows from, in one reply (3.5 bridge
//! `_cmd_describe_filters` → `csdm/bridge/tables.py::describe_filters`).

use csdm_core::preview::clips::{
    CSDM_CLI_COMMAND, CSDM_CLI_INSTALL_PATHS, DEFAULT_CLIPS_SUBDIR, HOME_ENV, LOCAL_APP_DATA_UNDER_HOME, PATHEXT_DEFAULT, PATHEXT_ENV, PATH_ENV,
    PRESET_FULL_CATEGORY, VIDEOS_DIR,
};
use csdm_core::registries::registries;
use csdm_core::settings::reference;
use csdm_core::values::LOCAL_APP_DATA_ENV;
use serde_json::{json, Map, Value};
use std::path::PathBuf;

/// Python `Path.home()` on Windows.
fn home() -> PathBuf {
    std::env::var_os(HOME_ENV).map(PathBuf::from).unwrap_or_default()
}

/// `shutil.which(name)`: the first `PATH` folder holding `name` with a `PATHEXT` extension.
/// shortcut: no current-folder search and no bare-name match; enough for an installed `csdm.CMD`.
fn which(name: &str) -> Option<PathBuf> {
    let exts = std::env::var(PATHEXT_ENV).unwrap_or_else(|_| PATHEXT_DEFAULT.into());
    let path = std::env::var_os(PATH_ENV)?;
    std::env::split_paths(&path).find_map(|dir| exts.split(';').filter(|e| !e.is_empty()).map(|e| dir.join(format!("{name}{e}"))).find(|p| p.is_file()))
}

/// `detect_csdm_cli`: the CS Demo Manager CLI found without any setting, or "".
fn detect_csdm_cli() -> String {
    let base = std::env::var_os(LOCAL_APP_DATA_ENV).filter(|v| !v.is_empty()).map_or_else(|| LOCAL_APP_DATA_UNDER_HOME.iter().fold(home(), |p, s| p.join(s)), PathBuf::from);
    CSDM_CLI_INSTALL_PATHS
        .iter()
        .map(|parts| parts.iter().fold(base.clone(), |p, s| p.join(s)))
        .find(|p| p.is_file())
        .or_else(|| which(CSDM_CLI_COMMAND))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// `describe_filters`.
pub fn describe_filters() -> Value {
    let r = registries();
    let filters: Vec<Value> = r
        .kill_filters
        .iter()
        .map(|f| {
            let extras: Vec<Value> = f
                .extra_ui
                .iter()
                .flatten()
                .map(|(k, lu)| json!({"key": k, "label": lu[0], "unit": lu[1], "default": f.extra_config.as_ref().and_then(|c| c.get(k)).cloned()}))
                .collect();
            json!({"key": f.key, "label": f.label, "tip": f.tip, "category": f.category, "hidden": f.hide_ui,
                   "applies_to": f.applies_to, "untested": f.untested, "extras": extras})
        })
        .collect();
    let match_types: Vec<Value> = r.match_types.iter().map(|m| json!({"key": m.key, "label": m.label, "tip": m.tip})).collect();
    let resolutions: Vec<Value> = r.resolutions.iter().map(|x| json!({"label": x.label, "width": x.width, "height": x.height})).collect();
    let mut categories = vec![json!(PRESET_FULL_CATEGORY)];
    for group in reference().presets.tab_groups.as_array().expect("preset tab groups") {
        categories.extend(group[1].as_array().expect("a tab group's categories").iter().map(|item| item[0].clone()));
    }
    let keys = |m: &Map<String, Value>| m.keys().cloned().collect::<Vec<_>>();
    json!({
        "filters": filters,
        "match_types": match_types,
        "weapon_categories": r.weapon_categories,
        "weapon_category_tips": r.weapon_category_tips,
        "resolutions": resolutions,
        "framerates": r.framerates,
        "video_codecs": keys(&r.video_codecs),
        "audio_codecs": keys(&r.audio_codecs),
        "preset_categories": categories,
        "default_paths": {"csdm_exe": detect_csdm_cli(),
                          "clips_dir": home().join(VIDEOS_DIR).join(DEFAULT_CLIPS_SUBDIR).to_string_lossy()},
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_have_the_3_5_shape() {
        let d = describe_filters();
        let f = &d["filters"][0];
        for k in ["key", "label", "tip", "category", "hidden", "applies_to", "untested", "extras"] {
            assert!(f.get(k).is_some(), "{k}");
        }
        assert_eq!(d["preset_categories"][0], "full");
        assert_eq!(d["preset_categories"].as_array().unwrap().len(), 10);
        let with_extras = d["filters"].as_array().unwrap().iter().find(|f| !f["extras"].as_array().unwrap().is_empty()).unwrap();
        assert!(with_extras["extras"][0].get("default").is_some());
    }
}
