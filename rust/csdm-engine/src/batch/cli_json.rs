//! The job file CS Demo Manager's CLI records from (3.5 `_build_json`, `_bj_players_options`,
//! `_bj_output_dir`, `_bj_output_params`) and the CS2 / HLAE injection it carries
//! (`_common_cs2_injection`, `_inject_hlae_extra_args`, `injection_preview_lines`). An external
//! contract with no crate behind it: its shape is fixed by the golden bench (`examples/t4_golden.rs`).

use crate::preview::cfg::{cfg_bool, cfg_float, cfg_int, py_str};
use crate::preview::clips::{camera_players, home, names_for, player_names, seq_cameras, CameraPlayers, Sequence};
use crate::preview::event::Arena;
use crate::preview::Ports;
use crate::EngineError;
use csdm_core::batch::{
    FOLDER_NAME_FORBIDDEN, FOLDER_NAME_MAX_CHARS, FOV_NEUTRAL, FOV_RANGE, PERCENT, RAGDOLL_GRAVITY_RANGE, RAGDOLL_SCALE_RANGE, RECORDING_OUTPUT, RECSYS_CS,
    RECSYS_HLAE, SLOW_MOTION_NEUTRAL, SLOW_MOTION_RANGE, SV_GRAVITY_RANGE, TIMESCALE_DECIMALS, WINDOW_MODE_ARGS,
};
use csdm_core::migrate::truthy;
use csdm_core::preview::clips::{DEFAULT_CLIPS_SUBDIR, VIDEOS_DIR};
use csdm_core::registries::registries;
use csdm_core::settings::def;
use csdm_core::Settings;
use csdm_db::Discovery;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

/// `cfg.get(key, <3.5 literal>)`: every literal default `_build_json` and the injection use equals
/// the settings table's (test below), so the table answers when the key is absent.
pub fn got<'a>(cfg: &'a Settings, key: &str) -> &'a Value {
    cfg.get(key).unwrap_or_else(|| &def(key).unwrap_or_else(|| panic!("`{key}` is not in the settings table")).default)
}

fn table_i64(key: &str) -> i64 {
    got(&Settings::new(), key).as_i64().unwrap_or_else(|| panic!("`{key}` has a whole default"))
}

fn table_f64(key: &str) -> f64 {
    got(&Settings::new(), key).as_f64().unwrap_or_else(|| panic!("`{key}` has a number default"))
}

fn table_bool(key: &str) -> bool {
    got(&Settings::new(), key).as_bool().unwrap_or_else(|| panic!("`{key}` has a true/false default"))
}

/// `str(value).strip()` for a setting 3.5 reads as text.
fn text(cfg: &Settings, key: &str) -> String {
    py_str(got(cfg, key)).trim().to_string()
}

/// 3.5 `_normalize_recsys`: "CS", else "HLAE".
pub fn normalize_recsys(v: &Value) -> &'static str {
    let v = if truthy(v) { py_str(v) } else { String::new() };
    if v.trim().to_uppercase() == RECSYS_CS { RECSYS_CS } else { RECSYS_HLAE }
}

/// Python `os.path.abspath` on Windows: the full path, without a trailing separator.
pub fn abspath(p: &str) -> String {
    let full = std::path::absolute(p).map_or_else(|_| p.to_string(), |a| a.to_string_lossy().into_owned());
    let trimmed = full.trim_end_matches(['\\', '/']);
    // A drive root keeps its separator ("C:\").
    if trimmed.ends_with(':') { format!("{trimmed}\\") } else { trimmed.to_string() } // allow-hardcode: Windows path separator
}

/// 3.5 `clips_root`: `output_dir_clips`, else `output_dir`, else `<home>/Videos/CSDM Batch Clips`
/// (the literal home folder, not the known "Videos" folder: research/03 §4).
pub fn clips_root(cfg: &Settings) -> PathBuf {
    let pick = [cfg.get("output_dir_clips"), cfg.get("output_dir")].into_iter().flatten().find(|v| truthy(v));
    let raw = pick.map(|v| py_str(v).trim().to_string()).unwrap_or_default();
    if raw.is_empty() { home().join(VIDEOS_DIR).join(DEFAULT_CLIPS_SUBDIR) } else { PathBuf::from(abspath(&raw)) }
}

/// 3.5 `safe_folder_name`: the file stem, characters Windows refuses replaced, at most 100 characters.
pub fn safe_folder_name(name: &str) -> String {
    let stem = Path::new(name).file_stem().map_or_else(String::new, |s| s.to_string_lossy().into_owned());
    stem.chars().map(|c| if FOLDER_NAME_FORBIDDEN.contains(c) { '_' } else { c }).take(FOLDER_NAME_MAX_CHARS).collect()
}

/// 3.5 `_bj_output_dir`: the clip folder of this demo, created.
pub fn output_dir(demo_path: &str, cfg: &Settings) -> std::io::Result<String> {
    let mut od = clips_root(cfg);
    if truthy(got(cfg, "subfolder_per_demo")) {
        let name = Path::new(demo_path).file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        od = od.join(safe_folder_name(&name));
        std::fs::create_dir_all(&od)?;
    }
    Ok(od.to_string_lossy().into_owned())
}

/// 3.5 `_bj_output_params`: `-preset` added for CPU codecs only, when the user did not set one.
pub fn output_params(cfg: &Settings) -> String {
    let codec = got(cfg, "video_codec");
    let preset = text(cfg, "video_preset");
    let user = text(cfg, "ffmpeg_output_params");
    let cpu = codec.as_str().is_some_and(|c| registries().cpu_video_codecs.iter().any(|x| x == c));
    if cpu && !preset.is_empty() && !user.contains("-preset") {
        format!("-preset {preset} {user}").trim().to_string()
    } else {
        user
    }
}

/// What every recording system injects into CS2 (3.5 `_common_cs2_injection`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Injection {
    pub launch_args: Vec<String>,
    pub console_cmds: Vec<String>,
}

/// Python `repr(float)` for the console commands (`1.0`, `0.8`).
fn py_float(f: f64) -> String {
    py_str(&json!(f))
}

pub fn common_cs2_injection(ports: &dyn Ports, cfg: &Settings) -> Injection {
    let mut launch_args = Vec::new();
    if let Some(mode) = got(cfg, "cs2_window_mode").as_str() {
        if let Some((_, args)) = WINDOW_MODE_ARGS.iter().find(|(m, _)| *m == mode) {
            launch_args.extend(args.split_whitespace().map(String::from));
        }
    }
    let int = |key: &str, (lo, hi): (i64, i64)| cfg_int(ports, cfg, key, table_i64(key), Some(lo), Some(hi));
    let flag = |key: &str| if cfg_bool(ports, cfg, key, table_bool(key)) { 1 } else { 0 };
    let (lo, hi) = RAGDOLL_SCALE_RANGE;
    let scale = cfg_float(ports, cfg, "phys_ragdoll_scale", table_f64("phys_ragdoll_scale"), Some(lo), Some(hi));
    let console_cmds = vec![
        // Demo playback locked to 1x: a host_timescale left by an earlier session would speed up physics.
        "demo_timescale 1".to_string(),
        format!("cl_ragdoll_gravity {}", int("phys_ragdoll_gravity", RAGDOLL_GRAVITY_RANGE)),
        format!("ragdoll_gravity_scale {}", py_float(scale)),
        format!("sv_gravity {}", int("phys_sv_gravity", SV_GRAVITY_RANGE)),
        format!("cl_ragdoll_physics_enable {}", flag("phys_ragdoll_enable")),
        format!("violence_hblood {}", flag("phys_blood")),
        format!("r_dynamic {}", flag("phys_dynamic_lighting")),
    ];
    Injection { launch_args, console_cmds }
}

/// Slow motion as a share of real time, `round(slow / 100, 4)`.
pub(crate) fn timescale(slow: i64) -> f64 {
    let scale = 10f64.powi(TIMESCALE_DECIMALS); // allow-hardcode: decimal base of Python round(x, n)
    (slow as f64 / PERCENT * scale).round() / scale
}

/// The configured slow motion (percent, clamped).
pub fn slow_motion(ports: &dyn Ports, cfg: &Settings) -> i64 {
    let (lo, hi) = SLOW_MOTION_RANGE;
    cfg_int(ports, cfg, "hlae_slow_motion", table_i64("hlae_slow_motion"), Some(lo), Some(hi))
}

/// Python `shlex.split(s, posix=False)`: whitespace splits, a token that starts with a quote runs
/// to the closing quote (kept) and ends there; a quote inside a word is a plain character.
/// `None` where Python raises (no closing quote).
fn shlex_split_nonposix(s: &str) -> Option<Vec<String>> {
    let ws = |c: char| matches!(c, ' ' | '\t' | '\r' | '\n');
    let (mut out, mut tok, mut state) = (Vec::new(), String::new(), ' ');
    for c in s.chars() {
        match state {
            ' ' if ws(c) => {}
            ' ' => {
                tok.push(c);
                state = if c == '"' || c == '\'' { c } else { 'a' };
            }
            'a' if ws(c) => {
                out.push(std::mem::take(&mut tok));
                state = ' ';
            }
            'a' => tok.push(c),
            q => {
                tok.push(c);
                if c == q {
                    out.push(std::mem::take(&mut tok));
                    state = ' ';
                }
            }
        }
    }
    match state {
        '"' | '\'' => None,
        _ => {
            if !tok.is_empty() {
                out.push(tok);
            }
            Some(out)
        }
    }
}

/// 3.5 `_inject_hlae_extra_args`: the `hlaeOptions` object.
pub fn hlae_options(ports: &dyn Ports, cfg: &Settings, shared: &Injection) -> Map<String, Value> {
    let mut o = Map::new();
    let (lo, hi) = FOV_RANGE;
    let fov = cfg_int(ports, cfg, "hlae_fov", table_i64("hlae_fov"), Some(lo), Some(hi));
    if fov != 0 && fov != FOV_NEUTRAL {
        o.insert("mirv_fov".into(), json!(fov));
    }
    let slow = slow_motion(ports, cfg);
    if slow != 0 && slow != SLOW_MOTION_NEUTRAL {
        o.insert("host_timescale".into(), json!(timescale(slow)));
    }
    if cfg_bool(ports, cfg, "hlae_afx_stream", table_bool("hlae_afx_stream")) {
        o.insert("afxStream".into(), json!(true));
    }
    let hide_ui = cfg_bool(ports, cfg, "hlae_no_spectator_ui", table_bool("hlae_no_spectator_ui"));
    if hide_ui {
        o.insert("hideSpectatorUi".into(), json!(true));
    }
    let mut tokens: Vec<String> = shared.launch_args.clone();
    tokens.extend(shared.console_cmds.iter().map(|c| format!("+{c}")));
    if hide_ui {
        tokens.push("+cl_draw_only_deathnotices 1".into());
    }
    if cfg_bool(ports, cfg, "hlae_fix_scope_fov", table_bool("hlae_fix_scope_fov")) {
        tokens.push("+mirv_fov handleZoom enabled 1".into());
    }
    let extra = text(cfg, "hlae_extra_args");
    if !extra.is_empty() {
        tokens.extend(shlex_split_nonposix(&extra).unwrap_or_else(|| extra.split_whitespace().map(String::from).collect()));
    }
    if !tokens.is_empty() {
        o.insert("extraArgs".into(), json!(tokens.join(" ")));
    }
    o
}

/// 3.5 `injection_preview_lines`: what the next run injects, as (text, kind) lines, kind = "key"
/// (heading), "val" or "dim" (none). Writes nothing.
pub fn injection_preview_lines(ports: &dyn Ports, cfg: &Settings) -> Vec<(String, &'static str)> {
    let shared = common_cs2_injection(ports, cfg);
    let mut lines = Vec::new();
    if normalize_recsys(got(cfg, "recsys")) == RECSYS_HLAE {
        let extra = hlae_options(ports, cfg, &shared).get("extraArgs").and_then(Value::as_str).unwrap_or("").to_string();
        lines.push(("HLAE extraArgs:".to_string(), "key"));
        if extra.is_empty() {
            lines.push(("  (none)".to_string(), "dim"));
        } else {
            // One line per switch or console command, with its arguments.
            let mut groups: Vec<String> = Vec::new();
            for tok in extra.split_whitespace() {
                match groups.last_mut() {
                    Some(g) if !tok.starts_with(['+', '-']) => {
                        g.push(' ');
                        g.push_str(tok);
                    }
                    _ => groups.push(tok.to_string()),
                }
            }
            lines.extend(groups.into_iter().map(|g| (format!("  {g}"), "val")));
        }
    } else {
        let launch = shared.launch_args.join(" ");
        lines.push(("Launch args:".to_string(), "key"));
        lines.push((format!("  {}", if launch.is_empty() { "(none)" } else { &launch }), if launch.is_empty() { "dim" } else { "val" }));
        lines.push(("Console cmds:".to_string(), "key"));
        lines.extend(shared.console_cmds.iter().map(|c| (format!("  {c}"), "val")));
    }
    lines
}

/// The set of non-empty SteamIDs among `values` (Python `{… if x}` then `- {None, ""}`).
fn sid_set<'a>(values: impl Iterator<Item = Option<&'a Value>>) -> BTreeSet<String> {
    values.flatten().filter(|v| truthy(v)).map(py_str).collect()
}

/// 3.5 `_bj_players_options`: who is shown / highlighted in the death notices of one sequence.
fn players_options(arena: &Arena, seq: &Sequence, cams: &[Value], perspective: &str, p: &CameraPlayers, name_for: &dyn Fn(&str) -> String, name_override: &str) -> Vec<Value> {
    let evs: Vec<&crate::preview::event::Event> = seq.events.iter().map(|&id| arena.get(id)).collect();
    let cam_target: BTreeSet<String> = sid_set(cams.iter().map(Some));
    let mut cam_sids = cam_target.clone();
    if perspective == "victim" || perspective == "both" {
        cam_sids.extend(sid_set(evs.iter().map(|e| e.get("victim_sid"))));
    }
    let mut killers = sid_set(evs.iter().map(|e| e.get("killer_sid")));
    killers.extend(sid_set(evs.iter().map(|e| e.get("attacker_sid"))));
    let victims = sid_set(evs.iter().map(|e| e.get("victim_sid")));
    let all: BTreeSet<String> = cam_sids.union(&killers).chain(victims.iter()).cloned().collect();
    // Active players first, then the other SteamIDs of the sequence, sorted.
    let ordered = p.list.iter().cloned().chain(all.into_iter().filter(|s| !p.set.contains(s)));
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for sid in ordered {
        if sid.is_empty() || !seen.insert(sid.clone()) {
            continue;
        }
        let is_our = p.set.contains(&sid);
        let name = if is_our && !name_override.is_empty() { name_override.to_string() } else { name_for(&sid) };
        let (is_killer, is_cam) = (killers.contains(&sid), cam_target.contains(&sid));
        let (show, hi) = if perspective == "killer" || perspective == "victim" {
            (is_our || is_killer || is_cam, is_cam || (is_our && cam_target.is_empty()))
        } else {
            (true, is_cam || is_our)
        };
        out.push(json!({"steamId": sid, "playerName": name, "showKill": show, "highlightKill": hi, "isVoiceEnabled": true}));
    }
    out
}

/// 3.5 `_build_json`: the CLI job for one demo. `demo_names` = names read in this demo.
pub fn build_json(ports: &dyn Ports, arena: &Arena, disc: &Discovery, demo_path: &str, seqs: &[Sequence], cfg: &Settings, demo_names: Option<&HashMap<String, String>>) -> Result<Value, EngineError> {
    let db_names = player_names(disc);
    let name_for = names_for(demo_names, &db_names);
    let name_override = text(cfg, "player_name_override");
    let players = camera_players(cfg);
    let perspective = got(cfg, "perspective").as_str().unwrap_or_default().to_string();
    let recsys = normalize_recsys(got(cfg, "recsys"));
    let mut sequences = Vec::new();
    for (i, seq) in seqs.iter().enumerate() {
        let cams = seq_cameras(arena, seq, cfg, &players)?;
        let sids: Vec<Value> = cams.iter().map(|c| c.sid.clone()).collect();
        let options = players_options(arena, seq, &sids, &perspective, &players, &name_for, &name_override);
        let player_cameras: Vec<Value> = cams.iter().map(|c| json!({"tick": c.tick, "playerSteamId": c.sid, "playerName": ""})).collect();
        sequences.push(json!({
            "number": i + 1,
            "startTick": seq.start_tick,
            "endTick": seq.end_tick,
            "showOnlyDeathNotices": got(cfg, "show_only_death_notices"),
            "deathNoticesDuration": got(cfg, "death_notices_duration"),
            "showXRay": got(cfg, "show_xray"),
            "showAssists": false,
            "recordAudio": true,
            "playerVoicesEnabled": true,
            "playerCameras": player_cameras,
            "cameras": [],
            "playersOptions": options,
        }));
    }
    let od = output_dir(demo_path, cfg).map_err(|e| super::os_error(&clips_root(cfg), &e))?;
    let shared = common_cs2_injection(ports, cfg);
    let hlae = (recsys == RECSYS_HLAE).then(|| hlae_options(ports, cfg, &shared));
    let mut out = json!({
        "demoPath": abspath(demo_path),
        "outputFolderPath": od,
        "encoderSoftware": got(cfg, "encoder"),
        "recordingSystem": recsys,
        "recordingOutput": RECORDING_OUTPUT,
        "framerate": got(cfg, "framerate"),
        "width": got(cfg, "width"),
        "height": got(cfg, "height"),
        "closeGameAfterRecording": got(cfg, "close_game_after"),
        "concatenateSequences": got(cfg, "concatenate_sequences"),
        "showOnlyDeathNotices": got(cfg, "show_only_death_notices"),
        "deathNoticesDuration": got(cfg, "death_notices_duration"),
        "trueView": got(cfg, "true_view"),
        "ffmpegSettings": {
            "audioBitrate": got(cfg, "audio_bitrate"),
            "constantRateFactor": got(cfg, "crf"),
            "customLocationEnabled": false,
            "customExecutableLocation": "",
            "videoContainer": got(cfg, "video_container"),
            "videoCodec": got(cfg, "video_codec"),
            "audioCodec": got(cfg, "audio_codec"),
            "inputParameters": got(cfg, "ffmpeg_input_params"),
            "outputParameters": output_params(cfg),
        },
        "sequences": sequences,
    });
    if let Some(h) = hlae {
        out["hlaeOptions"] = Value::Object(h);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::NoPorts;

    fn cfg(v: Value) -> Settings {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn the_3_5_literal_defaults_are_the_settings_table_defaults() {
        let literals = [
            ("show_only_death_notices", json!(true)), ("death_notices_duration", json!(5)), ("show_xray", json!(true)), ("encoder", json!("FFmpeg")),
            ("framerate", json!(60)), ("width", json!(1920)), ("height", json!(1080)), ("close_game_after", json!(true)),
            ("concatenate_sequences", json!(false)), ("true_view", json!(true)), ("audio_bitrate", json!(256)), ("crf", json!(18)),
            ("video_container", json!("mp4")), ("video_codec", json!("libx264")), ("audio_codec", json!("libmp3lame")), ("ffmpeg_input_params", json!("")),
            ("ffmpeg_output_params", json!("")), ("video_preset", json!("medium")), ("perspective", json!("killer")), ("recsys", json!("HLAE")),
            ("subfolder_per_demo", json!(true)), ("player_name_override", json!("")), ("cs2_window_mode", json!("none")), ("hlae_extra_args", json!("")),
            ("phys_ragdoll_gravity", json!(600)), ("phys_ragdoll_scale", json!(1.0)), ("phys_sv_gravity", json!(800)), ("phys_ragdoll_enable", json!(true)),
            ("phys_blood", json!(true)), ("phys_dynamic_lighting", json!(true)), ("hlae_slow_motion", json!(100)), ("hlae_fov", json!(90)),
            ("hlae_afx_stream", json!(false)), ("hlae_no_spectator_ui", json!(true)), ("hlae_fix_scope_fov", json!(true)),
        ];
        for (k, v) in literals {
            assert_eq!(got(&Settings::new(), k), &v, "{k}");
        }
    }

    #[test]
    fn common_injection_like_3_5() {
        let shared = common_cs2_injection(&NoPorts, &cfg(json!({"cs2_window_mode": "noborder", "phys_ragdoll_gravity": 500, "phys_ragdoll_scale": "0.8",
            "phys_sv_gravity": 700, "phys_ragdoll_enable": false, "phys_blood": false, "phys_dynamic_lighting": true})));
        assert_eq!(shared.launch_args, ["-windowed", "-noborder"]);
        assert_eq!(shared.console_cmds, ["demo_timescale 1", "cl_ragdoll_gravity 500", "ragdoll_gravity_scale 0.8", "sv_gravity 700",
            "cl_ragdoll_physics_enable 0", "violence_hblood 0", "r_dynamic 1"]);
        // test_invalid_cfg_values_are_parsed_with_fallbacks
        let bad = common_cs2_injection(&NoPorts, &cfg(json!({"cs2_window_mode": "windowed", "phys_ragdoll_gravity": "abc", "phys_ragdoll_scale": "nanx",
            "phys_sv_gravity": null, "phys_ragdoll_enable": "maybe", "phys_blood": "0", "phys_dynamic_lighting": "yes"})));
        assert_eq!(bad.launch_args, ["-windowed"]);
        assert_eq!(bad.console_cmds[1..], ["cl_ragdoll_gravity 600", "ragdoll_gravity_scale 1.0", "sv_gravity 800", "cl_ragdoll_physics_enable 1",
            "violence_hblood 0", "r_dynamic 1"]);
    }

    #[test]
    fn hlae_options_and_extra_args_split_like_shlex_non_posix() {
        let shared = Injection { launch_args: vec!["-windowed".into()], console_cmds: vec!["sv_gravity 700".into()] };
        let o = hlae_options(&NoPorts, &cfg(json!({"hlae_fov": 100, "hlae_slow_motion": 80, "hlae_extra_args": " -x  \"a b\"c d'e "})), &shared);
        assert_eq!(o["mirv_fov"], json!(100));
        assert_eq!(o["host_timescale"], json!(0.8));
        assert_eq!(o["hideSpectatorUi"], json!(true));
        assert_eq!(o["extraArgs"], json!("-windowed +sv_gravity 700 +cl_draw_only_deathnotices 1 +mirv_fov handleZoom enabled 1 -x \"a b\" c d'e"));
        let unclosed = hlae_options(&NoPorts, &cfg(json!({"hlae_extra_args": "a \"b c", "hlae_fix_scope_fov": false, "hlae_no_spectator_ui": false})), &Injection::default());
        assert_eq!(unclosed["extraArgs"], json!("a \"b c"), "no closing quote: plain whitespace split");
        assert!(!unclosed.contains_key("mirv_fov") && !unclosed.contains_key("host_timescale"));
    }

    #[test]
    fn preview_lines_group_switches_with_their_arguments() {
        let lines = injection_preview_lines(&NoPorts, &cfg(json!({"recsys": "HLAE", "hlae_fix_scope_fov": false})));
        assert_eq!(lines[0], ("HLAE extraArgs:".into(), "key"));
        assert!(lines.contains(&("  +sv_gravity 800".into(), "val")));
        let cs = injection_preview_lines(&NoPorts, &cfg(json!({"recsys": "cs"})));
        assert_eq!(cs[..3], [("Launch args:".into(), "key"), ("  (none)".into(), "dim"), ("Console cmds:".into(), "key")]);
    }

    #[test]
    fn output_params_add_the_preset_for_cpu_codecs_only() {
        assert_eq!(output_params(&cfg(json!({"video_codec": "libx264", "video_preset": " fast ", "ffmpeg_output_params": "-tune film"}))), "-preset fast -tune film");
        assert_eq!(output_params(&cfg(json!({"video_codec": "h264_nvenc", "video_preset": "fast", "ffmpeg_output_params": ""}))), "");
        assert_eq!(output_params(&cfg(json!({"video_codec": "libx264", "ffmpeg_output_params": "-preset slow"}))), "-preset slow");
    }

    #[test]
    fn folder_names_and_recording_system() {
        assert_eq!(safe_folder_name("a<b>c:d.dem"), "a_b_c_d");
        assert_eq!(safe_folder_name(&"x".repeat(150)).len(), FOLDER_NAME_MAX_CHARS);
        assert_eq!(normalize_recsys(&json!(" cs ")), "CS");
        assert_eq!(normalize_recsys(&json!(null)), "HLAE");
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let od = output_dir("C:/demos/match 1.dem", &cfg(json!({"output_dir_clips": format!("{root}/")}))).unwrap();
        assert_eq!(od, format!("{}\\match 1", abspath(&root)));
        assert!(Path::new(&od).is_dir());
    }
}
