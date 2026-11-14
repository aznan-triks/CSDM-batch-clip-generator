//! A time axis whose bars are the control (3.5 `cardstyle/ClipTimeline.tsx`): drag a handle, or
//! focus it and press ← →, to move one edge, snapped to whole seconds. Generic: it knows seconds,
//! spans, handles and markers, never which setting a handle stands for (EDITING reuses it, T8).
//!
//! The scale fits `extent` to the width; while a handle is dragged the scale stays frozen (a scale
//! that re-fits under the pointer makes the handle run away from it) and re-fits on release.

use crate::paint::{mono, regular, semibold};
use crate::theme::Theme;
use csdm_core::ui_values::{CLIP_TIMELINE_EDGE, CLIP_TIMELINE_MAJOR_EVERY};
use eframe::egui::{self, pos2, vec2, Align2, Color32, Pos2, Rect, Sense, Stroke, StrokeKind};

/// `.cs-tl-*` geometry (cardstyle.css), in px from the top of the axis.
const AXIS_H: f32 = 176.0;
const BAR_TOP: f32 = 44.0;
const BAR_H: f32 = 36.0;
const LINK_TOP: f32 = 60.0;
const LINK_H: f32 = 4.0;
const MARK_TOP: f32 = 26.0;
const MARK_H: f32 = 66.0;
const BADGE_TOP: f32 = 6.0;
const HANDLE_TOP: f32 = 38.0;
const HANDLE: [f32; 2] = [14.0, 48.0];
const HANDLE_GRIP: [f32; 2] = [3.0, 16.0];
const READOUT_TOP: f32 = 90.0;
const LINE_TOP: f32 = 116.0;
const TICK: [f32; 2] = [112.0, 5.0];
const TICK_MAJOR: [f32; 2] = [110.0, 9.0];
const TICK_LABEL_TOP: f32 = 122.0;
const BRACKET_TOP: f32 = 144.0;
const BRACKET_H: f32 = 10.0;
const BRACKET_LABEL_TOP: f32 = 156.0;
const RADIUS: f32 = 14.0;
const BAR_RADIUS: f32 = 9.0;
const STRIPE: f32 = 6.0;
const DASH: [f32; 2] = [3.0, 4.0];
const FOCUS_RING: f32 = 4.0;
const FONT_SPAN: f32 = 11.5;
const FONT_SPAN_SMALL: f32 = 10.0;
const FONT_BADGE: f32 = 10.0;
const FONT_READOUT: f32 = 10.5;
const FONT_TICK: f32 = 9.5;
const FONT_BRACKET: f32 = 10.5;
const BADGE_PAD: [f32; 2] = [8.0, 3.0];
const READOUT_PAD: [f32; 2] = [6.0, 1.0];
const CROSSHAIR: f32 = 5.0;
/// `color-mix` percentages of the `.cs-tl-*` rules.
const SECOND_LINE_PCT: f32 = 5.0;
const REST_STRIPES_PCT: [f32; 2] = [10.0, 18.0];
const GHOST_STRIPES_PCT: [f32; 2] = [4.0, 9.0];
const GHOST_EDGE_PCT: f32 = 45.0;
const LINK_PCT: f32 = 35.0;
const GHOST_MARK_PCT: f32 = 55.0;
const LINE_INK_PCT: f32 = 14.0;
const TICK_INK_PCT: [f32; 2] = [25.0, 35.0];
const SPAN_LIGHT_PCT: f32 = 80.0;
const PCT: f32 = 100.0;
/// Bracket caption: words before, bold part, words after.
const BRACKET_PARTS: usize = 3;
const ARC_STEPS: usize = 6;
/// A quarter turn, and where each corner's arc starts (in turns).
const QUARTER_TURN: f32 = 0.25;
const CORNER_STARTS: [f32; 4] = [-0.25, 0.0, 0.25, 0.5];
/// `.cs-tl` background: solid at 62 % over, solid mixed 40 % with hair-2 under.
const BOX_TOP_ALPHA: f32 = 0.62;
const BOX_BOTTOM_PCT: f32 = 40.0;
const THIN: f32 = 1.5;
const GRIP_ALPHA: f32 = 0.6;
const SMALL_ALPHA: f32 = 0.8;
const REST_BASE_PCT: f32 = 6.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone { Primary, Alt, Rest }

pub struct Span {
    pub from: f64,
    pub to: f64,
    pub tone: Tone,
    pub label: String,
    /// Smaller words after the label ("after", "killer").
    pub small: String,
}

pub struct Handle {
    pub id: &'static str,
    pub at: f64,
    pub alt: bool,
    /// Accessible name ("Seconds before").
    pub label: String,
    /// Text under the handle ("−5s").
    pub readout: String,
    pub value: f64,
    pub tip: String,
}

pub struct Marker {
    pub at: f64,
    pub label: String,
    pub ghost: bool,
}

#[derive(Default)]
pub struct Timeline {
    pub spans: Vec<Span>,
    pub handles: Vec<Handle>,
    pub markers: Vec<Marker>,
    /// A dashed second span (the next moment that would join this clip).
    pub ghost: Option<(f64, f64, String)>,
    /// A dotted link between two seconds.
    pub link: Option<(f64, f64)>,
    /// A bracket under the axis: from, to, words before the bold part, bold part, words after.
    pub bracket: Option<(f64, f64, [String; BRACKET_PARTS])>,
    /// Seconds that must be visible.
    pub extent: (f64, f64),
}

/// `fit`: seconds → pixels for a width.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Scale {
    pub t0: f64,
    pub t1: f64,
    pub pps: f64,
}

impl Scale {
    pub fn fit(extent: (f64, f64), width: f32) -> Self {
        let span = (extent.1 - extent.0).max(1.0);
        Scale { t0: extent.0, t1: extent.1, pps: f64::from(width - CLIP_TIMELINE_EDGE * 2.0).max(1.0) / span }
    }
    /// Distance from the axis's left edge.
    pub fn x(&self, t: f64) -> f32 {
        CLIP_TIMELINE_EDGE + ((t - self.t0) * self.pps) as f32
    }
    /// The whole second under a distance from the left edge.
    pub fn second_at(&self, dx: f32) -> f64 {
        (self.t0 + f64::from(dx - CLIP_TIMELINE_EDGE) / self.pps).round()
    }
}

fn mix(a: Color32, b: Color32, pct_a: f32) -> Color32 {
    a.lerp_to_gamma(b, 1.0 - pct_a / PCT)
}

fn stripes(p: &egui::Painter, r: Rect, a: Color32, b: Color32) {
    // 135° stripes: diagonal bands every STRIPE px, clipped to the rect.
    let p = p.with_clip_rect(r.intersect(p.clip_rect()));
    p.rect_filled(r, 0.0, a);
    let mut x = r.left() - r.height();
    let mut odd = false;
    while x < r.right() {
        if odd {
            let pts = vec![pos2(x, r.bottom()), pos2(x + STRIPE, r.bottom()), pos2(x + STRIPE + r.height(), r.top()), pos2(x + r.height(), r.top())];
            p.add(egui::Shape::convex_polygon(pts, b, Stroke::NONE));
        }
        odd = !odd;
        x += STRIPE;
    }
}

fn dashed_h(p: &egui::Painter, y: f32, x0: f32, x1: f32, color: Color32, width: f32) {
    p.add(egui::Shape::dashed_line(&[pos2(x0, y), pos2(x1, y)], Stroke::new(width, color), DASH[0], DASH[1]));
}

fn crosshair(p: &egui::Painter, c: Pos2, color: Color32) {
    let s = Stroke::new(1.0, color);
    p.circle_stroke(c, CROSSHAIR * GRIP_ALPHA, s);
    p.line_segment([pos2(c.x, c.y - CROSSHAIR), pos2(c.x, c.y - CROSSHAIR / 2.0)], s);
    p.line_segment([pos2(c.x, c.y + CROSSHAIR / 2.0), pos2(c.x, c.y + CROSSHAIR)], s);
    p.line_segment([pos2(c.x - CROSSHAIR, c.y), pos2(c.x - CROSSHAIR / 2.0, c.y)], s);
    p.line_segment([pos2(c.x + CROSSHAIR / 2.0, c.y), pos2(c.x + CROSSHAIR, c.y)], s);
}

/// A rounded rect filled with a top-to-bottom gradient: its outline as a fan, coloured by height.
fn gradient_rect(r: Rect, round: egui::CornerRadius, top: Color32, bottom: Color32) -> egui::Mesh {
    let [ne, se, sw, nw] = CORNER_STARTS;
    let corners = [(r.right_top(), f32::from(round.ne), ne), (r.right_bottom(), f32::from(round.se), se), (r.left_bottom(), f32::from(round.sw), sw), (r.left_top(), f32::from(round.nw), nw)];
    let mut outline = Vec::new();
    for (corner, rad, start) in corners {
        // Each corner's arc centre sits `rad` inside the rect, towards its middle.
        let c = pos2(corner.x - rad * (corner.x - r.center().x).signum(), corner.y - rad * (corner.y - r.center().y).signum());
        for k in 0..=ARC_STEPS {
            let a = std::f32::consts::TAU * (start + QUARTER_TURN * k as f32 / ARC_STEPS as f32);
            outline.push(c + vec2(a.cos(), a.sin()) * rad);
        }
    }
    let mut mesh = egui::Mesh::default();
    let shade = |y: f32| top.lerp_to_gamma(bottom, ((y - r.top()) / r.height()).clamp(0.0, 1.0));
    mesh.colored_vertex(r.center(), shade(r.center().y));
    for p in &outline {
        mesh.colored_vertex(*p, shade(p.y));
    }
    let n = outline.len() as u32;
    for i in 0..n {
        mesh.add_triangle(0, 1 + i, 1 + (i + 1) % n);
    }
    mesh
}

/// Draws the timeline; returns (handle index, new second) when a handle was moved.
pub fn show(ui: &mut egui::Ui, t: &Theme, id_salt: &str, tl: &Timeline, name: &str) -> Option<(usize, f64)> {
    let id = ui.make_persistent_id(("clip-timeline", id_salt));
    let width = ui.available_width();
    let (outer, _) = ui.allocate_exact_size(vec2(width, AXIS_H), Sense::hover());
    let frozen: Option<Scale> = ui.data(|d| d.get_temp(id));
    let scale = frozen.unwrap_or_else(|| Scale::fit(tl.extent, width));
    let x = |s: f64| outer.left() + scale.x(s);
    let y = |dy: f32| outer.top() + dy;
    let p = ui.painter().with_clip_rect(outer.intersect(ui.clip_rect()));
    let (cam_k, cam_v) = (t.accent, t.emerald);

    // Box: two-stop gradient of the solid surface, hairline, one faint line per second.
    crate::paint::vgradient(&p, outer, t.solid.gamma_multiply(BOX_TOP_ALPHA), mix(t.solid, t.hair2, BOX_BOTTOM_PCT));
    let mut s = scale.t0.ceil();
    while s <= scale.t1 {
        p.line_segment([pos2(x(s), outer.top()), pos2(x(s), outer.bottom())], Stroke::new(1.0, t.accent_alpha(SECOND_LINE_PCT)));
        s += 1.0;
    }
    p.rect_stroke(outer, RADIUS, Stroke::new(1.0, t.hair), StrokeKind::Inside);

    // Axis line, ticks, labels every MAJOR seconds.
    let ink = |pct: f32| t.txt.gamma_multiply(pct / PCT);
    p.line_segment([pos2(outer.left(), y(LINE_TOP)), pos2(outer.right(), y(LINE_TOP))], Stroke::new(1.0, ink(LINE_INK_PCT)));
    let mut s = scale.t0.ceil();
    while s <= scale.t1 {
        let major = (s as i64) % CLIP_TIMELINE_MAJOR_EVERY == 0;
        let [top, h] = if major { TICK_MAJOR } else { TICK };
        p.line_segment([pos2(x(s), y(top)), pos2(x(s), y(top + h))], Stroke::new(1.0, ink(if major { TICK_INK_PCT[1] } else { TICK_INK_PCT[0] })));
        if major {
            let label = if s > 0.0 { format!("+{}s", s as i64) } else { format!("{}s", s as i64) };
            p.text(pos2(x(s), y(TICK_LABEL_TOP)), Align2::CENTER_TOP, label, mono(FONT_TICK), t.faint);
        }
        s += 1.0;
    }

    if let Some((a, b)) = tl.link {
        let r = Rect::from_min_max(pos2(x(a), y(LINK_TOP)), pos2(x(b), y(LINK_TOP + LINK_H)));
        dashed_h(&p, r.center().y, r.left(), r.right(), t.accent_alpha(LINK_PCT), LINK_H);
    }
    if let Some((a, b, label)) = &tl.ghost {
        let r = Rect::from_min_max(pos2(x(*a), y(BAR_TOP)), pos2(x(*b), y(BAR_TOP + BAR_H)));
        let clip = p.with_clip_rect(r.intersect(p.clip_rect()));
        stripes(&clip, r, t.accent_alpha(GHOST_STRIPES_PCT[0]), t.accent_alpha(GHOST_STRIPES_PCT[1]));
        p.rect_stroke(r, BAR_RADIUS, Stroke::new(THIN, t.accent_alpha(GHOST_EDGE_PCT)), StrokeKind::Inside);
        clip.text(pos2(r.left() + BADGE_PAD[0], r.center().y), Align2::LEFT_CENTER, label, regular(FONT_SPAN_SMALL), t.accent);
    }

    // The clip bar: one segment per span.
    for sp in &tl.spans {
        let r = Rect::from_min_max(pos2(x(sp.from), y(BAR_TOP)), pos2(x(sp.to), y(BAR_TOP + BAR_H)));
        if r.width() <= 0.0 {
            continue;
        }
        let first = std::ptr::eq(sp, &tl.spans[0]);
        let last = std::ptr::eq(sp, tl.spans.last().expect("one span"));
        let round = egui::CornerRadius { nw: if first { BAR_RADIUS as u8 } else { 0 }, sw: if first { BAR_RADIUS as u8 } else { 0 }, ne: if last { BAR_RADIUS as u8 } else { 0 }, se: if last { BAR_RADIUS as u8 } else { 0 } };
        let seg = p.with_clip_rect(r.intersect(p.clip_rect()));
        let ink = match sp.tone {
            Tone::Primary | Tone::Alt => {
                let c = if sp.tone == Tone::Primary { cam_k } else { cam_v };
                seg.add(gradient_rect(r, round, mix(c, Color32::WHITE, SPAN_LIGHT_PCT), c));
                Color32::WHITE
            }
            Tone::Rest => {
                seg.rect_filled(r, round, mix(t.accent, t.solid, REST_BASE_PCT));
                stripes(&seg, r, t.accent_alpha(REST_STRIPES_PCT[0]), t.accent_alpha(REST_STRIPES_PCT[1]));
                t.accent
            }
        };
        let big = p.layout_no_wrap(sp.label.clone(), semibold(FONT_SPAN), ink);
        let small = p.layout_no_wrap(sp.small.clone(), regular(FONT_SPAN_SMALL), ink.gamma_multiply(SMALL_ALPHA));
        let gap = if sp.small.is_empty() { 0.0 } else { CROSSHAIR };
        let w = big.size().x + gap + small.size().x;
        if w <= r.width() {
            let left = r.center().x - w / 2.0;
            seg.galley(pos2(left, r.center().y - big.size().y / 2.0), big, ink);
            seg.galley(pos2(left + w - small.size().x, r.center().y - small.size().y / 2.0), small, ink);
        }
    }
    // Rounded ends over the rest stripes (they paint square).
    if let (Some(f), Some(l)) = (tl.spans.first(), tl.spans.last()) {
        let r = Rect::from_min_max(pos2(x(f.from), y(BAR_TOP)), pos2(x(l.to), y(BAR_TOP + BAR_H)));
        p.rect_stroke(r, BAR_RADIUS, Stroke::new(1.0, t.hair), StrokeKind::Outside);
    }

    for m in &tl.markers {
        let mx = x(m.at);
        if m.ghost {
            p.add(egui::Shape::dashed_line(&[pos2(mx, y(MARK_TOP)), pos2(mx, y(MARK_TOP + MARK_H))], Stroke::new(2.0, t.accent_alpha(GHOST_MARK_PCT)), DASH[0], DASH[1]));
        } else {
            p.line_segment([pos2(mx, y(MARK_TOP)), pos2(mx, y(MARK_TOP + MARK_H))], Stroke::new(2.0, t.txt));
        }
        let (fill, ink) = if m.ghost { (t.solid, t.accent) } else { (t.txt, t.solid) };
        let g = p.layout_no_wrap(m.label.clone(), semibold(FONT_BADGE), ink);
        let bw = g.size().x + CROSSHAIR * 2.0 + BADGE_PAD[0] + BADGE_PAD[1] * 2.0;
        let r = Rect::from_min_size(pos2(mx - bw / 2.0, y(BADGE_TOP)), vec2(bw, g.size().y + BADGE_PAD[1] * 2.0));
        p.rect(r, BAR_RADIUS - 2.0, fill, if m.ghost { Stroke::new(1.0, t.accent_alpha(GHOST_MARK_PCT)) } else { Stroke::NONE }, StrokeKind::Inside);
        crosshair(&p, pos2(r.left() + BADGE_PAD[1] * 2.0 + CROSSHAIR, r.center().y), ink);
        p.galley(pos2(r.right() - BADGE_PAD[0] - g.size().x, r.center().y - g.size().y / 2.0), g, ink);
    }

    if let Some((a, b, words)) = &tl.bracket {
        let r = Rect::from_min_max(pos2(x(*a), y(BRACKET_TOP)), pos2(x(*b), y(BRACKET_TOP + BRACKET_H)));
        let s = Stroke::new(THIN, t.accent_alpha(GHOST_EDGE_PCT));
        p.line_segment([r.left_top(), r.left_bottom()], s);
        p.line_segment([r.left_bottom(), r.right_bottom()], s);
        p.line_segment([r.right_top(), r.right_bottom()], s);
        let mut job = egui::text::LayoutJob::default();
        let fmt = |c: Color32, f: egui::FontId| egui::TextFormat { font_id: f, color: c, ..Default::default() };
        job.append(&words[0], 0.0, fmt(t.muted, regular(FONT_BRACKET)));
        job.append(&words[1], 0.0, fmt(t.accent, semibold(FONT_BRACKET)));
        job.append(&words[2], 0.0, fmt(t.muted, regular(FONT_BRACKET)));
        let g = p.layout_job(job);
        p.galley(pos2(r.center().x - g.size().x / 2.0, y(BRACKET_LABEL_TOP)), g, t.muted);
    }

    // Handles: one focusable slider each.
    let mut moved = None;
    for (i, h) in tl.handles.iter().enumerate() {
        let hx = x(h.at);
        let rect = Rect::from_min_size(pos2(hx - HANDLE[0] / 2.0, y(HANDLE_TOP)), vec2(HANDLE[0], HANDLE[1]));
        let hid = id.with(h.id);
        let resp = ui.interact(rect, hid, Sense::click_and_drag());
        let label = h.label.clone();
        let (value, readout) = (h.value, h.readout.clone());
        resp.widget_info(|| {
            let mut info = egui::WidgetInfo::labeled(egui::Role::Slider, true, &label);
            info.value = Some(value);
            info.current_text_value = Some(readout.clone());
            info
        });
        let resp = resp.on_hover_text(&h.tip);
        if resp.drag_started() || resp.is_pointer_button_down_on() {
            ui.data_mut(|d| d.insert_temp(id, scale));
            resp.request_focus();
        }
        if resp.dragged() {
            if let Some(pos) = resp.interact_pointer_pos() {
                let at = scale.second_at(pos.x - outer.left());
                if at != h.at {
                    moved = Some((i, at));
                }
            }
        }
        if resp.drag_stopped() || (!resp.dragged() && !resp.is_pointer_button_down_on() && frozen.is_some() && !tl.handles.iter().any(|o| ui.ctx().is_being_dragged(id.with(o.id)))) {
            ui.data_mut(|d| d.remove::<Scale>(id));
        }
        if resp.has_focus() {
            let step = ui.input(|inp| {
                if inp.key_pressed(egui::Key::ArrowLeft) || inp.key_pressed(egui::Key::ArrowDown) { -1.0 }
                else if inp.key_pressed(egui::Key::ArrowRight) || inp.key_pressed(egui::Key::ArrowUp) { 1.0 }
                else { 0.0 }
            });
            if step != 0.0 {
                moved = Some((i, h.at + step));
            }
        }
        let cam = if h.alt { cam_v } else { cam_k };
        let lit = resp.hovered() || resp.has_focus() || resp.dragged();
        if lit {
            p.rect_filled(rect.expand(FOCUS_RING), HANDLE[0] / 2.0 + FOCUS_RING, t.accent_soft);
        }
        p.rect(rect, HANDLE[0] / 2.0, t.solid, Stroke::new(2.0, cam), StrokeKind::Inside);
        let g = Rect::from_center_size(rect.center(), vec2(HANDLE_GRIP[0], HANDLE_GRIP[1]));
        let gs = Stroke::new(THIN, cam.gamma_multiply(GRIP_ALPHA));
        p.line_segment([g.left_top(), g.left_bottom()], gs);
        p.line_segment([g.right_top(), g.right_bottom()], gs);
        if lit {
            crate::cursor::snap_here(ui.ctx(), rect);
        }
        let gal = p.layout_no_wrap(h.readout.clone(), mono(FONT_READOUT), cam);
        let rr = Rect::from_min_size(pos2(hx - gal.size().x / 2.0 - READOUT_PAD[0], y(READOUT_TOP)), gal.size() + vec2(READOUT_PAD[0], READOUT_PAD[1]) * 2.0);
        p.rect(rr, READOUT_PAD[0], t.solid, Stroke::new(1.0, t.hair), StrokeKind::Inside);
        p.galley(rr.min + vec2(READOUT_PAD[0], READOUT_PAD[1]), gal, cam);
    }
    let name = name.to_string();
    ui.interact(outer, id.with("group"), Sense::hover()).widget_info(|| egui::WidgetInfo::labeled(egui::Role::Group, true, &name));
    moved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_maps_seconds_and_back() {
        let s = Scale::fit((-7.0, 18.5), 18.0 * 2.0 + 255.0);
        assert!((s.pps - 10.0).abs() < 1e-9);
        assert_eq!(s.x(-7.0), 18.0);
        assert_eq!(s.second_at(s.x(3.0) + 4.0), 3.0);
        assert_eq!(s.second_at(s.x(3.0) + 6.0), 4.0);
    }
}
