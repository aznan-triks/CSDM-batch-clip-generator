//! RecSys CS: what CS2 runs at start, written into its own cfg folder (3.5 `_resolve_cs2_cfg_dir`,
//! `_inject_cs_runtime_cfg`). It touches a user file: only the app's block of `autoexec.cfg` is
//! ever replaced. Files are written as 3.5's text mode wrote them (CRLF line ends).

use super::cli_json::{slow_motion, Injection};
use super::os_error;
use crate::event::Level;
use crate::preview::cfg::{cfg_bool, py_str};
use crate::preview::Ports;
use csdm_core::batch::{
    AUTOEXEC_NAME, CS2_CFG_PARTS, LIBRARY_VDF_PARTS, LIBRARY_VDF_PATH_KEY, PROGRAM_FILES_X86_DEFAULT, PROGRAM_FILES_X86_ENV, RUNTIME_BLOCK_END,
    RUNTIME_BLOCK_START, RUNTIME_CFG_NAME, SLOW_MOTION_NEUTRAL, STEAM_DIR, STEAM_ROOTS, WHERE_PATHS,
};
use csdm_core::migrate::truthy;
use csdm_core::Settings;
use std::path::{Path, PathBuf};

fn join(root: &Path, parts: &[&str]) -> PathBuf {
    parts.iter().fold(root.to_path_buf(), |p, s| p.join(s))
}

/// The library folders a Steam `libraryfolders.vdf` lists (3.5 regex `"path"\s*"([^"]+)"`, then
/// `\\` read as `\`).
fn vdf_paths(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find(LIBRARY_VDF_PATH_KEY) {
        rest = &rest[i + LIBRARY_VDF_PATH_KEY.len()..];
        let after = rest.trim_start();
        if let Some(body) = after.strip_prefix('"') {
            if let Some(end) = body.find('"').filter(|&e| e > 0) {
                out.push(body[..end].replace("\\\\", "\\")); // allow-hardcode: VDF escapes each backslash
                rest = &body[end + 1..];
            }
        }
    }
    out
}

/// 3.5 `_resolve_cs2_cfg_dir`: the setting `cs2_cfg_dir`, else CS2's cfg folder under each known
/// Steam root and each library its `libraryfolders.vdf` lists. "" when none exists.
pub fn resolve_cs2_cfg_dir(ports: &dyn Ports, cfg: &Settings) -> String {
    let hint = cfg.get("cs2_cfg_dir").filter(|v| truthy(v)).map(|v| py_str(v).trim().to_string()).unwrap_or_default();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if !hint.is_empty() {
        candidates.push(PathBuf::from(&hint));
    }
    let pf86 = std::env::var(PROGRAM_FILES_X86_ENV).unwrap_or_else(|_| PROGRAM_FILES_X86_DEFAULT.into());
    let mut roots = vec![Path::new(&pf86).join(STEAM_DIR)];
    roots.extend(STEAM_ROOTS.iter().map(PathBuf::from));
    let mut seen = Vec::new();
    for root in roots {
        if seen.contains(&root) {
            continue;
        }
        seen.push(root.clone());
        candidates.push(join(&root, &CS2_CFG_PARTS));
        let vdf = join(&root, &LIBRARY_VDF_PARTS);
        if vdf.is_file() {
            match std::fs::read(&vdf) {
                Ok(bytes) => candidates.extend(vdf_paths(&read_text_ignore(&bytes)).iter().map(|p| join(Path::new(p), &CS2_CFG_PARTS))),
                // 3.5 skipped an unreadable library list without a word.
                Err(e) => ports.log(&format!("  ⚠ CS injection: could not read {} ({e}).", vdf.display()), Level::Warn),
            }
        }
    }
    candidates.into_iter().find(|c| c.is_dir()).map(|c| c.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Python `read_text(errors="ignore")` in text mode: bad bytes dropped, `\r\n` and lone `\r` read `\n`.
fn read_text_ignore(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace('\u{FFFD}', "").replace("\r\n", "\n").replace('\r', "\n")
}

/// Python text mode on write under Windows: `\n` becomes `\r\n`.
fn write_text(path: &Path, text: &str) -> std::io::Result<()> {
    std::fs::write(path, text.replace('\n', "\r\n"))
}

/// `autoexec.cfg` with the app's block replaced (every copy), or appended on its own line.
fn with_block(current: &str, block: &str) -> String {
    let mut out = String::new();
    let mut rest = current;
    let mut replaced = false;
    while let Some(s) = rest.find(RUNTIME_BLOCK_START) {
        let Some(e) = rest[s..].find(RUNTIME_BLOCK_END).map(|e| s + e + RUNTIME_BLOCK_END.len()) else { break };
        out.push_str(&rest[..s]);
        out.push_str(block);
        replaced = true;
        rest = &rest[e..];
        rest = rest.strip_prefix('\n').unwrap_or(rest);
    }
    if replaced {
        out.push_str(rest);
        return out;
    }
    let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
    format!("{current}{sep}{block}")
}

/// 3.5 `_inject_cs_runtime_cfg`. `false` = not injected (said in the console).
pub fn inject_cs_runtime_cfg(ports: &dyn Ports, cfg: &Settings, shared: &Injection) -> bool {
    let dir = resolve_cs2_cfg_dir(ports, cfg);
    if dir.is_empty() {
        ports.log(&format!("  ⚠ CS injection: CS2 cfg folder not found. Set it in {WHERE_PATHS} › CS2 cfg folder."), Level::Warn);
        return false;
    }
    let mut cmds = shared.console_cmds.clone();
    let slow = slow_motion(ports, cfg);
    if slow != SLOW_MOTION_NEUTRAL {
        cmds.push(format!("host_timescale {}", py_str(&serde_json::json!(super::cli_json::timescale(slow)))));
    }
    if cfg_bool(ports, cfg, "hlae_no_spectator_ui", true) {
        cmds.push("cl_draw_only_deathnotices 1".into());
    }
    let runtime = Path::new(&dir).join(RUNTIME_CFG_NAME);
    if let Err(e) = write_text(&runtime, &format!("{}\n", cmds.join("\n"))) {
        ports.log(&format!("  ⚠ CS injection: {}", os_error(&runtime, &e).user_message()), Level::Warn);
        return false;
    }
    let autoexec = Path::new(&dir).join(AUTOEXEC_NAME);
    let current = if autoexec.is_file() {
        match std::fs::read(&autoexec) {
            Ok(b) => read_text_ignore(&b),
            Err(e) => {
                ports.log(&format!("  ⚠ CS injection: {}", os_error(&autoexec, &e).user_message()), Level::Warn);
                return false;
            }
        }
    } else {
        String::new()
    };
    let stem = Path::new(RUNTIME_CFG_NAME).file_stem().map_or_else(String::new, |s| s.to_string_lossy().into_owned());
    let block = format!("{RUNTIME_BLOCK_START}\nexec {stem}\n{RUNTIME_BLOCK_END}\n");
    if let Err(e) = write_text(&autoexec, &with_block(&current, &block)) {
        ports.log(&format!("  ⚠ CS injection: {}", os_error(&autoexec, &e).user_message()), Level::Warn);
        return false;
    }
    ports.log(&format!("  🎮 CS injection ready: {}", runtime.display()), Level::Dim);
    if !shared.launch_args.is_empty() {
        ports.log(&format!("  ⚠ CS launch options not injectable via CSDM JSON: {}", shared.launch_args.join(" ")), Level::Warn);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::{CollectPorts, NoPorts};
    use serde_json::json;

    fn cfg(v: serde_json::Value) -> Settings {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn writes_the_runtime_cfg_and_one_autoexec_block() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        std::fs::write(dir.path().join(AUTOEXEC_NAME), "echo hello\r\n").unwrap();
        let c = cfg(json!({"cs2_cfg_dir": root, "hlae_slow_motion": 80, "hlae_no_spectator_ui": true}));
        let shared = Injection { launch_args: vec!["-windowed".into()], console_cmds: vec!["sv_gravity 700".into()] };
        let ports = CollectPorts::default();
        assert!(inject_cs_runtime_cfg(&ports, &c, &shared));
        let runtime = std::fs::read_to_string(dir.path().join(RUNTIME_CFG_NAME)).unwrap();
        assert_eq!(runtime, "sv_gravity 700\r\nhost_timescale 0.8\r\ncl_draw_only_deathnotices 1\r\n");
        let block = format!("{RUNTIME_BLOCK_START}\r\nexec csdm_batch_runtime\r\n{RUNTIME_BLOCK_END}\r\n");
        assert_eq!(std::fs::read_to_string(dir.path().join(AUTOEXEC_NAME)).unwrap(), format!("echo hello\r\n{block}"));
        assert!(inject_cs_runtime_cfg(&NoPorts, &c, &shared));
        let again = std::fs::read_to_string(dir.path().join(AUTOEXEC_NAME)).unwrap();
        assert_eq!(again.matches(RUNTIME_BLOCK_START).count(), 1, "the block is replaced, never added twice");
        assert!(ports.logs.lock().unwrap().iter().any(|(m, l)| m.contains("not injectable") && *l == Level::Warn));
    }

    #[test]
    fn an_unwritable_runtime_cfg_is_said_and_refused() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(RUNTIME_CFG_NAME)).unwrap(); // a folder where the file goes
        let c = cfg(json!({"cs2_cfg_dir": dir.path().to_string_lossy()}));
        let ports = CollectPorts::default();
        assert!(!inject_cs_runtime_cfg(&ports, &c, &Injection { launch_args: vec![], console_cmds: vec!["sv_gravity 800".into()] }));
        assert!(ports.logs.lock().unwrap().iter().any(|(m, _)| m.starts_with("  ⚠ CS injection:")));
    }

    #[test]
    fn the_setting_wins_and_library_paths_are_read() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(resolve_cs2_cfg_dir(&NoPorts, &cfg(json!({"cs2_cfg_dir": dir.path().to_string_lossy()}))), dir.path().to_string_lossy());
        assert_eq!(vdf_paths("\"libraryfolders\" { \"0\" { \"path\"\t\t\"D:\\\\Games\\\\Steam\" } \"1\" { \"path\" \"E:\\\\S\" } }"), ["D:\\Games\\Steam", "E:\\S"]);
        assert_eq!(with_block("a", "B\n"), "a\nB\n");
    }
}
