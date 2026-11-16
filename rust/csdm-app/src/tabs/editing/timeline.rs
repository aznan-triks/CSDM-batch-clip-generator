//! The EDITING timeline (3.5 `tabs/editing/EditingTimeline.tsx`): one lane per demo, each clip a
//! block on the demo's own time axis, its events as marks inside it. One zoom (pixels per second)
//! for every lane, so the same second lines up down the page.
//!
//! Bounded by construction: the tab pages the lanes, and only the blocks the scroll window shows
//! (plus an overscan) are drawn and given a widget; event marks only in a block wide enough.
//! The lane tracks scroll in egui's own scroll area; the demo names and the ruler stay outside it
//! and are painted with its offset, so they never leave the view. A zoom step sets the scroll
//! offset in the same frame: the second under the pointer does not move.

use super::{kind_color, mix, SP};
use crate::paint::{mono, regular, semibold};
use crate::theme::Theme;
use crate::widgets::chip;
use csdm_core::editing::{clamp_pps, event_meta, format_clock, ruler_ticks, zoom_scroll, EditedWindow, Lane, Preview, PreviewClip};
use csdm_core::ui_values::{
    EDITING_BLOCK, EDITING_BLOCK_MIN, EDITING_LABEL_WIDTH, EDITING_LANE_HEIGHT, EDITING_MARKS_MIN, EDITING_OVERSCAN, EDITING_RULER_HEIGHT, EDITING_ZOOM_STEP, FONT_SMALL,
};
use eframe::egui::{self, pos2, vec2, Align, Align2, Color32, Layout, Painter, Pos2, Rect, Sense, Stroke, StrokeKind};

/// `.edtl { min-height: 120px }`.
pub const MIN_HEIGHT: f32 = 120.0;
const HINT: &str = "Click a clip to edit it · Ctrl + wheel to zoom";
/// `.edtl-zoom { min-width: 9ch }`.
const ZOOM_WIDTH: f32 = 74.0;
/// `.edtl-clip`: radius, edge, the lit top of a kept block, the stripes of a left-out one.
const BLOCK_RADIUS: f32 = 5.0;
const EDGE_PCT: f32 = 70.0;
const LIT_PCT: f32 = 75.0;
const OUT_STRIPES_PCT: [f32; 2] = [10.0, 22.0];
const STRIPE: f32 = 4.0;
const DASH: f32 = 3.0;
/// `.edtl-clip.edited::after`: the corner dot.
const DOT_RADIUS: f32 = 2.5;
const DOT_INSET: f32 = 3.0;
/// `.edtl-mark`: inset from the block's edge; a ghost is dotted and fainter.
const MARK_INSET: f32 = 4.0;
const GHOST_ALPHA: f32 = 0.7;
/// `.edtl-tick`: ink of the line, room before the label, label size.
const TICK_INK_PCT: f32 = 22.0;
const TICK_PAD: f32 = 4.0;
const FONT_TICK: f32 = 10.0;
/// `.edtl-lane .edtl-track`: the faint line through the middle of a lane.
const LANE_LINE_PCT: f32 = 5.0;
const HOVER_RING: f32 = 3.0;
const PCT: f32 = 100.0;
const ARC_STEPS: usize = 4;
/// Where each corner's arc starts, in turns, clockwise from the top-right one.
const CORNER_STARTS: [f32; 4] = [-0.25, 0.0, 0.25, 0.5];
const QUARTER_TURN: f32 = 0.25;

/// The timeline's zoom and what its last frame drew.
#[derive(Debug, Default)]
pub struct Zoom {
    /// Pixels per second of demo; `None` fits the page's longest demo to the width.
    pub pps: Option<f64>,
    /// Horizontal scroll to apply on this frame's draw: keeps the anchored second in place.
    jump: Option<f32>,
    /// Scale, scroll and track width of the last frame (the next step starts from them).
    pub scale: f64,
    pub left: f32,
    pub viewport: f32,
}

impl Zoom {
    /// 3.5 `zoom`: one step, keeping the second under `anchor` (px from the tracks' left edge; the
    /// view's middle when `None`) where it is.
    fn step(&mut self, fit: f64, factor: f64, anchor: Option<f32>) {
        let scale = self.pps.unwrap_or(fit);
        let next = clamp_pps(scale * factor);
        if next == scale {
            return;
        }
        let anchor = f64::from(anchor.unwrap_or(self.viewport / 2.0));
        let left = f64::from(self.jump.unwrap_or(self.left));
        self.jump = Some(zoom_scroll(left, anchor, scale, next) as f32);
        self.pps = Some(next);
    }
}

/// Draws the toolbar and the lanes of one page; returns the clip clicked.
pub fn show(ui: &mut egui::Ui, t: &Theme, preview: &Preview, lanes: &[Lane], active: Option<usize>, zoom: &mut Zoom) -> Option<usize> {
    let span_s = preview.span_s(lanes);
    let room = if zoom.viewport > 0.0 { zoom.viewport } else { (ui.available_width() - EDITING_LABEL_WIDTH).max(1.0) };
    let fit = clamp_pps(f64::from(room) / span_s);
    toolbar(ui, t, zoom, fit);
    ui.add_space(SP[0]);

    let frame = ui.available_rect_before_wrap();
    let ruler = Rect::from_min_max(pos2(frame.left() + EDITING_LABEL_WIDTH, frame.top()), pos2(frame.right(), frame.top() + EDITING_RULER_HEIGHT));
    let labels = Rect::from_min_max(pos2(frame.left(), ruler.bottom()), pos2(ruler.left(), frame.bottom()));
    let tracks = Rect::from_min_max(pos2(ruler.left() + 1.0, ruler.bottom() + 1.0), frame.max - vec2(1.0, 1.0));
    ui.painter().rect_filled(frame, f32::from(crate::CORNER_MID), t.solid);

    // Ctrl + wheel over the lanes (names included, as 3.5): one step per notch, anchored at the pointer.
    if ui.rect_contains_pointer(frame) {
        let (pointer, turns) = ui.input(|i| {
            let turns: Vec<f32> = i.events.iter().filter_map(|e| match e {
                egui::Event::MouseWheel { delta, modifiers, .. } if modifiers.ctrl || modifiers.command => Some(delta.y),
                _ => None,
            }).collect();
            (i.pointer.hover_pos(), turns)
        });
        for turn in turns.into_iter().filter(|d| *d != 0.0) {
            zoom.step(fit, if turn > 0.0 { EDITING_ZOOM_STEP } else { 1.0 / EDITING_ZOOM_STEP }, pointer.map(|q| q.x - tracks.left()));
        }
    }

    let scale = zoom.pps.unwrap_or(fit);
    let rate = preview.tickrate as f64;
    let track_width = {
        let w = (span_s * scale).ceil() as f32;
        // Fitted, the track is the view: a rounded-up pixel must not bring a scrollbar.
        if zoom.pps.is_none() { w.min(room) } else { w }
    };
    let lanes_height = lanes.len() as f32 * EDITING_LANE_HEIGHT;
    let mut area = egui::ScrollArea::both().id_salt("editing-tracks").auto_shrink(false);
    if let Some(x) = zoom.jump.take() {
        area = area.horizontal_scroll_offset(x);
    }
    let mut clicked = None;
    let mut tracks_ui = ui.new_child(egui::UiBuilder::new().max_rect(tracks).id_salt("editing-tracks-pane"));
    let out = area.show_viewport(&mut tracks_ui, |ui, view| {
        let (content, _) = ui.allocate_exact_size(vec2(track_width.max(view.width()), lanes_height.max(view.height())), Sense::hover());
        let origin = content.min;
        let x_of = |tick: i64| origin.x + (tick as f64 / rate * scale) as f32;
        let (x0, x1) = (origin.x + view.left() - EDITING_OVERSCAN, origin.x + view.right() + EDITING_OVERSCAN);
        let p = ui.painter().clone();
        let seen = Rect::from_min_size(origin + view.min.to_vec2(), view.size());
        for (k, lane) in lanes.iter().enumerate() {
            let top = origin.y + k as f32 * EDITING_LANE_HEIGHT;
            if top > seen.bottom() || top + EDITING_LANE_HEIGHT < seen.top() {
                continue;
            }
            p.hline(seen.x_range(), top + EDITING_LANE_HEIGHT / 2.0, Stroke::new(1.0, t.accent_alpha(LANE_LINE_PCT)));
            p.hline(seen.x_range(), top + EDITING_LANE_HEIGHT - 1.0, Stroke::new(1.0, t.hair2));
            for (n, &idx) in lane.indices.iter().enumerate() {
                let clip = &preview.clips[idx];
                let win = clip.window(preview.tickrate);
                let (start, end) = win.as_ref().map_or((clip.start_tick, clip.end_tick), |w| (w.start_tick, w.end_tick));
                let from = x_of(start);
                let width = (x_of(end) - from).max(EDITING_BLOCK_MIN);
                if from + width < x0 || from > x1 {
                    continue;
                }
                let r = Rect::from_min_size(pos2(from, top + EDITING_BLOCK[0]), vec2(width, EDITING_BLOCK[1]));
                let b = Block { clip, win: win.as_ref(), rate, active: active == Some(idx), name: format!("{} clip {}", lane.name, n + 1) };
                if b.show(ui, &p, t, r, ui.scope_id().with(("clip", idx)), &x_of) {
                    clicked = Some(idx);
                }
            }
        }
    });
    zoom.scale = scale;
    zoom.left = out.state.clamped_offset().x;
    let seen_width = out.inner_rect.width();
    if (seen_width - zoom.viewport).abs() > 1.0 / 2.0 {
        // The fitted scale follows the width on the next frame.
        zoom.viewport = seen_width;
        ui.ctx().request_repaint();
    }

    // Ruler: labelled seconds, painted with the tracks' horizontal offset.
    let rp = ui.painter().with_clip_rect(ruler.intersect(ui.clip_rect()));
    let left = f64::from(zoom.left);
    for s in ruler_ticks(scale, left - f64::from(EDITING_OVERSCAN), left + f64::from(seen_width + EDITING_OVERSCAN), span_s) {
        let x = ruler.left() + 1.0 + (s * scale - left) as f32;
        rp.vline(x, ruler.y_range(), Stroke::new(1.0, t.txt.gamma_multiply(TICK_INK_PCT / PCT)));
        rp.text(pos2(x + TICK_PAD, ruler.center().y), Align2::LEFT_CENTER, format_clock(s), mono(FONT_TICK), t.faint);
    }

    // Demo names: painted with the tracks' vertical offset.
    let lp = ui.painter().with_clip_rect(labels.intersect(ui.clip_rect()));
    for (k, lane) in lanes.iter().enumerate() {
        let row = Rect::from_min_size(pos2(labels.left(), labels.top() + 1.0 + k as f32 * EDITING_LANE_HEIGHT - out.state.clamped_offset().y), vec2(EDITING_LABEL_WIDTH, EDITING_LANE_HEIGHT));
        if !row.intersects(labels) {
            continue;
        }
        let kept = lane.indices.iter().filter(|&&i| preview.clips[i].selected).count();
        let count = format!("{kept}/{} clips", lane.indices.len());
        let mut job = egui::text::LayoutJob::simple_singleline(lane.name.clone(), semibold(FONT_SMALL), t.txt);
        job.wrap = egui::text::TextWrapping::truncate_at_width(EDITING_LABEL_WIDTH - SP[1] * 2.0);
        let name = lp.layout_job(job);
        let small = lp.layout_no_wrap(count.clone(), regular(FONT_TICK), t.muted);
        let y = row.center().y - (name.size().y + 1.0 + small.size().y) / 2.0;
        let under = y + name.size().y + 1.0;
        lp.galley(pos2(row.left() + SP[1], y), name, t.txt);
        lp.galley(pos2(row.left() + SP[1], under), small, t.muted);
        lp.hline(row.x_range(), row.bottom() - 1.0, Stroke::new(1.0, t.hair2));
        let resp = ui.interact(row.intersect(labels), ui.scope_id().with(("lane", k)), Sense::hover());
        let label = format!("{}, {count}", lane.name);
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, &label));
        resp.on_hover_text(&lane.demo_path);
    }
    let p = ui.painter();
    p.hline(frame.x_range(), ruler.bottom(), Stroke::new(1.0, t.hair));
    p.vline(labels.right(), frame.y_range(), Stroke::new(1.0, t.hair));
    p.rect_stroke(frame, f32::from(crate::CORNER_MID), Stroke::new(1.0, t.hair), StrokeKind::Inside);
    ui.allocate_rect(frame, Sense::hover());
    clicked
}

/// `.edtl-toolbar`: − scale + Fit, and the hint.
fn toolbar(ui: &mut egui::Ui, t: &Theme, zoom: &mut Zoom, fit: f64) {
    egui::Frame::new().fill(t.surface).corner_radius(egui::CornerRadius::same(crate::CORNER_MID)).inner_margin(egui::Margin::same(SP[0] as i8)).show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = SP[0];
            let scale = zoom.pps.unwrap_or(fit);
            if chip(ui, t, "−", None, Some("Zoom out"), true).on_hover_text("Zoom out (Ctrl + wheel)").clicked() {
                zoom.step(fit, 1.0 / EDITING_ZOOM_STEP, None);
            }
            let words = if scale >= 1.0 { format!("{scale:.1} px/s") } else { format!("{:.1} s/px", 1.0 / scale) };
            ui.allocate_ui_with_layout(vec2(ZOOM_WIDTH, 0.0), Layout::centered_and_justified(egui::Direction::LeftToRight), |ui| {
                ui.label(egui::RichText::new(words).font(mono(FONT_SMALL)).color(t.muted)).on_hover_text("Pixels drawn per second of demo");
            });
            if chip(ui, t, "+", None, Some("Zoom in"), true).on_hover_text("Zoom in (Ctrl + wheel)").clicked() {
                zoom.step(fit, EDITING_ZOOM_STEP, None);
            }
            if chip(ui, t, "Fit", None, None, zoom.pps.is_some()).on_hover_text("Fit the longest demo of this page to the width").clicked() {
                zoom.pps = None;
                zoom.jump = Some(0.0);
            }
            ui.allocate_ui_with_layout(vec2(ui.available_width(), 0.0), Layout::right_to_left(Align::Center), |ui| {
                ui.label(egui::RichText::new(HINT).font(regular(FONT_TICK)).color(t.faint));
            });
        });
    });
}

/// One clip on its lane (`ClipBlock`): a button that opens it in the inspector.
struct Block<'a> {
    clip: &'a PreviewClip,
    win: Option<&'a EditedWindow>,
    rate: f64,
    active: bool,
    name: String,
}

impl Block<'_> {
    fn show(&self, ui: &mut egui::Ui, p: &Painter, t: &Theme, r: Rect, id: egui::Id, x_of: &dyn Fn(i64) -> f32) -> bool {
        let (clip, win) = (self.clip, self.win);
        let (label, kind) = event_meta(&clip.event_type);
        let hue = kind_color(t, kind);
        let resp = ui.interact(r, id, Sense::click());
        let (active, name) = (self.active, &self.name);
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, active, name));
        if resp.hovered() {
            crate::cursor::snap_here(ui.ctx(), r);
        }
        let edge = Stroke::new(1.0, hue.gamma_multiply(EDGE_PCT / PCT));
        if clip.selected && win.is_some() {
            rounded_vgradient(p, r, mix(hue, Color32::WHITE, LIT_PCT), hue);
            p.rect_stroke(r, BLOCK_RADIUS, edge, StrokeKind::Inside);
        } else {
            let inner = p.with_clip_rect(r.intersect(p.clip_rect()));
            inner.rect_filled(r, 0.0, hue.gamma_multiply(OUT_STRIPES_PCT[0] / PCT));
            let lean = r.height();
            let mut x = r.left() - lean;
            while x < r.right() {
                inner.line_segment([pos2(x, r.bottom()), pos2(x + lean, r.top())], Stroke::new(STRIPE / std::f32::consts::SQRT_2, hue.gamma_multiply(OUT_STRIPES_PCT[1] / PCT)));
                x += STRIPE * 2.0 * std::f32::consts::SQRT_2;
            }
            p.add(egui::Shape::dashed_line(&[r.left_top(), r.right_top(), r.right_bottom(), r.left_bottom(), r.left_top()], edge, DASH, DASH));
        }
        if r.width() >= EDITING_MARKS_MIN {
            let inner = p.with_clip_rect(r.intersect(p.clip_rect()));
            for e in &clip.events {
                let x = x_of(e.tick);
                let line = [pos2(x, r.top() + MARK_INSET), pos2(x, r.bottom() - MARK_INSET)];
                if clip.is_excluded(&e.key) {
                    inner.add(egui::Shape::dashed_line(&line, Stroke::new(2.0, t.solid.gamma_multiply(GHOST_ALPHA)), 2.0, 2.0));
                } else {
                    inner.line_segment(line, Stroke::new(2.0, t.solid));
                }
            }
        }
        if clip.edited() {
            let c = pos2(r.right() - DOT_INSET - DOT_RADIUS, r.top() + DOT_INSET + DOT_RADIUS);
            p.circle(c, DOT_RADIUS, t.solid, Stroke::new(1.0, hue));
        }
        if self.active {
            p.rect_stroke(r, BLOCK_RADIUS, Stroke::new(2.0, t.solid), StrokeKind::Outside);
            p.rect_stroke(r.expand(2.0), BLOCK_RADIUS + 2.0, Stroke::new(2.0, t.accent), StrokeKind::Outside);
        } else if resp.hovered() || resp.has_focus() {
            p.rect_stroke(r, BLOCK_RADIUS, Stroke::new(HOVER_RING, t.accent_soft), StrokeKind::Outside);
        }
        let clicked = resp.clicked();
        let rate = self.rate;
        resp.on_hover_ui(|ui| {
            let when = format_clock(win.map_or(clip.start_tick, |w| w.start_tick) as f64 / rate);
            let length = win.map_or("no event left".to_string(), |w| format!("{:.1} s", w.duration_s));
            ui.label(format!("{label} · {when} · {length}{}{}", if clip.selected { "" } else { " · excluded" }, if clip.edited() { " · edited" } else { "" }));
        });
        clicked
    }
}

/// A rounded rectangle filled top to bottom (`linear-gradient(180deg, …)` under `border-radius`).
fn rounded_vgradient(p: &Painter, r: Rect, top: Color32, bottom: Color32) {
    let radius = BLOCK_RADIUS.min(r.width() / 2.0).min(r.height() / 2.0);
    let color = |y: f32| top.lerp_to_gamma(bottom, ((y - r.top()) / r.height()).clamp(0.0, 1.0));
    let centers: [Pos2; 4] = [pos2(r.right() - radius, r.top() + radius), pos2(r.right() - radius, r.bottom() - radius), pos2(r.left() + radius, r.bottom() - radius), pos2(r.left() + radius, r.top() + radius)];
    let mut m = egui::epaint::Mesh::default();
    m.colored_vertex(r.center(), color(r.center().y));
    for (c, start) in centers.iter().zip(CORNER_STARTS) {
        for s in 0..=ARC_STEPS {
            let a = (start + QUARTER_TURN * s as f32 / ARC_STEPS as f32) * std::f32::consts::TAU;
            let q = pos2(c.x + radius * a.cos(), c.y + radius * a.sin());
            m.colored_vertex(q, color(q.y));
        }
    }
    let rim = (centers.len() * (ARC_STEPS + 1)) as u32;
    for i in 0..rim {
        m.add_triangle(0, 1 + i, 1 + (i + 1) % rim);
    }
    p.add(m);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_zoom_step_keeps_the_anchored_second_and_stops_at_the_bounds() {
        let mut z = Zoom { viewport: 800.0, left: 100.0, ..Default::default() };
        z.step(2.0, EDITING_ZOOM_STEP, Some(300.0));
        assert_eq!(z.pps, Some(3.0));
        // 200 s was under the pointer (100 + 300 px at 2 px/s); it still is at 3 px/s.
        assert_eq!(z.jump, Some(300.0));
        z.step(2.0, EDITING_ZOOM_STEP, Some(300.0));
        assert_eq!(z.pps, Some(4.5), "the second step starts from the first, same frame");
        assert_eq!((f64::from(z.jump.unwrap()) + 300.0) / 4.5, 200.0);
        let mut top = Zoom { pps: Some(40.0), viewport: 800.0, ..Default::default() };
        top.step(2.0, EDITING_ZOOM_STEP, None);
        assert_eq!((top.pps, top.jump), (Some(40.0), None), "already at the bound: nothing moves");
    }
}
