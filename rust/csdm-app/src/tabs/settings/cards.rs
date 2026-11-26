//! The eight SETTINGS cards, in all three card styles (`timeline`, `sentence`, `tiles`)
//! after 3.5 `settingsCards/*.tsx` and `PresetSection.tsx`. Words and tips are 3.5's.

use super::controls::{action, bool_of, hint, kick, num_of, number_box, path_box, segmented, slider, switch, text_box, text_box_w, text_of, PickKind};
use super::{PendingSwitch, PgState, Req, SettingsTab};
use crate::cardstyle::{action_word, big_tile, bool_word, choice_token, choice_word, count_tile, number_token, paint_glyph, prose_line, prose_muted, prose_word, style_of, text_word, tile_grid, word_options, TileGlyph};
use crate::controls::{link_arrow, mark, mix, node, NodeIcon, LINK_W};
use crate::grid::CardCx;
use crate::paint::{mono, regular, semibold};
use crate::theme::{parse_hex, resolve_accent, Theme};
use crate::widgets::{chip, confirm_dialog, tip, Confirm};
use csdm_core::theme_v12::{ACCENT_PRESETS, GROUNDS};
use csdm_core::ui_values::{
    CardStyle, ACCENT_SWATCH, BLOCK_SLIDER, CARD_STYLES, DP2_THREADS_CHOICES, FONT_BODY, FONT_SMALL, FONT_SWATCH, GROUND_LOOK, LAYOUT_AUTO_FALLBACK_SCREEN, LAYOUT_AUTO_SCREEN,
    LAYOUT_DRAWING_HEIGHT, LAYOUT_HEIGHT_RANGE, LAYOUT_WIDTH_RANGE, SETTINGS_ROW_GAP, SPLIT_PCT_DEFAULT, SPLIT_PCT_MAX, SPLIT_PCT_MIN, STYLED_CARDS, THEME_PREVIEW,
};
use csdm_engine::Command;
use eframe::egui::{self, pos2, vec2, Color32, Rect, Sense, Stroke, StrokeKind, Vec2};
use serde_json::{json, Value};

const PCT: f64 = 100.0;
const LIGHT: f32 = 5.0;
/// Paths rail (3.5.1 PathsCard `.st-ic`): rail width, step tile (26 px), corner (8 px), tint, glyph (16 px), line.
const PATH_RAIL_W: f32 = 150.0;
const PATH_TILE: f32 = 26.0;
const PATH_TILE_RADIUS: f32 = 8.0;
const PATH_TILE_TINT_PCT: f32 = 10.0;
const PATH_GLYPH: f32 = 16.0;
const PATH_RAIL_STROKE: f32 = 2.0;
const PATH_RAIL_ALPHA: f32 = 0.35;
/// `.st-chain` column shares and compact `.st-form` label width.
const PG_NODE_SHARES: [f32; 3] = [1.0, 1.0, 0.8];
const PG_LABEL_WIDTH: f32 = 34.0;
/// `.pf-cores`: 8 equal tiles, 5 px gap, 9 px radius, 46 px tall, CPU glyph 18 px, tint 12 %, edge 45 %.
const PERF_TILE_GAP: f32 = 5.0;
const PERF_TILE_H: f32 = 46.0;
const PERF_TILE_RADIUS: f32 = 9.0;
const PERF_TILE_TINT_PCT: f32 = 12.0;
const PERF_TILE_EDGE_ALPHA: f32 = 0.45;
const PERF_CPU_SIZE: f32 = 18.0;
const PERF_CPU_STROKE: f32 = 1.7;
const PERF_CPU_INSET: f32 = 0.3;
const PERF_CPU_PIN: f32 = 0.14;
const PERF_CPU_PINS: [f32; 2] = [0.4, 0.6];
const TILE_MIN_W: f32 = 175.0;
const CFG_TILE_MIN_W: f32 = 150.0;
const GROUND_TILE_MIN_W: f32 = 110.0;
const GROUND_PREVIEW_H: f32 = 64.0;
const TILE_LOC_GLYPH: f32 = 24.0;
const TILE_RADIUS: f32 = 12.0;
const TILE_PAD: f32 = 10.0;
const TILE_LABEL_GAP: f32 = 4.0;
const TILE_EXTRA_H: f32 = 8.0;
const PATH_TILE_MIN_W: f32 = 240.0;
const PATH_IDX_CONCAT: usize = 3;
const PATH_IDX_ASSEMBLED: usize = 4;
const LAYOUT_SLIDER_STEP: f64 = 1.0;
const THREAD_TILE_MIN_W: f32 = 44.0;
/// Header counts: UI Theme, UI Layout, Performance.
pub const HEADER_COUNTS: usize = 3;
/// Words shown in empty boxes and examples (3.5's), never used as addresses or paths.
const HOST_HINT: &str = "localhost";
const CS2_CFG_HINT: &str = "Optional override (…\\Counter-Strike Global Offensive\\game\\csgo\\cfg)";
const SUBFOLDER_EXAMPLE: [&str; 2] = ["…\\clips\\<demo>\\clip.mp4", "…\\clips\\clip.mp4"];
/// Per-card style: (title, choice) pairs per row, as 3.5's grid.
const THEME_PREVIEW_TILE: [f32; 2] = [96.0, 56.0];
const STYLE_PAIRS_PER_ROW: usize = 3;
const FULL: &str = "full";

fn gap(ui: &mut egui::Ui) {
    ui.add_space(SETTINGS_ROW_GAP);
}

fn status_line(ui: &mut egui::Ui, text: &str, color: Color32) {
    if !text.is_empty() {
        let r = ui.add(egui::Label::new(egui::RichText::new(text).font(semibold(FONT_SMALL)).color(color)).wrap());
        r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Status, true, text));
    }
}

// ---------------------------------------------------------------- PostgreSQL Connection

const PG_HINT: &str = "Use the values shown in CS Demo Manager › Settings › Database. CS Demo Manager must be installed and its database running.";

fn light(ui: &mut egui::Ui, t: &Theme, state: PgState) {
    let color = match state {
        PgState::Idle => t.faint,
        PgState::Busy => t.amber,
        PgState::Ok => t.emerald,
        PgState::Bad => t.rose,
    };
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(LIGHT * 2.0), Sense::hover());
    ui.painter().circle_filled(rect.center(), LIGHT, color);
}

fn pg_trigger_test(tab: &mut SettingsTab, cx: &mut CardCx) {
    // The values being typed, before they are saved (3.5 B1).
    let pg: csdm_core::Settings = ["pg_host", "pg_port", "pg_user", "pg_pass", "pg_db"].iter().map(|k| (k.to_string(), json!(text_of(cx, k)))).collect();
    tab.pg_status = "Connecting…".into();
    tab.pg_state = PgState::Busy;
    tab.ask(cx, Command::ConnectDb { pg: Some(pg) }, Req::Connect);
}

fn pg_answer(tab: &SettingsTab, ui: &mut egui::Ui, cx: &CardCx) {
    let t = cx.theme;
    ui.vertical(|ui| {
        let color = match tab.pg_state {
            PgState::Ok => t.emerald,
            PgState::Bad => t.rose,
            _ => t.muted,
        };
        status_line(ui, &tab.pg_status, color);
        // Before any test, a start-up connection that failed is said here, where it is fixed (first run).
        if tab.pg_state == PgState::Idle {
            if let crate::link::DbState::Error(e) = &cx.link.db {
                status_line(ui, &format!("Not connected: {e}"), t.rose);
            }
        }
        // The guidance stays after a test: a failed test is when it is needed most.
        hint(ui, t, PG_HINT);
    });
}

pub fn postgres(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let state = tab.pg_state;
    let busy = tab.pg_state == PgState::Busy;
    match style_of(cx, "postgresql") {
        CardStyle::Timeline => {
            // 3.5.1 `.st-chain`: You -> Server -> Database as white sub-cards linked by dashed arrows.
            let room = ui.available_width() - LINK_W * 2.0;
            let w = PG_NODE_SHARES.map(|k| room * k / PG_NODE_SHARES.iter().sum::<f32>());
            ui.horizontal_top(|ui| {
                ui.spacing_mut().item_spacing.x = 0.0;
                let r0 = ui.allocate_ui(Vec2::new(w[0], 0.0), |ui| {
                    node(ui, t, NodeIcon::Named("player"), "You", 0.0, |_| {}, |ui| {
                        text_box_w(ui, cx, "pg_user", "User", PG_LABEL_WIDTH, "postgres", "PostgreSQL user name", false);
                        text_box_w(ui, cx, "pg_pass", "Pass", PG_LABEL_WIDTH, "no password", "PostgreSQL password", true);
                    })
                });
                let h0 = r0.response.rect.height();
                link_arrow(ui, t, LINK_W, h0);
                let r1 = ui.allocate_ui(Vec2::new(w[1], 0.0), |ui| {
                    node(ui, t, NodeIcon::Named("postgresql"), "Server", 0.0, |_| {}, |ui| {
                        text_box_w(ui, cx, "pg_host", "Host", PG_LABEL_WIDTH, HOST_HINT, "Machine running the PostgreSQL server of CS Demo Manager", false);
                        text_box_w(ui, cx, "pg_port", "Port", PG_LABEL_WIDTH, "5432", "Port the PostgreSQL server listens on", false);
                    })
                });
                let h = h0.max(r1.response.rect.height());
                link_arrow(ui, t, LINK_W, h);
                ui.allocate_ui(Vec2::new(w[2], 0.0), |ui| {
                    node(ui, t, NodeIcon::Cylinder, "Database", h, |ui| light(ui, t, state), |ui| {
                        text_box_w(ui, cx, "pg_db", "Base", PG_LABEL_WIDTH, "csdm", "PostgreSQL database name (the one created by CS Demo Manager)", false);
                    })
                });
            });
            gap(ui);
            ui.horizontal(|ui| {
                if action(ui, t, "Test & Reload", "Tests the PostgreSQL connection and reloads players/tables from the database", !busy) {
                    pg_trigger_test(tab, cx);
                }
                pg_answer(tab, ui, cx);
            });
        }
        CardStyle::Sentence => {
            prose_line(ui, |ui| {
                prose_word(ui, t, "Sign in as");
                text_word(ui, cx, "pg_user", "User", "postgres", false, false, false, "PostgreSQL user name");
                prose_word(ui, t, "with");
                text_word(ui, cx, "pg_pass", "Pass", "no password", true, false, false, "PostgreSQL password");
                prose_word(ui, t, "to the");
                text_word(ui, cx, "pg_db", "Base", "csdm", false, false, true, "PostgreSQL database name (the one created by CS Demo Manager)");
                prose_word(ui, t, "database on");
                text_word(ui, cx, "pg_host", "Host", HOST_HINT, false, false, false, "Machine running the PostgreSQL server of CS Demo Manager");
                prose_word(ui, t, ":");
                text_word(ui, cx, "pg_port", "Port", "5432", false, false, false, "Port the PostgreSQL server listens on");
                prose_word(ui, t, ".");
            });
            gap(ui);
            ui.horizontal(|ui| {
                light(ui, t, state);
                if action_word(ui, t, "Test it and reload the lists", "Test & Reload", false, false, "Tests the PostgreSQL connection and reloads players/tables from the database", !busy) {
                    pg_trigger_test(tab, cx);
                }
                pg_answer(tab, ui, cx);
            });
        }
        CardStyle::Tiles => {
            let fields: &[(&str, &str, &str, &str, bool, TileGlyph, bool)] = &[
                ("pg_host", "Host", HOST_HINT, "Machine running the PostgreSQL server of CS Demo Manager", false, TileGlyph::Icon("postgresql"), false),
                ("pg_port", "Port", "5432", "Port the PostgreSQL server listens on", false, TileGlyph::Icon("performance"), false),
                ("pg_db", "Database", "csdm", "PostgreSQL database name (the one created by CS Demo Manager)", false, TileGlyph::Cylinder, true),
                ("pg_user", "User", "postgres", "PostgreSQL user name", false, TileGlyph::Icon("player"), false),
                ("pg_pass", "Password", "no password", "PostgreSQL password", true, TileGlyph::Icon("settings"), false),
                ("", "Connection", "", "Tests the PostgreSQL connection and reloads players/tables from the database", false, TileGlyph::Icon("postgresql"), false),
            ];
            let mut test_clicked = false;
            tile_grid(ui, TILE_MIN_W, fields.len(), |ui, idx, w| {
                let (key, title, hint_txt, tip_txt, pw, glyph, alt) = fields[idx];
                if key.is_empty() {
                    big_tile(ui, t, w, title, None, state == PgState::Ok, state == PgState::Bad, false, |p, r, c| paint_glyph(p, r, glyph, c), |ui| {
                        ui.horizontal(|ui| {
                            if action(ui, t, "Test & Reload", tip_txt, !busy) {
                                test_clicked = true;
                            }
                            light(ui, t, state);
                        });
                    });
                } else {
                    big_tile(ui, t, w, title, None, false, false, alt, |p, r, c| paint_glyph(p, r, glyph, c), |ui| {
                        text_box_w(ui, cx, key, title, 0.0, hint_txt, tip_txt, pw);
                    });
                }
            });
            if test_clicked {
                pg_trigger_test(tab, cx);
            }
            gap(ui);
            pg_answer(tab, ui, cx);
        }
    }
}

// ---------------------------------------------------------------- Paths

type PathSpec<'a> = (&'a str, &'a str, &'a str, &'a str, &'a str, &'a str, PickKind, &'static str);

pub fn paths(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let exe_hint = match &tab.default_csdm_exe {
        Some(p) => format!("Empty = auto-detected: {p}"),
        None if tab.waiting_for(&Req::Describe) => "csdm.CMD or csdm.exe".into(),
        None => "Not found automatically: Browse to CS Demo Manager's csdm.CMD".into(),
    };
    let exe_empty = if tab.default_csdm_exe.is_some() { "auto-detected" } else { "not found yet" };
    let clips_hint = match &tab.default_clips_dir {
        Some(p) => format!("Empty = {p} (a subfolder per demo is created inside)"),
        None => "A subfolder per demo is created here".into(),
    };
    let specs: &[PathSpec<'_>] = &[
        ("csdm_exe", "CSDM Executable", "Records", &exe_hint, "CS Demo Manager's csdm.CMD (or csdm.exe), which records the clips", exe_empty, PickKind::File, "capture"),
        ("cs2_cfg_dir", "CS2 cfg folder", "Injects commands", CS2_CFG_HINT, "Where CSDM writes injected CS2 console commands before recording. Leave empty to auto-detect", "auto-detected", PickKind::Folder, "editing"),
        ("output_dir_clips", "Raw clips folder", "Writes raw clips", &clips_hint, "Where the recorded clips are written", "the default clips folder", PickKind::Folder, "video"),
        ("output_dir_concat", "Concatenated clips folder", "Joins them", "Empty = same folder as raw clips", "Where the clips joined per demo are written", "the raw clips folder", PickKind::Folder, "operations"),
        ("output_dir_assembled", "Assembled file folder", "Assembles the video", "Empty = same folder as raw clips", "Where the final assembled video is written", "the raw clips folder", PickKind::Folder, "encoding"),
    ];
    let pick = &mut tab.pick;
    match style_of(cx, "paths") {
        CardStyle::Timeline => {
            let mut tiles: Vec<egui::Pos2> = Vec::new();
            for (key, name, step_words, hint_txt, tip_txt, _, kind, icon) in specs {
                ui.horizontal_top(|ui| {
                    ui.allocate_ui_with_layout(Vec2::new(PATH_RAIL_W, 0.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
                        ui.set_width(PATH_RAIL_W);
                        let (r, _) = ui.allocate_exact_size(Vec2::splat(PATH_TILE), Sense::hover());
                        ui.painter().rect_filled(r, PATH_TILE_RADIUS, crate::controls::mix(t.accent, t.solid, PATH_TILE_TINT_PCT));
                        crate::icons::paint(ui.painter(), icon, Rect::from_center_size(r.center(), Vec2::splat(PATH_GLYPH)), t.accent);
                        tiles.push(r.center());
                        ui.add(egui::Label::new(egui::RichText::new(*step_words).font(semibold(FONT_SMALL)).color(t.muted)).wrap());
                    });
                    ui.vertical(|ui| {
                        path_box(ui, cx, pick, key, name, hint_txt, tip_txt, *kind);
                        if *key == "output_dir_clips" {
                            ui.horizontal(|ui| {
                                switch(ui, cx, "subfolder_per_demo", "Subfolder per demo", "When on, each demo's clips go in their own subfolder instead of sharing the raw clips folder");
                                let eg = if bool_of(cx, "subfolder_per_demo") { SUBFOLDER_EXAMPLE[0] } else { SUBFOLDER_EXAMPLE[1] };
                                ui.label(egui::RichText::new(eg).font(mono(FONT_SMALL)).color(t.faint));
                            });
                        }
                    });
                });
                gap(ui);
            }
            for w in tiles.windows(2) {
                ui.painter().line_segment([w[0] + Vec2::new(0.0, PATH_TILE / 2.0), w[1] - Vec2::new(0.0, PATH_TILE / 2.0)], Stroke::new(PATH_RAIL_STROKE, t.accent.gamma_multiply(PATH_RAIL_ALPHA)));
            }
        }
        CardStyle::Sentence => {
            let path_tok = |ui: &mut egui::Ui, cx: &mut CardCx, pick: &mut super::controls::Picker, idx: usize| {
                let (key, name, _, hint_txt, tip_txt, empty_w, kind, _) = specs[idx];
                let val = text_of(cx, key);
                let shown = if val.is_empty() { empty_w.to_string() } else { crate::cardstyle::path_tail(&val) };
                choice_token(ui, cx.theme, key, &shown, name, false, tip_txt, true, |ui, _| {
                    path_box(ui, cx, pick, key, name, hint_txt, tip_txt, kind);
                });
            };
            prose_line(ui, |ui| {
                prose_word(ui, t, "Record with CS Demo Manager from");
                path_tok(ui, cx, pick, 0);
                prose_word(ui, t, ", writing CS2 commands into");
                path_tok(ui, cx, pick, 1);
                prose_word(ui, t, ".");
            });
            prose_line(ui, |ui| {
                prose_word(ui, t, "Save raw clips in");
                path_tok(ui, cx, pick, 2);
                prose_word(ui, t, ",");
                let sub = bool_of(cx, "subfolder_per_demo");
                let mut picked = None;
                choice_token(ui, t, "subfolder_per_demo", if sub { "one subfolder per demo" } else { "all in the same folder" }, "Subfolder per demo", true, "When on, each demo's clips go in their own subfolder instead of sharing the raw clips folder", false, |ui, close| {
                    if let Some(v) = word_options(ui, t, &[("on", "one subfolder per demo", SUBFOLDER_EXAMPLE[0]), ("off", "all in the same folder", SUBFOLDER_EXAMPLE[1])], if sub { "on" } else { "off" }) {
                        picked = Some(v == "on");
                        *close = true;
                    }
                });
                if let Some(v) = picked {
                    cx.link.set(cx.now, "subfolder_per_demo", json!(v));
                }
                prose_word(ui, t, ".");
            });
            prose_line(ui, |ui| {
                prose_word(ui, t, "Put the concatenated clips in");
                path_tok(ui, cx, pick, PATH_IDX_CONCAT);
                prose_word(ui, t, "and the assembled video in");
                path_tok(ui, cx, pick, PATH_IDX_ASSEMBLED);
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            tile_grid(ui, PATH_TILE_MIN_W, specs.len() + 1, |ui, idx, w| {
                if idx < specs.len() {
                    let (key, name, _, hint_txt, tip_txt, empty_w, kind, icon) = specs[idx];
                    let val = text_of(cx, key);
                    let cap = if val.is_empty() { Some(format!("Empty = {empty_w}")) } else { None };
                    big_tile(ui, t, w, name, cap.as_deref(), false, false, false, |p, r, c| paint_glyph(p, r, TileGlyph::Icon(icon), c), |ui| {
                        path_box(ui, cx, pick, key, name, hint_txt, tip_txt, kind);
                    });
                } else {
                    let on = bool_of(cx, "subfolder_per_demo");
                    let eg = if on { SUBFOLDER_EXAMPLE[0] } else { SUBFOLDER_EXAMPLE[1] };
                    big_tile(ui, t, w, "Subfolder per demo", Some(eg), on, false, false, |p, r, c| paint_glyph(p, r, TileGlyph::Icon("paths"), c), |ui| {
                        switch(ui, cx, "subfolder_per_demo", "Subfolder per demo", "When on, each demo's clips go in their own subfolder instead of sharing the raw clips folder");
                    });
                }
            });
        }
    }
}

// ---------------------------------------------------------------- Configuration Folder

/// (kind, label, sentence words, `config_dir` value or `None` for a chosen folder, tip) — 3.5 `CHOICES`.
const LOCATIONS: [(&str, &str, &str, Option<&str>, &str); 3] = [
    ("app", "App folder (portable)", "the app's own folder", Some(""), "Stores settings next to the app itself -- portable, travels with the folder (e.g. USB drive)"),
    ("appdata", "User Local AppData", "my Windows user folder", Some("appdata"), "Stores settings in Windows' per-user AppData folder -- survives moving/reinstalling the app"),
    ("custom", "Choose…", "a folder I choose", None, "Stores settings in a folder you pick"),
];

fn folder_footer(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    hint(ui, t, "The four settings files (config, presets, players, assembly names) live in a \"CSDM-batch-clip_config\" subfolder of the selected location. Switching COPIES them there — the current files always stay in place.");
    status_line(ui, &tab.folder_error, t.rose);
    if let Some(p) = tab.switch.clone() {
        switch_confirm(tab, ui, cx, p);
    }
}

fn folder_pick(tab: &mut SettingsTab, cx: &mut CardCx, value: Option<&str>, label: &str) {
    tab.folder_error.clear();
    let picked = match value {
        Some(v) => Some((v.to_string(), label.to_string())),
        None => (tab.pick)(PickKind::Folder).map(|p| (p, "Custom folder".to_string())),
    };
    if let Some((value, label)) = picked {
        tab.ask(cx, Command::ProbeConfigDir { target: Some(value.clone()) }, Req::SwitchProbe { value, label });
    }
}

pub fn config_folder(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let kind = tab.folder.as_ref().and_then(|f| f["kind"].as_str()).unwrap_or_default().to_string();
    let current = tab.folder.as_ref().and_then(|f| f["current"].as_str()).unwrap_or("…").to_string();
    match style_of(cx, "config-folder") {
        CardStyle::Timeline => {
            kick(ui, t, "Settings live in");
            ui.add(egui::Label::new(egui::RichText::new(&current).font(mono(FONT_SMALL)).color(t.txt)).wrap());
            gap(ui);
            kick(ui, t, "Copy to →");
            let mut chosen = None;
            ui.horizontal_wrapped(|ui| {
                for (k, label, _, value, tip_text) in LOCATIONS {
                    let r = chip(ui, t, label, Some(kind == k), Some(label), tab.switch.is_none());
                    if r.on_hover_text(tip_text).clicked() {
                        chosen = Some((value, label));
                    }
                }
            });
            if let Some((value, label)) = chosen {
                folder_pick(tab, cx, value, label);
            }
        }
        CardStyle::Sentence => {
            let now_words = LOCATIONS.iter().find(|(k, ..)| *k == kind).map(|(_, _, w, ..)| *w).unwrap_or("…");
            let mut chosen = None;
            prose_line(ui, |ui| {
                prose_word(ui, t, "Keep my settings in");
                choice_token(ui, t, "config_dir", now_words, "Configuration folder", false, "Where the settings files live", false, |ui, close| {
                    ui.label(egui::RichText::new("Copy the settings to").font(semibold(FONT_SMALL)).color(t.muted));
                    let opts: Vec<(&str, &str, &str)> = LOCATIONS.iter().map(|(k, lbl, words, ..)| (*k, *words, *lbl)).collect();
                    if let Some(picked_k) = word_options(ui, t, &opts, &kind) {
                        if let Some((_, lbl, _, val, _)) = LOCATIONS.iter().find(|(k, ..)| *k == picked_k) {
                            chosen = Some((*val, *lbl));
                            *close = true;
                        }
                    }
                });
                prose_word(ui, t, ", that is");
                ui.add(egui::Label::new(egui::RichText::new(&current).font(mono(FONT_SMALL)).color(t.muted)).wrap());
                prose_word(ui, t, ".");
            });
            if let Some((value, label)) = chosen {
                folder_pick(tab, cx, value, label);
            }
        }
        CardStyle::Tiles => {
            let mut chosen = None;
            tile_grid(ui, CFG_TILE_MIN_W, LOCATIONS.len(), |ui, idx, w| {
                let (k, label, words, value, tip_text) = LOCATIONS[idx];
                let on = kind == k;
                let enabled = tab.switch.is_none();
                let h = TILE_LOC_GLYPH + TILE_PAD * 2.0 + FONT_BODY + FONT_SMALL + TILE_EXTRA_H;
                let (rect, resp) = ui.allocate_exact_size(vec2(w, h), if enabled { Sense::click() } else { Sense::hover() });
                resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, enabled, on, label));
                let p = ui.painter();
                let fill = if on { mix(t.accent, t.solid, 10.0) } else { t.solid }; // allow-hardcode: tint percentage
                let edge = if on || (resp.hovered() && enabled) { t.accent } else { t.hair };
                p.rect(rect, TILE_RADIUS, fill, Stroke::new(if on { 2.0 } else { 1.0 }, edge), StrokeKind::Inside);
                let ic = Rect::from_center_size(pos2(rect.center().x, rect.top() + TILE_PAD + TILE_LOC_GLYPH / 2.0), Vec2::splat(TILE_LOC_GLYPH));
                paint_glyph(p, ic, TileGlyph::Icon("paths"), if on { t.accent } else { t.muted });
                p.text(pos2(rect.center().x, ic.bottom() + FONT_BODY / 2.0 + TILE_LABEL_GAP), egui::Align2::CENTER_CENTER, label, semibold(FONT_BODY), if on { t.accent } else { t.txt });
                p.text(pos2(rect.center().x, rect.bottom() - TILE_PAD), egui::Align2::CENTER_BOTTOM, words, regular(FONT_SMALL - 1.0), t.muted);
                if resp.on_hover_text(tip_text).clicked() && enabled {
                    chosen = Some((value, label));
                }
            });
            if let Some((value, label)) = chosen {
                folder_pick(tab, cx, value, label);
            }
            gap(ui);
            kick(ui, t, "Now");
            ui.add(egui::Label::new(egui::RichText::new(&current).font(mono(FONT_SMALL)).color(t.txt)).wrap());
        }
    }
    gap(ui);
    folder_footer(tab, ui, cx);
}

fn switch_confirm(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx, p: PendingSwitch) {
    let t = cx.theme;
    let danger = !p.conflicts.is_empty() && p.step == 2;
    let edge = if danger { t.rose } else { t.accent };
    egui::Frame::new().fill(t.accent_soft).stroke(Stroke::new(1.0, edge)).corner_radius(egui::CornerRadius::same(crate::CORNER_SMALL)).inner_margin(egui::Margin::same(crate::ASK_PAD)).show(ui, |ui| {
        let (text, go) = if p.conflicts.is_empty() {
            (format!("Copy the settings files to {}?", p.target_dir), "Copy")
        } else if p.step == 1 {
            (format!("These files already exist in {}: {}. Copying would overwrite them.", p.target_dir, p.conflicts.join(", ")), "Continue")
        } else {
            ("Really overwrite? The existing files are first backed up in a \"backup-…\" subfolder, then replaced by the current ones.".to_string(), "Overwrite & copy")
        };
        let r = ui.add(egui::Label::new(egui::RichText::new(&text).font(regular(FONT_BODY)).color(t.txt)).wrap());
        r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Alert, true, &text));
        ui.horizontal(|ui| {
            if action(ui, t, go, &text, !p.busy) {
                if !p.conflicts.is_empty() && p.step == 1 {
                    tab.switch = Some(PendingSwitch { step: 2, ..p.clone() });
                } else {
                    tab.switch = Some(PendingSwitch { busy: true, ..p.clone() });
                    tab.ask(cx, Command::ApplyConfigDir { target: p.value.clone() }, Req::Apply(p.value.clone()));
                }
            }
            if action(ui, t, "Cancel", "Leave the settings where they are", !p.busy) {
                tab.switch = None;
            }
        });
    });
}

// ---------------------------------------------------------------- Presets

/// A category key as words (3.5 `categoryLabel`).
pub fn category_label(key: &str) -> String {
    if key == FULL {
        return "Full config".into();
    }
    key.split('_').map(|w| {
        let mut c = w.chars();
        c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
    }).collect::<Vec<_>>().join(" ")
}

/// "full" clears the partial categories and the other way round (3.5 `toggleCategory`).
pub fn toggle_category(cats: &mut Vec<String>, cat: &str) {
    if let Some(i) = cats.iter().position(|c| c == cat) {
        cats.remove(i);
    } else if cat == FULL {
        *cats = vec![FULL.into()];
    } else {
        cats.retain(|c| c != FULL);
        cats.push(cat.into());
    }
}

fn preset_name_box(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &CardCx, show_label: bool) {
    let t = cx.theme;
    let r = if show_label {
        ui.horizontal(|ui| {
            let l = ui.label(egui::RichText::new("Name").font(regular(FONT_BODY)).color(t.muted));
            ui.add(egui::TextEdit::singleline(&mut tab.preset_name).hint_text("Preset name").desired_width(ui.available_width())).labelled_by(l.id)
        })
        .inner
    } else {
        let edit = ui.add(egui::TextEdit::singleline(&mut tab.preset_name).hint_text("Preset name").desired_width(PATH_RAIL_W));
        edit.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, "Name"));
        edit
    };
    tip(ui, t, r, "Identifier name for this configuration preset", cx.always_tips);
}

fn preset_categories(tab: &mut SettingsTab, ui: &mut egui::Ui, t: &Theme) {
    let mut flip = None;
    ui.horizontal_wrapped(|ui| {
        for cat in &tab.categories {
            let words = category_label(cat);
            let on = tab.preset_cats.contains(cat);
            if chip(ui, t, &words, Some(on), Some(&words), true).on_hover_text(format!("Include {words} settings in this preset")).clicked() {
                flip = Some(cat.clone());
            }
        }
    });
    if let Some(cat) = flip {
        toggle_category(&mut tab.preset_cats, &cat);
    }
}

fn preset_trigger_save(tab: &mut SettingsTab, cx: &mut CardCx) {
    tab.preset_error.clear();
    tab.preset_status.clear();
    let name = tab.preset_name.trim().to_string();
    if name.is_empty() {
        tab.preset_error = "This preset needs a name.".into();
    } else if tab.preset_cats.is_empty() {
        tab.preset_error = "Select at least one category to include.".into();
    } else {
        let cmd = Command::SavePreset { preset: name.clone(), cats: tab.preset_cats.clone(), cfg: cx.link.settings.clone(), selected_clips: None, ask_name: false };
        tab.ask(cx, cmd, Req::PresetDone(format!("Saved \"{name}\".")));
    }
}

fn preset_message(tab: &SettingsTab, ui: &mut egui::Ui, t: &Theme) {
    if !tab.preset_error.is_empty() {
        status_line(ui, &tab.preset_error, t.rose);
    } else {
        status_line(ui, &tab.preset_status, t.emerald);
    }
}

fn preset_rows(tab: &SettingsTab) -> Vec<(String, String)> {
    tab.presets
        .iter()
        .map(|(n, p)| {
            let cats = p["cats"].as_array().map(|a| a.iter().filter_map(Value::as_str).map(category_label).collect::<Vec<_>>().join(", ")).unwrap_or_default();
            (n.clone(), cats)
        })
        .collect()
}

fn preset_list(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    if tab.presets.is_empty() {
        ui.label(egui::RichText::new("No saved presets.").font(regular(FONT_BODY)).color(t.faint));
    }
    for (name, cats) in preset_rows(tab) {
        ui.horizontal_wrapped(|ui| {
            ui.label(egui::RichText::new(&name).font(semibold(FONT_BODY)).color(t.txt));
            ui.label(egui::RichText::new(&cats).font(regular(FONT_SMALL)).color(t.muted));
            if chip(ui, t, "Load", None, Some(&format!("Load {name}")), true).on_hover_text("Load this preset, overwriting only the settings it was saved with").clicked() {
                tab.preset_error.clear();
                tab.ask(cx, Command::LoadPreset { preset: name.clone() }, Req::LoadPreset(name.clone()));
            }
            if chip(ui, t, "Delete", None, Some(&format!("Delete {name}")), true).on_hover_text("Permanently remove this preset").clicked() {
                tab.pending_delete = Some(name.clone());
            }
        });
    }
}

fn preset_confirm(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    if let Some(name) = tab.pending_delete.clone() {
        match confirm_dialog(ui.ctx(), t, "Delete preset", &format!("Delete preset \"{name}\"? This cannot be undone."), true) {
            Confirm::Pending => {}
            Confirm::Cancelled => tab.pending_delete = None,
            Confirm::Confirmed => {
                tab.pending_delete = None;
                tab.preset_error.clear();
                tab.ask(cx, Command::DeletePreset { preset: name.clone() }, Req::PresetDone(format!("Deleted \"{name}\".")));
            }
        }
    }
}

fn included_words(tab: &SettingsTab) -> String {
    let on: Vec<String> = tab.categories.iter().filter(|c| tab.preset_cats.contains(*c)).map(|c| category_label(c)).collect();
    match on.len() {
        0 => "which settings?".into(),
        1 => on[0].clone(),
        2 => format!("{} and {}", on[0], on[1]),
        n => format!("{}, {} +{}", on[0], on[1], n - 2),
    }
}

pub fn presets(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    match style_of(cx, "presets") {
        CardStyle::Timeline => {
            kick(ui, t, "Save the current settings");
            preset_name_box(tab, ui, cx, true);
            preset_categories(tab, ui, t);
            ui.horizontal_wrapped(|ui| {
                if action(ui, t, "SAVE", "Save selected settings categories to this preset", true) {
                    preset_trigger_save(tab, cx);
                }
                preset_message(tab, ui, t);
            });
            gap(ui);
            kick(ui, t, "Saved");
            preset_list(tab, ui, cx);
        }
        CardStyle::Sentence => {
            let words = included_words(tab);
            let mut save_clicked = false;
            prose_line(ui, |ui| {
                prose_word(ui, t, "Save");
                choice_token(ui, t, "preset-cats", &words, "Categories", false, "Choose which settings groups this preset saves and can later overwrite", true, |ui, _| {
                    ui.label(egui::RichText::new("What the preset keeps").font(semibold(FONT_SMALL)).color(t.muted));
                    preset_categories(tab, ui, t);
                });
                prose_word(ui, t, "as");
                preset_name_box(tab, ui, cx, false);
                if action_word(ui, t, "SAVE", "SAVE", false, false, "Save selected settings categories to this preset", true) {
                    save_clicked = true;
                }
            });
            if save_clicked {
                preset_trigger_save(tab, cx);
            }
            preset_message(tab, ui, t);
            gap(ui);
            preset_list(tab, ui, cx);
        }
        CardStyle::Tiles => {
            let width = ui.available_width();
            let mut save_clicked = false;
            big_tile(ui, t, width, "New preset", None, false, false, false, |p, r, c| paint_glyph(p, r, TileGlyph::Icon("presets"), c), |ui| {
                preset_name_box(tab, ui, cx, false);
                preset_categories(tab, ui, t);
                ui.horizontal_wrapped(|ui| {
                    if action(ui, t, "SAVE", "Save selected settings categories to this preset", true) {
                        save_clicked = true;
                    }
                    preset_message(tab, ui, t);
                });
            });
            if save_clicked {
                preset_trigger_save(tab, cx);
            }
            gap(ui);
            let rows = preset_rows(tab);
            if rows.is_empty() {
                ui.label(egui::RichText::new("No saved presets.").font(regular(FONT_BODY)).color(t.faint));
            } else {
                let mut load_name = None;
                let mut del_name = None;
                tile_grid(ui, TILE_MIN_W, rows.len(), |ui, idx, w| {
                    let (name, cats) = &rows[idx];
                    big_tile(ui, t, w, name, Some(cats), false, false, true, |p, r, c| paint_glyph(p, r, TileGlyph::Icon("presets"), c), |ui| {
                        ui.horizontal_wrapped(|ui| {
                            if chip(ui, t, "Load", None, Some(&format!("Load {name}")), true).on_hover_text("Load this preset, overwriting only the settings it was saved with").clicked() {
                                load_name = Some(name.clone());
                            }
                            if chip(ui, t, "Delete", None, Some(&format!("Delete {name}")), true).on_hover_text("Permanently remove this preset").clicked() {
                                del_name = Some(name.clone());
                            }
                        });
                    });
                });
                if let Some(name) = load_name {
                    tab.preset_error.clear();
                    tab.ask(cx, Command::LoadPreset { preset: name.clone() }, Req::LoadPreset(name));
                }
                if let Some(name) = del_name {
                    tab.pending_delete = Some(name);
                }
            }
        }
    }
    preset_confirm(tab, ui, cx);
}

// ---------------------------------------------------------------- UI Theme

const GROUND_TIP: &str = "Dark variants: amoled = pure black (OLED), deepblue = blue-tinted, terminal = green-on-black";
const FONT_TIP: &str = "Monospace font used across the UI. \"auto\" keeps the built-in stack (JetBrains Mono / Fira Code / Cascadia Mono / Consolas); type an installed font name to force it";
const STYLE_TIP: &str = "How cards with variants draw their settings: timeline = a clip you drag, sentence = a sentence with fill-in words, tiles = big picture tiles. Every style changes the same settings";
const DEFAULT_STYLE: &str = "default";

fn rgb(c: [u8; crate::theme::RGB]) -> Color32 {
    Color32::from_rgb(c[0], c[1], c[2])
}

/// A small window in the chosen ground, the accent on its active parts (3.5 `Preview`), drawn
/// on the mock's 120 x 70 grid.
fn preview_sized(ui: &mut egui::Ui, ground: &str, accent: Color32, size: Vec2) {
    let look = GROUND_LOOK.iter().find(|(g, _)| *g == ground).unwrap_or(&GROUND_LOOK[0]).1;
    let [page, card, ink] = look.map(|h| parse_hex(h).map(rgb).unwrap_or(Color32::GRAY));
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    let p = ui.painter();
    let unit = rect.width() / VIEW_W;
    let at = |x: f32, y: f32, w: f32, h: f32| Rect::from_min_size(rect.min + Vec2::new(x, y) * unit, Vec2::new(w, h) * unit);
    let r = |h: f32| h * unit / 2.0;
    p.rect_filled(rect, r(VIEW_CORNER), page);
    for (x, y, w, h, color) in PREVIEW_PARTS.iter().map(|&(x, y, w, h, part)| (x, y, w, h, match part {
        Part::Card => card,
        Part::Accent => accent,
        Part::Ink(alpha) => ink.gamma_multiply(alpha),
    })) {
        p.rect_filled(at(x, y, w, h), r(h.min(VIEW_CORNER)), color);
    }
}

fn preview(ui: &mut egui::Ui, ground: &str, accent: Color32) {
    preview_sized(ui, ground, accent, Vec2::from(THEME_PREVIEW));
}

const VIEW_W: f32 = 120.0;
const VIEW_CORNER: f32 = 7.0;
#[derive(Clone, Copy)]
enum Part { Card, Accent, Ink(f32) }
/// `UiThemeCard.tsx::Preview` rectangles (x, y, w, h, fill).
const PREVIEW_PARTS: [(f32, f32, f32, f32, Part); 13] = [
    (6.0, 6.0, 108.0, 9.0, Part::Card),
    (10.0, 9.0, 16.0, 3.0, Part::Accent),
    (30.0, 9.0, 12.0, 3.0, Part::Ink(0.35)),
    (6.0, 20.0, 52.0, 44.0, Part::Card),
    (62.0, 20.0, 52.0, 44.0, Part::Card),
    (11.0, 26.0, 30.0, 3.0, Part::Ink(0.7)),
    (11.0, 34.0, 20.0, 8.0, Part::Accent),
    (34.0, 34.0, 18.0, 8.0, Part::Ink(0.15)),
    (11.0, 48.0, 40.0, 4.0, Part::Ink(0.15)),
    (11.0, 48.0, 24.0, 4.0, Part::Accent),
    (67.0, 26.0, 26.0, 3.0, Part::Ink(0.7)),
    (100.0, 24.0, 8.0, 8.0, Part::Accent),
    (67.0, 36.0, 42.0, 22.0, Part::Ink(0.08)),
];

fn style_controls(ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let raw = text_of(cx, "ui_card_style");
    let global = if CARD_STYLES.contains(&raw.as_str()) { raw } else { CARD_STYLES[0].to_string() };
    if let Some(s) = segmented(ui, t, "Card style", &CARD_STYLES, &global, STYLE_TIP, cx.always_tips) {
        cx.link.set(cx.now, "ui_card_style", json!(s));
    }
    let overrides = cx.link.get("ui_card_style_overrides").and_then(Value::as_object).cloned().unwrap_or_default();
    let mut next = overrides.clone();
    // Open like 3.5: it is how a user leaves a style, it must never be hidden.
    egui::CollapsingHeader::new(egui::RichText::new("Per-card style").font(regular(FONT_BODY)).color(t.muted)).id_salt("per-card-style").default_open(true).show(ui, |ui| {
        egui::Grid::new("per-card-style-grid").num_columns(STYLE_PAIRS_PER_ROW * 2).show(ui, |ui| {
            for (k, &(id, title)) in STYLED_CARDS.iter().enumerate() {
                let l = ui.label(egui::RichText::new(title).font(regular(FONT_SMALL)).color(t.txt));
                let own = overrides.get(id).and_then(Value::as_str).filter(|s| CARD_STYLES.contains(s)).unwrap_or(DEFAULT_STYLE).to_string();
                let shown = if own == DEFAULT_STYLE { format!("Default: {global}") } else { own.clone() };
                let mut pick = own.clone();
                egui::ComboBox::from_id_salt(("card-style", id)).selected_text(shown).show_ui(ui, |ui| {
                    ui.selectable_value(&mut pick, DEFAULT_STYLE.to_string(), format!("Default: {global}"));
                    for s in CARD_STYLES {
                        ui.selectable_value(&mut pick, s.to_string(), s);
                    }
                }).response.labelled_by(l.id).on_hover_text(format!("How the {title} card draws its settings. Default follows Card style above"));
                if pick != own {
                    if pick == DEFAULT_STYLE {
                        next.remove(id);
                    } else {
                        next.insert(id.to_string(), json!(pick));
                    }
                }
                if (k + 1) % STYLE_PAIRS_PER_ROW == 0 {
                    ui.end_row();
                }
            }
        });
    });
    if next != overrides {
        cx.link.set(cx.now, "ui_card_style_overrides", Value::Object(next));
    }
}

pub fn ui_theme(ui: &mut egui::Ui, cx: &mut CardCx) {
    style_controls(ui, cx);
    gap(ui);
    let t = cx.theme;
    let accent_raw = text_of(cx, "theme_accent");
    let accent = resolve_accent(&accent_raw).unwrap_or_else(crate::theme::default_accent);
    let ground_raw = text_of(cx, "theme_bg");
    let grounds: Vec<&str> = GROUNDS.iter().map(|g| g.ground).collect();
    let ground = if grounds.contains(&ground_raw.as_str()) { ground_raw } else { grounds[0].to_string() };
    let accent_name = ACCENT_PRESETS.iter().find(|(_, hex)| *hex == accent_raw).map(|(n, _)| *n).unwrap_or(&accent_raw);
    let draw_swatches = |ui: &mut egui::Ui, cx: &mut CardCx| {
        ui.horizontal_wrapped(|ui| {
            for (name, hex) in ACCENT_PRESETS {
                let c = parse_hex(hex).unwrap_or(accent);
                let selected = c == accent;
                let word = ui.painter().layout_no_wrap(name.to_uppercase(), semibold(FONT_SWATCH), Color32::WHITE);
                let size = Vec2::new(word.size().x + ACCENT_SWATCH, ACCENT_SWATCH);
                let (rect, r) = ui.allocate_exact_size(size, Sense::click());
                r.widget_info(|| egui::WidgetInfo::selected(egui::Role::RadioButton, true, selected, format!("{name} accent")));
                let corner = crate::CORNER_SMALL as f32 / 2.0;
                ui.painter().rect_filled(rect, corner, rgb(c));
                if selected || r.hovered() {
                    ui.painter().rect_stroke(rect.expand(1.0), corner, Stroke::new(2.0, t.txt), StrokeKind::Outside);
                }
                ui.painter().galley(rect.center() - word.size() / 2.0, word, Color32::WHITE);
                if r.on_hover_text(format!("Select {name} accent ({hex})")).clicked() {
                    cx.link.set(cx.now, "theme_accent", json!(hex));
                }
            }
            let mut custom = accent;
            let r = egui::color_picker::color_edit_button_srgb(ui, &mut custom).on_hover_text("Pick a custom hex accent color");
            r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, "Custom accent"));
            if custom != accent {
                cx.link.set(cx.now, "theme_accent", json!(format!("#{:02X}{:02X}{:02X}", custom[0], custom[1], custom[2])));
            }
        });
    };
    match style_of(cx, "ui-theme") {
        CardStyle::Timeline => {
            ui.horizontal(|ui| {
                preview(ui, &ground, rgb(accent));
                ui.vertical(|ui| {
                    ui.label(egui::RichText::new("Accent").font(regular(FONT_BODY)).color(t.muted));
                    draw_swatches(ui, cx);
                    mark(ui, "theme_accent");
                    if let Some(g) = segmented(ui, t, "Mode", &grounds, &ground, GROUND_TIP, cx.always_tips) {
                        cx.link.set(cx.now, "theme_bg", json!(g));
                    }
                    mark(ui, "theme_bg");
                });
            });
            gap(ui);
            text_box(ui, cx, "ui_font_family", "Font family", "auto", FONT_TIP, false);
        }
        CardStyle::Sentence => {
            let g_opts: Vec<(&str, &str, &str)> = grounds.iter().map(|g| (*g, *g, "")).collect();
            prose_line(ui, |ui| {
                prose_word(ui, t, "Paint the interface on a");
                choice_word(ui, cx, "theme_bg", "Mode", &g_opts, grounds[0], true, GROUND_TIP);
                prose_word(ui, t, "ground with a");
                mark(ui, "theme_accent");
                choice_token(ui, t, "theme_accent", accent_name, "Accent", false, "Accent color", true, |ui, close| {
                    ui.horizontal_wrapped(|ui| {
                        for (name, hex) in ACCENT_PRESETS {
                            if let Some(c) = parse_hex(hex) {
                                let _ = c;
                                if chip(ui, t, name, Some(*hex == accent_raw), Some(name), true).clicked() {
                                    cx.link.set(cx.now, "theme_accent", json!(hex));
                                    *close = true;
                                }
                            }
                        }
                    });
                    let mut custom = accent;
                    if egui::color_picker::color_edit_button_srgb(ui, &mut custom).changed() {
                        cx.link.set(cx.now, "theme_accent", json!(format!("#{:02X}{:02X}{:02X}", custom[0], custom[1], custom[2])));
                    }
                });
                prose_word(ui, t, "accent, set in");
                text_word(ui, cx, "ui_font_family", "Font family", "auto", false, false, false, FONT_TIP);
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            tile_grid(ui, GROUND_TILE_MIN_W, grounds.len(), |ui, idx, w| {
                let g = grounds[idx];
                let on = g == ground;
                let h = GROUND_PREVIEW_H + FONT_BODY + TILE_PAD * 2.0;
                let (rect, resp) = ui.allocate_exact_size(vec2(w, h), Sense::click());
                resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::RadioButton, true, on, format!("Mode: {g}")));
                let fill = if on { mix(t.accent, t.solid, PATH_TILE_TINT_PCT) } else { t.solid };
                let edge = if on || resp.hovered() { t.accent } else { t.hair };
                ui.painter().rect(rect, TILE_RADIUS, fill, Stroke::new(if on { 2.0 } else { 1.0 }, edge), StrokeKind::Inside);
                let mut child = ui.new_child(egui::UiBuilder::new().max_rect(rect.shrink(TILE_PAD)));
                child.vertical_centered(|ui| {
                    preview_sized(ui, g, rgb(accent), Vec2::from(THEME_PREVIEW_TILE));
                    ui.label(egui::RichText::new(g).font(semibold(FONT_BODY)).color(if on { t.accent } else { t.txt }));
                });
                if resp.on_hover_text(GROUND_TIP).clicked() {
                    cx.link.set(cx.now, "theme_bg", json!(g));
                }
            });
            mark(ui, "theme_bg");
            gap(ui);
            draw_swatches(ui, cx);
            mark(ui, "theme_accent");
            gap(ui);
            text_box(ui, cx, "ui_font_family", "Font family", "auto", FONT_TIP, false);
        }
    }
}

// ---------------------------------------------------------------- UI Layout

fn default_of(key: &str) -> f64 {
    csdm_core::settings::def(key).and_then(|d| d.default.as_f64()).unwrap_or_default()
}

/// 3.5 `clampLayout`: a value that is not a number takes the default.
pub fn clamp_layout(w: f64, h: f64, split: f64) -> (i64, i64, i64) {
    let pick = |v: f64, key: &str| if v.is_finite() && v.round() != 0.0 { v.round() } else { default_of(key) };
    let w = pick(w, "ui_window_w").clamp(LAYOUT_WIDTH_RANGE[0], LAYOUT_WIDTH_RANGE[1]);
    let h = pick(h, "ui_window_h").clamp(LAYOUT_HEIGHT_RANGE[0], LAYOUT_HEIGHT_RANGE[1]);
    let s = if split.is_finite() { split.round() } else { SPLIT_PCT_DEFAULT }.clamp(SPLIT_PCT_MIN, SPLIT_PCT_MAX);
    (w as i64, h as i64, s as i64)
}

fn resize(ui: &egui::Ui, cx: &mut CardCx, w: f64, h: f64, split: f64) {
    let (w, h, s) = clamp_layout(w, h, split);
    cx.link.set(cx.now, "ui_window_w", json!(w));
    cx.link.set(cx.now, "ui_window_h", json!(h));
    cx.link.set(cx.now, "ui_split_pct", json!(s));
    ui.ctx().send_viewport_cmd(egui::ViewportCommand::InnerSize(Vec2::new(w as f32, h as f32)));
}

/// The window to scale, the split as a bar to drag (3.5 `WindowDrawing`).
fn window_drawing(ui: &mut egui::Ui, cx: &mut CardCx, w: f64, h: f64, split: f64) {
    let t = cx.theme;
    let height = LAYOUT_DRAWING_HEIGHT;
    let width = (height * (w.max(1.0) / h.max(1.0)) as f32).min(ui.available_width());
    let (rect, _) = ui.allocate_exact_size(Vec2::new(width, height), Sense::hover());
    let pct = split.clamp(SPLIT_PCT_MIN, SPLIT_PCT_MAX);
    let cut = rect.left() + rect.width() * (pct / PCT) as f32;
    let p = ui.painter();
    p.rect(rect, crate::CORNER_SMALL as f32, t.surface2, Stroke::new(1.0, t.hair), StrokeKind::Inside);
    let video = Rect::from_min_max(rect.min, egui::pos2(cut, rect.bottom()));
    p.rect_filled(video.shrink(2.0), crate::CORNER_SMALL as f32, t.accent_soft);
    p.text(video.center(), egui::Align2::CENTER_CENTER, format!("video · {pct}%"), regular(FONT_SMALL), t.muted);
    let cards = Rect::from_min_max(egui::pos2(cut, rect.top()), rect.max);
    p.text(cards.center(), egui::Align2::CENTER_CENTER, format!("settings · {}%", PCT - pct), regular(FONT_SMALL), t.muted);
    let bar = Rect::from_center_size(egui::pos2(cut, rect.center().y), Vec2::new(SETTINGS_ROW_GAP, height));
    let r = ui.interact(bar, ui.scope_id().with("split-bar"), Sense::drag());
    r.widget_info(|| egui::WidgetInfo::slider(true, pct, "Split %"));
    ui.painter().rect_filled(Rect::from_center_size(bar.center(), Vec2::new(2.0, height)), 1.0, if r.hovered() || r.dragged() { t.accent } else { t.hair2 });
    if r.hovered() || r.dragged() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::ResizeHorizontal);
    }
    let r = r.on_hover_text("Width split between the left video panel and right settings panel, as a percentage. Drag it");
    if r.dragged() {
        if let Some(x) = r.interact_pointer_pos().map(|q| q.x) {
            let v = (((x - rect.left()) / rect.width()) as f64 * PCT).round().clamp(SPLIT_PCT_MIN, SPLIT_PCT_MAX);
            cx.link.set(cx.now, "ui_split_pct", json!(v as i64));
        }
    }
}

pub fn ui_layout(ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let (dw, dh) = (default_of("ui_window_w"), default_of("ui_window_h"));
    let ds = default_of("ui_split_pct");
    let (w, h, split) = (num_of(cx, "ui_window_w", dw), num_of(cx, "ui_window_h", dh), num_of(cx, "ui_split_pct", SPLIT_PCT_DEFAULT));
    let [lo, hi, step, fallback] = BLOCK_SLIDER;
    let (w_lo, w_hi) = (LAYOUT_WIDTH_RANGE[0], LAYOUT_WIDTH_RANGE[1]);
    let (h_lo, h_hi) = (LAYOUT_HEIGHT_RANGE[0], LAYOUT_HEIGHT_RANGE[1]);
    match style_of(cx, "ui-layout") {
        CardStyle::Timeline => {
            number_box(ui, cx, "ui_window_w", "Window width", dw, &format!("Width of the application window in pixels (default {dw})"));
            number_box(ui, cx, "ui_window_h", "Window height", dh, &format!("Height of the application window in pixels (default {dh})"));
            number_box(ui, cx, "ui_split_pct", "Split %", SPLIT_PCT_DEFAULT, "Width split between the left video panel and right settings panel, as a percentage");
            window_drawing(ui, cx, w, h, split);
            gap(ui);
            ui.horizontal_wrapped(|ui| {
                if action(ui, t, "Apply", "Resizes the live window to the width/height/split values typed above", true) {
                    resize(ui, cx, w, h, split);
                }
                if action(ui, t, "Auto", "Sizes the window automatically from your screen resolution (~86% width, 84% height)", true) {
                    let screen = ui.ctx().input(|i| i.viewport().monitor_size).map(|s| [s.x as f64, s.y as f64]).unwrap_or(LAYOUT_AUTO_FALLBACK_SCREEN);
                    resize(ui, cx, (screen[0] * LAYOUT_AUTO_SCREEN[0]).round(), (screen[1] * LAYOUT_AUTO_SCREEN[1]).round(), SPLIT_PCT_DEFAULT);
                }
                if action(ui, t, "Reset default", "Resets window size and split to the app's built-in defaults", true) {
                    resize(ui, cx, dw, dh, ds);
                }
                if action(ui, t, "Reset card layout", "Resets every tab's card positions to the default arrangement -- does not affect window size", true) {
                    cx.reset_cards = true;
                }
            });
            gap(ui);
            switch(ui, cx, "ui_remember_layout", "Remember current layout", "Automatically saves window size and pane split whenever they change, without pressing Apply");
            switch(ui, cx, "ui_always_show_tooltips", "Always show tooltips", "Keep tooltips and explanation hints constantly visible under controls instead of only on hover");
            gap(ui);
            slider(ui, cx, "ui_card_block_size", "Card grid size", [lo, hi], step, fallback as f64, "px", "Width of one grid column, in pixels -- decides how finely cards can be resized and repositioned");
        }
        CardStyle::Sentence => {
            prose_line(ui, |ui| {
                prose_word(ui, t, "Size the window to");
                number_token(ui, cx, "ui_window_w", "Window width", "px", [w_lo, w_hi], LAYOUT_SLIDER_STEP, 0, dw, false, "Width of the application window in pixels", &[]);
                prose_word(ui, t, "×");
                number_token(ui, cx, "ui_window_h", "Window height", "px", [h_lo, h_hi], LAYOUT_SLIDER_STEP, 0, dh, false, "Height of the application window in pixels", &[]);
                prose_word(ui, t, "with a");
                number_token(ui, cx, "ui_split_pct", "Split %", "%", [SPLIT_PCT_MIN, SPLIT_PCT_MAX], LAYOUT_SLIDER_STEP, 0, SPLIT_PCT_DEFAULT, false, "Width split between the left video panel and right settings panel, as a percentage", &[]);
                prose_word(ui, t, "split (");
                if action_word(ui, t, "Apply", "Apply", false, false, "Resizes the live window to the width/height/split values typed above", true) {
                    resize(ui, cx, w, h, split);
                }
                prose_word(ui, t, "·");
                if action_word(ui, t, "Auto", "Auto", false, false, "Sizes the window automatically from your screen resolution (~86% width, 84% height)", true) {
                    let screen = ui.ctx().input(|i| i.viewport().monitor_size).map(|s| [s.x as f64, s.y as f64]).unwrap_or(LAYOUT_AUTO_FALLBACK_SCREEN);
                    resize(ui, cx, (screen[0] * LAYOUT_AUTO_SCREEN[0]).round(), (screen[1] * LAYOUT_AUTO_SCREEN[1]).round(), SPLIT_PCT_DEFAULT);
                }
                prose_word(ui, t, "·");
                if action_word(ui, t, "Reset default", "Reset default", false, false, "Resets window size and split to the app's built-in defaults", true) {
                    resize(ui, cx, dw, dh, ds);
                }
                prose_word(ui, t, ").");
            });
            prose_line(ui, |ui| {
                bool_word(ui, cx, "ui_remember_layout", "Remember current layout", "Remember layout changes automatically", "Only save layout on Apply", false, "Automatically saves window size and pane split whenever they change, without pressing Apply");
                prose_word(ui, t, "·");
                bool_word(ui, cx, "ui_always_show_tooltips", "Always show tooltips", "Always show tooltips", "Show tooltips on hover", false, "Keep tooltips and explanation hints constantly visible under controls instead of only on hover");
                prose_word(ui, t, "· grid block");
                number_token(ui, cx, "ui_card_block_size", "Card grid size", "px", [lo as f64, hi as f64], step as f64, 0, fallback as f64, false, "Width of one grid column, in pixels -- decides how finely cards can be resized and repositioned", &[]);
                prose_word(ui, t, "·");
                if action_word(ui, t, "Reset card layout", "Reset card layout", false, false, "Resets every tab's card positions to the default arrangement -- does not affect window size", true) {
                    cx.reset_cards = true;
                }
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            window_drawing(ui, cx, w, h, split);
            gap(ui);
            tile_grid(ui, TILE_MIN_W, 4, |ui, idx, tw| match idx { // allow-hardcode: four layout metric tiles
                0 => count_tile(ui, cx, "ui_window_w", "Window width", "px", [w_lo, w_hi], LAYOUT_SLIDER_STEP, 0, None, "Pixels wide", "Width of the application window in pixels", tw, |p, r, c| paint_glyph(p, r, TileGlyph::Icon("uiLayout"), c)),
                1 => count_tile(ui, cx, "ui_window_h", "Window height", "px", [h_lo, h_hi], LAYOUT_SLIDER_STEP, 0, None, "Pixels tall", "Height of the application window in pixels", tw, |p, r, c| paint_glyph(p, r, TileGlyph::Icon("uiLayout"), c)),
                2 => count_tile(ui, cx, "ui_split_pct", "Split %", "%", [SPLIT_PCT_MIN, SPLIT_PCT_MAX], LAYOUT_SLIDER_STEP, 0, None, "Left/right share", "Width split between the left video panel and right settings panel", tw, |p, r, c| paint_glyph(p, r, TileGlyph::Icon("operations"), c)),
                _ => count_tile(ui, cx, "ui_card_block_size", "Card grid size", "px", [lo as f64, hi as f64], step as f64, 0, None, "Grid block", "Width of one grid column, in pixels", tw, |p, r, c| paint_glyph(p, r, TileGlyph::Icon("tagGrid"), c)),
            });
            gap(ui);
            ui.horizontal_wrapped(|ui| {
                if action(ui, t, "Apply", "Resizes the live window to the width/height/split values typed above", true) {
                    resize(ui, cx, w, h, split);
                }
                if action(ui, t, "Auto", "Sizes the window automatically from your screen resolution (~86% width, 84% height)", true) {
                    let screen = ui.ctx().input(|i| i.viewport().monitor_size).map(|s| [s.x as f64, s.y as f64]).unwrap_or(LAYOUT_AUTO_FALLBACK_SCREEN);
                    resize(ui, cx, (screen[0] * LAYOUT_AUTO_SCREEN[0]).round(), (screen[1] * LAYOUT_AUTO_SCREEN[1]).round(), SPLIT_PCT_DEFAULT);
                }
                if action(ui, t, "Reset default", "Resets window size and split to the app's built-in defaults", true) {
                    resize(ui, cx, dw, dh, ds);
                }
                if action(ui, t, "Reset card layout", "Resets every tab's card positions to the default arrangement -- does not affect window size", true) {
                    cx.reset_cards = true;
                }
            });
            gap(ui);
            switch(ui, cx, "ui_remember_layout", "Remember current layout", "Automatically saves window size and pane split whenever they change, without pressing Apply");
            switch(ui, cx, "ui_always_show_tooltips", "Always show tooltips", "Keep tooltips and explanation hints constantly visible under controls instead of only on hover");
        }
    }
}

// ---------------------------------------------------------------- Performance

const PERF_TIP: &str = "Number of parallel threads used to pre-parse demo files with demoparser2 (TROIS SHOT / ONE TAP / TROIS TAP filters). Higher = faster pre-parse on multi-core CPUs. Set to 1 to disable.";

fn paint_cpu(p: &egui::Painter, rect: Rect, color: Color32) {
    let s = Stroke::new(PERF_CPU_STROKE, color);
    let inner = rect.shrink(rect.width() * PERF_CPU_INSET);
    p.rect_stroke(inner, 2.0, s, StrokeKind::Middle);
    for k in PERF_CPU_PINS {
        let x = rect.left() + rect.width() * k;
        let y = rect.top() + rect.height() * k;
        let pin = rect.width() * PERF_CPU_PIN;
        p.line_segment([pos2(x, inner.top() - pin), pos2(x, inner.top())], s);
        p.line_segment([pos2(x, inner.bottom()), pos2(x, inner.bottom() + pin)], s);
        p.line_segment([pos2(inner.left() - pin, y), pos2(inner.left(), y)], s);
        p.line_segment([pos2(inner.right(), y), pos2(inner.right() + pin, y)], s);
    }
}

pub fn performance(ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let [lo, hi, fallback] = DP2_THREADS_CHOICES;
    let count = (hi - lo + 1) as usize;
    let value = (num_of(cx, "dp2_threads", fallback as f64).round() as i64).clamp(lo, hi);
    mark(ui, "dp2_threads");
    match style_of(cx, "performance") {
        CardStyle::Timeline | CardStyle::Tiles => {
            let style = style_of(cx, "performance");
            let mut picked = None;
            let mut draw_tile = |ui: &mut egui::Ui, n: i64, tile_w: f32| {
                let (rect, r) = ui.allocate_exact_size(vec2(tile_w, PERF_TILE_H), Sense::click());
                let name = if n == 1 { "1 thread".to_string() } else { format!("{n} threads") };
                r.widget_info(|| egui::WidgetInfo::selected(egui::Role::RadioButton, true, n == value, &name));
                let lit = n <= value;
                let (fill, ink) = if lit { (mix(t.accent, t.solid, PERF_TILE_TINT_PCT), t.accent) } else { (t.solid, t.faint) };
                let edge = if r.hovered() { t.accent } else if lit { t.accent.gamma_multiply(PERF_TILE_EDGE_ALPHA) } else { t.hair };
                let p = ui.painter();
                p.rect(rect, PERF_TILE_RADIUS, fill, Stroke::new(1.0, edge), StrokeKind::Inside);
                let cpu = Rect::from_center_size(pos2(rect.center().x, rect.top() + PERF_TILE_H * PERF_CPU_INSET + 2.0), Vec2::splat(PERF_CPU_SIZE));
                paint_cpu(p, cpu, ink);
                p.text(pos2(rect.center().x, rect.bottom() - FONT_SMALL / 2.0 - PERF_TILE_GAP), egui::Align2::CENTER_CENTER, n.to_string(), semibold(FONT_SMALL), ink);
                if r.on_hover_text(PERF_TIP).clicked() {
                    picked = Some(n);
                }
            };
            if style == CardStyle::Tiles {
                tile_grid(ui, THREAD_TILE_MIN_W, count, |ui, idx, tile_w| draw_tile(ui, lo + idx as i64, tile_w));
            } else {
                let tile_w = ((ui.available_width() - PERF_TILE_GAP * (count - 1) as f32) / count as f32).max(PERF_CPU_SIZE);
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = PERF_TILE_GAP;
                    for n in lo..=hi {
                        draw_tile(ui, n, tile_w);
                    }
                });
            }
            if let Some(n) = picked {
                cx.link.set(cx.now, "dp2_threads", json!(n));
            }
            let read = if value == 1 { "1 thread -- parallel pre-parse off".to_string() } else { format!("{value} threads in parallel") };
            ui.label(egui::RichText::new(read).font(semibold(FONT_BODY)).color(t.txt));
            hint(ui, t, PERF_TIP);
        }
        CardStyle::Sentence => {
            let opts: Vec<String> = (lo..=hi).map(|n| n.to_string()).collect();
            let tuples: Vec<(&str, &str, &str)> = opts.iter().map(|s| (s.as_str(), s.as_str(), "")).collect();
            let cur = value.to_string();
            let mut picked = None;
            prose_line(ui, |ui| {
                prose_word(ui, t, "Pre-parse demos across");
                choice_token(ui, t, "dp2_threads", &cur, "Demoparser2 threads", false, PERF_TIP, false, |ui, close| {
                    ui.label(egui::RichText::new("Demoparser2 threads").font(semibold(FONT_SMALL)).color(t.muted));
                    if let Some(next) = word_options(ui, t, &tuples, &cur) {
                        picked = next.parse::<i64>().ok();
                        *close = true;
                    }
                });
                prose_word(ui, t, if value == 1 { "CPU thread (parallel pre-parse off)." } else { "CPU threads in parallel." });
            });
            if let Some(n) = picked {
                cx.link.set(cx.now, "dp2_threads", json!(n));
            }
        }
    }
}

// ---------------------------------------------------------------- Header counts

/// 3.5 header `count`s: the card style, the window size, the thread count.
pub fn counts(cx: &CardCx) -> [Option<String>; HEADER_COUNTS] {
    let style = text_of(cx, "ui_card_style");
    let style = if CARD_STYLES.contains(&style.as_str()) { style } else { CARD_STYLES[0].to_string() };
    let (w, h) = (num_of(cx, "ui_window_w", default_of("ui_window_w")), num_of(cx, "ui_window_h", default_of("ui_window_h")));
    let threads = num_of(cx, "dp2_threads", DP2_THREADS_CHOICES[2] as f64);
    [Some(style), Some(format!("{w} by {h}")), Some(format!("{threads} threads"))]
}

// ---------------------------------------------------------------- Injection Preview

pub fn injection(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let busy = tab.waiting_for(&Req::Injection);
    let mut do_refresh = false;
    let style = style_of(cx, "injection-preview");
    if style == CardStyle::Sentence {
        prose_line(ui, |ui| {
            let status = match &tab.injection {
                None => "not built yet".to_string(),
                Some(Ok(lines)) if lines.is_empty() => "empty for these settings".to_string(),
                Some(Ok(lines)) => format!("{} lines ready", lines.len()),
                Some(Err(e)) => format!("error: {e}"),
            };
            prose_word(ui, t, "CS2 injected arguments:");
            prose_muted(ui, t, &status);
            prose_word(ui, t, "—");
            if action_word(ui, t, "Refresh preview", "⟳ Refresh", false, false, "Builds the preview from the current settings", !busy) {
                do_refresh = true;
            }
            prose_word(ui, t, ".");
        });
    } else {
        hint(ui, t, "Live preview of the args injected into CS2 for the current configuration.");
    }
    match &tab.injection {
        None if style != CardStyle::Sentence => {
            ui.label(egui::RichText::new("Press Refresh to build it from the current settings.").font(regular(FONT_SMALL)).color(t.faint));
        }
        None => {}
        Some(Ok(lines)) if lines.is_empty() && style != CardStyle::Sentence => {
            ui.label(egui::RichText::new("Nothing is injected with these settings.").font(regular(FONT_SMALL)).color(t.faint));
        }
        Some(Ok(lines)) if lines.is_empty() => {}
        Some(Ok(lines)) => {
            egui::Frame::new().fill(t.surface2).corner_radius(egui::CornerRadius::same(crate::CORNER_SMALL)).inner_margin(egui::Margin::same(crate::ASK_PAD)).show(ui, |ui| {
                for (text, kind) in lines {
                    let color = match kind.as_str() {
                        "head" | "header" => t.accent,
                        "dim" | "comment" => t.faint,
                        _ => t.txt,
                    };
                    ui.add(egui::Label::new(egui::RichText::new(text).font(mono(FONT_SMALL)).color(color)).wrap());
                }
            });
        }
        Some(Err(e)) => status_line(ui, e, t.rose),
    }
    if style != CardStyle::Sentence && action(ui, t, "⟳ Refresh", "Builds the preview from the current settings", !busy) {
        do_refresh = true;
    }
    if do_refresh {
        let cfg = cx.link.settings.clone();
        tab.ask(cx, Command::InjectionPreview { cfg }, Req::Injection);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories_toggle_like_35() {
        let mut c = vec![];
        toggle_category(&mut c, "players");
        toggle_category(&mut c, "date");
        assert_eq!(c, ["players", "date"]);
        toggle_category(&mut c, FULL);
        assert_eq!(c, [FULL]);
        toggle_category(&mut c, "timing");
        assert_eq!(c, ["timing"]);
        toggle_category(&mut c, "timing");
        assert!(c.is_empty());
        assert_eq!(category_label("output_name"), "Output Name");
        assert_eq!(category_label(FULL), "Full config");
    }

    #[test]
    fn layout_clamps_like_35() {
        assert_eq!(clamp_layout(500.0, 5000.0, 99.0), (1000, 2160, 80));
        assert_eq!(clamp_layout(f64::NAN, 0.0, 10.0), (1600, 900, 38));
        assert_eq!(clamp_layout(1280.4, 720.6, 55.5), (1280, 721, 56));
    }
}
