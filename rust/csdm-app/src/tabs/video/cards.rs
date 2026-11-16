//! The seven VIDEO cards in the `timeline` style, after 3.5's `*Card.tsx` timeline views and their
//! `use*.ts` models (keys, words, tooltips). Numbers are typed (never capped: the engine clamps),
//! shown at the settings table's default while unset.

use super::kit::{self, code, mark, note, num, quick, shown, warn};
use super::{is_hlae, Tables, VideoTab};
use crate::grid::{CardCx, CardDecl};
use crate::link::Link;
use crate::tabs::settings::controls::{bool_of, decimal_box, hint, kick, segmented, switch, text_box, text_of};
use csdm_core::batch::{FOV_NEUTRAL, RECSYS_CS, RECSYS_HLAE, SLOW_MOTION_NEUTRAL, WINDOW_MODE_ARGS};
use eframe::egui;
use serde_json::{json, Value};

/// `cs2_window_mode`'s "unchanged" value; the others are the engine's own (`WINDOW_MODE_ARGS`).
const WINDOW_NONE: &str = "none";
/// `video_preset`, fastest first (3.5 `PRESETS_CPU`).
const VIDEO_PRESETS: [&str; 9] = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"];
/// `video_container` (3.5 `VIDEO_CONTAINERS`).
const VIDEO_CONTAINERS: [&str; 5] = ["mp4", "avi", "mkv", "mov", "webm"];
const ASSEMBLY_PLACEHOLDER: &str = "assembled.mp4";
/// Shortcut values, copied from the 3.5 window's own rows; the boxes stay free.
const SPEED_QUICK: [f64; 8] = [50.0, 75.0, 100.0, 125.0, 150.0, 200.0, 500.0, 1000.0];
const RAG_GRAVITY_QUICK: [f64; 7] = [600.0, 200.0, 0.0, -200.0, -500.0, 2000.0, 5000.0];
const RAG_SCALE_QUICK: [f64; 6] = [1.0, 0.5, 0.1, 0.0, 2.0, 3.0];
const SV_GRAVITY_QUICK: [f64; 6] = [800.0, 400.0, 200.0, 100.0, 1200.0, 2000.0];
/// Decimals a stored value keeps (3.5 `NumSpec.decimals`).
const SCALE_DECIMALS: i32 = 2;
const DURATION_DECIMALS: i32 = 1;
/// Words for a FOV (3.5 `fovWords`): under 80 zoomed, up to 95 near the default.
const FOV_ZOOMED_BELOW: f64 = 80.0;
const FOV_NEAR_UP_TO: f64 = 95.0;
/// Words for a CRF (3.5 `crfWords`).
const CRF_VISUALLY_LOSSLESS: f64 = 18.0;
const CRF_GOOD: f64 = 23.0;
const CRF_FAIR: f64 = 28.0;
/// A ratio whose reduced width passes this is said as "1.78:1" (3.5 `aspectOf`).
const ASPECT_TERMS_MAX: i64 = 32;

const HLAE_HINT: &str = "Passed to HLAE via CSDM. Not available in CS recording mode. Audio captured directly by HLAE (bypasses Windows mixer).";
const RECSYS_HINT: &str = "HLAE = injects via HLAE into CS2 (recommended -- full options). CS = native CSDM recording via CS2's startmovie command. HLAE-exclusive features (custom FOV, AFX streams, No spectator UI, Fix scope FOV) are not available in CS mode; CS2 effects (physics, gravity, blood) are injected in both modes.";
const FX_HINT: &str = "Vanilla CS2 commands shared by both recording modes. Non-default values are injected as CS2 console commands on startup.";

/// What the headers need from the settings, read at the last card drawn.
#[derive(Clone, Debug, PartialEq)]
pub struct Header {
    hlae: bool,
    assembly: String,
    resolution: String,
    recsys: String,
    hlae_count: String,
    encoding: String,
}

impl Default for Header {
    /// Before any card is drawn: HLAE mode, the table's defaults.
    fn default() -> Self {
        Self::from_values(|k| csdm_core::settings::def(k).map(|d| d.default.clone()))
    }
}

impl Header {
    pub fn read(link: &Link) -> Self {
        let mut h = Self::from_values(|k| link.get(k).cloned());
        h.hlae = is_hlae(link);
        h
    }

    fn from_values(get: impl Fn(&str) -> Option<Value>) -> Self {
        let n = |k: &str| match get(k) {
            Some(Value::Number(v)) => v.as_f64().unwrap_or_else(|| kit::fallback(k)),
            Some(Value::String(s)) => s.trim().parse().unwrap_or_else(|_| kit::fallback(k)),
            _ => kit::fallback(k),
        };
        let s = |k: &str| match get(k) {
            Some(Value::String(v)) => v,
            _ => String::new(),
        };
        let assemble = get("assemble_after") == Some(Value::Bool(true));
        let recsys = csdm_engine::batch::cli_json::normalize_recsys(&get("recsys").unwrap_or(Value::Null)).to_string();
        let codec = s("video_codec");
        Self {
            hlae: recsys == RECSYS_HLAE,
            assembly: if assemble { file_name(&s("assemble_output")) } else { "off".into() },
            resolution: format!("{}x{} · {} fps", shown(n("width")), shown(n("height")), shown(n("framerate"))),
            recsys,
            hlae_count: format!("{}° · {}%", shown(n("hlae_fov")), shown(n("hlae_slow_motion"))),
            encoding: format!("{} · CRF {} · .{}", if codec.is_empty() { "?".into() } else { codec }, shown(n("crf")), choice("video_container", &s("video_container"), &VIDEO_CONTAINERS)),
        }
    }
}

/// The cards in 3.5 reading order; HLAE Options only in HLAE mode (3.5 `VideoTab`).
pub fn decls(h: &Header) -> Vec<CardDecl> {
    let decl = |id, title: &str, icon, count: Option<String>, wide| CardDecl { id, title: title.into(), icon: Some(icon), count, wide };
    let mut v = vec![
        decl("final-assembly", "Final Assembly", "finalAssembly", Some(h.assembly.clone()), false),
        decl("resolution", "Resolution, Framerate & Window", "resolution", Some(h.resolution.clone()), true),
        decl("recording-system", "Recording System", "recordingSystem", Some(h.recsys.clone()), false),
    ];
    if h.hlae {
        v.push(decl("hlae-options", "HLAE Options", "hlaeOptions", Some(h.hlae_count.clone()), false));
    }
    v.push(decl("in-game-options", "In-Game Options", "inGameOptions", None, false));
    v.push(decl("cs2-effects", "CS2 Effects", "cs2Effects", None, true));
    v.push(decl("encoding", "Encoding", "encoding", Some(h.encoding.clone()), true));
    v
}

// ---- small shared pieces ------------------------------------------------------------------------

fn sw(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, tip_text: &str) {
    switch(ui, cx, key, name, tip_text);
    mark(ui, key);
}

fn text(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, hint_text: &str, tip_text: &str) {
    text_box(ui, cx, key, name, hint_text, tip_text, false);
    mark(ui, key);
}

fn number(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, decimals: i32, tip_text: &str) {
    decimal_box(ui, cx, key, name, kit::fallback(key), decimals, tip_text);
    mark(ui, key);
}

/// One choice out of a fixed list; a stored value outside it shows as the list's default.
fn choose(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, options: &[&str], tip_text: &str) {
    let current = choice(key, &text_of(cx, key), options);
    if let Some(v) = segmented(ui, cx.theme, name, options, &current, tip_text, cx.always_tips) {
        cx.link.set(cx.now, key, json!(v));
    }
    mark(ui, key);
}

/// 3.5 `useChoice`: the stored value when the list holds it, else the key's default in the table.
fn choice(key: &str, value: &str, options: &[&str]) -> String {
    if options.contains(&value) {
        return value.to_string();
    }
    let default = csdm_core::settings::def(key).and_then(|d| d.default.as_str());
    default.filter(|d| options.contains(d)).or(options.first().copied()).unwrap_or_default().to_string()
}

fn file_name(output: &str) -> String {
    let t = output.trim();
    if t.is_empty() { ASSEMBLY_PLACEHOLDER.into() } else { t.into() }
}

fn tables_missing(ui: &mut egui::Ui, tab: &VideoTab, cx: &CardCx) -> bool {
    match (&tab.tables, &tab.tables_error) {
        (Some(_), _) => false,
        (None, Some(e)) => {
            warn(ui, cx.theme, &format!("The engine's tables did not come: {e}"));
            true
        }
        (None, None) => {
            hint(ui, cx.theme, "Loading tables…");
            true
        }
    }
}

// ---- Final Assembly -----------------------------------------------------------------------------

/// 3.5 `assemblySummary`.
pub fn assembly_summary(assemble: bool, concat: bool, delete: bool, file: &str) -> String {
    let joined = if concat { "Clips of one sequence are joined first" } else { "Each clip stays its own file" };
    if !assemble {
        return format!("{joined}; no final video is made.");
    }
    let then = if delete { "then the source clips are deleted" } else { "the source clips are kept" };
    format!("{joined}, then everything is joined into {file}; {then}.")
}

pub fn final_assembly(ui: &mut egui::Ui, cx: &mut CardCx) {
    kick(ui, cx.theme, "Clips");
    sw(ui, cx, "concatenate_sequences", "Join sequences", "Combines clips from the same play/sequence into one before final assembly");
    kick(ui, cx.theme, "Final video");
    sw(ui, cx, "assemble_after", "Assemble at the end", "Concatenates all captured clips into a single video file upon job completion");
    text(ui, cx, "assemble_output", "Output filename", ASSEMBLY_PLACEHOLDER, "Name of the final assembled video file (e.g. assembled.mp4)");
    let (assemble, concat) = (bool_of(cx, "assemble_after"), bool_of(cx, "concatenate_sequences"));
    ui.horizontal(|ui| {
        sw(ui, cx, "delete_after_assemble", "Delete source clips after assembly", "Deletes the original per-clip files once the assembled video is created. Requires assembly enabled");
        if bool_of(cx, "delete_after_assemble") && !assemble {
            warn(ui, cx.theme, "only when assembling");
        }
    });
    let delete = bool_of(cx, "delete_after_assemble");
    hint(ui, cx.theme, &assembly_summary(assemble, concat, delete, &file_name(&text_of(cx, "assemble_output"))));
}

// ---- Resolution, Framerate & Window -------------------------------------------------------------

fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 { a } else { gcd(b, a % b) }
}

/// 3.5 `aspectOf`: "16:9", or "1.78:1" when the terms would be large.
pub fn aspect(width: f64, height: f64) -> String {
    let (w, h) = (width.round() as i64, height.round() as i64);
    if w <= 0 || h <= 0 {
        return String::new();
    }
    let d = gcd(w, h);
    if w / d > ASPECT_TERMS_MAX { format!("{:.2}:1", w as f64 / h as f64) } else { format!("{}:{}", w / d, h / d) }
}

pub fn resolution(tab: &VideoTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let (w, h) = (num(cx, "width"), num(cx, "height"));
    let empty = Tables::default();
    let missing = tables_missing(ui, tab, cx);
    let tables = tab.tables.as_ref().unwrap_or(&empty);
    let preset = tables.resolutions.iter().find(|(_, rw, rh)| *rw as f64 == w && *rh as f64 == h).map(|(l, ..)| l.clone()).unwrap_or_default();

    kick(ui, cx.theme, "Frame");
    if !missing {
        let labels: Vec<&str> = tables.resolutions.iter().map(|(l, ..)| l.as_str()).collect();
        // Width and height in one change: one save, never the new width with the old height (L3).
        if let Some(picked) = segmented(ui, cx.theme, "Resolution", &labels, &preset, "Presets for video resolution (width x height)", cx.always_tips) {
            if let Some((_, pw, ph)) = tables.resolutions.iter().find(|(l, ..)| *l == picked) {
                cx.link.set(cx.now, "width", json!(pw));
                cx.link.set(cx.now, "height", json!(ph));
            }
        }
    }
    number(ui, cx, "width", "Width", 0, "Video width in pixels");
    number(ui, cx, "height", "Height", 0, "Video height in pixels");
    note(ui, cx.theme, &format!("{} · {}", if preset.is_empty() { "custom" } else { &preset }, aspect(w, h)));

    let fps = num(cx, "framerate");
    kick(ui, cx.theme, &format!("One second = {} frames", shown(fps)));
    let rates: Vec<String> = tables.framerates.iter().map(|f| f.to_string()).collect();
    let rate_refs: Vec<&str> = rates.iter().map(String::as_str).collect();
    if let Some(picked) = segmented(ui, cx.theme, "FPS", &rate_refs, &shown(fps), "Frames per second for recording (e.g. 60, 120, 240 for smooth slow-mo)", cx.always_tips) {
        if let Ok(v) = picked.parse::<i64>() {
            cx.link.set(cx.now, "framerate", json!(v));
        }
    }
    mark(ui, "framerate");

    kick(ui, cx.theme, "CS2 window");
    let modes: Vec<&str> = std::iter::once(WINDOW_NONE).chain(WINDOW_MODE_ARGS.iter().map(|(m, _)| *m)).collect();
    choose(ui, cx, "cs2_window_mode", "Window mode", &modes, "CS2 window mode on launch: none=unchanged, fullscreen, windowed, or noborder (borderless)");
    sw(ui, cx, "cs2_send_to_back", "Send to back on launch", "Sends the CS2 window behind other windows right after launch, so it doesn't steal focus");
}

// ---- Recording System ---------------------------------------------------------------------------

pub fn recording_system(ui: &mut egui::Ui, cx: &mut CardCx) {
    let current = csdm_engine::batch::cli_json::normalize_recsys(cx.link.get("recsys").unwrap_or(&Value::Null));
    let tip_text = "Recording backend: HLAE (advanced features & effects) or CS native startmovie";
    if let Some(v) = segmented(ui, cx.theme, "System", &[RECSYS_HLAE, RECSYS_CS], current, tip_text, cx.always_tips) {
        cx.link.set(cx.now, "recsys", json!(v));
    }
    mark(ui, "recsys");
    code(ui, cx.theme, if current == RECSYS_CS { "CSDM → CS2 startmovie → video" } else { "CSDM → HLAE → CS2 → video" });
    hint(ui, cx.theme, RECSYS_HINT);
}

// ---- HLAE Options -------------------------------------------------------------------------------

/// 3.5 `fovWords`.
pub fn fov_words(fov: f64) -> &'static str {
    if fov < FOV_ZOOMED_BELOW {
        "zoomed"
    } else if fov <= FOV_NEAR_UP_TO {
        if fov == FOV_NEUTRAL as f64 { "default" } else { "near default" }
    } else {
        "cinematic wide"
    }
}

/// 3.5 `speedWords`; a speed of 0 or less reads as the engine's lowest (it clamps).
pub fn speed_words(speed: f64) -> String {
    let neutral = SLOW_MOTION_NEUTRAL as f64;
    if speed == neutral {
        return "normal speed".into();
    }
    let speed = speed.max(csdm_core::batch::SLOW_MOTION_RANGE.0 as f64);
    let factor = if speed < neutral { neutral / speed } else { speed / neutral };
    let x = if factor.fract() == 0.0 { format!("{factor}") } else { format!("{factor:.1}") };
    if speed < neutral { format!("{x}× slow motion") } else { format!("{x}× fast-forward") }
}

pub fn hlae_options(ui: &mut egui::Ui, cx: &mut CardCx) {
    kick(ui, cx.theme, "Field of view");
    number(ui, cx, "hlae_fov", "FOV", 0, "Camera field of view in degrees (default: 90, cinematic: 100-110, zoomed: 60)");
    note(ui, cx.theme, &format!("{}° · {}", shown(num(cx, "hlae_fov")), fov_words(num(cx, "hlae_fov"))));
    kick(ui, cx.theme, "Game speed");
    number(ui, cx, "hlae_slow_motion", "Game speed", 0, "Playback speed for recording: 100 = normal, below = slow motion, above = fast-forward");
    quick(ui, cx, "hlae_slow_motion", "Game speed", &SPEED_QUICK, 0);
    note(ui, cx.theme, &format!("{}% · {}", shown(num(cx, "hlae_slow_motion")), speed_words(num(cx, "hlae_slow_motion"))));
    sw(ui, cx, "hlae_afx_stream", "AFX Stream", "Records separate color/depth/stencil passes for compositing (HLAE AFX)");
    sw(ui, cx, "hlae_no_spectator_ui", "No spectator UI", "Hides the spectator HUD — injects +cl_draw_only_deathnotices 1");
    sw(ui, cx, "hlae_fix_scope_fov", "Fix scope FOV", "Stops scoped weapons overriding your FOV setting. Recommended: ON");
    text(ui, cx, "hlae_extra_args", "Additional HLAE args", "", "Extra command-line arguments passed directly to the HLAE launcher (advanced)");
    hint(ui, cx.theme, HLAE_HINT);
}

// ---- In-Game Options ----------------------------------------------------------------------------

pub fn in_game_options(ui: &mut egui::Ui, cx: &mut CardCx) {
    sw(ui, cx, "true_view", "TrueView", "Enables CS2's TrueView free spectator camera (clean, HUD-free footage) for recording");
    sw(ui, cx, "show_only_death_notices", "Death notices only", "Hides all HUD elements except the kill-feed (death notices) during recording");
    sw(ui, cx, "show_xray", "X-Ray", "Highlights enemy players through walls/smoke with colored outlines (spectator X-ray)");
    number(ui, cx, "death_notices_duration", "Death notices (s)", DURATION_DECIMALS, "How long each kill-feed entry stays visible on screen, in seconds");
    kick(ui, cx.theme, "After each demo");
    sw(ui, cx, "close_game_after", "Close CS2", "Automatically exits CS2 after each demo completes to free system resources");
}

// ---- CS2 Effects --------------------------------------------------------------------------------

fn lane(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, command: &str, quicks: &[f64], decimals: i32, tip_text: &str) {
    ui.horizontal(|ui| {
        kick(ui, cx.theme, name);
        code(ui, cx.theme, command);
    });
    number(ui, cx, key, name, decimals, tip_text);
    let mut sorted = quicks.to_vec();
    sorted.sort_by(f64::total_cmp);
    quick(ui, cx, key, name, &sorted, decimals);
}

pub fn cs2_effects(ui: &mut egui::Ui, cx: &mut CardCx) {
    hint(ui, cx.theme, FX_HINT);
    lane(ui, cx, "phys_ragdoll_gravity", "Ragdoll gravity", "cl_ragdoll_gravity", &RAG_GRAVITY_QUICK, 0, "CS2 console command cl_ragdoll_gravity: gravity applied to ragdolls after death");
    lane(ui, cx, "phys_ragdoll_scale", "Ragdoll scale", "ragdoll_gravity_scale", &RAG_SCALE_QUICK, SCALE_DECIMALS, "Multiplier on ragdoll gravity: 1.0 = normal, 0 = weightless, negative = floats upward");
    lane(ui, cx, "phys_sv_gravity", "World gravity", "sv_gravity", &SV_GRAVITY_QUICK, 0, "Server-wide gravity affecting all physics: players, ragdolls, dropped weapons (default 800)");
    sw(ui, cx, "phys_ragdoll_enable", "Ragdoll physics", "Enables ragdoll death physics; required for the gravity/scale values above to have any effect");
    sw(ui, cx, "phys_blood", "Blood on walls", "CS2 console command r_drawdecals: show blood and bullet impact decals on walls");
    sw(ui, cx, "phys_dynamic_lighting", "Dynamic lighting", "CS2 dynamic lighting and shadows on models and environment");
    if !bool_of(cx, "phys_ragdoll_enable") {
        warn(ui, cx.theme, "ragdoll physics off: the two ragdoll values do nothing");
    }
}

// ---- Encoding -----------------------------------------------------------------------------------

/// 3.5 `crfWords`.
pub fn crf_words(crf: f64) -> &'static str {
    if crf <= 0.0 {
        "lossless"
    } else if crf <= CRF_VISUALLY_LOSSLESS {
        "visually lossless"
    } else if crf <= CRF_GOOD {
        "good"
    } else if crf <= CRF_FAIR {
        "fair"
    } else {
        "low"
    }
}

pub fn encoding(tab: &VideoTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let empty = Tables::default();
    tables_missing(ui, tab, cx);
    let tables = tab.tables.as_ref().unwrap_or(&empty);
    kick(ui, cx.theme, "Video");
    kit::codec(ui, cx, "video_codec", "Codec", &tables.video_codecs, "FFmpeg video encoder (e.g. libx264 = CPU H.264, h264_nvenc = NVIDIA GPU encoder)");
    number(ui, cx, "crf", "CRF", 0, "Constant Rate Factor: video quality 0-51, lower = better quality & larger file (18 ~ lossless)");
    note(ui, cx.theme, &format!("quality ⟷ size: {}", crf_words(num(cx, "crf"))));
    kick(ui, cx.theme, "Faster encode ⟷ smaller file");
    choose(ui, cx, "video_preset", "Preset", &VIDEO_PRESETS, "FFmpeg encode speed vs. compression: faster presets encode quicker but yield larger files");
    choose(ui, cx, "video_container", "Container", &VIDEO_CONTAINERS, "Output video container format (MP4 recommended for broad compatibility)");
    kick(ui, cx.theme, "Audio");
    kit::codec(ui, cx, "audio_codec", "Audio codec", &tables.audio_codecs, "FFmpeg audio encoder used for the output track (e.g. aac, mp3, copy)");
    number(ui, cx, "audio_bitrate", "Audio bitrate (kbps)", 0, "Audio bitrate in kilobits per second (e.g. 192, 256, 320)");
    kick(ui, cx.theme, "FFmpeg command");
    text(ui, cx, "ffmpeg_input_params", "FFmpeg input params", "input params", "Raw FFmpeg flags inserted before the input (-i) file. Advanced/optional");
    text(ui, cx, "ffmpeg_output_params", "FFmpeg output params", "output params", "Raw FFmpeg flags inserted before the output file. Advanced/optional");
    let codec = text_of(cx, "video_codec");
    let line = format!(
        "ffmpeg {} -i frames … -c:v {} -crf {} -preset {} {} clip.{}",
        text_of(cx, "ffmpeg_input_params"),
        if codec.is_empty() { "?" } else { &codec },
        shown(num(cx, "crf")),
        choice("video_preset", &text_of(cx, "video_preset"), &VIDEO_PRESETS),
        text_of(cx, "ffmpeg_output_params"),
        choice("video_container", &text_of(cx, "video_container"), &VIDEO_CONTAINERS),
    );
    code(ui, cx.theme, &line.split_whitespace().collect::<Vec<_>>().join(" "));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_match_3_5() {
        assert_eq!(aspect(1920.0, 1080.0), "16:9");
        assert_eq!(aspect(1366.0, 768.0), "1.78:1");
        assert_eq!(aspect(0.0, 1080.0), "");
        assert_eq!(fov_words(90.0), "default");
        assert_eq!(fov_words(92.0), "near default");
        assert_eq!(fov_words(60.0), "zoomed");
        assert_eq!(fov_words(110.0), "cinematic wide");
        assert_eq!(speed_words(100.0), "normal speed");
        assert_eq!(speed_words(50.0), "2× slow motion");
        assert_eq!(speed_words(75.0), "1.3× slow motion");
        assert_eq!(speed_words(200.0), "2× fast-forward");
        assert_eq!(speed_words(0.0), "100× slow motion");
        assert_eq!(crf_words(0.0), "lossless");
        assert_eq!(crf_words(18.0), "visually lossless");
        assert_eq!(crf_words(23.0), "good");
        assert_eq!(crf_words(28.0), "fair");
        assert_eq!(crf_words(40.0), "low");
        assert_eq!(assembly_summary(false, true, false, "a.mp4"), "Clips of one sequence are joined first; no final video is made.");
        assert_eq!(assembly_summary(true, false, true, "a.mp4"), "Each clip stays its own file, then everything is joined into a.mp4; then the source clips are deleted.");
        assert_eq!(choice("video_container", "mkv", &VIDEO_CONTAINERS), "mkv");
        assert_eq!(choice("video_container", "flv", &VIDEO_CONTAINERS), "mp4");
        assert_eq!(choice("video_preset", "", &VIDEO_PRESETS), "medium", "the table's default, not the list's first");
    }
}
