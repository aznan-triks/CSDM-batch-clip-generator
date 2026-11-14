//! Shared by the T4 benches: a golden case's settings with the bench overrides of `meta.json`
//! applied, as `tools/t4_golden_refs.py` applies them (`{**cfg, **overrides}`), every path in a
//! throwaway root. A guard refuses any setting that would reach the author's folders: the case
//! files hold the raw settings, and without the overrides a run writes to the real clips folder.

use csdm_core::migrate::truthy;
use csdm_core::Settings;
use serde_json::Value;
use std::path::Path;

pub const ROOT_MARK: &str = "{ROOT}";
/// Settings that name a place the run writes to or starts.
const PATH_KEYS: [&str; 3] = ["csdm_exe", "output_dir_clips", "cs2_cfg_dir"];
/// Settings the bench forces off: their writes (FFmpeg, tags) are never part of it.
const OFF_KEYS: [&str; 3] = ["assemble_after", "tag_enabled", "cs2_send_to_back"];

/// `v` with `from` replaced by `to` in every text.
pub fn swap_root(v: &Value, from: &str, to: &str) -> Value {
    match v {
        Value::String(s) => Value::String(s.replace(from, to)),
        Value::Array(a) => Value::Array(a.iter().map(|x| swap_root(x, from, to)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), swap_root(x, from, to))).collect()),
        other => other.clone(),
    }
}

/// The case's settings over `root` (its `cli\csdm.CMD` stand-in, `clips`, `cs2cfg` created).
/// `refs` holds `meta.json`. Panics when a path setting leaves `root` or a forced-off one is on.
pub fn case_settings(refs: &Path, case: &Value, root: &Path) -> Settings {
    let meta: Value = serde_json::from_str(&std::fs::read_to_string(refs.join("meta.json")).expect("meta.json")).expect("meta JSON");
    let root_text = root.to_string_lossy().into_owned();
    let mut cfg: Settings = serde_json::from_value(swap_root(&case["cfg"], ROOT_MARK, &root_text)).expect("case cfg");
    let overrides = swap_root(&meta["overrides"], ROOT_MARK, &root_text);
    cfg.extend(overrides.as_object().expect("overrides object").clone());
    for key in PATH_KEYS {
        let v = cfg.get(key).and_then(Value::as_str).unwrap_or_default();
        assert!(Path::new(v).starts_with(root), "refusing to run: `{key}` = {v:?} is outside the throwaway root");
    }
    for key in OFF_KEYS {
        assert!(!cfg.get(key).is_some_and(truthy), "refusing to run: `{key}` must be off in the bench");
    }
    for sub in ["cli", "clips", "cs2cfg"] {
        std::fs::create_dir_all(root.join(sub)).expect("root folders");
    }
    std::fs::write(root.join("cli").join("csdm.CMD"), "").expect("stand-in CLI file");
    cfg
}
