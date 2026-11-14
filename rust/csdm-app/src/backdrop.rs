//! The holographic plate field behind the window (3.5 `shell/Backdrop.tsx` +
//! `backdropField.ts`): flat plates on the ground, a sheen that fades in near the
//! pointer, a different motif per tab.
//!
//! Repaints only while something moves: fast for a second after the pointer moves, then
//! `BACKDROP_IDLE_FPS` while a plate is lit, nothing once every plate is dark (pointer
//! outside, motion off). The idle window therefore costs nothing.

use eframe::egui;
use csdm_core::ui_values::{
    BACKDROP_BAND, BACKDROP_BY_TAB, BACKDROP_CELL, BACKDROP_CLUSTER, BACKDROP_DRIFT, BACKDROP_EASE, BACKDROP_GAP, BACKDROP_IDLE_FPS, BACKDROP_RAMP, BACKDROP_SETTLE_S, BACKDROP_SHEEN, BACKDROP_TOP_BAR, BACKDROP_VISIBLE_FLOOR,
};
use eframe::egui::{epaint::Mesh, Color32, Painter, Pos2, Rect, Stroke, StrokeKind, Vec2};

const MS: f64 = 1000.0;
const HASH: [u32; 3] = [374_761_393, 668_265_263, 1_274_126_177];
const SHIFT: [u32; 2] = [13, 16];
const SMOOTH: [f32; 2] = [3.0, 2.0];
const MOTIF_ARM: f32 = 0.18;
const MOTIF_EDGE: f32 = 0.16;
const HATCH_INSET: f32 = 0.24;
const DOT_AT: [f32; 2] = [0.35, 0.65];
const DOT_R: f32 = 0.045;
const BRACKET_INSET: f32 = 0.22;
const BRACKET_LEN: f32 = 0.2;
const SCAN_INSET: f32 = 2.0;

fn hash(x: i32, y: i32) -> f32 {
    let mut h = (x as u32).wrapping_mul(HASH[0]).wrapping_add((y as u32).wrapping_mul(HASH[1]));
    h = (h ^ (h >> SHIFT[0])).wrapping_mul(HASH[2]);
    (h ^ (h >> SHIFT[1])) as f32 / u32::MAX as f32
}

fn smooth(t: f32) -> f32 {
    t * t * (SMOOTH[0] - SMOOTH[1] * t)
}

fn noise(x: f32, y: f32) -> f32 {
    let (xi, yi) = (x.floor(), y.floor());
    let (u, v) = (smooth(x - xi), smooth(y - yi));
    let (xi, yi) = (xi as i32, yi as i32);
    let (a, b, c, d) = (hash(xi, yi), hash(xi + 1, yi), hash(xi, yi + 1), hash(xi + 1, yi + 1));
    a * (1.0 - u) * (1.0 - v) + b * u * (1.0 - v) + c * (1.0 - u) * v + d * u * v
}

#[derive(Clone, Copy)]
struct Field { reach: f32, threshold: f32, falloff: f32, motif: &'static str }

fn field(tab: &str) -> Field {
    let (_, reach, threshold, falloff, motif) = BACKDROP_BY_TAB.iter().find(|r| r.0 == tab).copied().unwrap_or(BACKDROP_BY_TAB[0]);
    Field { reach, threshold, falloff, motif }
}

/// Target intensity of plate (col, row) for a pointer at cell (cc, cr) at `time_ms`.
fn intensity(col: i32, row: i32, cc: f32, cr: f32, time_ms: f64, f: Field) -> f32 {
    let cheb = (col as f32 - cc).abs().max((row as f32 - cr).abs());
    if cheb > f.reach {
        return 0.0;
    }
    let (nx, ny) = ((time_ms * BACKDROP_DRIFT[0]) as f32, (time_ms * BACKDROP_DRIFT[1]) as f32);
    let [cs, cw] = BACKDROP_CLUSTER;
    let [bx, by, bd, bw] = BACKDROP_BAND;
    let cluster = noise(col as f32 * cs + nx, row as f32 * cs + ny);
    let band = noise(col as f32 * bx + nx * bd, row as f32 * by);
    let value = (cluster * cw + band * bw) * (f.falloff + (1.0 - cheb / f.reach));
    if value <= f.threshold { 0.0 } else { ((value - f.threshold) / BACKDROP_RAMP).min(1.0) }
}

#[derive(Default)]
pub struct Backdrop {
    plates: Vec<f32>,
    cols: usize,
    last_move: f64,
    last_pointer: Option<Pos2>,
    /// The unlit plates, built once per size and palette: one mesh instead of a thousand shapes a frame.
    still: Option<(StillKey, std::sync::Arc<Mesh>)>,
}

/// What the cached unlit mesh depends on: columns, rows, origin cell, plate fill and edge.
type StillKey = (usize, usize, [i32; 2], Color32, Color32);

/// The unlit field: every plate filled and outlined, as one mesh.
fn still_mesh(origin: Pos2, cols: usize, rows: usize, fill: Color32, edge: Color32) -> Mesh {
    let mut m = Mesh::default();
    let size = BACKDROP_CELL - BACKDROP_GAP;
    let offset = BACKDROP_GAP / 2.0;
    for row in 0..rows {
        for col in 0..cols {
            let r = Rect::from_min_size(origin + Vec2::new(col as f32 * BACKDROP_CELL + offset, row as f32 * BACKDROP_CELL + offset), Vec2::splat(size));
            m.add_colored_rect(r.shrink(1.0), fill);
            for e in [Rect::from_min_size(r.min, Vec2::new(size, 1.0)), Rect::from_min_size(r.left_bottom() - Vec2::new(0.0, 1.0), Vec2::new(size, 1.0)), Rect::from_min_size(r.min, Vec2::new(1.0, size)), Rect::from_min_size(r.right_top() - Vec2::new(1.0, 0.0), Vec2::new(1.0, size))] {
                m.add_colored_rect(e, edge);
            }
        }
    }
    m
}

impl Backdrop {
    /// Paints the field over `screen`; returns the delay before the next repaint it needs.
    pub fn paint(&mut self, p: &Painter, screen: Rect, cx: &crate::Cx, tab: &str, pointer: Option<Pos2>) -> Option<f64> {
        let (t, now, motion) = (cx.theme, cx.now, cx.motion);
        let cols = (screen.width() / BACKDROP_CELL).ceil() as usize + 1;
        let rows = (screen.height() / BACKDROP_CELL).ceil() as usize + 1;
        if self.cols != cols || self.plates.len() != cols * rows {
            self.cols = cols;
            self.plates = vec![0.0; cols * rows];
        }
        let pointer = if motion { pointer } else { None };
        if pointer != self.last_pointer {
            self.last_pointer = pointer;
            if pointer.is_some() {
                self.last_move = now;
            }
        }
        let f = field(tab);
        let size = BACKDROP_CELL - BACKDROP_GAP;
        let offset = BACKDROP_GAP / 2.0;
        let (cc, cr) = pointer.map(|q| ((q.x - screen.left()) / BACKDROP_CELL, (q.y - screen.top()) / BACKDROP_CELL)).unwrap_or((f32::MIN / 2.0, f32::MIN / 2.0));
        let key = (cols, rows, [screen.min.x as i32, screen.min.y as i32], t.tile_fill, t.glow_in);
        if self.still.as_ref().is_none_or(|(k, _)| *k != key) {
            self.still = Some((key, std::sync::Arc::new(still_mesh(screen.min, cols, rows, t.tile_fill, t.glow_in))));
        }
        if let Some((_, mesh)) = &self.still {
            p.add(egui::Shape::Mesh(mesh.clone()));
        }
        let mut lit = false;
        let [tint, top, scan, step] = BACKDROP_SHEEN;
        for row in 0..rows {
            for col in 0..cols {
                let i = row * cols + col;
                let target = if pointer.is_some() { intensity(col as i32, row as i32, cc, cr, now * MS, f) } else { 0.0 };
                let v = if motion { self.plates[i] + (target - self.plates[i]) * BACKDROP_EASE } else { target };
                self.plates[i] = v;
                let r = Rect::from_min_size(screen.min + Vec2::new(col as f32 * BACKDROP_CELL + offset, row as f32 * BACKDROP_CELL + offset), Vec2::splat(size));
                if v <= BACKDROP_VISIBLE_FLOOR {
                    continue;
                }
                lit = true;
                p.rect_filled(r, 0.0, t.accent.gamma_multiply(v * tint));
                p.rect_filled(Rect::from_min_size(r.min, Vec2::new(size, 1.0)), 0.0, t.tile_bevel);
                p.rect_filled(Rect::from_min_size(r.min, Vec2::new(size, BACKDROP_TOP_BAR)), 0.0, t.accent.gamma_multiply(v * top));
                let mut y = r.top() + BACKDROP_TOP_BAR;
                while y < r.bottom() - 1.0 {
                    p.rect_filled(Rect::from_min_size(Pos2::new(r.left() + SCAN_INSET, y), Vec2::new(size - SCAN_INSET * 2.0, 1.0)), 0.0, t.accent.gamma_multiply(v * scan));
                    y += step;
                }
                let glow = t.glow_in.a() as f32 + v * (t.glow_out.a() as f32 - t.glow_in.a() as f32);
                p.rect_stroke(r, 0.0, Stroke::new(1.0, t.accent.gamma_multiply(glow / f32::from(u8::MAX))), StrokeKind::Inside);
                motif(p, f.motif, r, Stroke::new(1.0, t.accent.gamma_multiply(v * top)), t.accent.gamma_multiply(v * tint));
            }
        }
        if !motion {
            return None;
        }
        // Moving pointer, or a lit field fading out once the pointer left: every frame.
        if (pointer.is_some() && now - self.last_move < BACKDROP_SETTLE_S) || (lit && pointer.is_none()) {
            Some(0.0)
        } else if lit {
            Some(1.0 / BACKDROP_IDLE_FPS)
        } else {
            None
        }
    }
}

fn motif(p: &Painter, kind: &str, r: Rect, s: Stroke, fill: Color32) {
    let (x, y, size) = (r.left(), r.top(), r.width());
    let mid = size / 2.0;
    let arm = size * MOTIF_ARM;
    let at = |a: f32, b: f32| Pos2::new(x + a, y + b);
    match kind {
        "crosshair" => {
            let (e, f) = (size * MOTIF_EDGE, size * (1.0 - MOTIF_EDGE));
            p.line_segment([at(mid, e), at(mid, e + arm)], s);
            p.line_segment([at(mid, f), at(mid, f - arm)], s);
            p.line_segment([at(e, mid), at(e + arm, mid)], s);
            p.line_segment([at(f, mid), at(f - arm, mid)], s);
        }
        "hatch" => {
            let i = size * HATCH_INSET;
            p.line_segment([at(i, i), at(size - i, size - i)], s);
            p.line_segment([at(size - i, i), at(i, size - i)], s);
        }
        "dots" => {
            for cx in DOT_AT {
                for cy in DOT_AT {
                    p.circle_filled(at(size * cx, size * cy), (size * DOT_R).max(1.0), fill);
                }
            }
        }
        "bracket" => {
            let (i, l) = (size * BRACKET_INSET, size * BRACKET_LEN);
            p.line_segment([at(i, i + l), at(i, i)], s);
            p.line_segment([at(i, i), at(i + l, i)], s);
            p.line_segment([at(size - i, size - i - l), at(size - i, size - i)], s);
            p.line_segment([at(size - i, size - i), at(size - i - l, size - i)], s);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_is_dark_far_from_the_pointer_and_lit_near_it() {
        let f = field("capture");
        assert_eq!(intensity(50, 50, 0.0, 0.0, 0.0, f), 0.0, "beyond reach");
        let near: f32 = (0..20).flat_map(|c| (0..20).map(move |r| (c, r))).map(|(c, r)| intensity(c, r, 10.0, 10.0, 0.0, f)).sum();
        assert!(near > 0.0, "some plate lights near the pointer");
    }

    #[test]
    fn every_tab_has_a_field() {
        for tab in ["capture", "editing", "tags", "video", "settings"] {
            assert_eq!(field(tab).motif, BACKDROP_BY_TAB.iter().find(|r| r.0 == tab).unwrap().4);
        }
    }
}
