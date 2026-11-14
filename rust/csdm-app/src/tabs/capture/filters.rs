//! Kill / Damage / Shot Filters, `timeline` style (3.5 `filterCards/KillViews.tsx` switchboard,
//! `cardstyle/FilterMatrix.tsx`, `FilterExtra.tsx`). Rows come from the registry
//! (`describe_filters`): which rows exist, their card (`applies_to`), group (`category`) and
//! extras. Nothing here names a filter except the kill extras 3.5 itself wrote by hand.

use super::kit::{as_text, button, default_of, flag, framed, hint, lab, mark, number_field, seg, text};
use super::model::{filter_rows, toggle_changes, Cell, FilterRow};
use super::CaptureTab;
use crate::grid::CardCx;
use crate::paint::{regular, semibold};
use crate::theme::Theme;
use csdm_core::ui_values::{CLUTCH_RUNG_HEIGHT, CLUTCH_SIZES, KILL_COUNT_OPTIONS};
use eframe::egui::{self, pos2, vec2, Rect, Sense, Stroke, StrokeKind};
use serde_json::{json, Value};

const SUICIDE_MODES: [&str; 3] = ["include", "exclude", "only"];
const HEADSHOT_MODES: [&str; 3] = ["all", "only", "exclude"];
const CLUTCH_MODES: [&str; 2] = ["kills_only", "full_clutch"];
/// The kill card's groups, in the window's order: (category, heading).
const GROUPS: [(&str, &str); 3] = [("mods", "Mods — none checked = all kills"), ("dp2", "demoparser2 modifiers"), ("db", "Situation (DB)")];
/// How the "also …" mention names each non-kill category a kill filter judges.
const ALSO: [(&str, &str); 3] = [("damage", "damage"), ("shot", "shots"), ("round", "rounds")];

const TIP_SUICIDES: &str = "Include, exclude, or capture only clips where a suicide occurred";
const TIP_HEADSHOTS: &str = "Headshot filter (all/only/exclude); disabled when One Tap or Trois Tap is on";
const TIP_CLEAR: &str = "Resets Enable/Must for every filter below, including Situation (DB), not just Mods/dp2";
const TIP_CLUTCH: &str = "Detects clutch situations: player is the last alive on their team";
const TIP_WINS: &str = "Only capture clutches the player's team went on to win";
const TIP_CLUTCH_MODE: &str = "Kills only = just the frags; Full clutch = whole round from the 1vX moment";
const TIP_CLUTCH_SIZE: &str = "Clutch size to capture: number of opponents alive when it started";
const TIP_ALSO: &str = "This filter also keeps or drops those events when they are captured (Event Type)";

/// `.cf-mrow` geometry: glyph column, cell size, gap.
const GLYPH_W: f32 = 24.0;
const CELL: [f32; 2] = [34.0, 26.0];
const CELL_GAP: f32 = 4.0;
const CELL_RADIUS: f32 = 7.0;
const ROW_H: f32 = 30.0;
const FONT_NAME: f32 = 12.0;
const FONT_HEAD: f32 = 9.5;
const FONT_TAG: f32 = 9.0;
const FIELD_W: f32 = 52.0;
const RUNG_W: f32 = 46.0;
const ROW_TINT: f32 = 0.08;
const HEAD_SPACING: f32 = 0.12;
const CELLS: f32 = 3.0;
const TAG_PAD: [f32; 2] = [4.0, 2.0];

/// One row's three cells, keyed by the row; returns the changes a click asked for.
fn matrix(ui: &mut egui::Ui, cx: &mut CardCx, heading: &str, rows: &[FilterRow], extras: &dyn Fn(&FilterRow, &CardCx) -> Vec<Extra>) {
    let t = cx.theme;
    if rows.is_empty() {
        return;
    }
    framed(ui, t, |ui| {
        let width = ui.available_width();
        let cells_w = CELL[0] * CELLS + CELL_GAP * (CELLS - 1.0);
        // Column names over the cells.
        let (head, _) = ui.allocate_exact_size(vec2(width, FONT_HEAD + CELL_GAP * 2.0), Sense::hover());
        let p = ui.painter();
        let hd = |s: &str| s.to_uppercase();
        p.text(head.left_center(), egui::Align2::LEFT_CENTER, hd(heading), semibold(FONT_HEAD), t.accent);
        for (i, c) in ["Keep", "Must", "Drop"].iter().enumerate() {
            let x = head.right() - cells_w + i as f32 * (CELL[0] + CELL_GAP) + CELL[0] / 2.0;
            p.text(pos2(x, head.center().y), egui::Align2::CENTER_CENTER, hd(c), semibold(FONT_HEAD), t.faint);
        }
        let _ = HEAD_SPACING;
        for row in rows {
            let enabled = flag(cx, &row.key, false);
            let required = flag(cx, &row.must_key(), false);
            let excluded = row.exclude && flag(cx, &row.exclude_key(), false);
            let (r, resp) = ui.allocate_exact_size(vec2(width, ROW_H), Sense::hover());
            let resp = resp.on_hover_text(row.full_tip());
            let _ = resp;
            let p = ui.painter();
            if enabled {
                p.rect_filled(r, CELL_RADIUS, t.lime.gamma_multiply(ROW_TINT * 2.0));
            } else if excluded {
                p.rect_filled(r, CELL_RADIUS, t.rose.gamma_multiply(ROW_TINT));
            }
            p.text(pos2(r.left() + GLYPH_W / 2.0, r.center().y), egui::Align2::CENTER_CENTER, &row.glyph, regular(FONT_NAME + 2.0), t.txt);
            let name_g = p.layout_no_wrap(row.name.clone(), semibold(FONT_NAME), t.txt);
            let mut x = r.left() + GLYPH_W + CELL_GAP;
            let nw = name_g.size().x;
            p.galley(pos2(x, r.center().y - name_g.size().y / 2.0), name_g, t.txt);
            x += nw + CELL_GAP * 2.0;
            if !row.untested.is_empty() {
                let g = p.layout_no_wrap("UNTESTED".into(), semibold(FONT_TAG), t.amber);
                let tr = Rect::from_min_size(pos2(x, r.center().y - g.size().y / 2.0 - TAG_PAD[1]), g.size() + vec2(TAG_PAD[0], TAG_PAD[1]) * 2.0);
                p.rect_stroke(tr, CELL_GAP, Stroke::new(1.0, t.amber), StrokeKind::Inside);
                p.galley(tr.min + vec2(TAG_PAD[0], TAG_PAD[1]), g, t.amber);
                ui.interact(tr, ui.scope_id().with(("untested", &row.key)), Sense::hover()).on_hover_text(&row.untested);
                x = tr.right() + CELL_GAP;
            }
            let also: Vec<&str> = ALSO.iter().filter(|(c, _)| row.applies_to.iter().any(|a| a == c) && row.judges("kill")).map(|(_, w)| *w).collect();
            if !also.is_empty() {
                let g = p.layout_no_wrap(format!("also {}", also.join(" + ")), regular(FONT_TAG), t.faint);
                let ar = Rect::from_min_size(pos2(x, r.center().y - g.size().y / 2.0), g.size());
                p.galley(ar.min, g, t.faint);
                ui.interact(ar, ui.scope_id().with(("also", &row.key)), Sense::hover()).on_hover_text(TIP_ALSO);
            }
            for (i, (cell, on, mark_text, word, key)) in [
                (Cell::Keep, enabled, "✓", "Enable", row.key.clone()),
                (Cell::Must, required, "★", "Must", row.must_key()),
                (Cell::Drop, excluded, "✕", "Exclude", row.exclude_key()),
            ].into_iter().enumerate() {
                if cell == Cell::Drop && !row.exclude {
                    continue;
                }
                mark(ui, &key);
                let cr = Rect::from_min_size(pos2(r.right() - cells_w + i as f32 * (CELL[0] + CELL_GAP), r.center().y - CELL[1] / 2.0), vec2(CELL[0], CELL[1]));
                let resp = ui.interact(cr, ui.scope_id().with(("cell", &key)), Sense::click());
                let name = format!("{word} {}", row.name);
                resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, on, &name));
                let tip = match cell {
                    Cell::Keep => if row.tip.is_empty() { format!("Enable {} filter", row.name) } else { row.tip.clone() },
                    Cell::Must => format!("Require {}: every captured clip must match this filter", row.name),
                    Cell::Drop => format!("Exclude {}: remove clips matching this filter from results", row.name),
                };
                let resp = resp.on_hover_text(tip);
                let (fill, ink, edge) = match (cell, on) {
                    (Cell::Keep, true) => (t.lime, t.lime_ink, t.lime_glow),
                    (Cell::Must, true) => (t.amber, egui::Color32::WHITE, t.amber),
                    (Cell::Drop, true) => (t.rose, egui::Color32::WHITE, t.rose),
                    _ => (t.solid, t.faint, t.hair),
                };
                let p = ui.painter();
                p.rect(cr, CELL_RADIUS, fill, Stroke::new(1.0, if resp.hovered() { t.accent } else { edge }), StrokeKind::Inside);
                p.text(cr.center(), egui::Align2::CENTER_CENTER, mark_text, semibold(FONT_NAME), if on { ink } else { t.faint.gamma_multiply(1.0 / 2.0) });
                if resp.hovered() {
                    crate::cursor::snap_here(ui.ctx(), cr);
                }
                if resp.clicked() {
                    for (k, v) in toggle_changes(row, cell, enabled, required, excluded) {
                        cx.link.set(cx.now, &k, json!(v));
                    }
                }
            }
            let ex = extras(row, cx);
            if !ex.is_empty() {
                ui.horizontal_wrapped(|ui| {
                    ui.add_space(GLYPH_W + CELL_GAP);
                    for e in ex {
                        e.draw(ui, cx);
                    }
                });
            }
            if cx.always_tips && !row.tip.is_empty() {
                ui.horizontal_wrapped(|ui| {
                    ui.add_space(GLYPH_W + CELL_GAP);
                    hint(ui, t, &row.full_tip());
                });
            }
        }
    });
}

/// A setting a filter carries beyond its three toggles (`FilterExtraModel`).
pub enum Extra {
    Number { key: String, label: String, unit: String, tip: String, fallback: Value },
    Choice { key: String, label: String, tip: String, fallback: Value },
    Toggle { key: String, label: String, tip: String },
}

impl Extra {
    fn draw(self, ui: &mut egui::Ui, cx: &mut CardCx) {
        let t = cx.theme;
        match self {
            Extra::Number { key, label, unit, tip, fallback } => {
                if !label.is_empty() {
                    lab(ui, t, &label);
                }
                let name = if label.is_empty() { key.clone() } else { label.clone() };
                number_field(ui, cx, &key, &name, &fallback, FIELD_W, &tip);
                if !unit.is_empty() {
                    lab(ui, t, &unit);
                }
            }
            Extra::Choice { key, label, tip, fallback } => {
                lab(ui, t, &label);
                mark(ui, &key);
                let cur = as_text(cx.link.get(&key), &fallback);
                if let Some(v) = seg(ui, t, &label, &KILL_COUNT_OPTIONS, &cur, false, &tip, None) {
                    // The engine counts with a number; 3.5 wrote the option's text.
                    cx.link.set(cx.now, &key, json!(v.parse::<i64>().unwrap_or_default()));
                }
            }
            Extra::Toggle { key, label, tip } => {
                super::kit::toggle_chip(ui, cx, &key, &label, &tip);
            }
        }
    }
}

/// `killExtras`: the kill filters' own sub-settings, as 3.5 wrote them.
fn kill_extras(row: &FilterRow, cx: &CardCx) -> Vec<Extra> {
    let num = |key: &str, label: &str, unit: &str, tip: &str| Extra::Number { key: key.into(), label: label.into(), unit: unit.into(), tip: tip.into(), fallback: default_of(key) };
    let count = |key: &str, label: &str, tip: &str| Extra::Choice { key: key.into(), label: label.into(), tip: tip.into(), fallback: default_of(key) };
    match row.key.as_str() {
        // FERRARI PEEK: the sub-panel exists only while the filter is enabled.
        "kill_mod_high_velocity" if flag(cx, "kill_mod_high_velocity", false) => vec![
            Extra::Toggle { key: "kill_mod_hv_one_shot".into(), label: "One-shot".into(), tip: "Require exactly one shot for Ferrari Peek (movement-speed kill)".into() },
            num("kill_mod_high_vel_thr", "", "u/s", "Minimum approach speed to qualify, in game units/sec (AWP~200, AK~215)"),
        ],
        "kill_mod_flick" => vec![num("kill_mod_flick_deg", "Min angle", "°", "Minimum view-angle change (degrees) right before the kill to count as a flick")],
        "kill_mod_one_tap" => vec![num("kill_mod_one_tap_s", "Window", "s", "Seconds around the kill with no other shot, to count as an isolated one-tap")],
        "kill_mod_multi_kill" => vec![
            count("kill_mod_multi_kill_n", "Min kills", "Minimum kills in one round to qualify as a multi-kill"),
            num("kill_mod_multi_kill_s", "within", "s", "Time window (seconds) the multi-kill count must happen within"),
        ],
        "kill_mod_bully" => vec![count("kill_mod_bully_n", "From kill #", "Captures the Nth+ kill against the same opponent this match")],
        _ => Vec::new(),
    }
}

/// `registryExtras`: labelled number boxes straight from the registry.
fn registry_extras(row: &FilterRow, _cx: &CardCx) -> Vec<Extra> {
    row.extras.iter().map(|(key, label, unit, default)| Extra::Number { key: key.clone(), label: label.clone(), unit: unit.clone(), tip: format!("{label} (default {})", as_text(Some(default), &Value::Null)), fallback: default.clone() }).collect()
}

fn active_count(cx: &CardCx, rows: &[FilterRow]) -> usize {
    rows.iter().filter(|r| flag(cx, &r.key, false) || (r.exclude && flag(cx, &r.exclude_key(), false))).count()
}

fn choice(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, label: &str, options: &[&str], disabled: bool, tip: &str) {
    let t = cx.theme;
    lab(ui, t, label);
    mark(ui, key);
    let raw = text(cx, key);
    let cur = options.iter().copied().find(|o| *o == raw).unwrap_or(options[0]);
    if let Some(v) = seg(ui, t, label, options, cur, disabled, tip, None) {
        cx.link.set(cx.now, key, json!(v));
    }
}

/// Kill Filters: suicides, headshots, the three registry groups, Clear, the clutch ladder.
pub fn kill(tab: &mut CaptureTab, ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    let Some(tables) = &tab.tables else {
        lab(ui, t, "Loading filters…");
        return None;
    };
    let rows: Vec<FilterRow> = filter_rows(tables).into_iter().filter(|r| r.judges("kill")).collect();
    ui.horizontal_wrapped(|ui| {
        choice(ui, cx, "suicides_mode", "Suicides", &SUICIDE_MODES, false, TIP_SUICIDES);
        // A one-tap kill is already a headshot constraint: the choice is greyed, not hidden.
        let hs_off = flag(cx, "kill_mod_one_tap", false) || flag(cx, "kill_mod_trois_tap", false);
        choice(ui, cx, "headshots_mode", "Headshots", &HEADSHOT_MODES, hs_off, TIP_HEADSHOTS);
        if button(ui, t, "Clear", "Clear", TIP_CLEAR, true) {
            // Only this card's rows: Clear must not reach the Damage / Shot cards.
            for r in &rows {
                cx.link.set(cx.now, &r.key, json!(false));
                cx.link.set(cx.now, &r.must_key(), json!(false));
            }
        }
    });
    for (cat, heading) in GROUPS {
        let group: Vec<FilterRow> = rows.iter().filter(|r| r.category == cat).cloned().collect();
        if !group.is_empty() {
            ui.add_space(CELL_GAP * 2.0);
            matrix(ui, cx, heading, &group, &kill_extras);
        }
    }
    ui.add_space(CELL_GAP * 2.0);
    clutch(ui, cx);
    let on = active_count(cx, &rows) + usize::from(flag(cx, "clutch_enabled", false));
    Some(if on > 0 { format!("{on} active") } else { "all kills".into() })
}

/// The clutch block: switch, wins only, mode, and the sizes as bars that grow with the odds.
fn clutch(ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let on = flag(cx, "clutch_enabled", false);
    ui.horizontal_wrapped(|ui| {
        super::kit::toggle_chip(ui, cx, "clutch_enabled", "🎯 CLUTCH", TIP_CLUTCH);
        if on {
            super::kit::toggle_chip(ui, cx, "clutch_wins_only", "Wins only", TIP_WINS);
            mark(ui, "clutch_mode");
            let raw = text(cx, "clutch_mode");
            let cur = CLUTCH_MODES.iter().copied().find(|o| *o == raw).unwrap_or(CLUTCH_MODES[0]);
            if let Some(v) = seg(ui, t, "Clutch mode", &CLUTCH_MODES, cur, false, TIP_CLUTCH_MODE, None) {
                cx.link.set(cx.now, "clutch_mode", json!(v));
            }
        }
    });
    if !on {
        return;
    }
    let tallest = CLUTCH_RUNG_HEIGHT[0] + CLUTCH_SIZES[CLUTCH_SIZES.len() - 1] as f32 * CLUTCH_RUNG_HEIGHT[1];
    ui.horizontal(|ui| {
        for n in CLUTCH_SIZES {
            let key = format!("clutch_1v{n}");
            mark(ui, &key);
            let lit = flag(cx, &key, false);
            let (slot, resp) = ui.allocate_exact_size(vec2(RUNG_W, tallest + FONT_NAME * 2.0), Sense::click());
            let name = format!("1v{n}");
            resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, lit, &name));
            let resp = resp.on_hover_text(TIP_CLUTCH_SIZE);
            let h = CLUTCH_RUNG_HEIGHT[0] + f32::from(n) * CLUTCH_RUNG_HEIGHT[1];
            let bar = Rect::from_min_max(pos2(slot.left(), slot.bottom() - FONT_NAME * 2.0 - h), pos2(slot.right(), slot.bottom() - FONT_NAME * 2.0));
            let p = ui.painter();
            p.rect(bar, CELL_RADIUS, if lit { t.lime } else { t.surface2 }, Stroke::new(1.0, if lit { t.lime_glow } else if resp.hovered() { t.accent } else { t.hair }), StrokeKind::Inside);
            p.text(pos2(slot.center().x, slot.bottom() - FONT_NAME), egui::Align2::CENTER_CENTER, &name, semibold(FONT_NAME), if lit { t.txt } else { t.muted });
            if resp.clicked() {
                cx.link.set(cx.now, &key, json!(!lit));
            }
        }
    });
}

fn event_hint(category: &str) -> (&'static str, &'static str) {
    if category == "damage" {
        ("Judges non-lethal damage — tick Non-lethal in Event Type.", "hits")
    } else {
        ("Judges shots and knife swings — tick Other in Event Type.", "shots")
    }
}

/// Damage / Shot Filters: the hint and one switchboard of registry rows.
pub fn events(tab: &mut CaptureTab, ui: &mut egui::Ui, cx: &mut CardCx, category: &str) -> Option<String> {
    let t = cx.theme;
    let Some(tables) = &tab.tables else {
        lab(ui, t, "Loading filters…");
        return None;
    };
    let rows: Vec<FilterRow> = filter_rows(tables).into_iter().filter(|r| r.category == "event" && r.judges(category)).collect();
    hint(ui, t, event_hint(category).0);
    ui.add_space(CELL_GAP);
    matrix(ui, cx, "", &rows, &registry_extras);
    let on = active_count(cx, &rows);
    Some(if on > 0 { format!("{on} active") } else { "none".into() })
}

#[allow(dead_code)]
fn unused(_t: &Theme) {}
