//! Parity with 3.5: the settings table and the registries embedded in csdm-core
//! must equal what `tools/export_reference.py` reads from the Python source of
//! this checkout (`csdm/config.py::DEFAULT_CONFIG`, `capabilities.py`,
//! `static_data.py`). Nothing is copied by hand: a key added, removed or changed
//! in 3.5 fails here until `export_reference.py --write` is re-run and reviewed.
//!
//! Needs a Python with the 3.5 requirements (psycopg2): `CSDM_REFERENCE_PYTHON`,
//! else `python` on PATH. Retired with the Python engine at T13.

use serde_json::Value;
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;

fn exported() -> &'static Value {
    static OUT: OnceLock<Value> = OnceLock::new();
    OUT.get_or_init(|| {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let python = std::env::var("CSDM_REFERENCE_PYTHON").unwrap_or_else(|_| "python".into());
        let out = Command::new(&python)
            .arg(manifest.join("../tools/export_reference.py"))
            .arg(manifest.join("../.."))
            .output()
            .unwrap_or_else(|e| panic!("could not run {python}: {e}. Set CSDM_REFERENCE_PYTHON to a Python with the 3.5 requirements."));
        assert!(
            out.status.success(),
            "export_reference.py failed with {python} (set CSDM_REFERENCE_PYTHON to a Python with the 3.5 requirements):\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&out.stdout).expect("export_reference.py did not print JSON")
    })
}

fn embedded(text: &str) -> Value {
    serde_json::from_str(text).expect("embedded data is not JSON")
}

fn keys(v: &Value) -> Vec<String> {
    v["settings"].as_array().unwrap().iter().map(|s| s["key"].as_str().unwrap().to_string()).collect()
}

#[test]
fn settings_keys_are_exactly_default_config() {
    let python = keys(&exported()["settings"]);
    let rust = keys(&embedded(include_str!("../data/settings.json")));
    let missing: Vec<_> = python.iter().filter(|k| !rust.contains(k)).collect();
    let extra: Vec<_> = rust.iter().filter(|k| !python.contains(k)).collect();
    assert!(missing.is_empty() && extra.is_empty(), "missing in Rust: {missing:?}; not in 3.5: {extra:?}");
    assert_eq!(python, rust, "same keys, different order");
}

#[test]
fn settings_table_equals_35() {
    let python = &exported()["settings"];
    let rust = embedded(include_str!("../data/settings.json"));
    for (p, r) in python["settings"].as_array().unwrap().iter().zip(rust["settings"].as_array().unwrap()) {
        assert_eq!(p, r, "row differs");
    }
    assert_eq!(*python, rust, "capabilities, intentions or preset rules differ");
}

#[test]
fn registries_equal_35() {
    assert_eq!(exported()["registries"], embedded(include_str!("../data/registries.json")));
}

/// `data/preview.json` (fixed tables of the preview chain, T3) equals what
/// `tools/export_preview_reference.py` reads from 3.5's source now.
#[test]
fn preview_tables_equal_35() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let python = std::env::var("CSDM_REFERENCE_PYTHON").unwrap_or_else(|_| "python".into());
    let out = Command::new(&python)
        .arg(manifest.join("../tools/export_preview_reference.py"))
        .arg(manifest.join("../.."))
        .env("PYTHONIOENCODING", "utf-8")
        .output()
        .unwrap_or_else(|e| panic!("could not run {python}: {e}"));
    assert!(out.status.success(), "export_preview_reference.py failed:\n{}", String::from_utf8_lossy(&out.stderr));
    let python: Value = serde_json::from_slice(&out.stdout).expect("export_preview_reference.py did not print JSON");
    assert_eq!(python, embedded(include_str!("../data/preview.json")), "re-run export_preview_reference.py --write and review");
}
