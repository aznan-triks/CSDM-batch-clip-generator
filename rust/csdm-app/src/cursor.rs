//! The crosshair reticle in place of the arrow, and the spark of a click
//! (3.5 `cursor/Reticle.tsx`, `effects/ClickSpark.tsx`).
//!
//! Over text fields, tabs, handles (anything that set its own cursor) the system cursor
//! stays; over a button the reticle snaps to it; elsewhere it follows the pointer.

use crate::theme::Theme;
use csdm_core::ui_values::{RETICLE_CORNER, RETICLE_SIZE, RETICLE_SNAP_PAD, SPARK_COUNT, SPARK_RING, SPARK_RING_S, SPARK_S, SPARK_SIZE, SPARK_TRAVEL};
use eframe::egui::{self, Color32, CursorIcon, Id, LayerId, Order, Pos2, Rect, Stroke, Vec2};

const DOT: f32 = 1.5;
const SPARK_RING_STROKE: f32 = 1.5;
const SNAP_KEY: &str = "reticle-snap";

/// Marks `rect` as what the reticle snaps to this frame (call when a button is hovered).
pub fn snap_here(ctx: &egui::Context, rect: Rect) {
    ctx.data_mut(|d| d.insert_temp(Id::unique(SNAP_KEY), Some(rect)));
}

#[derive(Default)]
pub struct Cursor {
    sparks: Vec<(Pos2, f64, bool)>,
    /// Shown last frame (tests read it).
    pub reticle: Option<Rect>,
}

impl Cursor {
    /// Called once per frame, after every widget has drawn.
    pub fn finish(&mut self, ctx: &egui::Context, t: &Theme, now: f64, motion: bool) {
        let snap: Option<Rect> = ctx.data_mut(|d| d.remove_temp::<Option<Rect>>(Id::unique(SNAP_KEY))).flatten();
        let pointer = ctx.input(|i| i.pointer.hover_pos());
        let own_cursor = ctx.output(|o| o.cursor_icon) != CursorIcon::Default;
        let p = ctx.layer_painter(LayerId::new(Order::Tooltip, Id::unique("reticle")));
        self.reticle = match (pointer, snap) {
            (Some(_), Some(r)) => Some(r.expand(RETICLE_SNAP_PAD / 2.0)),
            (Some(at), None) if !own_cursor => Some(Rect::from_center_size(at, Vec2::splat(RETICLE_SIZE))),
            _ => None,
        };
        if let Some(r) = self.reticle {
            ctx.set_cursor_icon(CursorIcon::None);
            let s = Stroke::new(2.0, t.accent);
            let c = RETICLE_CORNER;
            for (corner, dx, dy) in [(r.left_top(), 1.0, 1.0), (r.right_top(), -1.0, 1.0), (r.left_bottom(), 1.0, -1.0), (r.right_bottom(), -1.0, -1.0)] {
                p.line_segment([corner, corner + Vec2::new(c * dx, 0.0)], s);
                p.line_segment([corner, corner + Vec2::new(0.0, c * dy)], s);
            }
            if snap.is_none() {
                p.circle_filled(r.center(), DOT, t.accent);
            }
        }
        if motion {
            if let Some(at) = ctx.input(|i| if i.pointer.any_pressed() { i.pointer.press_origin() } else { None }) {
                self.sparks.push((at, now, snap.is_some()));
            }
        }
        self.sparks.retain(|(_, at, _)| now - at < SPARK_S);
        for (at, start, on_button) in &self.sparks {
            let age = now - start;
            let color: Color32 = if *on_button { t.accent } else { t.accent.lerp_to_gamma(Color32::WHITE, 1.0 / 2.0 / 2.0) };
            if age < SPARK_RING_S {
                let k = (age / SPARK_RING_S) as f32;
                let size = SPARK_RING[0] + (SPARK_RING[1] - SPARK_RING[0]) * k;
                p.rect_stroke(Rect::from_center_size(*at, Vec2::splat(size)), 2.0, Stroke::new(SPARK_RING_STROKE, color.gamma_multiply(1.0 - k)), egui::StrokeKind::Middle);
            }
            let k = (age / SPARK_S) as f32;
            for i in 0..SPARK_COUNT {
                let d = Vec2::angled(i as f32 / SPARK_COUNT as f32 * std::f32::consts::TAU);
                let from = *at + d * (SPARK_TRAVEL[0] + (SPARK_TRAVEL[1] - SPARK_TRAVEL[0]) * k);
                p.line_segment([from, from + d * SPARK_SIZE[1]], Stroke::new(SPARK_SIZE[0], color.gamma_multiply(1.0 - k)));
            }
        }
        if !self.sparks.is_empty() {
            ctx.request_repaint();
        }
    }
}
