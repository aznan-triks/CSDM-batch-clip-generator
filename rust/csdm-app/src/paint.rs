//! Drawing helpers egui lacks: fonts by weight, letter spacing, gradients, the mock's
//! cut-corner plates, the conic ring of the primary button (from the ticket 06 prototype).

use csdm_core::ui_values::{FONT_DIR, FONT_MONO, FONT_REGULAR, FONT_SEMIBOLD, FONT_SYMBOLS, PILL_SEGMENTS, RING_SEGMENTS, RING_STOPS, RING_WIDTH};
use eframe::egui::{self, epaint, Align2, Color32, FontFamily, FontId, Painter, Pos2, Rect, Shape, Stroke, Vec2};
use std::f32::consts::{FRAC_PI_2, PI, TAU};

pub const SEMIBOLD: &str = "semibold";
const FAN_SEGMENTS: u32 = 48;

/// Installs the fonts by weight (egui has no synthetic bold): the first file found of each
/// list, then the symbol fonts under every family. A missing file only skips that choice:
/// egui's built-in fonts stay as the last fallback, so text always renders.
pub fn install_fonts(ctx: &egui::Context) {
    use epaint::text::{FontData, FontInsert, FontPriority, InsertFontFamily};
    let read = |names: &[&str]| names.iter().find_map(|n| std::fs::read(format!("{FONT_DIR}/{n}")).ok().map(|b| (n.to_string(), b)));
    let families = [
        (&FONT_REGULAR[..], FontFamily::Proportional),
        (&FONT_SEMIBOLD[..], FontFamily::Name(SEMIBOLD.into())),
        (&FONT_MONO[..], FontFamily::Monospace),
    ];
    for (files, family) in families {
        if let Some((name, bytes)) = read(files) {
            ctx.add_font(FontInsert::new(&name, FontData::from_owned(bytes), vec![InsertFontFamily { family, priority: FontPriority::Highest }]));
        }
    }
    for file in FONT_SYMBOLS {
        if let Some((name, bytes)) = read(&[file]) {
            let all = [FontFamily::Proportional, FontFamily::Name(SEMIBOLD.into()), FontFamily::Monospace];
            ctx.add_font(FontInsert::new(&name, FontData::from_owned(bytes), all.into_iter().map(|family| InsertFontFamily { family, priority: FontPriority::Lowest }).collect()));
        }
    }
}

pub fn regular(size: f32) -> FontId {
    FontId::proportional(size)
}

pub fn semibold(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name(SEMIBOLD.into()))
}

pub fn mono(size: f32) -> FontId {
    FontId::monospace(size)
}

/// A one-line galley with CSS `letter-spacing` (in em).
pub fn spaced_galley(p: &Painter, text: &str, font: FontId, color: Color32, spacing_em: f32) -> std::sync::Arc<epaint::Galley> {
    let mut job = egui::text::LayoutJob::default();
    let spacing = spacing_em * font.size;
    job.append(text, 0.0, egui::TextFormat { font_id: font, color, extra_letter_spacing: spacing, ..Default::default() });
    p.layout_job(job)
}

/// Spaced text anchored at `pos`; returns its rectangle.
pub fn spaced(p: &Painter, pos: Pos2, anchor: Align2, text: &str, font: FontId, color: Color32, spacing_em: f32) -> Rect {
    let g = spaced_galley(p, text, font, color, spacing_em);
    let r = anchor.anchor_size(pos, g.size());
    p.galley(r.min, g, color);
    r
}

/// Vertical two-colour gradient over a rectangle (CSS `linear-gradient(180deg, a, b)`).
pub fn vgradient(p: &Painter, r: Rect, top: Color32, bottom: Color32) {
    let mut m = epaint::Mesh::default();
    m.colored_vertex(r.left_top(), top);
    m.colored_vertex(r.right_top(), top);
    m.colored_vertex(r.right_bottom(), bottom);
    m.colored_vertex(r.left_bottom(), bottom);
    m.add_triangle(0, 1, 2);
    m.add_triangle(0, 2, 3); // allow-hardcode: quad vertex indices
    p.add(m);
}

/// Horizontal gradient a → b → transparent: the mock's 1-2 px accent rules.
pub fn hrule(p: &Painter, r: Rect, stops: &[Color32]) {
    let n = stops.len().max(2) - 1;
    let mut m = epaint::Mesh::default();
    for (k, c) in stops.iter().enumerate() {
        let x = r.left() + r.width() * k as f32 / n as f32;
        m.colored_vertex(Pos2::new(x, r.top()), *c);
        m.colored_vertex(Pos2::new(x, r.bottom()), *c);
    }
    for k in 0..n as u32 {
        let i = 2 * k;
        m.add_triangle(i, i + 1, i + 2);
        m.add_triangle(i + 1, i + 3, i + 2); // allow-hardcode: strip vertex indices
    }
    p.add(m);
}

/// Elliptic radial glow, colour at the centre fading out at `fade` of the radius (the `.amb` layers).
pub fn radial_glow(p: &Painter, c: Pos2, radius: Vec2, color: Color32, fade: f32) {
    let mut m = epaint::Mesh::default();
    m.colored_vertex(c, color);
    for i in 0..FAN_SEGMENTS {
        let a = i as f32 / FAN_SEGMENTS as f32 * TAU;
        m.colored_vertex(c + Vec2::new(a.cos() * radius.x * fade, a.sin() * radius.y * fade), Color32::TRANSPARENT);
    }
    for i in 0..FAN_SEGMENTS {
        m.add_triangle(0, 1 + i, 1 + (i + 1) % FAN_SEGMENTS);
    }
    p.add(m);
}

/// The mock's plate with two cut corners (`clip-path: polygon(c 0, 100% 0, 100% calc(100% - c), calc(100% - c) 100%, 0 100%, 0 c)`).
pub fn cut_corners(r: Rect, c: f32) -> Vec<Pos2> {
    vec![
        Pos2::new(r.left() + c, r.top()),
        r.right_top(),
        Pos2::new(r.right(), r.bottom() - c),
        Pos2::new(r.right() - c, r.bottom()),
        r.left_bottom(),
        Pos2::new(r.left(), r.top() + c),
    ]
}

pub fn cut_plate(p: &Painter, r: Rect, c: f32, fill: Color32, stroke: Stroke) {
    p.add(Shape::convex_polygon(cut_corners(r, c), fill, stroke));
}

/// Point on a stadium (pill) outline, t in [0, 1).
fn stadium(c: Pos2, half_w: f32, r: f32, t: f32) -> Pos2 {
    let straight = 2.0 * (half_w - r).max(0.0);
    let arc = PI * r;
    let total = 2.0 * straight + 2.0 * arc;
    let mut d = t * total;
    if d < straight {
        return Pos2::new(c.x - (half_w - r) + d, c.y - r);
    }
    d -= straight;
    if d < arc {
        let a = -FRAC_PI_2 + d / r;
        return Pos2::new(c.x + (half_w - r) + r * a.cos(), c.y + r * a.sin());
    }
    d -= arc;
    if d < straight {
        return Pos2::new(c.x + (half_w - r) - d, c.y + r);
    }
    d -= straight;
    let a = FRAC_PI_2 + d / r;
    Pos2::new(c.x - (half_w - r) + r * a.cos(), c.y + r * a.sin())
}

/// Pill filled with a vertical gradient (`.btn.primary`: blue-2 → accent).
pub fn gradient_pill(p: &Painter, r: Rect, top: Color32, bottom: Color32) {
    let c = r.center();
    let col = |y: f32| top.lerp_to_gamma(bottom, ((y - r.top()) / r.height()).clamp(0.0, 1.0));
    let mut m = epaint::Mesh::default();
    m.colored_vertex(c, col(c.y));
    for i in 0..PILL_SEGMENTS {
        let q = stadium(c, r.width() / 2.0, r.height() / 2.0, i as f32 / PILL_SEGMENTS as f32);
        m.colored_vertex(q, col(q.y));
    }
    for i in 0..PILL_SEGMENTS {
        m.add_triangle(0, 1 + i, 1 + (i + 1) % PILL_SEGMENTS);
    }
    p.add(m);
}

/// Conic ring around a pill, turned by `phase` (radians): the mock's StarBorder
/// (transparent → lime glow → white → accent → transparent).
pub fn ring(p: &Painter, r: Rect, phase: f32, lime_glow: Color32, accent: Color32) {
    let c = r.center();
    let (hw, rad) = (r.width() / 2.0, r.height() / 2.0);
    let [s0, s1, s2, s3, s4] = RING_STOPS;
    let at = |f: f32| -> Color32 {
        let seg = |a: f32, b: f32| ((f - a) / (b - a)).clamp(0.0, 1.0);
        if f < s0 {
            Color32::TRANSPARENT
        } else if f < s1 {
            lime_glow.gamma_multiply(seg(s0, s1))
        } else if f < s2 {
            lime_glow.lerp_to_gamma(Color32::WHITE, seg(s1, s2))
        } else if f < s3 {
            Color32::WHITE.lerp_to_gamma(accent, seg(s2, s3))
        } else {
            accent.gamma_multiply(1.0 - seg(s3, s4))
        }
    };
    let mut m = epaint::Mesh::default();
    for i in 0..RING_SEGMENTS {
        let t = i as f32 / RING_SEGMENTS as f32;
        let o = stadium(c, hw, rad, t);
        let inn = stadium(c, hw - RING_WIDTH, rad - RING_WIDTH, t);
        // CSS conic gradients start at 12 o'clock and turn clockwise.
        let ang = ((o.x - c.x).atan2(-(o.y - c.y)) - phase).rem_euclid(TAU) / TAU;
        let col = at(ang);
        m.colored_vertex(o, col);
        m.colored_vertex(inn, col);
    }
    for i in 0..RING_SEGMENTS {
        let (a, b) = (2 * i, 2 * ((i + 1) % RING_SEGMENTS));
        m.add_triangle(a, a + 1, b);
        m.add_triangle(a + 1, b + 1, b);
    }
    p.add(m);
}

/// The caret the mock types as `▾`, drawn (the glyph is missing from Segoe UI).
pub fn caret(p: &Painter, c: Pos2, size: f32, color: Color32, open: bool) {
    let h = size / 2.0;
    let pts = if open {
        vec![Pos2::new(c.x - h, c.y - h / 2.0), Pos2::new(c.x + h, c.y - h / 2.0), Pos2::new(c.x, c.y + h / 2.0)]
    } else {
        vec![Pos2::new(c.x - h / 2.0, c.y - h), Pos2::new(c.x + h / 2.0, c.y), Pos2::new(c.x - h / 2.0, c.y + h)]
    };
    p.add(Shape::convex_polygon(pts, color, Stroke::NONE));
}

/// Six-dot grip (the `⠿` drag handle, drawn).
pub fn grip(p: &Painter, r: Rect, color: Color32) {
    const ROWS: u32 = 3;
    const COLS: u32 = 2;
    const DOT: f32 = 1.2;
    let (dx, dy) = (r.width() / COLS as f32, r.height() / ROWS as f32);
    for row in 0..ROWS {
        for col in 0..COLS {
            let x = r.left() + dx * (col as f32 + 1.0 / 2.0);
            let y = r.top() + dy * (row as f32 + 1.0 / 2.0);
            p.circle_filled(Pos2::new(x, y), DOT, color);
        }
    }
}

/// Saves RGBA pixels as a PNG (bench captures). Fails loudly: a capture that cannot be
/// written is a broken bench, not something to hide.
pub fn png(path: &str, w: u32, h: u32, rgba: Vec<u8>) {
    use resvg::tiny_skia::{IntSize, Pixmap};
    let size = IntSize::from_wh(w, h).expect("a screenshot has a size");
    let pix = Pixmap::from_vec(rgba, size).expect("pixels match the size");
    pix.save_png(path).unwrap_or_else(|e| panic!("cannot write {path}: {e}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A symbol missing from every installed font shows as a box in the app: fail here instead
    /// (the prototype met it with `▾`). Scans every string the crate's sources can print.
    #[test]
    fn every_symbol_the_shell_prints_has_a_glyph_in_its_fonts() {
        let ctx = egui::Context::default();
        install_fonts(&ctx);
        // One frame builds the font atlas; its texture upload is not needed here.
        ctx.run_ui(egui::RawInput::default(), |_| {}).textures_delta.clear();
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut symbols = std::collections::BTreeSet::new();
        for entry in std::fs::read_dir(src).unwrap() {
            let path = entry.unwrap().path();
            if path.file_name().is_some_and(|n| n == "icons_data.rs") {
                continue;
            }
            for line in std::fs::read_to_string(&path).unwrap().lines() {
                symbols.extend(line.split("//").next().unwrap_or_default().chars().filter(|c| !c.is_ascii()));
            }
        }
        assert!(!symbols.is_empty(), "the scan found the shell's symbols");
        let families = [FontFamily::Proportional, FontFamily::Name(SEMIBOLD.into()), FontFamily::Monospace];
        let missing: Vec<String> = ctx.fonts_mut(|f| {
            symbols.iter().flat_map(|c| families.iter().filter(|fam| !f.has_glyph(&FontId::new(12.0, (*fam).clone()), *c)).map(move |fam| format!("{c} (U+{:04X}) in {fam:?}", *c as u32)).collect::<Vec<_>>()).collect()
        });
        assert!(missing.is_empty(), "no glyph for: {missing:?}");
        assert!(!ctx.fonts_mut(|f| f.has_glyph(&FontId::proportional(12.0), '\u{10FFFD}')), "the check can fail");
    }
}
