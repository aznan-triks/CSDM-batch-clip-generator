//! The engine surface against 3.5's source, read as text (no Python run):
//! commands = `csdm/bridge/host.py::COMMANDS` minus the retired diagnostics,
//! states = every `.state("<name>"` the 3.5 engine emits. Retired at T13.

use csdm_engine::command::COMMAND_NAMES;
use csdm_engine::event::STATE_NAMES;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const RETIRED: [&str; 5] = ["ping", "set_debug", "demo_logs", "demo_ask", "tkinter_check"];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Quoted names opening a `"name": _cmd_` line inside `COMMANDS = { ... }`.
fn bridge_commands() -> BTreeSet<String> {
    let host = std::fs::read_to_string(repo().join("csdm/bridge/host.py")).expect("csdm/bridge/host.py");
    let block = host.split("\nCOMMANDS = {").nth(1).expect("COMMANDS block").split("\n}").next().unwrap();
    block
        .lines()
        .filter_map(|l| l.trim().strip_prefix('"')?.split_once("\": _cmd_").map(|(n, _)| n.to_string()))
        .collect()
}

fn engine_states() -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut dirs = vec![repo().join("csdm")];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                dirs.push(path);
            } else if path.extension().is_some_and(|e| e == "py") {
                let text = std::fs::read_to_string(&path).unwrap();
                for chunk in text.split(".state(\"").skip(1) {
                    found.insert(chunk.split('"').next().unwrap().to_string());
                }
            }
        }
    }
    found
}

#[test]
fn commands_are_the_35_bridge_minus_diagnostics() {
    let bridge = bridge_commands();
    assert_eq!(bridge.len(), COMMAND_NAMES.len() + RETIRED.len(), "3.5 bridge: {bridge:?}");
    let expected: BTreeSet<String> = bridge.into_iter().filter(|n| !RETIRED.contains(&n.as_str())).collect();
    let rust: BTreeSet<String> = COMMAND_NAMES.iter().map(|s| s.to_string()).collect();
    assert_eq!(rust, expected);
}

#[test]
fn states_are_the_ones_35_emits() {
    let rust: BTreeSet<String> = STATE_NAMES.iter().map(|s| s.to_string()).collect();
    assert_eq!(rust, engine_states());
}

#[test]
fn every_command_has_exactly_one_owner_capability() {
    let caps = &csdm_core::settings::reference().capabilities;
    for name in COMMAND_NAMES {
        let owners: Vec<&str> = caps.iter().filter(|c| c.commands.iter().any(|x| x == name)).map(|c| c.id.as_str()).collect();
        assert_eq!(owners.len(), 1, "{name}: {owners:?}");
    }
    for c in caps {
        for cmd in &c.commands {
            assert!(COMMAND_NAMES.contains(&cmd.as_str()), "capability {} owns unknown command {cmd}", c.id);
        }
    }
}
