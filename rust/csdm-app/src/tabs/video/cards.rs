//! The seven VIDEO cards in the `timeline` style, after 3.5.1's `*Card.tsx` timeline views and their
//! `use*.ts` models (keys, words, tooltips): the pictures of `art`, numbers as ‹ value › tokens.
//! Numbers are typed (never capped: the engine clamps), shown at the table's default while unset.

use super::art::{self, head as lane_head, seg, subcard, ticks, token, SegMark};
use super::kit::{self, mark, num, shown, warn};
use super::{is_hlae, Tables, VideoTab};
use crate::cardstyle::{
    big_tile, bool_word, choice_token, choice_word, count_tile, icon_tile, number_token, picture_choice, prose_line, prose_muted, prose_word, style_of, text_word, tile_grid, PictureOpt,
    TileGlyph,
};
use crate::grid::{CardCx, CardDecl};
use crate::link::Link;
use crate::paint::{mono, regular, semibold};
use crate::tabs::settings::controls::{bool_of, hint, text_of};
use csdm_core::batch::{FOV_NEUTRAL, FOV_RANGE, RECSYS_CS, RECSYS_HLAE, SLOW_MOTION_NEUTRAL, SLOW_MOTION_RANGE, SV_GRAVITY_RANGE, WINDOW_MODE_ARGS};
use csdm_core::ui_values::{CardStyle, FONT_BODY, FONT_SMALL};
use eframe::egui::{self, pos2, vec2, Align, Align2, Layout, Rect, Stroke, StrokeKind, UiBuilder, Vec2};
use serde_json::{json, Value};

const VIDEO_TILE_MIN_W: f32 = 165.0;
const RES_TILE_MIN_W: f32 = 115.0;
const RECSYS_TILE_MIN_W: f32 = 200.0;
const STEP_ONE: f64 = 1.0;
const STEP_CRF: f64 = 1.0;
const CHAIN_BOX_W: f32 = 44.0;
const CHAIN_BOX_H: f32 = 22.0;
const CHAIN_BOX_GAP: f32 = 10.0;
const CHAIN_BOX_RADIUS: f32 = 5.0;
const PREVIEW_STROKE: f32 = 1.5;
const RES_WIDTH_BOUNDS: [f64; 2] = [320.0, 7680.0];
const RES_HEIGHT_BOUNDS: [f64; 2] = [240.0, 4320.0];
const FPS_BOUNDS: [f64; 2] = [1.0, 1000.0];
const CRF_BOUNDS: [f64; 2] = [0.0, 51.0];
const AUDIO_BITRATE_BOUNDS: [f64; 2] = [32.0, 512.0];
const DEATH_NOTICE_BOUNDS: [f64; 2] = [0.0, 60.0];
const RAG_GRAVITY_BOUNDS: [f64; 2] = [-10_000.0, 10_000.0];
const RAG_SCALE_BOUNDS: [f64; 2] = [-10.0, 10.0];

/// `cs2_window_mode`'s "unchanged" value; the others are the engine's own (`WINDOW_MODE_ARGS`).
const WINDOW_NONE: &str = "none";
/// `video_preset`, fastest first (3.5 `PRESETS_CPU`).
const VIDEO_PRESETS: [&str; 9] = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"];
/// `video_container` (3.5 `VIDEO_CONTAINERS`).
const VIDEO_CONTAINERS: [&str; 5] = ["mp4", "avi", "mkv", "mov", "webm"];
const ASSEMBLY_PLACEHOLDER: &str = "assembled.mp4";
/// Shortcut values, copied from the 3.5 window's own rows; the tokens stay free.
const SPEED_QUICK: [f64; 8] = [50.0, 75.0, 100.0, 125.0, 150.0, 200.0, 500.0, 1000.0];
const RAG_GRAVITY_QUICK: [f64; 7] = [600.0, 200.0, 0.0, -200.0, -500.0, 2000.0, 5000.0];
const RAG_SCALE_QUICK: [f64; 6] = [1.0, 0.5, 0.1, 0.0, 2.0, 3.0];
const SV_GRAVITY_QUICK: [f64; 6] = [800.0, 400.0, 200.0, 100.0, 1200.0, 2000.0];
/// Decimals a stored value keeps (3.5 `NumSpec.decimals`).
const SCALE_DECIMALS: i32 = 2;
const DURATION_DECIMALS: i32 = 1;
/// Steps of the ‹ › arrows (3.5 `NumSpec.step`).
const STEP_PIXELS: f64 = 2.0;
const STEP_SPEED: f64 = 5.0;
const STEP_GRAVITY: f64 = 50.0;
const STEP_SCALE: f64 = 0.1;
const STEP_BITRATE: f64 = 16.0;
/// Words for a FOV (3.5 `fovWords`): under 80 zoomed, up to 95 near the default.
const FOV_ZOOMED_BELOW: f64 = 80.0;
const FOV_NEAR_UP_TO: f64 = 95.0;
/// Words for a CRF (3.5 `crfWords`), the rail's end, the bitrate rail's full share (`EncodingCard`).
const CRF_VISUALLY_LOSSLESS: f64 = 18.0;
const CRF_GOOD: f64 = 23.0;
const CRF_FAIR: f64 = 28.0;
const CRF_MAX: f64 = 51.0;
const BITRATE_MAX: f64 = 512.0;
/// A ratio whose reduced width passes this is said as "1.78:1" (3.5 `aspectOf`).
const ASPECT_TERMS_MAX: i64 = 32;
/// Room for a ‹ value › token beside the frame; the arrow between Final Assembly's stages; the
/// FFmpeg flag boxes; the two-cell rows' shares.
const TOKEN_BOX: [f32; 2] = [130.0, 26.0];
const STAGE_LEFT_SHARE: f32 = 0.45;
const STAGE_ARROW_H: f32 = 64.0;
const FLAGS_W: f32 = 150.0;
const CODEC_ROW: [f32; 2] = [0.42, 0.58];
const PRESET_ROW: [f32; 2] = [0.68, 0.32];

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
    let on = bool_of(cx, key);
    let r = crate::controls::switch(ui, cx.theme, name, on);
    let r = crate::widgets::tip(ui, cx.theme, r, tip_text, cx.always_tips);
    if r.clicked() {
        cx.link.set(cx.now, key, json!(!on));
    }
    mark(ui, key);
}

fn text(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, hint_text: &str, tip_text: &str) {
    kit::text_row(ui, cx, key, name, hint_text, tip_text);
}

/// One choice out of a fixed list in a segmented tray; a stored value outside it shows as the default.
fn choose(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, options: &[&str], marks: &[SegMark], tip_text: &str) {
    let current = choice(key, &text_of(cx, key), options);
    if let Some(v) = seg(ui, cx.theme, name, options, &current, marks, tip_text) {
        cx.link.set(cx.now, key, json!(v));
    }
    mark(ui, key);
}

/// Draws `add` inside `r`, laid out by `layout` without moving the parent `ui`'s cursor.
fn place(ui: &mut egui::Ui, r: Rect, layout: Layout, add: impl FnOnce(&mut egui::Ui)) {
    let mut child = ui.new_child(UiBuilder::new().max_rect(r).layout(layout));
    add(&mut child);
}

/// Cells side by side, each its share of the width (3.5's two-cell lanes).
fn columns(ui: &mut egui::Ui, shares: &[f32], mut add: impl FnMut(usize, &mut egui::Ui)) {
    let gap = ui.spacing().item_spacing.x;
    let free = ui.available_width() - gap * (shares.len() - 1) as f32;
    ui.horizontal_top(|ui| {
        for (i, s) in shares.iter().enumerate() {
            ui.allocate_ui_with_layout(vec2(free * s, 0.0), Layout::top_down(Align::Min), |ui| add(i, ui));
        }
    });
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

fn codec_word(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, label: &str, list: &[String], tip_text: &str) {
    mark(ui, key);
    let current = text_of(cx, key);
    let shown = if current.trim().is_empty() { "default" } else { current.trim() };
    let t = cx.theme;
    choice_token(ui, t, key, shown, label, false, tip_text, true, |ui, _| {
        kit::codec(ui, cx, key, label, list, tip_text);
    });
}

fn bounds_f64(r: (i64, i64)) -> [f64; 2] {
    [r.0 as f64, r.1 as f64]
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
    let t = cx.theme;
    let (assemble, concat, delete) = (bool_of(cx, "assemble_after"), bool_of(cx, "concatenate_sequences"), bool_of(cx, "delete_after_assemble"));
    let file = file_name(&text_of(cx, "assemble_output"));
    match style_of(cx, "final-assembly") {
        CardStyle::Timeline => {
            ui.horizontal_top(|ui| {
                let gap = ui.spacing().item_spacing.x;
                let left_w = (ui.available_width() - art::ARROW_SPACE - gap * 2.0) * STAGE_LEFT_SHARE;
                ui.allocate_ui_with_layout(vec2(left_w, 0.0), Layout::top_down(Align::Min), |ui| {
                    subcard(ui, t, false, |ui| {
                        art::kick(ui, t, "Clips");
                        art::clips(ui, t, concat);
                        sw(ui, cx, "concatenate_sequences", "Join sequences", "Combines clips from the same play/sequence into one before final assembly");
                    });
                });
                art::flow_arrow(ui, t, STAGE_ARROW_H, assemble);
                ui.allocate_ui_with_layout(vec2(ui.available_width(), 0.0), Layout::top_down(Align::Min), |ui| {
                    subcard(ui, t, !assemble, |ui| {
                        art::kick(ui, t, "Final video");
                        ui.horizontal(|ui| {
                            art::film_badge(ui, t, assemble);
                            ui.add(egui::Label::new(egui::RichText::new(&file).font(mono(FONT_BODY)).strong().color(t.txt)).truncate());
                        });
                        sw(ui, cx, "assemble_after", "Assemble at the end", "Concatenates all captured clips into a single video file upon job completion");
                    });
                });
            });
            text(ui, cx, "assemble_output", "Output filename", ASSEMBLY_PLACEHOLDER, "Name of the final assembled video file (e.g. assembled.mp4)");
            ui.horizontal(|ui| {
                sw(ui, cx, "delete_after_assemble", "Delete source clips after assembly", "Deletes the original per-clip files once the assembled video is created. Requires assembly enabled");
                if delete && !assemble {
                    warn(ui, cx.theme, "only when assembling");
                }
            });
            hint(ui, cx.theme, &assembly_summary(assemble, concat, delete, &file));
        }
        CardStyle::Sentence => {
            prose_line(ui, |ui| {
                bool_word(ui, cx, "concatenate_sequences", "Join sequences", "Join clips from the same play first", "Keep each clip separate", false, "Combines clips from the same play/sequence into one before final assembly");
                prose_word(ui, t, ",");
                bool_word(ui, cx, "assemble_after", "Assemble at the end", "then assemble everything into", "without making a final video", true, "Concatenates all captured clips into a single video file upon job completion");
                text_word(ui, cx, "assemble_output", "Output filename", ASSEMBLY_PLACEHOLDER, false, false, false, "Name of the final assembled video file (e.g. assembled.mp4)");
                prose_word(ui, t, "and");
                bool_word(ui, cx, "delete_after_assemble", "Delete source clips after assembly", "delete the source clips", "keep the source clips", false, "Deletes the original per-clip files once the assembled video is created. Requires assembly enabled");
                if delete && !assemble {
                    prose_muted(ui, t, "(only when assembling)");
                }
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            let items: &[(&str, &str, &str, TileGlyph)] = &[
                ("concatenate_sequences", "Join sequences", "Merge clips of the same play", TileGlyph::Icon("operations")),
                ("assemble_after", "Assemble at the end", "Join all clips into one video", TileGlyph::Icon("finalAssembly")),
                ("delete_after_assemble", "Delete sources", if !assemble && delete { "Only when assembling" } else { "Remove per-clip files after" }, TileGlyph::Stuck),
            ];
            tile_grid(ui, VIDEO_TILE_MIN_W, items.len(), |ui, idx, w| {
                let (key, title, cap, glyph) = items[idx];
                let on = bool_of(cx, key);
                mark(ui, key);
                if icon_tile(ui, t, w, crate::cardstyle::ICON_TILE_H, title, cap, None, on, false, false, cap, |p, r, c| crate::cardstyle::paint_glyph(p, r, glyph, c)).clicked() {
                    cx.link.set(cx.now, key, json!(!on));
                }
            });
            text(ui, cx, "assemble_output", "Output filename", ASSEMBLY_PLACEHOLDER, "Name of the final assembled video file (e.g. assembled.mp4)");
            hint(ui, t, &assembly_summary(assemble, concat, delete, &file));
        }
    }
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
    let t = cx.theme;
    let (w, h, fps) = (num(cx, "width"), num(cx, "height"), num(cx, "framerate"));
    let empty = Tables::default();
    let tables = tab.tables.as_ref().unwrap_or(&empty);
    let preset = tables.resolutions.iter().find(|(_, rw, rh)| *rw as f64 == w && *rh as f64 == h).map(|(l, ..)| l.clone()).unwrap_or_default();
    let modes: Vec<&str> = std::iter::once(WINDOW_NONE).chain(WINDOW_MODE_ARGS.iter().map(|(m, _)| *m)).collect();
    let w_bounds = RES_WIDTH_BOUNDS;
    let h_bounds = RES_HEIGHT_BOUNDS;
    let fps_bounds = FPS_BOUNDS;

    match style_of(cx, "resolution") {
        CardStyle::Timeline => {
            subcard(ui, t, false, |ui| {
                let mut picked = None;
                lane_head(ui, t, "Frame", |ui| {
                    if tab.tables.is_some() {
                        let labels: Vec<&str> = tables.resolutions.iter().map(|(l, ..)| l.as_str()).collect();
                        picked = seg(ui, t, "Resolution", &labels, &preset, &[], "Presets for video resolution (width x height)");
                    }
                });
                tables_missing(ui, tab, cx);
                if let Some((_, pw, ph)) = picked.and_then(|p| tables.resolutions.iter().find(|(l, ..)| *l == p)) {
                    cx.link.set(cx.now, "width", json!(pw));
                    cx.link.set(cx.now, "height", json!(ph));
                }
                let frame = art::frame_stage(ui, t, w, h, if preset.is_empty() { "custom" } else { &preset }, &aspect(w, h));
                let above = Rect::from_center_size(frame.center_top() - vec2(0.0, 2.0), Vec2::from(TOKEN_BOX));
                place(ui, above, Layout::top_down(Align::Center), |ui| token(ui, cx, "width", "Width", 0, STEP_PIXELS, "", false, None));
                let beside = Rect::from_min_size(frame.right_center() + vec2(ui.spacing().item_spacing.x, -TOKEN_BOX[1] / 2.0), Vec2::from(TOKEN_BOX));
                place(ui, beside, Layout::left_to_right(Align::Center), |ui| token(ui, cx, "height", "Height", 0, STEP_PIXELS, "", false, None));
            });

            subcard(ui, t, false, |ui| {
                let rates: Vec<String> = tables.framerates.iter().map(|f| f.to_string()).collect();
                let rate_refs: Vec<&str> = rates.iter().map(String::as_str).collect();
                let mut picked = None;
                lane_head(ui, t, &format!("One second = {} frames", shown(fps)), |ui| {
                    picked = seg(ui, t, "FPS", &rate_refs, &shown(fps), &[], "Frames per second for recording (e.g. 60, 120, 240 for smooth slow-mo)");
                });
                if let Some(v) = picked.and_then(|p| p.parse::<i64>().ok()) {
                    cx.link.set(cx.now, "framerate", json!(v));
                }
                mark(ui, "framerate");
                art::film(ui, t, fps);
            });

            subcard(ui, t, false, |ui| {
                let marks = [SegMark::Dash, SegMark::Full, SegMark::Window, SegMark::Borderless];
                lane_head(ui, t, "CS2 window", |ui| {
                    choose(ui, cx, "cs2_window_mode", "Window mode", &modes, &marks, "CS2 window mode on launch: none=unchanged, fullscreen, windowed, or noborder (borderless)");
                });
                sw(ui, cx, "cs2_send_to_back", "Send to back on launch", "Sends the CS2 window behind other windows right after launch, so it doesn't steal focus");
            });
        }
        CardStyle::Sentence => {
            tables_missing(ui, tab, cx);
            let mode_opts: Vec<(&str, &str, &str)> = modes
                .iter()
                .map(|m| {
                    let words = match *m {
                        WINDOW_NONE => "unchanged",
                        "fullscreen" => "fullscreen",
                        "windowed" => "windowed",
                        "noborder" => "borderless",
                        other => other,
                    };
                    (*m, words, "")
                })
                .collect();
            prose_line(ui, |ui| {
                prose_word(ui, t, "Record at");
                number_token(ui, cx, "width", "Width", "px", w_bounds, STEP_PIXELS, 0, kit::fallback("width"), false, "Output video width in pixels", &[]);
                prose_word(ui, t, "×");
                number_token(ui, cx, "height", "Height", "px", h_bounds, STEP_PIXELS, 0, kit::fallback("height"), false, "Output video height in pixels", &[]);
                if !tables.resolutions.is_empty() {
                    let tag = if preset.is_empty() { aspect(w, h) } else { format!("{preset}, {}", aspect(w, h)) };
                    let mut picked = None;
                    choice_token(ui, t, "resolution_preset", &tag, "Resolution presets", true, "Presets for video resolution (width x height)", false, |ui, close| {
                        for (label, rw, rh) in &tables.resolutions {
                            let cap = format!("{label} ({rw}×{rh})");
                            if crate::widgets::chip(ui, t, &cap, Some(*rw as f64 == w && *rh as f64 == h), Some(&cap), true).clicked() {
                                picked = Some((*rw, *rh));
                                *close = true;
                            }
                        }
                    });
                    if let Some((pw, ph)) = picked {
                        cx.link.set(cx.now, "width", json!(pw));
                        cx.link.set(cx.now, "height", json!(ph));
                    }
                }
                prose_word(ui, t, "at");
                number_token(ui, cx, "framerate", "FPS", "fps", fps_bounds, STEP_ONE, 0, kit::fallback("framerate"), false, "Frames per second for recording", &[]);
                prose_word(ui, t, "; launch CS2");
                choice_word(ui, cx, "cs2_window_mode", "Window mode", &mode_opts, WINDOW_NONE, false, "CS2 window mode on launch");
                prose_word(ui, t, "and");
                bool_word(ui, cx, "cs2_send_to_back", "Send to back on launch", "send it behind other windows", "leave it in front", false, "Sends the CS2 window behind other windows right after launch");
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            tables_missing(ui, tab, cx);
            if !tables.resolutions.is_empty() {
                let mut picked = None;
                tile_grid(ui, RES_TILE_MIN_W, tables.resolutions.len(), |ui, idx, tw| {
                    let (label, rw, rh) = &tables.resolutions[idx];
                    let on = *rw as f64 == w && *rh as f64 == h;
                    let sub = format!("{rw}×{rh}");
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, label, &sub, None, on, false, false, &sub, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("resolution"), c)).clicked() {
                        picked = Some((*rw, *rh));
                    }
                });
                if let Some((pw, ph)) = picked {
                    cx.link.set(cx.now, "width", json!(pw));
                    cx.link.set(cx.now, "height", json!(ph));
                }
            }
            tile_grid(ui, VIDEO_TILE_MIN_W, 3, |ui, idx, tw| match idx { // allow-hardcode: three numeric resolution tiles
                0 => count_tile(ui, cx, "width", "Width", "px", w_bounds, STEP_PIXELS, 0, None, "Pixels wide", "Output video width in pixels", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("resolution"), c)),
                1 => count_tile(ui, cx, "height", "Height", "px", h_bounds, STEP_PIXELS, 0, None, "Pixels tall", "Output video height in pixels", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("resolution"), c)),
                _ => count_tile(ui, cx, "framerate", "FPS", "fps", fps_bounds, STEP_ONE, 0, None, "Frames / sec", "Frames per second for recording", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Play, c)),
            });
            let win_opts = [
                PictureOpt { value: WINDOW_NONE, title: "Unchanged", subtitle: "Keep CS2 default", tip: "Keep CS2 window mode unchanged" },
                PictureOpt { value: "fullscreen", title: "Fullscreen", subtitle: "-fullscreen", tip: "Launch CS2 fullscreen" },
                PictureOpt { value: "windowed", title: "Windowed", subtitle: "-windowed", tip: "Launch CS2 in a window" },
                PictureOpt { value: "noborder", title: "Borderless", subtitle: "-noborder", tip: "Launch CS2 borderless windowed" },
            ];
            let current_mode = choice("cs2_window_mode", &text_of(cx, "cs2_window_mode"), &modes);
            if let Some(next_mode) = picture_choice(ui, t, RES_TILE_MIN_W, "Window mode", &win_opts, &current_mode, |p, r, val, on| {
                let ink = if on { t.accent } else { t.muted };
                let s = Stroke::new(PREVIEW_STROKE, ink);
                match val {
                    "fullscreen" => { p.rect_filled(r.shrink(CHAIN_BOX_GAP), 2.0, ink.gamma_multiply(0.35)); } // allow-hardcode: preview fill
                    "windowed" => { p.rect_stroke(r.shrink(CHAIN_BOX_GAP * 1.4), 3.0, s, StrokeKind::Inside); } // allow-hardcode: preview box
                    "noborder" => { p.rect_stroke(r.shrink(CHAIN_BOX_GAP), 2.0, s, StrokeKind::Inside); }
                    _ => { p.line_segment([r.center() - vec2(CHAIN_BOX_GAP, 0.0), r.center() + vec2(CHAIN_BOX_GAP, 0.0)], s); }
                }
            }) {
                cx.link.set(cx.now, "cs2_window_mode", json!(next_mode));
            }
            mark(ui, "cs2_window_mode");
            sw(ui, cx, "cs2_send_to_back", "Send to back on launch", "Sends the CS2 window behind other windows right after launch, so it doesn't steal focus");
        }
    }
}

// ---- Recording System ---------------------------------------------------------------------------

/// Each system's chain, in the order the recording goes through it (3.5 `CHAINS`).
const CHAINS: [(&str, &str, &[&str]); 2] = [(RECSYS_HLAE, "HLAE", &["CSDM", "HLAE", "CS2", "video"]), (RECSYS_CS, "CS native", &["CSDM", "CS2 startmovie", "video"])];

pub fn recording_system(ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let current = csdm_engine::batch::cli_json::normalize_recsys(cx.link.get("recsys").unwrap_or(&Value::Null));
    let tip_text = "Recording backend: HLAE (advanced features & effects) or CS native startmovie";
    match style_of(cx, "recording-system") {
        CardStyle::Timeline => {
            for (system, title, steps) in CHAINS {
                if art::chain_lane(ui, t, &format!("System: {system}"), title, steps, RECSYS_HLAE, system == current, tip_text) && system != current {
                    cx.link.set(cx.now, "recsys", json!(system));
                }
            }
            mark(ui, "recsys");
            hint(ui, t, RECSYS_HINT);
        }
        CardStyle::Sentence => {
            let opts = [
                (RECSYS_HLAE, "HLAE (advanced features & effects)", "CSDM -> HLAE -> CS2 -> video"),
                (RECSYS_CS, "CS native startmovie", "CSDM -> CS2 startmovie -> video"),
            ];
            prose_line(ui, |ui| {
                prose_word(ui, t, "Record clips through");
                choice_word(ui, cx, "recsys", "Recording system", &opts, RECSYS_HLAE, false, tip_text);
                prose_word(ui, t, ".");
            });
            hint(ui, t, RECSYS_HINT);
        }
        CardStyle::Tiles => {
            let opts = [
                PictureOpt { value: RECSYS_HLAE, title: "HLAE", subtitle: "CSDM → HLAE → CS2 (full options)", tip: tip_text },
                PictureOpt { value: RECSYS_CS, title: "CS native", subtitle: "CSDM → CS2 startmovie", tip: tip_text },
            ];
            if let Some(next) = picture_choice(ui, t, RECSYS_TILE_MIN_W, "System", &opts, current, |p, r, val, on| {
                let steps: &[&str] = if val == RECSYS_HLAE { &["CSDM", "HLAE", "CS2"] } else { &["CSDM", "CS2"] };
                let total_w = steps.len() as f32 * CHAIN_BOX_W + (steps.len() - 1) as f32 * CHAIN_BOX_GAP;
                let mut x = r.center().x - total_w / 2.0;
                let ink = if on { t.accent } else { t.muted };
                for (i, label) in steps.iter().enumerate() {
                    let box_r = Rect::from_min_size(pos2(x, r.center().y - CHAIN_BOX_H / 2.0), vec2(CHAIN_BOX_W, CHAIN_BOX_H));
                    p.rect(box_r, CHAIN_BOX_RADIUS, t.surface2, Stroke::new(1.0, ink), StrokeKind::Inside);
                    p.text(box_r.center(), Align2::CENTER_CENTER, *label, semibold(FONT_SMALL - 1.0), ink);
                    if i + 1 < steps.len() {
                        p.line_segment([pos2(box_r.right(), box_r.center().y), pos2(box_r.right() + CHAIN_BOX_GAP, box_r.center().y)], Stroke::new(PREVIEW_STROKE, ink));
                    }
                    x += CHAIN_BOX_W + CHAIN_BOX_GAP;
                }
            }) {
                cx.link.set(cx.now, "recsys", json!(next));
            }
            mark(ui, "recsys");
            hint(ui, t, RECSYS_HINT);
        }
    }
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
    let t = cx.theme;
    let fov_bounds = bounds_f64(FOV_RANGE);
    let spd_bounds = bounds_f64(SLOW_MOTION_RANGE);
    match style_of(cx, "hlae-options") {
        CardStyle::Timeline => {
            subcard(ui, t, false, |ui| {
                lane_head(ui, t, "Field of view", |ui| token(ui, cx, "hlae_fov", "FOV", 0, 1.0, "°", false, None));
                art::cone(ui, t, num(cx, "hlae_fov"), fov_words(num(cx, "hlae_fov")));
            });
            subcard(ui, t, false, |ui| {
                lane_head(ui, t, "Game speed", |ui| token(ui, cx, "hlae_slow_motion", "Game speed", 0, STEP_SPEED, "%", true, None));
                let speed = num(cx, "hlae_slow_motion");
                art::speed_bars(ui, t, speed, &speed_words(speed));
                ticks(ui, cx, "hlae_slow_motion", "Game speed", &SPEED_QUICK, 0, false);
            });
            ui.horizontal_wrapped(|ui| {
                sw(ui, cx, "hlae_afx_stream", "AFX Stream", "Records separate color/depth/stencil passes for compositing (HLAE AFX)");
                sw(ui, cx, "hlae_no_spectator_ui", "No spectator UI", "Hides the spectator HUD — injects +cl_draw_only_deathnotices 1");
                sw(ui, cx, "hlae_fix_scope_fov", "Fix scope FOV", "Stops scoped weapons overriding your FOV setting. Recommended: ON");
            });
            text(ui, cx, "hlae_extra_args", "Extra HLAE args", "", "Additional command-line arguments passed directly to the HLAE launcher (advanced)");
            hint(ui, t, HLAE_HINT);
        }
        CardStyle::Sentence => {
            let fov = num(cx, "hlae_fov");
            let spd = num(cx, "hlae_slow_motion");
            prose_line(ui, |ui| {
                prose_word(ui, t, "Set camera FOV to");
                number_token(ui, cx, "hlae_fov", "FOV", "°", fov_bounds, STEP_ONE, 0, kit::fallback("hlae_fov"), false, "Custom camera field of view in degrees", &[]);
                prose_muted(ui, t, &format!("({})", fov_words(fov)));
                prose_word(ui, t, "at");
                number_token(ui, cx, "hlae_slow_motion", "Game speed", "%", spd_bounds, STEP_SPEED, 0, kit::fallback("hlae_slow_motion"), false, "Playback speed percentage (100% = normal)", &SPEED_QUICK);
                prose_muted(ui, t, &format!("({});", speed_words(spd)));
                bool_word(ui, cx, "hlae_afx_stream", "AFX Stream", "capture AFX streams", "no AFX streams", false, "Records separate color/depth/stencil passes for compositing");
                prose_word(ui, t, ",");
                bool_word(ui, cx, "hlae_no_spectator_ui", "No spectator UI", "hide spectator HUD", "keep spectator HUD", false, "Hides the spectator HUD");
                prose_word(ui, t, ",");
                bool_word(ui, cx, "hlae_fix_scope_fov", "Fix scope FOV", "keep FOV when scoped", "allow scope zoom FOV", false, "Stops scoped weapons overriding your FOV setting");
                prose_word(ui, t, "; extra args");
                text_word(ui, cx, "hlae_extra_args", "Extra HLAE args", "none", false, false, false, "Additional command-line arguments passed directly to the HLAE launcher");
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            tile_grid(ui, VIDEO_TILE_MIN_W, 5, |ui, idx, tw| match idx { // allow-hardcode: five HLAE setting tiles
                0 => count_tile(ui, cx, "hlae_fov", "FOV", "°", fov_bounds, STEP_ONE, 0, None, "Degrees", "Custom field of view in degrees", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("hlaeOptions"), c)),
                1 => count_tile(ui, cx, "hlae_slow_motion", "Game speed", "%", spd_bounds, STEP_SPEED, 0, None, "Playback %", "Playback speed percentage", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Play, c)),
                _ => {
                    let (key, title, cap, tip_txt) = [
                        ("hlae_afx_stream", "AFX Stream", "Separate color/depth", "Records separate color/depth/stencil passes"),
                        ("hlae_no_spectator_ui", "No spectator UI", "Hide spectator HUD", "Hides the spectator HUD"),
                        ("hlae_fix_scope_fov", "Fix scope FOV", "Lock FOV on scope", "Stops scoped weapons overriding your FOV"),
                    ][idx - 2];
                    let on = bool_of(cx, key);
                    mark(ui, key);
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, title, cap, None, on, false, false, tip_txt, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("hlaeOptions"), c)).clicked() {
                        cx.link.set(cx.now, key, json!(!on));
                    }
                }
            });
            text(ui, cx, "hlae_extra_args", "Extra HLAE args", "", "Additional command-line arguments passed directly to the HLAE launcher (advanced)");
            hint(ui, t, HLAE_HINT);
        }
    }
}

// ---- In-Game Options ----------------------------------------------------------------------------

pub fn in_game_options(ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let d_bounds = DEATH_NOTICE_BOUNDS;
    match style_of(cx, "in-game-options") {
        CardStyle::Timeline => {
            let hud = !bool_of(cx, "show_only_death_notices");
            let at = art::game_screen(ui, t, hud, bool_of(cx, "show_xray"), bool_of(cx, "true_view"));
            place(ui, at, Layout::right_to_left(Align::Center), |ui| {
                token(ui, cx, "death_notices_duration", "Death notices", DURATION_DECIMALS, 1.0, "s", false, None);
                ui.label(egui::RichText::new("stays").font(regular(FONT_SMALL)).color(t.muted));
            });
            ui.horizontal_wrapped(|ui| {
                sw(ui, cx, "true_view", "TrueView", "Enables CS2's TrueView free spectator camera (clean, HUD-free footage) for recording");
                sw(ui, cx, "show_only_death_notices", "Death notices only", "Hides all HUD elements except the kill-feed (death notices) during recording");
                sw(ui, cx, "show_xray", "X-Ray", "Highlights enemy players through walls/smoke with colored outlines (spectator X-ray)");
            });
            ui.horizontal(|ui| {
                art::kick(ui, t, "After each demo");
                sw(ui, cx, "close_game_after", "Close CS2", "Automatically exits CS2 after each demo completes to free system resources");
            });
        }
        CardStyle::Sentence => {
            prose_line(ui, |ui| {
                prose_word(ui, t, "Record with");
                bool_word(ui, cx, "true_view", "TrueView", "TrueView on", "TrueView off", false, "Enables CS2's TrueView free spectator camera");
                prose_word(ui, t, ",");
                bool_word(ui, cx, "show_only_death_notices", "Death notices only", "death notices only", "full HUD", false, "Hides all HUD elements except the kill-feed");
                prose_word(ui, t, "(kills stay");
                number_token(ui, cx, "death_notices_duration", "Death notices", "s", d_bounds, STEP_ONE, DURATION_DECIMALS, kit::fallback("death_notices_duration"), false, "Seconds each kill remains visible in the death notice feed", &[]);
                prose_word(ui, t, "),");
                bool_word(ui, cx, "show_xray", "X-Ray", "X-Ray on", "X-Ray off", false, "Highlights enemy players through walls/smoke");
                prose_word(ui, t, ", and");
                bool_word(ui, cx, "close_game_after", "Close CS2", "close CS2 after each demo", "keep CS2 open", false, "Automatically exits CS2 after each demo completes");
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            let items: &[(&str, &str, &str, &str)] = &[
                ("true_view", "TrueView", "Free spectator camera", "Enables CS2's TrueView free spectator camera"),
                ("show_only_death_notices", "Death notices only", "Hide other HUD elements", "Hides all HUD elements except the kill-feed"),
                ("show_xray", "X-Ray", "Outlines through walls", "Highlights enemy players through walls/smoke"),
                ("close_game_after", "Close CS2", "Exit after each demo", "Automatically exits CS2 after each demo completes"),
            ];
            tile_grid(ui, VIDEO_TILE_MIN_W, items.len() + 1, |ui, idx, tw| {
                if idx < items.len() {
                    let (key, title, cap, tip_txt) = items[idx];
                    let on = bool_of(cx, key);
                    mark(ui, key);
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, title, cap, None, on, false, false, tip_txt, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("inGameOptions"), c)).clicked() {
                        cx.link.set(cx.now, key, json!(!on));
                    }
                } else {
                    count_tile(ui, cx, "death_notices_duration", "Death notices", "s", d_bounds, STEP_ONE, DURATION_DECIMALS, None, "Feed duration", "Seconds each kill stays in the feed", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Wait, c));
                }
            });
        }
    }
}

// ---- CS2 Effects --------------------------------------------------------------------------------

/// One gravity: what pulls bodies (as an arrow), its name and console command, its token, its ruler.
struct Lane<'a> {
    key: &'a str,
    name: &'a str,
    command: &'a str,
    quicks: &'a [f64],
    decimals: i32,
    step: f64,
    unit: &'a str,
    pull: f64,
    dim: bool,
    tip: &'a str,
}

fn lane(ui: &mut egui::Ui, cx: &mut CardCx, l: Lane) {
    let t = cx.theme;
    subcard(ui, t, l.dim, |ui| {
        ui.horizontal_top(|ui| {
            art::pull_arrow(ui, t, l.pull, l.dim);
            ui.vertical(|ui| {
                ui.horizontal(|ui| {
                    let label = ui.label(egui::RichText::new(l.name).font(semibold(FONT_BODY)).color(t.txt)).on_hover_text(l.tip);
                    ui.label(egui::RichText::new(l.command).font(mono(FONT_SMALL)).color(t.faint));
                    ui.allocate_ui_with_layout(vec2(ui.available_width(), 0.0), Layout::right_to_left(Align::Center), |ui| {
                        token(ui, cx, l.key, l.name, l.decimals, l.step, l.unit, false, Some(label.id));
                    });
                });
                let mut sorted = l.quicks.to_vec();
                sorted.sort_by(f64::total_cmp);
                ticks(ui, cx, l.key, l.name, &sorted, l.decimals, true);
            });
        });
    });
}

pub fn cs2_effects(ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let off = !bool_of(cx, "phys_ragdoll_enable");
    let (rag, scale, world) = (num(cx, "phys_ragdoll_gravity"), num(cx, "phys_ragdoll_scale"), num(cx, "phys_sv_gravity"));
    let (rag0, world0) = (kit::fallback("phys_ragdoll_gravity"), kit::fallback("phys_sv_gravity"));
    let sv_bounds = bounds_f64(SV_GRAVITY_RANGE);
    match style_of(cx, "cs2-effects") {
        CardStyle::Timeline => {
            hint(ui, t, FX_HINT);
            lane(ui, cx, Lane { key: "phys_ragdoll_gravity", name: "Ragdoll gravity", command: "cl_ragdoll_gravity", quicks: &RAG_GRAVITY_QUICK, decimals: 0, step: STEP_GRAVITY, unit: "", pull: rag * scale / rag0, dim: off, tip: "CS2 console command cl_ragdoll_gravity: gravity applied to ragdolls after death" });
            lane(ui, cx, Lane { key: "phys_ragdoll_scale", name: "Ragdoll scale", command: "ragdoll_gravity_scale", quicks: &RAG_SCALE_QUICK, decimals: SCALE_DECIMALS, step: STEP_SCALE, unit: "x", pull: scale, dim: off, tip: "Multiplier on ragdoll gravity: 1.0 = normal, 0 = weightless, negative = floats upward" });
            lane(ui, cx, Lane { key: "phys_sv_gravity", name: "World gravity", command: "sv_gravity", quicks: &SV_GRAVITY_QUICK, decimals: 0, step: STEP_GRAVITY, unit: "", pull: world / world0, dim: false, tip: "Server-wide gravity affecting all physics: players, ragdolls, dropped weapons (default 800)" });
            ui.horizontal_wrapped(|ui| {
                sw(ui, cx, "phys_ragdoll_enable", "Ragdoll physics", "Enables ragdoll death physics; required for the gravity/scale values above to have any effect");
                sw(ui, cx, "phys_blood", "Blood on walls", "CS2 console command r_drawdecals: show blood and bullet impact decals on walls");
                sw(ui, cx, "phys_dynamic_lighting", "Dynamic lighting", "CS2 dynamic lighting and shadows on models and environment");
                if off {
                    warn(ui, t, "ragdoll physics off: the two ragdoll values do nothing");
                }
            });
        }
        CardStyle::Sentence => {
            prose_line(ui, |ui| {
                bool_word(ui, cx, "phys_ragdoll_enable", "Ragdoll physics", "Enable ragdoll physics", "Disable ragdoll physics", false, "Enables ragdoll death physics");
                prose_word(ui, t, "with gravity");
                number_token(ui, cx, "phys_ragdoll_gravity", "Ragdoll gravity", "", RAG_GRAVITY_BOUNDS, STEP_GRAVITY, 0, rag0, false, "CS2 console command cl_ragdoll_gravity", &RAG_GRAVITY_QUICK);
                prose_word(ui, t, "and scale");
                number_token(ui, cx, "phys_ragdoll_scale", "Ragdoll scale", "x", RAG_SCALE_BOUNDS, STEP_SCALE, SCALE_DECIMALS, kit::fallback("phys_ragdoll_scale"), false, "Multiplier on ragdoll gravity", &RAG_SCALE_QUICK);
                prose_word(ui, t, "; world gravity");
                number_token(ui, cx, "phys_sv_gravity", "World gravity", "", sv_bounds, STEP_GRAVITY, 0, world0, false, "Server-wide sv_gravity", &SV_GRAVITY_QUICK);
                prose_word(ui, t, ",");
                bool_word(ui, cx, "phys_blood", "Blood on walls", "blood decals on", "blood decals off", false, "CS2 console command r_drawdecals");
                prose_word(ui, t, ",");
                bool_word(ui, cx, "phys_dynamic_lighting", "Dynamic lighting", "dynamic lighting on", "dynamic lighting off", false, "CS2 dynamic lighting and shadows");
                prose_word(ui, t, ".");
            });
            if off {
                warn(ui, t, "ragdoll physics off: the two ragdoll values do nothing");
            }
        }
        CardStyle::Tiles => {
            tile_grid(ui, VIDEO_TILE_MIN_W, 6, |ui, idx, tw| match idx { // allow-hardcode: six CS2 effect tiles
                0 => {
                    let on = bool_of(cx, "phys_ragdoll_enable");
                    mark(ui, "phys_ragdoll_enable");
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, "Ragdoll physics", "Death physics", None, on, false, false, "Enables ragdoll death physics", |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("cs2Effects"), c)).clicked() {
                        cx.link.set(cx.now, "phys_ragdoll_enable", json!(!on));
                    }
                }
                1 => count_tile(ui, cx, "phys_ragdoll_gravity", "Ragdoll gravity", "", RAG_GRAVITY_BOUNDS, STEP_GRAVITY, 0, None, "cl_ragdoll_gravity", "cl_ragdoll_gravity", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("cs2Effects"), c)),
                2 => count_tile(ui, cx, "phys_ragdoll_scale", "Ragdoll scale", "x", RAG_SCALE_BOUNDS, STEP_SCALE, SCALE_DECIMALS, None, "ragdoll_gravity_scale", "ragdoll_gravity_scale", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("cs2Effects"), c)),
                3 => count_tile(ui, cx, "phys_sv_gravity", "World gravity", "", sv_bounds, STEP_GRAVITY, 0, None, "sv_gravity", "sv_gravity", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("cs2Effects"), c)), // allow-hardcode: tile index
                4 => { // allow-hardcode: tile index
                    let on = bool_of(cx, "phys_blood");
                    mark(ui, "phys_blood");
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, "Blood on walls", "r_drawdecals", None, on, false, false, "Show blood and bullet impact decals", |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Kill, c)).clicked() {
                        cx.link.set(cx.now, "phys_blood", json!(!on));
                    }
                }
                _ => {
                    let on = bool_of(cx, "phys_dynamic_lighting");
                    mark(ui, "phys_dynamic_lighting");
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, "Dynamic lighting", "Model shadows", None, on, false, false, "CS2 dynamic lighting and shadows", |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("uiTheme"), c)).clicked() {
                        cx.link.set(cx.now, "phys_dynamic_lighting", json!(!on));
                    }
                }
            });
            if off {
                warn(ui, t, "ragdoll physics off: the two ragdoll values do nothing");
            }
            hint(ui, t, FX_HINT);
        }
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
    let t = cx.theme;
    let empty = Tables::default();
    tables_missing(ui, tab, cx);
    let tables = tab.tables.as_ref().unwrap_or(&empty);
    let crf_bounds = CRF_BOUNDS;
    let br_bounds = AUDIO_BITRATE_BOUNDS;
    match style_of(cx, "encoding") {
        CardStyle::Timeline => {
            subcard(ui, t, false, |ui| {
                columns(ui, &CODEC_ROW, |i, ui| {
                    if i == 0 {
                        kit::codec(ui, cx, "video_codec", "Codec", &tables.video_codecs, "FFmpeg video encoder (e.g. libx264 = CPU H.264, h264_nvenc = NVIDIA GPU encoder)");
                    } else {
                        lane_head(ui, t, "Quality ⟷ size", |ui| token(ui, cx, "crf", "CRF", 0, 1.0, "", false, None));
                        art::crf_rail(ui, t, num(cx, "crf"), CRF_MAX, crf_words(num(cx, "crf")));
                    }
                });
            });
            subcard(ui, t, false, |ui| {
                columns(ui, &PRESET_ROW, |i, ui| {
                    if i == 0 {
                        art::kick(ui, t, "Faster encode ⟷ smaller file");
                        choose(ui, cx, "video_preset", "Preset", &VIDEO_PRESETS, &[], "FFmpeg encode speed vs. compression: faster presets encode quicker but yield larger files");
                    } else {
                        art::kick(ui, t, "File");
                        choose(ui, cx, "video_container", "Container", &VIDEO_CONTAINERS, &[], "Output video container format (MP4 recommended for broad compatibility)");
                    }
                });
            });
            subcard(ui, t, false, |ui| {
                columns(ui, &CODEC_ROW, |i, ui| {
                    if i == 0 {
                        kit::codec(ui, cx, "audio_codec", "Audio codec", &tables.audio_codecs, "FFmpeg audio encoder used for the output track (e.g. aac, mp3, copy)");
                    } else {
                        lane_head(ui, t, "Bitrate", |ui| token(ui, cx, "audio_bitrate", "Audio bitrate", 0, STEP_BITRATE, " kbps", true, None));
                        art::fill_rail(ui, t, num(cx, "audio_bitrate") / BITRATE_MAX);
                    }
                });
            });
            let codec = text_of(cx, "video_codec");
            let middle = format!(
                "-i frames … -c:v {} -crf {} -preset {}",
                if codec.is_empty() { "?" } else { &codec },
                shown(num(cx, "crf")),
                choice("video_preset", &text_of(cx, "video_preset"), &VIDEO_PRESETS)
            );
            let tail = format!("clip.{}", choice("video_container", &text_of(cx, "video_container"), &VIDEO_CONTAINERS));
            art::ink_bar(ui, t, |ui| {
                ui.horizontal_wrapped(|ui| {
                    art::ink_words(ui, t, "ffmpeg");
                    art::inline_text(ui, cx, "ffmpeg_input_params", "Input params", "input params", FLAGS_W, "Raw FFmpeg flags inserted before the input (-i) file. Advanced/optional");
                    art::ink_words(ui, t, &middle);
                    art::inline_text(ui, cx, "ffmpeg_output_params", "Output params", "output params", FLAGS_W, "Raw FFmpeg flags inserted before the output file. Advanced/optional");
                    art::ink_words(ui, t, &tail);
                });
            });
        }
        CardStyle::Sentence => {
            let preset_opts: Vec<(&str, &str, &str)> = VIDEO_PRESETS.iter().map(|p| (*p, *p, "")).collect();
            let cont_opts: Vec<(&str, &str, &str)> = VIDEO_CONTAINERS.iter().map(|c| (*c, *c, "")).collect();
            prose_line(ui, |ui| {
                prose_word(ui, t, "Encode video with");
                codec_word(ui, cx, "video_codec", "Codec", &tables.video_codecs, "FFmpeg video encoder");
                prose_word(ui, t, "at CRF");
                number_token(ui, cx, "crf", "CRF", "", crf_bounds, STEP_CRF, 0, kit::fallback("crf"), false, "Constant Rate Factor (lower = higher quality)", &[]);
                prose_muted(ui, t, &format!("({})", crf_words(num(cx, "crf"))));
                prose_word(ui, t, ", preset");
                choice_word(ui, cx, "video_preset", "Preset", &preset_opts, "medium", false, "FFmpeg encode speed vs. compression");
                prose_word(ui, t, ", into .");
                choice_word(ui, cx, "video_container", "Container", &cont_opts, "mp4", false, "Output video container format");
                prose_word(ui, t, "; audio");
                codec_word(ui, cx, "audio_codec", "Audio codec", &tables.audio_codecs, "FFmpeg audio encoder");
                prose_word(ui, t, "at");
                number_token(ui, cx, "audio_bitrate", "Audio bitrate", " kbps", br_bounds, STEP_BITRATE, 0, kit::fallback("audio_bitrate"), false, "Audio track bitrate", &[]);
                prose_word(ui, t, ". Extra flags: input");
                text_word(ui, cx, "ffmpeg_input_params", "Input params", "none", false, false, false, "Raw FFmpeg flags inserted before -i");
                prose_word(ui, t, ", output");
                text_word(ui, cx, "ffmpeg_output_params", "Output params", "none", false, false, false, "Raw FFmpeg flags inserted before the output file");
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            let cur_preset = choice("video_preset", &text_of(cx, "video_preset"), &VIDEO_PRESETS);
            let cur_cont = choice("video_container", &text_of(cx, "video_container"), &VIDEO_CONTAINERS);
            tile_grid(ui, VIDEO_TILE_MIN_W, 6, |ui, idx, tw| match idx { // allow-hardcode: six encoding setting tiles
                0 => {
                    big_tile(ui, t, tw, "Video codec", None, true, false, false, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("encoding"), c), |ui| {
                        kit::codec(ui, cx, "video_codec", "Codec", &tables.video_codecs, "FFmpeg video encoder");
                    });
                }
                1 => count_tile(ui, cx, "crf", "CRF", "", crf_bounds, STEP_CRF, 0, None, crf_words(num(cx, "crf")), "Constant Rate Factor", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("encoding"), c)),
                2 => {
                    big_tile(ui, t, tw, "Preset", Some(&cur_preset), false, false, false, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Play, c), |ui| {
                        ui.horizontal_wrapped(|ui| {
                            for p_opt in VIDEO_PRESETS {
                                if crate::widgets::chip(ui, t, p_opt, Some(p_opt == cur_preset), Some(&format!("Preset: {p_opt}")), true).on_hover_text("FFmpeg preset").clicked() {
                                    cx.link.set(cx.now, "video_preset", json!(p_opt));
                                }
                            }
                        });
                        mark(ui, "video_preset");
                    });
                }
                3 => { // allow-hardcode: tile index
                    big_tile(ui, t, tw, "Container", Some(&cur_cont), false, false, false, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Cylinder, c), |ui| {
                        ui.horizontal_wrapped(|ui| {
                            for c_opt in VIDEO_CONTAINERS {
                                if crate::widgets::chip(ui, t, c_opt, Some(c_opt == cur_cont), Some(&format!("Container: {c_opt}")), true).on_hover_text("Output container format").clicked() {
                                    cx.link.set(cx.now, "video_container", json!(c_opt));
                                }
                            }
                        });
                        mark(ui, "video_container");
                    });
                }
                4 => { // allow-hardcode: tile index
                    big_tile(ui, t, tw, "Audio codec", None, true, false, false, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("encoding"), c), |ui| {
                        kit::codec(ui, cx, "audio_codec", "Audio codec", &tables.audio_codecs, "FFmpeg audio encoder");
                    });
                }
                _ => count_tile(ui, cx, "audio_bitrate", "Audio bitrate", " kbps", br_bounds, STEP_BITRATE, 0, None, "Bitrate", "Audio bitrate", tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Icon("encoding"), c)),
            });
            text(ui, cx, "ffmpeg_input_params", "Input params", "input params", "Raw FFmpeg flags inserted before the input (-i) file. Advanced/optional");
            text(ui, cx, "ffmpeg_output_params", "Output params", "output params", "Raw FFmpeg flags inserted before the output file. Advanced/optional");
        }
    }
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
