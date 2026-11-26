//! The VIDEO cards' drawn pieces, after 3.5.1's timeline views (`videoKit/`, `*Card.tsx`, their CSS):
//! sub-cards, a segmented tray, the ‹ value › token, shortcut rulers, and the pictures (frame at its
//! ratio, one second of film, FOV cone, game speed bars, game screen, gravity arrows, quality rails,
//! the FFmpeg line). Shapes only, drawn once per frame: nothing here asks for another frame.
//!
//! Local versions of a segmented tray and a framed sub-card: the shared ones (T6b) replace them at
//! the merge.

use super::kit::{fallback, mark, shown};
use crate::grid::CardCx;
use crate::paint::{mono, regular, semibold};
use crate::tabs::settings::controls::{bool_of, num_of, stored_number};
use crate::theme::Theme;
use crate::widgets::tip;
use csdm_core::ui_values::{FONT_BODY, FONT_SMALL, FONT_SWITCH, SWITCH_GAP, SWITCH_TRACK};
use eframe::egui::{self, pos2, vec2, Align, Color32, Layout, Rect, Response, Sense, Stroke, StrokeKind, Ui, UiBuilder, Vec2};
use serde_json::json;

// Sub-card (`.vk-lane`, `.fa-stage`, `.fx-lane`).
const SUB_RADIUS: u8 = 12;
const SUB_PAD: i8 = 8;
// Segmented tray (`.seg`).
const TRAY_PAD: f32 = 3.0;
const TRAY_RADIUS: f32 = 9.0;
const OPT_PAD: [f32; 2] = [9.0, 4.0];
const OPT_RADIUS: f32 = 7.0;
const FONT_SEG: f32 = 11.5;
const MARK_W: f32 = 9.0;
const MARK_GAP: f32 = 4.0;
// ‹ value › token (`NumWord`).
const TOKEN_PAD: [f32; 2] = [6.0, 2.0];
const TOKEN_RADIUS: f32 = 8.0;
const FONT_TOKEN: f32 = 12.5;
const TOKEN_MIN_CHARS: usize = 2;
const ARROW_W: f32 = 11.0;
// Mini chips of a ruler or a shortcut row (`.fx-tick`, `QuickChips`).
const TICK_PAD: [f32; 2] = [6.0, 2.0];
const TICK_RADIUS: f32 = 7.0;
const FONT_TICK: f32 = 10.5;
const KICK_SPACING: f32 = 0.12;
const FONT_KICK: f32 = 10.0;
// Pictures.
const FRAME_STAGE_H: f32 = 96.0;
const FRAME_H: f32 = 68.0;
const FRAME_RATIO: [f32; 2] = [1.0, 2.4];
const STAGE_RULE_STEP: f32 = 9.0;
const FILM_H: f32 = 24.0;
const FILM_FRAMES_PER_CELL: f32 = 10.0;
const FILM_CELLS_MAX: f32 = 24.0;
const FILM_GAP: f32 = 3.0;
const TRACK_H: f32 = 60.0;
const CONE_R: f32 = 34.0;
const SPEED_BAR_H: f32 = 7.0;
const SPEED_LANE_W: f32 = 0.38;
const SPEED_MATCH_SHARE: f32 = 0.25;
const SCREEN_H: f32 = 120.0;
const RADAR_R: f32 = 11.0;
const WALL: [f32; 2] = [52.0, 58.0];
const MAN_R: f32 = 6.0;
const MAN_TORSO_TOP: f32 = 1.5;
const XRAY_RING_SCALE: f32 = 2.5;
const ARROW_BOX: [f32; 2] = [22.0, 44.0];
const ARROW_MAX: f32 = 16.0;
const RAIL_H: f32 = 7.0;
const MARKER: [f32; 2] = [3.0, 13.0];
const BAR_PAD: [f32; 2] = [10.0, 8.0];
const BAR_RADIUS: u8 = 10;
const CLIP: [f32; 2] = [14.0, 11.0];
const CLIP_GAP: f32 = 4.0;
const GHOST_ALPHA: f32 = 0.45;
const SOFT_ALPHA: f32 = 0.16;
const FAINT_ALPHA: f32 = 0.35;
const RULE_ALPHA: f32 = 0.5;
const PCT: f32 = 100.0;
const CHAIN_LANE_H: f32 = 40.0;
const CHAIN_TITLE_W: f32 = 96.0;
const CHAIN_LINK: f32 = 12.0;
/// Width the Final Assembly arrow takes between its two stages (arrow and the gaps around it).
pub const ARROW_SPACE: f32 = 24.0;
const CLIP_RADIUS: f32 = 3.0;
const CONE_STEPS: usize = 16;
const FOV_DRAWN_MAX: f64 = 179.0;
const EYE_R: f32 = 3.0;
const ARROW_STROKE: f32 = 1.5;
const THIRDS: f32 = 3.0;
const HUD_PILL_ALPHA: f32 = 0.72;
const HUD_PILL_PAD: [f32; 2] = [5.0, 1.0];
const HUD_PILL_RADIUS: f32 = 4.0;
const FILM_BADGE_SIZE: [f32; 2] = [14.0, 11.0];
const FILM_BADGE_HOLE: f32 = 3.0;
const TOKEN_TEXT_FUDGE: f32 = 6.0;

/// The dark plate of the film strip and the FFmpeg line, in both grounds (3.5 `--ink`-like).
fn ink(t: &Theme) -> Color32 {
    if t.dark { t.page0 } else { t.txt }
}

fn on_ink(t: &Theme) -> Color32 {
    if t.dark { t.txt } else { t.solid }
}

/// `.vk-kick`: tracked upper-case accent words.
pub fn kick(ui: &mut Ui, t: &Theme, text: &str) -> Response {
    ui.label(egui::RichText::new(text.to_uppercase()).font(semibold(FONT_KICK)).color(t.accent).extra_letter_spacing(KICK_SPACING * FONT_KICK))
}

/// A framed sub-card (local; T6b's shared one replaces it). `ghost` draws it faded.
pub fn subcard<R>(ui: &mut Ui, t: &Theme, ghost: bool, add: impl FnOnce(&mut Ui) -> R) -> R {
    let edge = if ghost { t.hair.gamma_multiply(GHOST_ALPHA) } else { t.hair };
    egui::Frame::new()
        .fill(t.solid.gamma_multiply(if ghost { GHOST_ALPHA } else { 1.0 }))
        .stroke(Stroke::new(1.0, edge))
        .corner_radius(egui::CornerRadius::same(SUB_RADIUS))
        .inner_margin(egui::Margin::same(SUB_PAD))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            add(ui)
        })
        .inner
}

/// A lane's head: kicker left, `right` right-aligned on the same line (bounded to its content height).
pub fn head(ui: &mut Ui, t: &Theme, title: &str, right: impl FnOnce(&mut Ui)) {
    ui.horizontal(|ui| {
        kick(ui, t, title);
        ui.allocate_ui_with_layout(vec2(ui.available_width(), 0.0), Layout::right_to_left(Align::Center), right);
    });
}

/// Which small picture a segmented option wears (CS2 window modes).
#[derive(Clone, Copy)]
pub enum SegMark { Dash, Full, Window, Borderless }

fn paint_mark(p: &egui::Painter, r: Rect, mark: SegMark, c: Color32) {
    let s = Stroke::new(1.0, c);
    match mark {
        SegMark::Dash => {
            p.line_segment([pos2(r.left(), r.center().y), pos2(r.right(), r.center().y)], s);
        }
        SegMark::Full => {
            p.rect_filled(r.shrink(1.0), 1.0, c);
        }
        SegMark::Window => {
            p.rect_stroke(r.shrink(1.0), 1.0, s, StrokeKind::Inside);
            p.line_segment([pos2(r.left() + 1.0, r.top() + MARK_GAP), pos2(r.right() - 1.0, r.top() + MARK_GAP)], s);
        }
        SegMark::Borderless => {
            p.rect_stroke(r.shrink(1.0), 0.0, s, StrokeKind::Inside);
        }
    }
}

/// A segmented tray (local `.seg`; T6b's shared one replaces it). Each option is a button named
/// "{name}: {option}"; returns the option clicked.
pub fn seg(ui: &mut Ui, t: &Theme, name: &str, options: &[&str], current: &str, marks: &[SegMark], tip: &str) -> Option<String> {
    let font = regular(FONT_SEG);
    let bold = semibold(FONT_SEG);
    let sizes: Vec<Vec2> = options
        .iter()
        .enumerate()
        .map(|(i, o)| {
            let g = ui.painter().layout_no_wrap(o.to_string(), if *o == current { bold.clone() } else { font.clone() }, t.txt);
            let m = if marks.get(i).is_some() { MARK_W + MARK_GAP } else { 0.0 };
            g.size() + Vec2::new(m, 0.0) + Vec2::from(OPT_PAD) * 2.0
        })
        .collect();
    let h = sizes.iter().map(|s| s.y).fold(0.0, f32::max);
    let w: f32 = sizes.iter().map(|s| s.x).sum();
    let (tray, _) = ui.allocate_exact_size(vec2(w + TRAY_PAD * 2.0, h + TRAY_PAD * 2.0), Sense::hover());
    ui.painter().rect(tray, TRAY_RADIUS, t.surface2, Stroke::new(1.0, t.hair), StrokeKind::Inside);
    let mut x = tray.left() + TRAY_PAD;
    let mut picked = None;
    for (i, o) in options.iter().enumerate() {
        let r = Rect::from_min_size(pos2(x, tray.top() + TRAY_PAD), vec2(sizes[i].x, h));
        x += sizes[i].x;
        let id = ui.scope_id().with(("seg", name, i));
        let resp = ui.interact(r, id, Sense::click());
        let on = *o == current;
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, on, format!("{name}: {o}")));
        let color = if on { t.accent } else if resp.hovered() { t.txt } else { t.muted };
        if on {
            ui.painter().rect(r, OPT_RADIUS, t.solid, Stroke::new(1.0, t.hair), StrokeKind::Inside);
        }
        let mut left = r.left() + OPT_PAD[0];
        if let Some(m) = marks.get(i).copied() {
            let mr = Rect::from_center_size(pos2(left + MARK_W / 2.0, r.center().y), Vec2::splat(MARK_W));
            paint_mark(ui.painter(), mr, m, color);
            left += MARK_W + MARK_GAP;
        }
        ui.painter().text(pos2(left, r.center().y), egui::Align2::LEFT_CENTER, *o, if on { bold.clone() } else { font.clone() }, color);
        if resp.on_hover_text(tip).clicked() && !on {
            picked = Some(o.to_string());
        }
    }
    picked
}

/// The `‹ value unit ›` token (3.5 `NumWord`): the value is typed in place (a word is not stored),
/// the arrows step it. Accessible as a text box named `name`.
#[allow(clippy::too_many_arguments)]
/// `by`: the visible label naming it (a field and its label are one node for assistive tools);
/// `None` names it `name` itself.
pub fn token(ui: &mut Ui, cx: &mut CardCx, key: &str, name: &str, decimals: i32, step: f64, unit: &str, alt: bool, by: Option<egui::Id>) {
    let t = cx.theme;
    let current = num_of(cx, key, fallback(key));
    let id = ui.scope_id().with(("token", key));
    let mut text: String = ui.data(|d| d.get_temp(id)).unwrap_or_else(|| shown(current));
    let tone = if alt { t.emerald } else { t.accent };
    let font = semibold(FONT_TOKEN);
    let mut commit = None;
    let shown_w = ui.painter().layout_no_wrap(format!("{text:0<w$}", w = TOKEN_MIN_CHARS), font.clone(), tone).size().x + TOKEN_TEXT_FUDGE;
    let arrow_font = regular(FONT_TOKEN);
    let arrow_w = |g: &str| ui.painter().layout_no_wrap(g.to_string(), arrow_font.clone(), t.faint).size().x;
    let unit_w = if unit.is_empty() { 0.0 } else { ui.painter().layout_no_wrap(unit.to_string(), font.clone(), tone).size().x + 1.0 };
    let gaps = if unit.is_empty() { 2.0 } else { 2.0 + 1.0 };
    let total_w = TOKEN_PAD[0] * 2.0 + arrow_w("‹") + shown_w + unit_w + arrow_w("›") + gaps;
    let frame = egui::Frame::new()
        .fill(t.solid)
        .stroke(Stroke::new(1.0, tone.gamma_multiply(FAINT_ALPHA)))
        .corner_radius(egui::CornerRadius::same(TOKEN_RADIUS as u8))
        .inner_margin(egui::Margin::symmetric(TOKEN_PAD[0] as i8, TOKEN_PAD[1] as i8));
    ui.allocate_ui_with_layout(vec2(total_w, 0.0), Layout::left_to_right(Align::Center), |ui| {
        frame.show(ui, |ui| {
            ui.spacing_mut().item_spacing.x = 1.0;
            let arrow = |ui: &mut Ui, glyph: &str, what: &str| {
                let r = ui.add(egui::Label::new(egui::RichText::new(glyph).font(arrow_font.clone()).color(t.faint)).sense(Sense::click()));
                r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, format!("{what} {name}")));
                r.on_hover_text(format!("{what} {name}")).clicked()
            };
            if arrow(ui, "‹", "Decrease") {
                commit = Some(current - step);
            }
            let edit = egui::TextEdit::singleline(&mut text).frame(egui::Frame::NONE).font(font.clone()).text_color(tone).desired_width(shown_w).margin(egui::Margin::ZERO);
            let r = ui.add(edit);
            let (shown_text, enabled) = (text.clone(), ui.is_enabled());
            r.widget_info(|| {
                let mut i = egui::WidgetInfo::text_edit(enabled, &shown_text, &shown_text, "");
                i.label = by.is_none().then(|| name.to_string());
                i
            });
            let r = match by {
                Some(id) => r.labelled_by(id),
                None => r,
            };
            if r.changed() {
                commit = text.trim().parse::<f64>().ok().filter(|v| v.is_finite());
            }
            if r.has_focus() || r.changed() {
                ui.data_mut(|d| d.insert_temp(id, text.clone()));
            } else {
                ui.data_mut(|d| d.remove::<String>(id));
            }
            if !unit.is_empty() {
                ui.label(egui::RichText::new(unit).font(font.clone()).color(tone));
            }
            if arrow(ui, "›", "Increase") {
                commit = Some(current + step);
            }
        });
    });
    mark(ui, key);
    if let Some(v) = commit {
        cx.link.set(cx.now, key, stored_number(v, decimals));
    }
}

/// Mini chips named "{name} {value}", the current one lit: a ruler (`spread`, ends to ends) or a
/// shortcut row (`QuickChips`).
pub fn ticks(ui: &mut Ui, cx: &mut CardCx, key: &str, name: &str, values: &[f64], decimals: i32, spread: bool) {
    let t = cx.theme;
    let current = num_of(cx, key, fallback(key));
    let font = mono(FONT_TICK);
    let galleys: Vec<_> = values.iter().map(|v| ui.painter().layout_no_wrap(shown(*v), font.clone(), t.txt)).collect();
    let sizes: Vec<Vec2> = galleys.iter().map(|g| g.size() + Vec2::from(TICK_PAD) * 2.0).collect();
    let h = sizes.iter().map(|s| s.y).fold(0.0, f32::max);
    let gap = ui.spacing().item_spacing.x;
    let natural: f32 = sizes.iter().map(|s| s.x).sum::<f32>() + gap * (values.len().saturating_sub(1)) as f32;
    let width = if spread { ui.available_width() } else { natural.min(ui.available_width()) };
    let (row, _) = ui.allocate_exact_size(vec2(width, h), Sense::hover());
    if spread {
        ui.painter().line_segment([pos2(row.left(), row.center().y), pos2(row.right(), row.center().y)], Stroke::new(1.0, t.hair));
    }
    let free = if spread && values.len() > 1 { (width - sizes.iter().map(|s| s.x).sum::<f32>()) / (values.len() - 1) as f32 } else { gap };
    let mut x = row.left();
    let mut picked = None;
    for (i, v) in values.iter().enumerate() {
        let r = Rect::from_min_size(pos2(x, row.top()), vec2(sizes[i].x, h));
        x += sizes[i].x + free;
        let on = *v == current;
        let resp = ui.interact(r, ui.scope_id().with(("tick", key, i)), Sense::click());
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, on, format!("{name} {}", shown(*v))));
        let (fill, edge, ink) = if on { (t.accent, t.accent, t.on_accent) } else { (t.solid, if resp.hovered() { t.accent } else { t.hair }, t.muted) };
        ui.painter().rect(r, TICK_RADIUS, fill, Stroke::new(1.0, edge), StrokeKind::Inside);
        ui.painter().text(r.center(), egui::Align2::CENTER_CENTER, shown(*v), font.clone(), ink);
        if resp.on_hover_text(format!("Set {name} to {}", shown(*v))).clicked() {
            picked = Some(*v);
        }
    }
    if let Some(v) = picked {
        cx.link.set(cx.now, key, stored_number(v, decimals));
    }
}

/// A text setting typed inside a picture (the HLAE args row, the FFmpeg line), named `name`.
pub fn inline_text(ui: &mut Ui, cx: &mut CardCx, key: &str, name: &str, hint: &str, width: f32, tip: &str) {
    let mut value = super::super::settings::controls::text_of(cx, key);
    let r = ui.add(egui::TextEdit::singleline(&mut value).font(mono(FONT_SMALL)).hint_text(hint).desired_width(width));
    let (v, enabled) = (value.clone(), ui.is_enabled());
    r.widget_info(|| {
        let mut i = egui::WidgetInfo::text_edit(enabled, &v, &v, hint);
        i.label = Some(name.to_string());
        i
    });
    let changed = r.changed();
    r.on_hover_text(tip);
    mark(ui, key);
    if changed {
        cx.link.set(cx.now, key, json!(value));
    }
}

/// Compact switch matching 3.5's `ToggleSwitch` (`SWITCH_TRACK` + `FONT_SWITCH`).
pub fn switch(ui: &mut Ui, cx: &mut CardCx, key: &str, name: &str, tip_text: &str) {
    let on = bool_of(cx, key);
    let t = cx.theme;
    let galley = ui.painter().layout_no_wrap(name.to_string(), regular(FONT_SWITCH), t.txt);
    let track = Vec2::from(SWITCH_TRACK);
    let size = Vec2::new(track.x + SWITCH_GAP + galley.size().x, track.y.max(galley.size().y));
    let (whole, r) = ui.allocate_exact_size(size, Sense::click());
    r.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, on, name));
    let rect = Rect::from_min_size(pos2(whole.left(), whole.center().y - track.y / 2.0), track);
    let radius = rect.height() / 2.0;
    let (fill, edge) = if on { (t.emerald, t.emerald) } else { (t.surface2, if r.hovered() { t.accent } else { t.hair }) };
    ui.painter().rect(rect, radius, fill, Stroke::new(1.0, edge), StrokeKind::Inside);
    let x = if on { rect.right() - radius } else { rect.left() + radius };
    ui.painter().circle_filled(pos2(x, rect.center().y), radius - 2.0, if on { t.on_accent } else { t.muted });
    ui.painter().galley(pos2(rect.right() + SWITCH_GAP, whole.center().y - galley.size().y / 2.0), galley, t.txt);
    let r = tip(ui, t, r, tip_text, cx.always_tips);
    if r.clicked() {
        cx.link.set(cx.now, key, json!(!on));
    }
}

/// Words placed in `r` without moving the parent `ui`'s cursor, readable by assistive tools.
fn words(ui: &mut Ui, r: Rect, text: &str, font: egui::FontId, color: Color32) {
    let mut child = ui.new_child(UiBuilder::new().max_rect(r).layout(Layout::centered_and_justified(egui::Direction::LeftToRight)));
    child.add(egui::Label::new(egui::RichText::new(text).font(font).color(color)).selectable(false));
}

fn words_left(ui: &mut Ui, r: Rect, text: &str, font: egui::FontId, color: Color32) {
    let mut child = ui.new_child(UiBuilder::new().max_rect(r).layout(Layout::left_to_right(Align::Center)));
    child.add(egui::Label::new(egui::RichText::new(text).font(font).color(color)).selectable(false));
}

/// Small film badge beside the final output file name.
pub fn film_badge(ui: &mut Ui, t: &Theme, active: bool) {
    let (r, _) = ui.allocate_exact_size(Vec2::from(FILM_BADGE_SIZE), Sense::hover());
    let c = if active { t.accent } else { t.faint.gamma_multiply(GHOST_ALPHA) };
    ui.painter().rect(r, 2.0, c.gamma_multiply(SOFT_ALPHA), Stroke::new(1.0, c), StrokeKind::Inside);
    ui.painter().rect_filled(r.shrink(FILM_BADGE_HOLE), 1.0, c);
}

// ---- Final Assembly ------------------------------------------------------------------------------

/// The clips of two sequences (3 and 2), joined when `joined`.
pub fn clips(ui: &mut Ui, t: &Theme, joined: bool) {
    const SEQUENCES: [usize; 2] = [3, 2];
    let total: usize = SEQUENCES.iter().sum();
    let w = CLIP[0] * total as f32 + CLIP_GAP * (total + SEQUENCES.len()) as f32;
    let (row, _) = ui.allocate_exact_size(vec2(w, CLIP[1]), Sense::hover());
    let mut x = row.left();
    for (s, n) in SEQUENCES.iter().enumerate() {
        let color = if s == 0 { t.accent } else { t.emerald };
        let start = x;
        for _ in 0..*n {
            let r = Rect::from_min_size(pos2(x, row.top()), Vec2::from(CLIP));
            ui.painter().rect(r, 2.0, color.gamma_multiply(SOFT_ALPHA), Stroke::new(1.0, color.gamma_multiply(RULE_ALPHA)), StrokeKind::Inside);
            ui.painter().circle_filled(r.center(), 2.0, color);
            x += CLIP[0] + if joined { 1.0 } else { CLIP_GAP };
        }
        if joined {
            let r = Rect::from_min_max(pos2(start - 1.0, row.top() - 1.0), pos2(x, row.bottom() + 1.0));
            ui.painter().rect_stroke(r, CLIP_RADIUS, Stroke::new(1.0, color), StrokeKind::Outside);
        }
        x += CLIP_GAP * 2.0;
    }
}

/// The arrow between two stages, dim when `on` is false.
pub fn flow_arrow(ui: &mut Ui, t: &Theme, height: f32, on: bool) {
    let (r, _) = ui.allocate_exact_size(vec2(ARROW_W * 2.0, height), Sense::hover());
    let c = if on { t.accent } else { t.faint.gamma_multiply(GHOST_ALPHA) };
    let y = r.center().y;
    ui.painter().arrow(pos2(r.left() + 2.0, y), vec2(r.width() - 2.0 * 2.0, 0.0), Stroke::new(ARROW_STROKE, c));
}

// ---- Recording System ----------------------------------------------------------------------------

/// One recording chain as a lane (3.5 `rsys-lane`): its title, then its steps as linked pills, the
/// `star` step filled; the chosen lane framed in the accent. A radio button named `name`; true when
/// clicked.
#[allow(clippy::too_many_arguments)]
pub fn chain_lane(ui: &mut Ui, t: &Theme, name: &str, title: &str, steps: &[&str], star: &str, on: bool, tip: &str) -> bool {
    let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width(), CHAIN_LANE_H), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::RadioButton, true, on, name));
    let (fill, edge) = if on { (t.accent.gamma_multiply(SOFT_ALPHA / 2.0).blend(t.solid), Stroke::new(ARROW_STROKE, t.accent)) } else { (t.solid, Stroke::new(1.0, if resp.hovered() { t.accent } else { t.hair })) };
    ui.painter().rect(r, SUB_RADIUS as f32, fill, edge, StrokeKind::Inside);
    ui.painter().text(pos2(r.left() + SUB_PAD as f32, r.center().y), egui::Align2::LEFT_CENTER, title, semibold(FONT_BODY), if on { t.accent } else { t.txt });
    let mut x = r.left() + CHAIN_TITLE_W;
    for (i, step) in steps.iter().enumerate() {
        if i > 0 {
            ui.painter().line_segment([pos2(x, r.center().y), pos2(x + CHAIN_LINK, r.center().y)], Stroke::new(1.0, t.hair));
            x += CHAIN_LINK;
        }
        let g = ui.painter().layout_no_wrap(step.to_string(), mono(FONT_TICK), t.txt);
        let pill = Rect::from_min_size(pos2(x, r.center().y - g.size().y / 2.0 - TICK_PAD[1]), g.size() + Vec2::from(TICK_PAD) * 2.0);
        let starred = *step == star;
        let (pf, pe, pt) = if starred { (t.accent, t.accent, t.on_accent) } else { (t.solid, t.hair, if on { t.txt } else { t.muted }) };
        ui.painter().rect(pill, TICK_RADIUS, pf, Stroke::new(1.0, pe), StrokeKind::Inside);
        words(ui, pill, step, mono(FONT_TICK), pt);
        x = pill.right();
    }
    resp.on_hover_text(tip).clicked()
}

// ---- Resolution ----------------------------------------------------------------------------------

/// The frame at its ratio (1:1 to 2.4:1) on a ruled stage; `inside` draws in it, `around` gets the
/// rect to place the width and height tokens.
pub fn frame_stage(ui: &mut Ui, t: &Theme, width: f64, height: f64, label: &str, ratio: &str) -> Rect {
    let (stage, _) = ui.allocate_exact_size(vec2(ui.available_width(), FRAME_STAGE_H), Sense::hover());
    ui.painter().rect(stage, SUB_RADIUS as f32, t.surface2.gamma_multiply(RULE_ALPHA), Stroke::new(1.0, t.hair), StrokeKind::Inside);
    let mut x = stage.left() + STAGE_RULE_STEP;
    while x < stage.right() {
        ui.painter().line_segment([pos2(x, stage.top() + 1.0), pos2(x, stage.bottom() - 1.0)], Stroke::new(1.0, t.hair.gamma_multiply(RULE_ALPHA)));
        x += STAGE_RULE_STEP;
    }
    let r = (width / height.max(1.0)) as f32;
    let ratio_w = r.clamp(FRAME_RATIO[0], FRAME_RATIO[1]) * FRAME_H;
    let frame = Rect::from_center_size(stage.center(), vec2(ratio_w, FRAME_H));
    ui.painter().rect(frame, 2.0 * 2.0, t.accent.gamma_multiply(SOFT_ALPHA / 2.0).blend(t.solid), Stroke::new(2.0, t.accent), StrokeKind::Inside);
    let line = FONT_BODY + 2.0;
    words(ui, Rect::from_center_size(frame.center() - vec2(0.0, line / 2.0), vec2(frame.width(), line)), label, semibold(FONT_BODY), t.accent);
    words(ui, Rect::from_center_size(frame.center() + vec2(0.0, line / 2.0), vec2(frame.width(), line)), ratio, mono(FONT_SMALL), t.muted);
    frame
}

/// One second of film: one cell per ten frames.
pub fn film(ui: &mut Ui, t: &Theme, fps: f64) {
    let (bar, _) = ui.allocate_exact_size(vec2(ui.available_width(), FILM_H), Sense::hover());
    ui.painter().rect_filled(bar, OPT_RADIUS, ink(t));
    let n = ((fps as f32) / FILM_FRAMES_PER_CELL).round().clamp(1.0, FILM_CELLS_MAX);
    let inner = bar.shrink(TRAY_PAD + 1.0);
    let w = (inner.width() - FILM_GAP * (n - 1.0)) / n;
    for i in 0..n as usize {
        let r = Rect::from_min_size(pos2(inner.left() + i as f32 * (w + FILM_GAP), inner.top()), vec2(w, inner.height()));
        ui.painter().rect_filled(r, 2.0, t.emerald);
    }
}

// ---- HLAE Options --------------------------------------------------------------------------------

/// The camera seen from above, its cone opened to the FOV, and the FOV's words beside it.
pub fn cone(ui: &mut Ui, t: &Theme, fov: f64, words_text: &str) {
    let (track, _) = ui.allocate_exact_size(vec2(ui.available_width(), TRACK_H), Sense::hover());
    ui.painter().rect(track, OPT_RADIUS, t.surface2.gamma_multiply(RULE_ALPHA), Stroke::new(1.0, t.hair), StrokeKind::Inside);
    let eye = pos2(track.left() + CONE_R / 2.0, track.center().y);
    let half = (fov.clamp(1.0, FOV_DRAWN_MAX) as f32 / 2.0).to_radians();
    let steps = CONE_STEPS;
    let mut pts = vec![eye];
    for k in 0..=steps {
        let a = -half + 2.0 * half * k as f32 / steps as f32;
        pts.push(eye + vec2(a.cos(), a.sin()) * CONE_R);
    }
    ui.painter().add(egui::Shape::convex_polygon(pts, t.accent.gamma_multiply(SOFT_ALPHA * 2.0), Stroke::new(1.0, t.accent)));
    ui.painter().circle_filled(eye, EYE_R, t.accent);
    let at = Rect::from_min_max(pos2(eye.x + CONE_R + MARK_W, track.top()), track.max);
    words_left(ui, at, words_text, regular(FONT_SMALL), t.muted);
}

/// One match second (a quarter of the lane) against how long it lasts in the recording.
pub fn speed_bars(ui: &mut Ui, t: &Theme, speed: f64, words_text: &str) {
    let (track, _) = ui.allocate_exact_size(vec2(ui.available_width(), TRACK_H), Sense::hover());
    ui.painter().rect(track, OPT_RADIUS, t.surface2.gamma_multiply(RULE_ALPHA), Stroke::new(1.0, t.hair), StrokeKind::Inside);
    let lane = track.width() * SPEED_LANE_W;
    let stretch = (PCT / speed.max(1.0) as f32 * SPEED_MATCH_SHARE).min(1.0);
    let left = track.left() + SUB_PAD as f32;
    for (k, (share, color, text)) in [(SPEED_MATCH_SHARE, t.accent, "1 s of match"), (stretch, t.emerald, words_text)].into_iter().enumerate() {
        let y = track.top() + track.height() * (1.0 + k as f32) / THIRDS;
        let bar = Rect::from_min_size(pos2(left, y - SPEED_BAR_H / 2.0), vec2((lane * share * (1.0 / SPEED_MATCH_SHARE)).min(lane).max(SPEED_BAR_H), SPEED_BAR_H));
        ui.painter().rect_filled(bar, SPEED_BAR_H / 2.0, color);
        let at = Rect::from_min_max(pos2(left + lane + MARK_W, y - FONT_SMALL), pos2(track.right(), y + FONT_SMALL));
        words(ui, at, text, regular(FONT_SMALL), t.muted);
    }
}

// ---- In-Game Options -----------------------------------------------------------------------------

/// The filmed screen: radar, health, ammo, a wall with a player behind it (outlined with X-ray), the
/// kill feed top right. Returns where the feed's "stays" token goes.
pub fn game_screen(ui: &mut Ui, t: &Theme, hud: bool, xray: bool, true_view: bool) -> Rect {
    let (s, _) = ui.allocate_exact_size(vec2(ui.available_width(), SCREEN_H), Sense::hover());
    let p = ui.painter();
    p.rect(s, OPT_RADIUS, t.surface2, Stroke::new(1.0, t.hair), StrokeKind::Inside);
    let lower = Rect::from_min_max(pos2(s.left() + 1.0, s.center().y), s.max - vec2(1.0, 1.0));
    p.rect_filled(lower, OPT_RADIUS, t.amber.gamma_multiply(SOFT_ALPHA / 2.0));
    let hud_c = if hud { on_ink(t) } else { on_ink(t).gamma_multiply(FAINT_ALPHA) };
    let hud_bg = ink(t).gamma_multiply(if hud { HUD_PILL_ALPHA } else { SOFT_ALPHA });
    p.circle_stroke(s.left_top() + vec2(RADAR_R + SUB_PAD as f32, RADAR_R + SUB_PAD as f32), RADAR_R, Stroke::new(1.0, if hud { t.muted } else { t.faint.gamma_multiply(FAINT_ALPHA) }));
    for (text, pos, align) in [
        ("100", s.left_bottom() + vec2(SUB_PAD as f32, -(SUB_PAD as f32)), egui::Align2::LEFT_BOTTOM),
        ("30 / 90", s.right_bottom() - vec2(SUB_PAD as f32, SUB_PAD as f32), egui::Align2::RIGHT_BOTTOM),
    ] {
        let g = p.layout_no_wrap(text.to_string(), mono(FONT_SMALL), hud_c);
        let pad = Vec2::from(HUD_PILL_PAD);
        let size = g.size() + pad * 2.0;
        let min = match align {
            egui::Align2::LEFT_BOTTOM => pos2(pos.x, pos.y - size.y),
            _ => pos2(pos.x - size.x, pos.y - size.y),
        };
        p.rect_filled(Rect::from_min_size(min, size), HUD_PILL_RADIUS, hud_bg);
        p.galley(min + pad, g, hud_c);
    }
    let wall = Rect::from_center_size(pos2(s.center().x, s.bottom() - WALL[1] / 2.0), Vec2::from(WALL));
    p.rect_filled(wall, 0.0, t.muted.gamma_multiply(RULE_ALPHA));
    let man = pos2(wall.center().x, wall.center().y + MAN_R);
    let man_c = if xray { t.amber } else { t.faint.gamma_multiply(FAINT_ALPHA) };
    p.circle_filled(man - vec2(0.0, MAN_R * 2.0), MAN_R / 2.0 + 1.0, man_c);
    p.line_segment([man - vec2(0.0, MAN_R * MAN_TORSO_TOP), man + vec2(0.0, MAN_R)], Stroke::new(2.0, man_c));
    p.line_segment([man - vec2(MAN_R, 0.0), man + vec2(MAN_R, -MAN_R)], Stroke::new(2.0, man_c));
    if xray {
        p.circle_stroke(man - vec2(0.0, MAN_R / 2.0), MAN_R * XRAY_RING_SCALE, Stroke::new(ARROW_STROKE, t.amber));
    }
    if true_view {
        let badge = Rect::from_center_size(pos2(s.center().x, s.top() + SUB_PAD as f32), vec2(WALL[1] + SUB_PAD as f32, FONT_SMALL + 2.0));
        p.rect_filled(badge, badge.height() / 2.0, t.accent);
        p.text(badge.center(), egui::Align2::CENTER_CENTER, "TRUEVIEW", semibold(FONT_TICK), t.on_accent);
    }
    let feed_x = s.right() - SUB_PAD as f32;
    for (k, line) in ["you x enemy", "mate x enemy"].iter().enumerate() {
        let y = s.top() + SUB_PAD as f32 + k as f32 * (FONT_SMALL + 2.0 * 2.0);
        let g = p.layout_no_wrap(line.to_string(), semibold(FONT_TICK), on_ink(t));
        let r = Rect::from_min_size(pos2(feed_x - g.size().x - 2.0 * 2.0, y), g.size() + vec2(2.0 * 2.0, 2.0));
        p.rect_filled(r, 2.0, ink(t).gamma_multiply(if hud { RULE_ALPHA } else { 1.0 }));
        p.galley(r.min + vec2(2.0, 1.0), g, on_ink(t));
    }
    let top = s.top() + SUB_PAD as f32 + 2.0 * (FONT_SMALL + 2.0 * 2.0);
    Rect::from_min_max(pos2(s.center().x + WALL[0], top), pos2(feed_x, top + FONT_TOKEN * 2.0))
}

// ---- CS2 Effects ---------------------------------------------------------------------------------

/// Which way, and how hard, bodies are pulled: down for positive, up for negative.
pub fn pull_arrow(ui: &mut Ui, t: &Theme, pull: f64, dim: bool) {
    let (r, _) = ui.allocate_exact_size(Vec2::from(ARROW_BOX), Sense::hover());
    let c = if dim { t.faint.gamma_multiply(GHOST_ALPHA) } else { t.accent };
    ui.painter().circle_filled(r.center(), MAN_R / 2.0 + 1.0, c);
    let len = (pull.abs().min(1.0) as f32) * ARROW_MAX;
    if len > 0.0 {
        let dir = if pull < 0.0 { -1.0 } else { 1.0 };
        let from = r.center() + vec2(0.0, dir * (MAN_R / 2.0 + 2.0));
        ui.painter().arrow(from, vec2(0.0, dir * len), Stroke::new(ARROW_STROKE, if dim { c } else { t.emerald }));
    }
}

// ---- Encoding ------------------------------------------------------------------------------------

/// CRF on a quality-to-size rail (lossless → smallest), the marker at the value, its words under it.
pub fn crf_rail(ui: &mut Ui, t: &Theme, crf: f64, max: f64, words_text: &str) {
    let (rail, _) = ui.allocate_exact_size(vec2(ui.available_width(), MARKER[1]), Sense::hover());
    let bar = Rect::from_center_size(rail.center(), vec2(rail.width(), RAIL_H));
    let mut mesh = egui::Mesh::default();
    let stops = [t.emerald, t.accent, t.amber];
    let seg_w = bar.width() / (stops.len() - 1) as f32;
    for i in 0..stops.len() - 1 {
        let r = Rect::from_min_size(pos2(bar.left() + seg_w * i as f32, bar.top()), vec2(seg_w, bar.height()));
        let base = mesh.vertices.len() as u32;
        for (p, c) in [(r.left_top(), stops[i]), (r.right_top(), stops[i + 1]), (r.right_bottom(), stops[i + 1]), (r.left_bottom(), stops[i])] {
            mesh.colored_vertex(p, c);
        }
        mesh.add_triangle(base, base + 1, base + 2);
        mesh.add_triangle(base, base + 2, base + 2 + 1);
    }
    ui.painter().add(mesh);
    let at = bar.left() + bar.width() * (crf.clamp(0.0, max) / max) as f32;
    ui.painter().rect_filled(Rect::from_center_size(pos2(at, rail.center().y), Vec2::from(MARKER)), 1.0, t.txt);
    let (caps, _) = ui.allocate_exact_size(vec2(ui.available_width(), FONT_SMALL + 2.0), Sense::hover());
    let third = caps.width() / THIRDS;
    ui.painter().text(caps.left_center(), egui::Align2::LEFT_CENTER, "lossless", regular(FONT_TICK), t.faint);
    words(ui, Rect::from_center_size(caps.center(), vec2(third, caps.height())), words_text, regular(FONT_TICK), t.accent);
    ui.painter().text(caps.right_center(), egui::Align2::RIGHT_CENTER, "smallest", regular(FONT_TICK), t.faint);
}

/// The audio bitrate as a filled share of its range.
pub fn fill_rail(ui: &mut Ui, t: &Theme, share: f64) {
    let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), RAIL_H), Sense::hover());
    ui.painter().rect_filled(r, RAIL_H / 2.0, t.emerald.gamma_multiply(SOFT_ALPHA));
    let full = Rect::from_min_size(r.min, vec2(r.width() * share.clamp(0.0, 1.0) as f32, r.height()));
    ui.painter().rect_filled(full, RAIL_H / 2.0, t.emerald);
}

/// The dark command bar the FFmpeg line is written on.
pub fn ink_bar<R>(ui: &mut Ui, t: &Theme, add: impl FnOnce(&mut Ui) -> R) -> R {
    egui::Frame::new()
        .fill(ink(t))
        .corner_radius(egui::CornerRadius::same(BAR_RADIUS))
        .inner_margin(egui::Margin::symmetric(BAR_PAD[0] as i8, BAR_PAD[1] as i8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            add(ui)
        })
        .inner
}

/// Monospace words on the ink bar, readable by tests.
pub fn ink_words(ui: &mut Ui, t: &Theme, text: &str) -> Response {
    ui.add(egui::Label::new(egui::RichText::new(text).font(mono(FONT_SMALL)).color(on_ink(t))).selectable(false))
}
