//! Finding and reading the 3.5.x settings folder (research/05). Read-only: no
//! file is ever written, renamed or copied here; 3.5's own copy-on-load steps
//! (flat files, old folder name) are replayed by reading from where they are.

use crate::error::EngineError;
use csdm_core::import35::{import, Files, Imported};
use csdm_core::values::{
    ASM_NAMES_FILE, CONFIG_DIR_APPDATA, CONFIG_DIR_DEFAULT, CONFIG_FILE, CONFIG_SUBDIR, LEGACY_CONFIG_SUBDIR,
    LEGACY_ENGINE_MARKER, LOCAL_APP_DATA_ENV, PLAYERS_FILE, PRESETS_FILE, PROFILE_ROOT_ENV, ROOT_SEARCH_DEPTH,
};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Where to look: an explicit root wins and disables every other place, so a
/// test or a scripted launch can never reach the real settings.
#[derive(Debug, Clone, Default)]
pub struct SearchPlaces {
    pub explicit_root: Option<PathBuf>,
    pub exe_dir: Option<PathBuf>,
    pub local_app_data: Option<PathBuf>,
}

impl SearchPlaces {
    /// From the environment: `CSDM_PROFILE_ROOT`, the running exe, `%LOCALAPPDATA%`.
    pub fn from_env() -> Self {
        let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
        Self {
            explicit_root: var(PROFILE_ROOT_ENV),
            exe_dir: std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)),
            local_app_data: var(LOCAL_APP_DATA_ENV),
        }
    }
}

/// The folder under `parent` holding the settings: new name, else the pre-3.1.1 name.
fn settings_dir_in(parent: &Path) -> Option<PathBuf> {
    [CONFIG_SUBDIR, LEGACY_CONFIG_SUBDIR].iter().map(|s| parent.join(s)).find(|d| d.join(CONFIG_FILE).is_file())
}

/// An app root's settings folder; pre-3.0.1 installs kept the files flat in the root.
fn root_settings_dir(root: &Path) -> Option<PathBuf> {
    settings_dir_in(root).or_else(|| root.join(CONFIG_FILE).is_file().then(|| root.to_path_buf()))
}

fn is_app_root(dir: &Path) -> bool {
    root_settings_dir(dir).is_some() || LEGACY_ENGINE_MARKER.iter().fold(dir.to_path_buf(), |p, s| p.join(s)).is_dir()
}

/// The folder whose four files are the user's current 3.5 state.
///
/// Order (research/05 « Recommandation »): explicit root; else the first app
/// root found above the exe; else `%LOCALAPPDATA%`. From a root, the
/// `config_dir` pointer of its settings is followed as 3.5 did, falling back to
/// the root's own folder when the pointed one has no settings.
pub fn locate(places: &SearchPlaces) -> Result<PathBuf, EngineError> {
    let mut searched = Vec::new();
    let root = match &places.explicit_root {
        Some(r) => Some(r.clone()),
        None => places.exe_dir.as_ref().and_then(|exe| {
            exe.ancestors().take(ROOT_SEARCH_DEPTH + 1).find(|d| {
                searched.push(d.to_path_buf());
                is_app_root(d)
            }).map(Path::to_path_buf)
        }),
    };
    if let Some(root) = &root {
        searched.push(root.clone());
        if let Some(default_dir) = root_settings_dir(root) {
            let pointer = read_json(&default_dir.join(CONFIG_FILE))?
                .and_then(|c| c.get("config_dir").cloned());
            let pointed = match pointer.as_ref().and_then(Value::as_str) {
                None | Some(CONFIG_DIR_DEFAULT) => None,
                Some(CONFIG_DIR_APPDATA) => places.local_app_data.as_deref().and_then(settings_dir_in),
                Some(path) => settings_dir_in(Path::new(path)),
            };
            return Ok(pointed.unwrap_or(default_dir));
        }
    }
    if places.explicit_root.is_none() {
        if let Some(lad) = &places.local_app_data {
            searched.push(lad.clone());
            if let Some(dir) = settings_dir_in(lad) {
                return Ok(dir);
            }
        }
    }
    Err(EngineError::NoSettingsFound { searched })
}

/// A JSON file, or `None` if absent. Never written; a damaged file is an error
/// naming it (3.5 replaced it with an empty one, then overwrote it).
fn read_json(path: &Path) -> Result<Option<Value>, EngineError> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path).map_err(|e| EngineError::Unreadable { path: path.into(), reason: e.to_string() })?;
    let text = bytes.strip_prefix("\u{feff}".as_bytes()).unwrap_or(&bytes);
    serde_json::from_slice(text).map(Some).map_err(|e| EngineError::Damaged { path: path.into(), reason: e.to_string() })
}

/// Reads the four files of `dir` and replays every 3.5 migration in memory.
pub fn import_dir(dir: &Path) -> Result<Imported, EngineError> {
    let files = Files {
        config: read_json(&dir.join(CONFIG_FILE))?,
        presets: read_json(&dir.join(PRESETS_FILE))?,
        players: read_json(&dir.join(PLAYERS_FILE))?,
        asm_names: read_json(&dir.join(ASM_NAMES_FILE))?,
    };
    let cpus = std::thread::available_parallelism().ok().map(usize::from);
    import(&files, cpus).map_err(|error| EngineError::Invalid { path: dir.to_path_buf(), error })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn write(path: &Path, v: Value) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_vec_pretty(&v).unwrap()).unwrap();
    }

    fn places(root: Option<&Path>, exe: Option<&Path>, lad: Option<&Path>) -> SearchPlaces {
        SearchPlaces { explicit_root: root.map(Into::into), exe_dir: exe.map(Into::into), local_app_data: lad.map(Into::into) }
    }

    #[test]
    fn explicit_root_default_folder() {
        let t = tempfile::tempdir().unwrap();
        write(&t.path().join(CONFIG_SUBDIR).join(CONFIG_FILE), json!({"config_dir": ""}));
        assert_eq!(locate(&places(Some(t.path()), None, None)).unwrap(), t.path().join(CONFIG_SUBDIR));
    }

    #[test]
    fn explicit_root_never_falls_back_to_other_places() {
        let (t, lad) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write(&lad.path().join(CONFIG_SUBDIR).join(CONFIG_FILE), json!({}));
        assert!(matches!(locate(&places(Some(t.path()), None, Some(lad.path()))), Err(EngineError::NoSettingsFound { .. })));
    }

    #[test]
    fn pointer_to_appdata_and_to_a_custom_folder() {
        let (t, lad, custom) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let default_cfg = t.path().join(CONFIG_SUBDIR).join(CONFIG_FILE);
        write(&lad.path().join(CONFIG_SUBDIR).join(CONFIG_FILE), json!({}));
        write(&default_cfg, json!({"config_dir": "appdata"}));
        assert_eq!(locate(&places(Some(t.path()), None, Some(lad.path()))).unwrap(), lad.path().join(CONFIG_SUBDIR));
        write(&custom.path().join(CONFIG_SUBDIR).join(CONFIG_FILE), json!({}));
        write(&default_cfg, json!({"config_dir": custom.path().to_str().unwrap()}));
        assert_eq!(locate(&places(Some(t.path()), None, None)).unwrap(), custom.path().join(CONFIG_SUBDIR));
        // pointed folder gone → the root's own folder (3.5 `_bootstrap_dir`)
        write(&default_cfg, json!({"config_dir": t.path().join("gone").to_str().unwrap()}));
        assert_eq!(locate(&places(Some(t.path()), None, None)).unwrap(), t.path().join(CONFIG_SUBDIR));
    }

    #[test]
    fn old_folder_name_and_flat_files() {
        let t = tempfile::tempdir().unwrap();
        write(&t.path().join(CONFIG_FILE), json!({}));
        assert_eq!(locate(&places(Some(t.path()), None, None)).unwrap(), t.path());
        write(&t.path().join(LEGACY_CONFIG_SUBDIR).join(CONFIG_FILE), json!({}));
        assert_eq!(locate(&places(Some(t.path()), None, None)).unwrap(), t.path().join(LEGACY_CONFIG_SUBDIR));
    }

    #[test]
    fn root_found_above_the_exe_then_appdata() {
        let (t, lad) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let exe = t.path().join("rust").join("target").join("release");
        fs::create_dir_all(&exe).unwrap();
        write(&lad.path().join(CONFIG_SUBDIR).join(CONFIG_FILE), json!({}));
        assert_eq!(locate(&places(None, Some(&exe), Some(lad.path()))).unwrap(), lad.path().join(CONFIG_SUBDIR));
        write(&t.path().join(CONFIG_SUBDIR).join(CONFIG_FILE), json!({}));
        assert_eq!(locate(&places(None, Some(&exe), Some(lad.path()))).unwrap(), t.path().join(CONFIG_SUBDIR));
    }

    #[test]
    fn damaged_file_is_an_error_and_stays_untouched() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join(PRESETS_FILE);
        fs::write(&p, b"{ not json").unwrap();
        assert!(matches!(import_dir(t.path()), Err(EngineError::Damaged { .. })));
        assert_eq!(fs::read(&p).unwrap(), b"{ not json");
        assert_eq!(fs::read_dir(t.path()).unwrap().count(), 1, "nothing created next to it");
    }

    #[test]
    fn import_reads_and_migrates() {
        let t = tempfile::tempdir().unwrap();
        write(&t.path().join(CONFIG_FILE), json!({"headshots_only": true, "pg_port": 5432}));
        write(&t.path().join(PLAYERS_FILE), json!([{"steam_id": "1", "name": "a", "label": ""}]));
        let i = import_dir(t.path()).unwrap();
        assert_eq!((&i.settings["headshots_mode"], &i.settings["pg_port"]), (&json!("only"), &json!("5432")));
        assert_eq!(i.settings["saved_players"], json!([{"steam_id": "1", "name": "a"}]));
    }
}
