//! Layer guard (ticket 07): each crate may only depend on what its layer allows.
//! Reads the real manifests through `cargo metadata`, so a forbidden edge fails here
//! the moment it is added, whatever the code does with it.

use serde_json::Value;
use std::process::Command;

/// (crate, direct dependencies it must never take). Dev-dependencies are not checked.
const FORBIDDEN: &[(&str, &[&str])] = &[
    ("csdm-core", &["csdm-db", "csdm-demo", "csdm-engine", "csdm-app", "postgres", "slint", "egui", "eframe", "windows", "sysinfo", "rfd"]),
    ("csdm-db", &["csdm-demo", "csdm-engine", "csdm-app", "slint", "egui", "eframe", "rfd"]),
    ("csdm-demo", &["csdm-db", "csdm-engine", "csdm-app", "postgres", "slint", "egui", "eframe", "rfd"]),
    ("csdm-engine", &["csdm-app", "slint", "egui", "eframe", "rfd"]),
    // The UI reaches the database, demos and processes only through csdm-engine.
    ("csdm-app", &["csdm-db", "csdm-demo", "postgres"]),
];

/// Source patterns a layer must not use even through std: the UI never spawns
/// processes; csdm-core does no I/O at all (files, processes, network).
const FORBIDDEN_SOURCE: &[(&str, &str)] = &[
    ("csdm-app", "std::process"),
    ("csdm-core", "std::fs"),
    ("csdm-core", "std::process"),
    ("csdm-core", "std::net"),
];

fn metadata() -> Value {
    let out = Command::new(env!("CARGO"))
        .args(["metadata", "--format-version", "1", "--no-deps"])
        .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/.."))
        .output()
        .expect("cargo metadata did not run");
    assert!(out.status.success(), "cargo metadata failed: {}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).expect("cargo metadata output is not JSON")
}

#[test]
fn every_crate_respects_its_layer() {
    let meta = metadata();
    let packages = meta["packages"].as_array().expect("packages");
    let mut seen = Vec::new();
    let mut violations = Vec::new();
    for p in packages {
        let name = p["name"].as_str().unwrap();
        let Some((_, banned)) = FORBIDDEN.iter().find(|(c, _)| *c == name) else { continue };
        seen.push(name.to_string());
        for d in p["dependencies"].as_array().unwrap() {
            if d["kind"].as_str() == Some("dev") { continue; }
            let dep = d["name"].as_str().unwrap();
            if banned.contains(&dep) { violations.push(format!("{name} -> {dep}")); }
        }
    }
    for (c, _) in FORBIDDEN {
        assert!(seen.iter().any(|s| s == c), "layer rule names a crate that is not in the workspace: {c}");
    }
    assert!(violations.is_empty(), "forbidden dependencies: {violations:?}");
}

#[test]
fn no_layer_uses_its_forbidden_std_modules() {
    let root = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/.."));
    let mut hits = Vec::new();
    for (krate, pattern) in FORBIDDEN_SOURCE {
        let mut stack = vec![root.join(krate).join("src")];
        while let Some(dir) = stack.pop() {
            for e in std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display())) {
                let path = e.unwrap().path();
                if path.is_dir() { stack.push(path); continue; }
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                if text.contains(pattern) { hits.push(format!("{} uses {pattern}", path.display())); }
            }
        }
    }
    assert!(hits.is_empty(), "{hits:?}");
}
