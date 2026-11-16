//! Drawing pieces of the TAGS cards (TagCards.css, CloseButton.css, cardstyle.css `.cs-switch`).

use super::TagRow;
use crate::paint::{regular, semibold, spaced_galley};
use crate::theme::{parse_hex, Theme};
use csdm_core::ui_values::{
    CHIP_PAD, FONT_CHIP, FONT_KICK, FONT_SMALL, FONT_TAG_PILL, SPACING_KICK, SWITCH_GAP, TAG_CHIP_DOT, TAG_CLOSE_PAD, TAG_PILL_DOT, TAG_PILL_EDGE_PCT, TAG_PILL_H, TAG_PILL_PAD, TAG_PILL_TINT_PCT,
};
pub use crate::controls::{fade, mix, switch};
use crate::controls::{options_tray, Opt};
use eframe::egui::{self, Color32, CornerRadius, Pos2, Rect, Response, Sense, Stroke, StrokeKind, Vec2};

/// `.chip:hover` border: `color-mix(in srgb, var(--accent) 28%, transparent)`.
const HOVER_EDGE_PCT: f32 = 28.0;
/// The delete half (`.close-btn`); its hover ink is the theme rose (`--blood-t`).
const CLOSE_GLYPH: &str = "×";
const TICK_GLYPH: &str = "✓";
/// `.tg-create-name`: corner and padding of a text field.
const FIELD_RADIUS: u8 = 9;
const FIELD_PAD: [i8; 2] = [10, 6];
/// The tick box: side, corner, stroke, and its check mark as fractions of the side.
const TICK_BOX: f32 = 14.0;
const TICK_RADIUS: f32 = 4.0;
const TICK_STROKE: f32 = 2.0;
const TICK_MARK: [Vec2; 3] = [Vec2::new(0.25, 0.52), Vec2::new(0.43, 0.70), Vec2::new(0.76, 0.32)];


/// A text field drawn like the mock's inputs: solid fill, hairline, rounded; faint hint.
/// egui paints the hint in the visuals' weak text colour whatever the hint's own colour, so the
/// field is drawn in a scope that sets it (the shell's dark visuals make it unreadable otherwise).
pub fn field(ui: &mut egui::Ui, t: &Theme, text: &mut String, hint: &str, width: f32) -> Response {
    ui.scope(|ui| {
        ui.visuals_mut().weak_text_color = Some(t.faint);
        let edit = egui::TextEdit::singleline(text)
            .hint_text(hint)
            .text_color(t.txt)
            .frame(egui::Frame::new().fill(t.solid).stroke(Stroke::new(1.0, t.hair)).corner_radius(FIELD_RADIUS).inner_margin(egui::Margin::symmetric(FIELD_PAD[0], FIELD_PAD[1])))
            .desired_width(width);
        ui.add(edit)
    })
    .inner
}

/// A tag's own colour; an unreadable one falls back to the faint ink (3.5 drew it as given).
pub fn tag_color(t: &Theme, text: &str) -> Color32 {
    parse_hex(text).map_or(t.faint, |[r, g, b]| Color32::from_rgb(r, g, b))
}

fn named(resp: &Response, role: egui::Role, enabled: bool, name: &str, selected: Option<bool>) {
    resp.widget_info(|| match selected {
        Some(v) => egui::WidgetInfo::selected(role, enabled, v, name),
        None => egui::WidgetInfo::labeled(role, enabled, name),
    });
}

/// `.sx-kick`: a small upper-case label.
pub fn kicker(ui: &mut egui::Ui, t: &Theme, text: &str) {
    let g = spaced_galley(ui.painter(), &text.to_uppercase(), semibold(FONT_KICK), t.faint, SPACING_KICK);
    let (rect, _) = ui.allocate_exact_size(g.size(), Sense::hover());
    ui.painter().galley(rect.min, g, t.faint);
}

/// A small muted line (`.tg-status`, `.tg-empty`, `.tgr-now`).
pub fn note(ui: &mut egui::Ui, t: &Theme, text: &str, color: Color32) {
    let _ = t;
    ui.label(egui::RichText::new(text).font(regular(FONT_SMALL)).color(color));
}

/// A palette chip (`TagChip`): the tag's dot and name, lime when active, with its delete half.
/// Returns (toggle, delete).
pub fn tag_chip(ui: &mut egui::Ui, t: &Theme, tag: &TagRow, on: bool) -> (Response, Response) {
    let font = if on { semibold(FONT_CHIP) } else { regular(FONT_CHIP) };
    let ink = if on { t.lime_ink } else { t.muted };
    let g = spaced_galley(ui.painter(), &tag.name, font, ink, 0.0);
    let h = g.size().y + CHIP_PAD[1] * 2.0;
    let left_w = CHIP_PAD[0] + TAG_CHIP_DOT + SWITCH_GAP + g.size().x + CHIP_PAD[0];
    let x = spaced_galley(ui.painter(), CLOSE_GLYPH, semibold(FONT_CHIP), t.muted, 0.0);
    let right_w = TAG_CLOSE_PAD[0] + x.size().x + TAG_CLOSE_PAD[1];
    let (rect, _) = ui.allocate_exact_size(Vec2::new(left_w + right_w, h), Sense::hover());
    let left = Rect::from_min_size(rect.min, Vec2::new(left_w, h));
    let right = Rect::from_min_max(Pos2::new(left.right(), rect.top()), rect.max);
    let toggle = ui.interact(left, ui.scope_id().with(("tag", &tag.name)), Sense::click());
    let delete = ui.interact(right, ui.scope_id().with(("delete-tag", &tag.name)), Sense::click());
    named(&toggle, egui::Role::CheckBox, true, &format!("tag-{}", tag.name), Some(on));
    named(&delete, egui::Role::Button, true, &format!("delete-tag-{}", tag.name), None);
    let r = h / 2.0;
    let radius = r as u8;
    let (fill, edge) = if on { (t.lime, t.lime_glow) } else { (t.solid, t.hair) };
    let edge_left = if toggle.hovered() && !on { t.accent_alpha(HOVER_EDGE_PCT) } else { edge };
    let p = ui.painter();
    p.rect(left, CornerRadius { nw: radius, sw: radius, ne: 0, se: 0 }, fill, Stroke::new(1.0, edge_left), StrokeKind::Inside);
    let close_edge = if delete.hovered() { t.rose } else { t.hair };
    p.rect(right, CornerRadius { nw: 0, sw: 0, ne: radius, se: radius }, t.solid, Stroke::new(1.0, close_edge), StrokeKind::Inside);
    let dot = Pos2::new(left.left() + CHIP_PAD[0] + TAG_CHIP_DOT / 2.0, left.center().y);
    p.circle_filled(dot, TAG_CHIP_DOT / 2.0, tag_color(t, &tag.color));
    p.galley(Pos2::new(dot.x + TAG_CHIP_DOT / 2.0 + SWITCH_GAP, left.center().y - g.size().y / 2.0), g, ink);
    let xc = if delete.hovered() { t.rose } else { t.muted };
    p.galley(Pos2::new(right.left() + TAG_CLOSE_PAD[0], right.center().y - x.size().y / 2.0), x, xc);
    for resp in [&toggle, &delete] {
        if resp.hovered() {
            crate::cursor::snap_here(ui.ctx(), resp.rect);
        }
    }
    (toggle, delete)
}

/// An active tag in the tray (`.tg-pill`): click to stop using it.
pub fn tray_pill(ui: &mut egui::Ui, t: &Theme, tag: &TagRow) -> Response {
    let c = tag_color(t, &tag.color);
    let g = spaced_galley(ui.painter(), &tag.name, semibold(FONT_TAG_PILL), t.txt, 0.0);
    let ck = spaced_galley(ui.painter(), TICK_GLYPH, semibold(FONT_SMALL), c, 0.0);
    let gap = SWITCH_GAP - 1.0;
    let w = TAG_PILL_PAD[0] + TAG_PILL_DOT + gap + g.size().x + gap + ck.size().x + TAG_PILL_PAD[1];
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(w, TAG_PILL_H), Sense::click());
    named(&resp, egui::Role::Button, true, &format!("in-use-{}", tag.name), None);
    let p = ui.painter();
    p.rect(rect, TAG_PILL_H / 2.0, mix(c, t.solid, TAG_PILL_TINT_PCT), Stroke::new(1.0, fade(c, TAG_PILL_EDGE_PCT)), StrokeKind::Inside);
    let dot = Pos2::new(rect.left() + TAG_PILL_PAD[0] + TAG_PILL_DOT / 2.0, rect.center().y);
    p.circle_filled(dot, TAG_PILL_DOT / 2.0, c);
    let tx = dot.x + TAG_PILL_DOT / 2.0 + gap;
    p.galley(Pos2::new(tx, rect.center().y - g.size().y / 2.0), g.clone(), t.txt);
    p.galley(Pos2::new(tx + g.size().x + gap, rect.center().y - ck.size().y / 2.0), ck, c);
    if resp.hovered() {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    resp
}


/// A thin vertical separator (`.tg-foot-sep`).
pub fn separator(ui: &mut egui::Ui, t: &Theme, height: f32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(1.0, height), Sense::hover());
    ui.painter().rect_filled(rect, 0.0, t.hair);
}

/// A tick box and its label (the found list's `input[type=checkbox]`): accent when on.
pub fn tick(ui: &mut egui::Ui, t: &Theme, label: &str, on: bool, ink: Color32) -> Response {
    let g = spaced_galley(ui.painter(), label, regular(FONT_SMALL), ink, 0.0);
    let size = Vec2::new(TICK_BOX + SWITCH_GAP + g.size().x, g.size().y.max(TICK_BOX));
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    named(&resp, egui::Role::CheckBox, true, label, Some(on));
    let b = Rect::from_min_size(Pos2::new(rect.left(), rect.center().y - TICK_BOX / 2.0), Vec2::splat(TICK_BOX));
    let p = ui.painter();
    let edge = if resp.hovered() { t.accent } else { t.hair };
    if on {
        p.rect_filled(b, TICK_RADIUS, t.accent);
        let pts = [b.left_top() + TICK_MARK[0] * b.width(), b.left_top() + TICK_MARK[1] * b.width(), b.left_top() + TICK_MARK[2] * b.width()];
        p.line(pts.to_vec(), Stroke::new(TICK_STROKE, Color32::WHITE));
    } else {
        p.rect(b, TICK_RADIUS, t.solid, Stroke::new(1.0, edge), StrokeKind::Inside);
    }
    p.galley(Pos2::new(b.right() + SWITCH_GAP, rect.center().y - g.size().y / 2.0), g, ink);
    resp
}

/// The segmented control (`Segmented`, the mock's `.seg`), drawn by the shared tray. Returns the
/// index clicked, if any. Each segment is named `<prefix>-<word>`.
pub fn segmented(ui: &mut egui::Ui, t: &Theme, words: &[&str], chosen: usize, prefix: &str, tip: &str) -> Option<usize> {
    let opts: Vec<Opt> = words.iter().enumerate().map(|(k, w)| Opt { text: w, on: k == chosen, disabled: false, name: format!("{prefix}-{w}"), dot: None, tip }).collect();
    options_tray(ui, t, &opts, true)
}
