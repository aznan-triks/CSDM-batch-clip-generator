//! Controls every tab shares, in the V12 / 3.5.1 look: the option tray (3.5 `Segmented` + `.seg`,
//! `ToggleGroup` + `.cs-mseg`), the switch (`ToggleSwitch`, `.cs-switch`), and the coverage mark
//! (each control that writes a setting records its key, so a tab's coverage guard measures what is
//! really on screen, as 3.5's did).

use crate::paint::{semibold, spaced_galley};
use crate::theme::Theme;
use csdm_core::ui_values::{FONT_SWITCH, SWITCH_GAP, SWITCH_KNOB, SWITCH_TRACK};
use eframe::egui::{self, pos2, vec2, Color32, Pos2, Rect, Response, Sense, Stroke, StrokeKind, Vec2};
use std::collections::BTreeSet;

/// `.seg` / `.cs-mseg` trays and their options.
const TRAY_PAD: f32 = 3.0;
const TRAY_GAP: f32 = 2.0;
const TRAY_RADIUS: f32 = 10.0;
const SEG_PAD: [f32; 2] = [12.0, 6.0];
const MSEG_PAD: [f32; 2] = [8.0, 5.0];
const OPT_RADIUS: f32 = 8.0;
const MSEG_BOX: f32 = 6.0;
const MSEG_BOX_GAP: f32 = 6.0;
pub const FONT_SEG: f32 = 11.5;
const DOT: f32 = 4.0;
/// `.cs-mseg` tray: hair at 55 %; the disabled option at 45 %.
pub const TRAY_HAIR_ALPHA: f32 = 0.55;
const DISABLED_ALPHA: f32 = 0.45;
const SHADOW_ALPHA: f32 = 0.16;
/// `.seg { background: var(--recess) }` (3.5.1 `Segmented.css`), day and night.
const RECESS_DAY: Color32 = Color32::from_rgba_unmultiplied_const(226, 232, 240, 179);
const RECESS_NIGHT: Color32 = Color32::from_rgba_unmultiplied_const(8, 13, 24, 179);
const PCT: f32 = 100.0;
/// `.cs-switch i` (off): `color-mix(in srgb, var(--txt) 20%, transparent)`.
const SWITCH_OFF_PCT: f32 = 20.0;
/// `.cs-switch.on i`: `color-mix(in srgb, var(--lime-ink) 45%, var(--lime-glow))`.
const SWITCH_ON_PCT: f32 = 45.0;
/// `.st-node`: corner, padding (top, sides), row gap, shadow (`--shadow-sm`), title size.
const NODE_RADIUS: u8 = 14;
const NODE_PAD: [i8; 2] = [9, 10];
const NODE_GAP: f32 = 6.0;
const NODE_SHADOW_ALPHA: u8 = 20;
const NODE_SHADOW_OFFSET: [i8; 2] = [0, 4];
const NODE_SHADOW_BLUR: u8 = 12;
const FONT_NODE: f32 = 12.5;
/// `.st-ic`: 26 px tile, 8 px corner, `color-mix(var(--cam-k) 10%, var(--solid))`, 16 px glyph.
const NODE_ICON: f32 = 26.0;
const NODE_ICON_RADIUS: f32 = 8.0;
const NODE_ICON_TINT_PCT: f32 = 10.0;
const NODE_GLYPH: f32 = 16.0;
const NODE_GLYPH_STROKE: f32 = 1.6;
/// `.st-link`: 3 px inset, dashes 5 on / 4 off, the arrow head.
const LINK_INSET: f32 = 3.0;
const LINK_DASH: [f32; 2] = [5.0, 4.0];
const LINK_HEAD: f32 = 6.0;
/// Width of the `.st-link` column (`grid-template-columns: … 28px …`).
pub const LINK_W: f32 = 28.0;

/// Keys written by a control drawn this frame (the coverage guard reads them back).
#[derive(Clone, Default)]
pub struct Seen(pub BTreeSet<String>);

pub fn seen_id() -> egui::Id {
    egui::Id::unique("drawn-setting-keys")
}

/// Records that a control for `key` is on screen.
pub fn mark(ui: &egui::Ui, key: &str) {
    ui.ctx().data_mut(|d| {
        d.get_temp_mut_or_default::<Seen>(seen_id()).0.insert(key.to_string());
    });
}

fn tray(ui: &egui::Ui, t: &Theme, r: Rect, radio: bool) {
    // One-of-N sits in the recess (`.seg`); independent checks in the hairline tray (`.cs-mseg`).
    let fill = if !radio { t.hair.gamma_multiply(TRAY_HAIR_ALPHA).blend(t.surface2.gamma_multiply(TRAY_HAIR_ALPHA)) } else if t.dark { RECESS_NIGHT } else { RECESS_DAY };
    ui.painter().rect(r, TRAY_RADIUS, fill, Stroke::new(1.0, t.hair), StrokeKind::Inside);
}

/// One option of a tray: (visible words, lit, disabled, accessible name, dot colour).
pub struct Opt<'a> {
    pub text: &'a str,
    pub on: bool,
    pub disabled: bool,
    pub name: String,
    pub dot: Option<Color32>,
    pub tip: &'a str,
}

/// Lays out a tray of options; returns the index clicked. `radio`: one-of-N (`.seg`), else
/// independent checks (`.cs-mseg`).
pub fn options_tray(ui: &mut egui::Ui, t: &Theme, opts: &[Opt], radio: bool) -> Option<usize> {
    let pad = if radio { SEG_PAD } else { MSEG_PAD };
    let font = semibold(FONT_SEG);
    let galleys: Vec<_> = opts.iter().map(|o| ui.painter().layout_no_wrap(o.text.to_string(), font.clone(), t.muted)).collect();
    let lead = |o: &Opt| if !radio { MSEG_BOX + MSEG_BOX_GAP } else if o.dot.is_some() { DOT * 2.0 + MSEG_BOX_GAP } else { 0.0 };
    let widths: Vec<f32> = opts.iter().zip(&galleys).map(|(o, g)| g.size().x + pad[0] * 2.0 + lead(o)).collect();
    let h = galleys.first().map_or(0.0, |g| g.size().y) + pad[1] * 2.0;
    let total = widths.iter().sum::<f32>() + TRAY_GAP * (opts.len().saturating_sub(1)) as f32 + TRAY_PAD * 2.0;
    let (rect, _) = ui.allocate_exact_size(vec2(total, h + TRAY_PAD * 2.0), Sense::hover());
    tray(ui, t, rect, radio);
    let mut x = rect.left() + TRAY_PAD;
    let mut clicked = None;
    for (i, (o, g)) in opts.iter().zip(galleys).enumerate() {
        let r = Rect::from_min_size(pos2(x, rect.top() + TRAY_PAD), vec2(widths[i], h));
        x += widths[i] + TRAY_GAP;
        let id = ui.scope_id().with(("opt", &o.name));
        let resp = ui.interact(r, id, if o.disabled { Sense::hover() } else { Sense::click() });
        let name = o.name.clone();
        let (on, enabled) = (o.on, !o.disabled);
        resp.widget_info(|| egui::WidgetInfo::selected(if radio { egui::Role::RadioButton } else { egui::Role::CheckBox }, enabled, on, &name));
        let resp = if o.tip.is_empty() { resp } else { resp.on_hover_text(o.tip) };
        if resp.clicked() && !o.disabled {
            clicked = Some(i);
        }
        if resp.hovered() && !o.disabled {
            crate::cursor::snap_here(ui.ctx(), r);
        }
        let p = ui.painter();
        let ink = match (radio, o.on) {
            (true, true) => t.accent,
            (false, true) => t.lime_ink,
            _ => t.muted,
        };
        let ink = if o.disabled { ink.gamma_multiply(DISABLED_ALPHA) } else { ink };
        if o.on {
            if radio {
                p.rect_filled(r.translate(vec2(0.0, 2.0)), OPT_RADIUS, Color32::BLACK.gamma_multiply(SHADOW_ALPHA / 2.0));
                p.rect_filled(r, OPT_RADIUS, t.solid);
            } else {
                p.rect(r, OPT_RADIUS, t.lime, Stroke::new(1.0, t.lime_glow), StrokeKind::Inside);
            }
        } else if resp.hovered() && !o.disabled {
            p.rect_filled(r, OPT_RADIUS, t.solid.gamma_multiply(TRAY_HAIR_ALPHA));
        }
        let mut tx = r.left() + pad[0];
        if !radio {
            let b = Rect::from_center_size(pos2(tx + MSEG_BOX / 2.0, r.center().y), vec2(MSEG_BOX, MSEG_BOX));
            if o.on {
                p.rect_filled(b, 2.0, t.lime_ink);
            } else {
                p.rect_stroke(b, 2.0, Stroke::new(1.0, ink.gamma_multiply(TRAY_HAIR_ALPHA)), StrokeKind::Middle);
            }
            tx += MSEG_BOX + MSEG_BOX_GAP;
        } else if let Some(c) = o.dot {
            p.circle_filled(pos2(tx + DOT, r.center().y), DOT, c);
            tx += DOT * 2.0 + MSEG_BOX_GAP;
        }
        p.galley(pos2(tx, r.center().y - g.size().y / 2.0), g, ink);
    }
    clicked
}

/// `color-mix(in srgb, a pct%, b)`.
pub fn mix(a: Color32, b: Color32, pct: f32) -> Color32 {
    let k = pct / PCT;
    let ch = |x: u8, y: u8| (f32::from(x) * k + f32::from(y) * (1.0 - k)).round() as u8;
    Color32::from_rgba_unmultiplied(ch(a.r(), b.r()), ch(a.g(), b.g()), ch(a.b(), b.b()), ch(a.a(), b.a()))
}

/// `color-mix(in srgb, c pct%, transparent)`: the colour made translucent (premultiplied).
pub fn fade(c: Color32, pct: f32) -> Color32 {
    c.gamma_multiply(pct / PCT)
}

/// `ToggleSwitch` (`.cs-switch`): the lime track and its words, one accessible checkbox
/// clickable on both (two widgets with one name confuse assistive tools and tests).
pub fn switch(ui: &mut egui::Ui, t: &Theme, label: &str, on: bool) -> Response {
    let ink = if on { t.lime_ink } else { t.muted };
    let g = spaced_galley(ui.painter(), label, semibold(FONT_SWITCH), ink, 0.0);
    let size = Vec2::new(SWITCH_TRACK[0] + SWITCH_GAP + g.size().x, g.size().y.max(SWITCH_TRACK[1]));
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    let name = label.to_string();
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, on, &name));
    let track = Rect::from_min_size(Pos2::new(rect.left(), rect.center().y - SWITCH_TRACK[1] / 2.0), SWITCH_TRACK.into());
    let p = ui.painter();
    let fill = if on { mix(t.lime_ink, t.lime_glow, SWITCH_ON_PCT) } else { fade(t.txt, SWITCH_OFF_PCT) };
    p.rect_filled(track, SWITCH_TRACK[1] / 2.0, fill);
    let inset = (SWITCH_TRACK[1] - SWITCH_KNOB) / 2.0;
    let kx = if on { track.right() - inset - SWITCH_KNOB / 2.0 } else { track.left() + inset + SWITCH_KNOB / 2.0 };
    p.circle_filled(Pos2::new(kx, track.center().y), SWITCH_KNOB / 2.0, Color32::WHITE);
    p.galley(Pos2::new(track.right() + SWITCH_GAP, rect.center().y - g.size().y / 2.0), g, ink);
    if resp.hovered() {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    resp
}

/// `.st-node` (3.5.1 `SettingsCards.css`): a white sub-card with a hairline and a small shadow,
/// its header an icon tile (`.st-ic`) and a bold title, `header` drawn at its right end.
pub fn node<R>(ui: &mut egui::Ui, t: &Theme, icon: NodeIcon, title: &str, header: impl FnOnce(&mut egui::Ui), body: impl FnOnce(&mut egui::Ui) -> R) -> R {
    egui::Frame::new()
        .fill(t.solid)
        .stroke(Stroke::new(1.0, t.hair))
        .corner_radius(egui::CornerRadius::same(NODE_RADIUS))
        .inner_margin(egui::Margin { left: NODE_PAD[1], right: NODE_PAD[1], top: NODE_PAD[0], bottom: NODE_PAD[1] })
        .shadow(egui::epaint::Shadow { offset: NODE_SHADOW_OFFSET, blur: NODE_SHADOW_BLUR, spread: 0, color: Color32::from_black_alpha(NODE_SHADOW_ALPHA) })
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.spacing_mut().item_spacing.y = NODE_GAP;
            ui.horizontal(|ui| {
                let (r, _) = ui.allocate_exact_size(Vec2::splat(NODE_ICON), Sense::hover());
                let p = ui.painter();
                p.rect_filled(r, NODE_ICON_RADIUS, mix(t.accent, t.solid, NODE_ICON_TINT_PCT));
                let g = Rect::from_center_size(r.center(), Vec2::splat(NODE_GLYPH));
                match icon {
                    NodeIcon::Named(n) => crate::icons::paint(p, n, g, t.accent),
                    NodeIcon::Cylinder => cylinder(p, g, t.accent),
                }
                ui.label(egui::RichText::new(title).font(semibold(FONT_NODE)).color(t.txt));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), header);
            });
            body(ui)
        })
        .inner
}

/// What a sub-card's tile shows: a glyph of the icon set, or the database cylinder (3.5.1 `db`).
#[derive(Clone, Copy)]
pub enum NodeIcon {
    Named(&'static str),
    Cylinder,
}

fn cylinder(p: &egui::Painter, r: Rect, ink: Color32) {
    let s = Stroke::new(NODE_GLYPH_STROKE, ink);
    let rx = r.width() / 2.0 - NODE_GLYPH_STROKE;
    let ry = r.height() / 6.0;
    let (top, bottom) = (r.top() + ry + NODE_GLYPH_STROKE, r.bottom() - ry - NODE_GLYPH_STROKE);
    for y in [top, (top + bottom) / 2.0, bottom] {
        p.add(egui::Shape::ellipse_stroke(pos2(r.center().x, y), vec2(rx, ry), s));
    }
    p.line_segment([pos2(r.center().x - rx, top), pos2(r.center().x - rx, bottom)], s);
    p.line_segment([pos2(r.center().x + rx, top), pos2(r.center().x + rx, bottom)], s);
}

/// `.st-link`: the dashed accent arrow between two sub-cards, `width` wide, centred in `height`.
pub fn link_arrow(ui: &mut egui::Ui, t: &Theme, width: f32, height: f32) {
    let (r, _) = ui.allocate_exact_size(vec2(width, height), Sense::hover());
    let y = r.center().y;
    let (a, b) = (r.left() + LINK_INSET, r.right() - LINK_INSET);
    let s = Stroke::new(2.0, t.accent);
    ui.painter().add(egui::Shape::dashed_line(&[pos2(a, y), pos2(b - LINK_HEAD, y)], s, LINK_DASH[0], LINK_DASH[1]));
    ui.painter().add(egui::Shape::convex_polygon(vec![pos2(b, y), pos2(b - LINK_HEAD, y - LINK_HEAD / 2.0 - 1.0), pos2(b - LINK_HEAD, y + LINK_HEAD / 2.0 + 1.0)], t.accent, Stroke::NONE));
}
