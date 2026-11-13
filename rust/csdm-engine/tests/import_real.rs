//! Import of real 3.5 settings folders, on copies (proof of T0, run by hand):
//!
//!   $env:CSDM_REAL_SETTINGS_DIRS = "<dir>;<dir>"
//!   cargo test -p csdm-engine --test import_real -- --ignored --nocapture
//!
//! Each folder's four JSON files are copied to a temporary folder and imported
//! from there; the originals and the copies must have the same SHA-256 before
//! and after. Prints counts only: these files hold the database password.

use csdm_core::values::CONFIG_FILES;
use csdm_engine::import35::import_dir;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

fn hashes(dir: &Path) -> Vec<(String, Option<Vec<u8>>)> {
    CONFIG_FILES
        .iter()
        .map(|f| (f.to_string(), fs::read(dir.join(f)).ok().map(|b| Sha256::digest(&b).to_vec())))
        .collect()
}

fn password_values(raw: &Value) -> Vec<String> {
    let mut found = Vec::new();
    match raw {
        Value::Object(o) => {
            for (k, v) in o {
                match (k.as_str(), v) {
                    ("pg_pass", Value::String(s)) if !s.is_empty() => found.push(s.clone()),
                    _ => found.extend(password_values(v)),
                }
            }
        }
        Value::Array(a) => a.iter().for_each(|v| found.extend(password_values(v))),
        _ => {}
    }
    found
}

fn has_secret_key(v: &Value) -> bool {
    match v {
        Value::Object(o) => o.iter().any(|(k, x)| csdm_core::values::SECRET_KEYS.contains(&k.as_str()) || has_secret_key(x)),
        Value::Array(a) => a.iter().any(has_secret_key),
        _ => false,
    }
}

fn string_values(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.clone()],
        Value::Object(o) => o.values().flat_map(string_values).collect(),
        Value::Array(a) => a.iter().flat_map(string_values).collect(),
        _ => vec![],
    }
}

#[test]
#[ignore = "reads the author's real settings (copies only); run by hand, see the header"]
fn real_settings_import_on_copies() {
    let dirs = std::env::var("CSDM_REAL_SETTINGS_DIRS").expect("set CSDM_REAL_SETTINGS_DIRS (folders separated by ;)");
    for original in dirs.split(';').filter(|s| !s.is_empty()).map(PathBuf::from) {
        let before = hashes(&original);
        assert!(before.iter().any(|(_, h)| h.is_some()), "{}: no settings file", original.display());
        let copy = tempfile::tempdir().unwrap();
        for f in CONFIG_FILES {
            if original.join(f).is_file() {
                fs::copy(original.join(f), copy.path().join(f)).unwrap();
            }
        }
        let copied = hashes(copy.path());
        assert_eq!(copied, before, "copy differs from the original");

        let imported = import_dir(copy.path()).unwrap_or_else(|e| panic!("{}: {}", original.display(), e.user_message()));

        assert_eq!(hashes(copy.path()), copied, "import wrote to the copy");
        assert_eq!(hashes(&original), before, "original changed");

        let raw_presets: Value = fs::read(copy.path().join("csdm_presets.json"))
            .ok()
            .map(|b| serde_json::from_slice(&b).unwrap())
            .unwrap_or(Value::Null);
        let passwords = password_values(&raw_presets);
        // Values, not a substring search of the whole text: a short password can
        // also be an ordinary word of key names or preset names (seen on real data).
        let presets = Value::Object(imported.presets.clone());
        assert!(!has_secret_key(&presets), "a secret key survived in the presets");
        assert!(!string_values(&presets).iter().any(|v| passwords.contains(v)), "a password survived in the presets");
        for (name, p) in &imported.presets {
            for k in p["data"].as_object().unwrap().keys() {
                assert!(!csdm_core::presets::excludes(k), "preset {name} kept personal key {k}");
            }
        }
        let layouts_v5 = imported.settings["ui_sections"].as_object().unwrap().values().all(|t| t["v"] == 5);
        println!(
            "{}: {} settings, {} unknown keys {:?}, {} presets (passwords in raw presets: {}), {} favourites, {} assembly names, layouts v5: {}, notices: {:?}",
            original.display(),
            imported.settings.len(),
            imported.unknown.len(),
            imported.unknown.keys().collect::<Vec<_>>(),
            imported.presets.len(),
            passwords.len(),
            imported.settings["saved_players"].as_array().map_or(0, Vec::len),
            imported.asm_names.len(),
            layouts_v5,
            imported.notices,
        );
    }
}
