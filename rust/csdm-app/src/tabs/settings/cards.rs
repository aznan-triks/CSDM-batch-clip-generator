//! The eight SETTINGS cards, `timeline` style (3.5 `settingsCards/*.tsx` `TimelineView`,
//! `PresetSection.tsx` `TimelineView`). Words and tips are 3.5's.

use super::controls::{action, bool_of, hint, kick, num_of, number_box, path_box, segmented, slider, switch, text_box, text_box_w, text_of, PickKind};
use super::{PendingSwitch, PgState, Req, SettingsTab};
use crate::controls::{link_arrow, mix, node, NodeIcon, LINK_W};
use crate::grid::CardCx;
use crate::paint::{mono, regular, semibold};
use crate::theme::{parse_hex, resolve_accent, Theme};
use crate::widgets::{chip, confirm_dialog, tip, Confirm};
use csdm_core::theme_v12::{ACCENT_PRESETS, GROUNDS};
use csdm_core::ui_values::{
    ACCENT_SWATCH, BLOCK_SLIDER, CARD_STYLES, DP2_THREADS_CHOICES, FONT_BODY, FONT_SMALL, FONT_SWATCH, GROUND_LOOK, LAYOUT_AUTO_FALLBACK_SCREEN, LAYOUT_AUTO_SCREEN, LAYOUT_DRAWING_HEIGHT, LAYOUT_HEIGHT_RANGE,
    LAYOUT_WIDTH_RANGE, SETTINGS_ROW_GAP, SPLIT_PCT_DEFAULT, SPLIT_PCT_MAX, SPLIT_PCT_MIN, STYLED_CARDS, THEME_PREVIEW,
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
/// Header counts: UI Theme, UI Layout, Performance.
pub const HEADER_COUNTS: usize = 3;
/// Words shown in empty boxes and examples (3.5's), never used as addresses or paths.
const HOST_HINT: &str = "localhost";
const CS2_CFG_HINT: &str = "Optional override (…\\Counter-Strike Global Offensive\\game\\csgo\\cfg)";
const SUBFOLDER_EXAMPLE: [&str; 2] = ["…\\clips\\<demo>\\clip.mp4", "…\\clips\\clip.mp4"];
/// Per-card style: (title, choice) pairs per row, as 3.5's grid.
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

pub fn postgres(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    // 3.5.1 `.st-chain`: You -> Server -> Database as white sub-cards linked by dashed arrows,
    // columns 1fr 28px 1fr 28px 0.8fr; Database stretches to You/Server's natural height.
    let state = tab.pg_state;
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
    let busy = tab.pg_state == PgState::Busy;
    ui.horizontal(|ui| {
        if action(ui, t, "Test & Reload", "Tests the PostgreSQL connection and reloads players/tables from the database", !busy) {
            // The values being typed, before they are saved (3.5 B1).
            let pg: csdm_core::Settings = ["pg_host", "pg_port", "pg_user", "pg_pass", "pg_db"].iter().map(|k| (k.to_string(), json!(text_of(cx, k)))).collect();
            tab.pg_status = "Connecting…".into();
            tab.pg_state = PgState::Busy;
            tab.ask(cx, Command::ConnectDb { pg: Some(pg) }, Req::Connect);
        }
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
    });
}

// ---------------------------------------------------------------- Paths

pub fn paths(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let exe_hint = match &tab.default_csdm_exe {
        Some(p) => format!("Empty = auto-detected: {p}"),
        None if tab.waiting_for(&Req::Describe) => "csdm.CMD or csdm.exe".into(),
        None => "Not found automatically: Browse to CS Demo Manager's csdm.CMD".into(),
    };
    let clips_hint = match &tab.default_clips_dir {
        Some(p) => format!("Empty = {p} (a subfolder per demo is created inside)"),
        None => "A subfolder per demo is created here".into(),
    };
    let pick = &mut tab.pick;
    // 3.5.1 Paths: a rail of the five steps on the left (icon tile, words, a line between the
    // tiles), each step's field on the right.
    let mut tiles: Vec<egui::Pos2> = Vec::new();
    let mut step = |ui: &mut egui::Ui, cx: &mut CardCx, icon: &'static str, words: &str, field: &mut dyn FnMut(&mut egui::Ui, &mut CardCx)| {
        ui.horizontal_top(|ui| {
            ui.allocate_ui_with_layout(Vec2::new(PATH_RAIL_W, 0.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
                ui.set_width(PATH_RAIL_W);
                let (r, _) = ui.allocate_exact_size(Vec2::splat(PATH_TILE), Sense::hover());
                ui.painter().rect_filled(r, PATH_TILE_RADIUS, crate::controls::mix(t.accent, t.solid, PATH_TILE_TINT_PCT));
                crate::icons::paint(ui.painter(), icon, Rect::from_center_size(r.center(), Vec2::splat(PATH_GLYPH)), t.accent);
                tiles.push(r.center());
                ui.add(egui::Label::new(egui::RichText::new(words).font(semibold(FONT_SMALL)).color(t.muted)).wrap());
            });
            ui.vertical(|ui| field(ui, cx));
        });
        gap(ui);
    };
    step(ui, cx, "capture", "Records", &mut |ui, cx| path_box(ui, cx, pick, "csdm_exe", "CSDM Executable", &exe_hint, "CS Demo Manager's csdm.CMD (or csdm.exe), which records the clips", PickKind::File));
    step(ui, cx, "editing", "Injects commands", &mut |ui, cx| path_box(ui, cx, pick, "cs2_cfg_dir", "CS2 cfg folder", CS2_CFG_HINT, "Where CSDM writes injected CS2 console commands before recording. Leave empty to auto-detect", PickKind::Folder));
    step(ui, cx, "video", "Writes raw clips", &mut |ui, cx| {
        path_box(ui, cx, pick, "output_dir_clips", "Raw clips folder", &clips_hint, "Where the recorded clips are written", PickKind::Folder);
        ui.horizontal(|ui| {
            switch(ui, cx, "subfolder_per_demo", "Subfolder per demo", "When on, each demo's clips go in their own subfolder instead of sharing the raw clips folder");
            let eg = if bool_of(cx, "subfolder_per_demo") { SUBFOLDER_EXAMPLE[0] } else { SUBFOLDER_EXAMPLE[1] };
            ui.label(egui::RichText::new(eg).font(mono(FONT_SMALL)).color(t.faint));
        });
    });
    step(ui, cx, "operations", "Joins them", &mut |ui, cx| path_box(ui, cx, pick, "output_dir_concat", "Concatenated clips folder", "Empty = same folder as raw clips", "Where the clips joined per demo are written", PickKind::Folder));
    step(ui, cx, "encoding", "Assembles the video", &mut |ui, cx| path_box(ui, cx, pick, "output_dir_assembled", "Assembled file folder", "Empty = same folder as raw clips", "Where the final assembled video is written", PickKind::Folder));
    // The rail's line, from each tile to the next.
    for w in tiles.windows(2) {
        ui.painter().line_segment([w[0] + Vec2::new(0.0, PATH_TILE / 2.0), w[1] - Vec2::new(0.0, PATH_TILE / 2.0)], Stroke::new(PATH_RAIL_STROKE, t.accent.gamma_multiply(PATH_RAIL_ALPHA)));
    }
}

// ---------------------------------------------------------------- Configuration Folder

/// (kind, label, `config_dir` value or `None` for a chosen folder, tip) — 3.5 `CHOICES`.
const LOCATIONS: [(&str, &str, Option<&str>, &str); 3] = [
    ("app", "App folder (portable)", Some(""), "Stores settings next to the app itself -- portable, travels with the folder (e.g. USB drive)"),
    ("appdata", "User Local AppData", Some("appdata"), "Stores settings in Windows' per-user AppData folder -- survives moving/reinstalling the app"),
    ("custom", "Choose…", None, "Stores settings in a folder you pick"),
];

pub fn config_folder(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let kind = tab.folder.as_ref().and_then(|f| f["kind"].as_str()).unwrap_or_default().to_string();
    kick(ui, t, "Settings live in");
    let current = tab.folder.as_ref().and_then(|f| f["current"].as_str()).unwrap_or("…").to_string();
    ui.add(egui::Label::new(egui::RichText::new(&current).font(mono(FONT_SMALL)).color(t.txt)).wrap());
    gap(ui);
    kick(ui, t, "Copy to →");
    let mut chosen = None;
    ui.horizontal_wrapped(|ui| {
        for (k, label, value, tip_text) in LOCATIONS {
            let r = chip(ui, t, label, Some(kind == k), Some(label), tab.switch.is_none());
            if r.on_hover_text(tip_text).clicked() {
                chosen = Some((value, label));
            }
        }
    });
    if let Some((value, label)) = chosen {
        tab.folder_error.clear();
        let picked = match value {
            Some(v) => Some((v.to_string(), label.to_string())),
            None => (tab.pick)(PickKind::Folder).map(|p| (p, "Custom folder".to_string())),
        };
        if let Some((value, label)) = picked {
            tab.ask(cx, Command::ProbeConfigDir { target: Some(value.clone()) }, Req::SwitchProbe { value, label });
        }
    }
    hint(ui, t, "The four settings files (config, presets, players, assembly names) live in a \"CSDM-batch-clip_config\" subfolder of the selected location. Switching COPIES them there — the current files always stay in place.");
    status_line(ui, &tab.folder_error, t.rose);
    if let Some(p) = tab.switch.clone() {
        switch_confirm(tab, ui, cx, p);
    }
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

pub fn presets(tab: &mut SettingsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    kick(ui, t, "Save the current settings");
    ui.horizontal(|ui| {
        let l = ui.label(egui::RichText::new("Name").font(regular(FONT_BODY)).color(t.muted));
        let r = ui.add(egui::TextEdit::singleline(&mut tab.preset_name).hint_text("Preset name").desired_width(ui.available_width())).labelled_by(l.id);
        tip(ui, t, r, "Identifier name for this configuration preset", cx.always_tips);
    });
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
    ui.horizontal_wrapped(|ui| {
        if action(ui, t, "SAVE", "Save selected settings categories to this preset", true) {
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
        if !tab.preset_error.is_empty() {
            status_line(ui, &tab.preset_error, t.rose);
        } else {
            status_line(ui, &tab.preset_status, t.emerald);
        }
    });
    gap(ui);
    kick(ui, t, "Saved");
    if tab.presets.is_empty() {
        ui.label(egui::RichText::new("No saved presets.").font(regular(FONT_BODY)).color(t.faint));
    }
    let rows: Vec<(String, String)> = tab.presets.iter().map(|(n, p)| {
        let cats = p["cats"].as_array().map(|a| a.iter().filter_map(Value::as_str).map(category_label).collect::<Vec<_>>().join(", ")).unwrap_or_default();
        (n.clone(), cats)
    }).collect();
    for (name, cats) in rows {
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
fn preview(ui: &mut egui::Ui, ground: &str, accent: Color32) {
    let look = GROUND_LOOK.iter().find(|(g, _)| *g == ground).unwrap_or(&GROUND_LOOK[0]).1;
    let [page, card, ink] = look.map(|h| parse_hex(h).map(rgb).unwrap_or(Color32::GRAY));
    let (rect, _) = ui.allocate_exact_size(Vec2::from(THEME_PREVIEW), Sense::hover());
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
    ui.horizontal(|ui| {
        preview(ui, &ground, rgb(accent));
        ui.vertical(|ui| {
            ui.label(egui::RichText::new("Accent").font(regular(FONT_BODY)).color(t.muted));
            ui.horizontal_wrapped(|ui| {
                for (name, hex) in ACCENT_PRESETS {
                    let c = parse_hex(hex).unwrap_or(accent);
                    let selected = c == accent;
                    // 3.5 `.settings-swatch`: the colour with its name written on it.
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
            if let Some(g) = segmented(ui, t, "Mode", &grounds, &ground, GROUND_TIP, cx.always_tips) {
                cx.link.set(cx.now, "theme_bg", json!(g));
            }
        });
    });
    gap(ui);
    text_box(ui, cx, "ui_font_family", "Font family", "auto", FONT_TIP, false);
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
    number_box(ui, cx, "ui_window_w", "Window width", dw, &format!("Width of the application window in pixels (default {dw})"));
    number_box(ui, cx, "ui_window_h", "Window height", dh, &format!("Height of the application window in pixels (default {dh})"));
    number_box(ui, cx, "ui_split_pct", "Split %", SPLIT_PCT_DEFAULT, "Width split between the left video panel and right settings panel, as a percentage");
    let (w, h, split) = (num_of(cx, "ui_window_w", dw), num_of(cx, "ui_window_h", dh), num_of(cx, "ui_split_pct", SPLIT_PCT_DEFAULT));
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
            resize(ui, cx, dw, dh, default_of("ui_split_pct"));
        }
        if action(ui, t, "Reset card layout", "Resets every tab's card positions to the default arrangement -- does not affect window size", true) {
            cx.reset_cards = true;
        }
    });
    gap(ui);
    switch(ui, cx, "ui_remember_layout", "Remember current layout", "Automatically saves window size and pane split whenever they change, without pressing Apply");
    switch(ui, cx, "ui_always_show_tooltips", "Always show tooltips", "Keep tooltips and explanation hints constantly visible under controls instead of only on hover");
    gap(ui);
    let [lo, hi, step, fallback] = BLOCK_SLIDER;
    slider(ui, cx, "ui_card_block_size", "Card grid size", [lo, hi], step, fallback as f64, "px", "Width of one grid column, in pixels -- decides how finely cards can be resized and repositioned");
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
    let tile_w = ((ui.available_width() - PERF_TILE_GAP * (count - 1) as f32) / count as f32).max(PERF_CPU_SIZE);
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = PERF_TILE_GAP;
        for n in lo..=hi {
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
                cx.link.set(cx.now, "dp2_threads", json!(n));
            }
        }
    });
    let read = if value == 1 { "1 thread -- parallel pre-parse off".to_string() } else { format!("{value} threads in parallel") };
    ui.label(egui::RichText::new(read).font(semibold(FONT_BODY)).color(t.txt));
    hint(ui, t, PERF_TIP);
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
    hint(ui, t, "Live preview of the args injected into CS2 for the current configuration.");
    match &tab.injection {
        None => {
            ui.label(egui::RichText::new("Press Refresh to build it from the current settings.").font(regular(FONT_SMALL)).color(t.faint));
        }
        Some(Ok(lines)) if lines.is_empty() => {
            ui.label(egui::RichText::new("Nothing is injected with these settings.").font(regular(FONT_SMALL)).color(t.faint));
        }
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
    let busy = tab.waiting_for(&Req::Injection);
    if action(ui, t, "⟳ Refresh", "Builds the preview from the current settings", !busy) {
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
