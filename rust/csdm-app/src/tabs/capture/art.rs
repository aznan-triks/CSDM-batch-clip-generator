//! The game's own weapon silhouettes (3.5 `weapon/silhouettes.ts`, art vendored from
//! `Juknum/counter-strike-icons`, see `assets/cs2/SOURCE.md`), rasterised once per size as white
//! alpha masks and tinted when drawn.

use eframe::egui::{self, TextureHandle};
use std::collections::HashMap;

/// Bytes per pixel and the alpha byte's place.
const RGBA: usize = 4;
const ALPHA: usize = RGBA - 1;

/// Database weapon name → the game's file (`GAME_FILE`: `P2000` is `hkp2000`, `M4A4` is `m4a1`).
const ART: [(&str, &[u8]); 42] = [
    ("AK-47", include_bytes!("../../../assets/cs2/ak47.svg")),
    ("AUG", include_bytes!("../../../assets/cs2/aug.svg")),
    ("AWP", include_bytes!("../../../assets/cs2/awp.svg")),
    ("C4", include_bytes!("../../../assets/cs2/c4.svg")),
    ("CZ75 Auto", include_bytes!("../../../assets/cs2/cz75a.svg")),
    ("Desert Eagle", include_bytes!("../../../assets/cs2/deagle.svg")),
    ("Dual Berettas", include_bytes!("../../../assets/cs2/elite.svg")),
    ("FAMAS", include_bytes!("../../../assets/cs2/famas.svg")),
    ("Five-SeveN", include_bytes!("../../../assets/cs2/fiveseven.svg")),
    ("Flashbang", include_bytes!("../../../assets/cs2/flashbang.svg")),
    ("G3SG1", include_bytes!("../../../assets/cs2/g3sg1.svg")),
    ("Galil AR", include_bytes!("../../../assets/cs2/galilar.svg")),
    ("Glock-18", include_bytes!("../../../assets/cs2/glock.svg")),
    ("HE Grenade", include_bytes!("../../../assets/cs2/hegrenade.svg")),
    ("Incendiary Grenade", include_bytes!("../../../assets/cs2/incgrenade.svg")),
    ("Knife", include_bytes!("../../../assets/cs2/knife.svg")),
    ("M249", include_bytes!("../../../assets/cs2/m249.svg")),
    ("M4A1", include_bytes!("../../../assets/cs2/m4a1_silencer.svg")),
    ("M4A4", include_bytes!("../../../assets/cs2/m4a1.svg")),
    ("MAC-10", include_bytes!("../../../assets/cs2/mac10.svg")),
    ("MAG-7", include_bytes!("../../../assets/cs2/mag7.svg")),
    ("Molotov", include_bytes!("../../../assets/cs2/molotov.svg")),
    ("MP5-SD", include_bytes!("../../../assets/cs2/mp5sd.svg")),
    ("MP7", include_bytes!("../../../assets/cs2/mp7.svg")),
    ("MP9", include_bytes!("../../../assets/cs2/mp9.svg")),
    ("Negev", include_bytes!("../../../assets/cs2/negev.svg")),
    ("Nova", include_bytes!("../../../assets/cs2/nova.svg")),
    ("P2000", include_bytes!("../../../assets/cs2/hkp2000.svg")),
    ("P250", include_bytes!("../../../assets/cs2/p250.svg")),
    ("P90", include_bytes!("../../../assets/cs2/p90.svg")),
    ("PP-Bizon", include_bytes!("../../../assets/cs2/bizon.svg")),
    ("R8 Revolver", include_bytes!("../../../assets/cs2/revolver.svg")),
    ("Sawed-Off", include_bytes!("../../../assets/cs2/sawedoff.svg")),
    ("SCAR-20", include_bytes!("../../../assets/cs2/scar20.svg")),
    ("SG 553", include_bytes!("../../../assets/cs2/sg556.svg")),
    ("SSG 08", include_bytes!("../../../assets/cs2/ssg08.svg")),
    ("Tec-9", include_bytes!("../../../assets/cs2/tec9.svg")),
    ("UMP-45", include_bytes!("../../../assets/cs2/ump45.svg")),
    ("USP-S", include_bytes!("../../../assets/cs2/usp_silencer.svg")),
    ("World", include_bytes!("../../../assets/cs2/prop_exploding_barrel.svg")),
    ("XM1014", include_bytes!("../../../assets/cs2/xm1014.svg")),
    ("Zeus x27", include_bytes!("../../../assets/cs2/taser.svg")),
];

/// Rasterised silhouettes by (name, pixel height), with each one's width / height ratio.
#[derive(Default)]
pub struct Art {
    cache: HashMap<(String, u32), Option<(TextureHandle, f32)>>,
}

impl Art {
    /// The silhouette `height` points tall, or `None` when the pack has none for this weapon.
    pub fn get(&mut self, ctx: &egui::Context, name: &str, height: f32) -> Option<(TextureHandle, f32)> {
        let px = (height * ctx.pixels_per_point()).ceil() as u32;
        self.cache.entry((name.to_string(), px)).or_insert_with(|| rasterise(ctx, name, px)).clone()
    }
}

pub fn ratio(name: &str) -> Option<f32> {
    use resvg::usvg;
    let (_, bytes) = ART.iter().find(|(n, _)| *n == name)?;
    let s = usvg::Tree::from_data(bytes, &usvg::Options::default()).ok()?.size();
    Some(s.width() / s.height())
}

fn rasterise(ctx: &egui::Context, name: &str, px: u32) -> Option<(TextureHandle, f32)> {
    use resvg::{tiny_skia, usvg};
    let (_, bytes) = ART.iter().find(|(n, _)| *n == name)?;
    let tree = usvg::Tree::from_data(bytes, &usvg::Options::default()).ok()?;
    let size = tree.size();
    let scale = px as f32 / size.height();
    let w = (size.width() * scale).ceil() as u32;
    let mut pix = tiny_skia::Pixmap::new(w.max(1), px.max(1))?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pix.as_mut());
    // The pack carries no fill (3.5 paints it through a CSS mask): white with the shape's alpha.
    let mut data = pix.data().to_vec();
    for c in data.as_chunks_mut::<RGBA>().0 {
        let a = c[ALPHA];
        c[0] = a;
        c[1] = a;
        c[2] = a;
    }
    let img = egui::ColorImage::from_rgba_premultiplied([pix.width() as usize, pix.height() as usize], &data);
    Some((ctx.load_texture(format!("gun-{name}-{px}"), img, egui::TextureOptions::LINEAR), size.width() / size.height()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_pack_weapon_rasterises() {
        let ctx = egui::Context::default();
        let mut art = Art::default();
        for (name, _) in ART {
            let (tex, r) = art.get(&ctx, name, 30.0).unwrap_or_else(|| panic!("{name}"));
            assert!(r > 0.0 && tex.size()[1] == 30, "{name}");
        }
        assert!(art.get(&ctx, "Not a weapon", 30.0).is_none());
    }
}
