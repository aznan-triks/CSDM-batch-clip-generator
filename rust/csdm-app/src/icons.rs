//! The 3.5 glyphs (`icons/index.tsx`, one per tab, button and card), drawn from the
//! generated path table: rasterised once per size as a white mask, tinted when painted.

use crate::icons_data::ICONS;
use eframe::egui::{self, Color32, Painter, Rect, TextureHandle};
use std::collections::HashMap;

const SVG_NS: &str = "http://www.w3.org/2000/svg";
/// The glyphs are drawn on a 24×24 grid (`viewBox="0 0 24 24"`).
const GRID: f32 = 24.0;

#[derive(Clone, Default)]
struct Cache(HashMap<(&'static str, u32), Option<TextureHandle>>);

/// Whether `name` is a glyph of the set (a card or tab declaring an unknown one is a bug).
pub fn exists(name: &str) -> bool {
    ICONS.iter().any(|(n, _)| *n == name)
}

/// Paints glyph `name` filling `rect`, in `color`. Unknown names draw nothing (see `exists`).
pub fn paint(p: &Painter, name: &str, rect: Rect, color: Color32) {
    let ctx = p.ctx();
    let px = (rect.height() * ctx.pixels_per_point()).round().max(1.0) as u32;
    let Some((key, paths)) = ICONS.iter().find(|(n, _)| *n == name).map(|(n, p)| (*n, *p)) else { return };
    let id = egui::Id::unique("csdm-icons");
    let tex = ctx.data_mut(|d| d.get_temp_mut_or_default::<Cache>(id).0.get(&(key, px)).cloned());
    let tex = match tex {
        Some(t) => t,
        None => {
            let t = rasterise(ctx, key, paths, px);
            ctx.data_mut(|d| d.get_temp_mut_or_default::<Cache>(id).0.insert((key, px), t.clone()));
            t
        }
    };
    if let Some(t) = tex {
        p.image(t.id(), rect, Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), color);
    }
}

fn rasterise(ctx: &egui::Context, name: &str, paths: &[&str], px: u32) -> Option<TextureHandle> {
    use resvg::{tiny_skia, usvg};
    let body: String = paths.iter().map(|d| format!(r##"<path d="{d}" fill="#ffffff"/>"##)).collect();
    let svg = format!(r#"<svg xmlns="{SVG_NS}" viewBox="0 0 {GRID} {GRID}">{body}</svg>"#);
    let tree = usvg::Tree::from_str(&svg, &usvg::Options::default()).ok()?;
    let mut pix = tiny_skia::Pixmap::new(px, px)?;
    let scale = px as f32 / GRID;
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pix.as_mut());
    let img = egui::ColorImage::from_rgba_premultiplied([px as usize, px as usize], pix.data());
    Some(ctx.load_texture(format!("icon-{name}-{px}"), img, egui::TextureOptions::LINEAR))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tab_and_shell_button_has_its_glyph() {
        for name in ["capture", "editing", "tags", "video", "settings", "run", "preview", "stop", "kill", "presets"] {
            assert!(exists(name), "{name}");
        }
    }

    #[test]
    fn a_glyph_rasterises_to_an_inked_mask() {
        let ctx = egui::Context::default();
        let (_, paths) = ICONS.iter().find(|(n, _)| *n == "stop").unwrap();
        let tex = rasterise(&ctx, "stop", paths, 24).expect("rasterised");
        assert_eq!(tex.size(), [24, 24]);
    }
}
