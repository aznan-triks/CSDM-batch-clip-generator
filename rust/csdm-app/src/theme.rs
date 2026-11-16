//! The V12 palette in force: ground (`theme_bg`) + accent (`theme_accent`), as egui colours.
//! Colours come from the generated `csdm_core::theme_v12`; the accent-derived ones are
//! finished here (3.5 `theme/accent.ts`, `theme/mode.ts`).

use csdm_core::theme_v12::{Palette, Tone, ACCENT_PRESETS, GROUNDS};
use eframe::egui::{self, Color32};

/// `theme/mode.ts::DEFAULT_GROUND`: an unknown ground falls back to day.
const DEFAULT_GROUND: &str = "white";
/// `theme/accent.ts::ACCENT`: lightness factors of the lit / shaded accent and the two label inks.
const LIT_LIGHTNESS: f32 = 1.2;
const SHADED_LIGHTNESS: f32 = 0.67;
const ON_ACCENT_DARK: [u8; RGB] = [0x0B, 0x0E, 0x12];
const ON_ACCENT_LIGHT: [u8; RGB] = [0xF0, 0xF4, 0xF8];
const PCT: f32 = 100.0;
const QUARTER: f32 = 25.0;
pub const RGB: usize = 3;
pub const RGBA: usize = 4;
const HEX_DIGITS: usize = 6;
const SHORT_HEX_DIGITS: usize = 3;
const HEX_RADIX: u32 = 16;
/// `--amb-a`, `--amb-b`, `--amb-c`.
pub const AMBIENT_TONES: usize = 3;

#[derive(Clone, Debug, PartialEq)]
pub struct Theme {
    pub ground: &'static str,
    pub dark: bool,
    pub accent: Color32,
    pub accent_hi: Color32,
    pub accent_d: Color32,
    pub on_accent: Color32,
    pub page0: Color32,
    pub page1: Color32,
    pub txt: Color32,
    pub txt_hi: Color32,
    pub muted: Color32,
    pub faint: Color32,
    pub solid: Color32,
    pub surface: Color32,
    /// The card's glass as the eye sees it: `--surface` over the page, opaque. The browser's
    /// `backdrop-filter: blur(14px)` smooths the ground under it, and its shadow is drawn only
    /// outside; painted translucent here, the card showed its own shadow through (grey, T6b).
    pub card: Color32,
    pub surface2: Color32,
    pub band: Color32,
    pub border: Color32,
    pub hair: Color32,
    pub hair2: Color32,
    pub tile_fill: Color32,
    pub tile_bevel: Color32,
    pub tile_border: Color32,
    pub glow_in: Color32,
    pub glow_out: Color32,
    pub amb: [Color32; AMBIENT_TONES],
    pub lime: Color32,
    pub lime_ink: Color32,
    pub lime_glow: Color32,
    pub emerald: Color32,
    pub amber: Color32,
    pub rose: Color32,
    pub blue2: Color32,
    pub accent_soft: Color32,
}

/// `#rgb` / `#rrggbb` → colour; anything else is not a colour.
pub fn parse_hex(text: &str) -> Option<[u8; RGB]> {
    let body = text.trim().strip_prefix('#')?;
    let full: String = match body.len() {
        SHORT_HEX_DIGITS => body.chars().flat_map(|c| [c, c]).collect(),
        HEX_DIGITS => body.to_string(),
        _ => return None,
    };
    let byte = |k: usize| u8::from_str_radix(full.get(k..k + 2)?, HEX_RADIX).ok();
    Some([byte(0)?, byte(2)?, byte(2 + 2)?])
}

/// `theme_accent` may be a preset name (any case, as the Tk host wrote it) or a hex colour.
/// `None`: the value is neither, the caller says so and uses the default.
pub fn resolve_accent(value: &str) -> Option<[u8; RGB]> {
    let named = ACCENT_PRESETS.iter().find(|(n, _)| n.eq_ignore_ascii_case(value.trim())).map(|(_, h)| *h);
    parse_hex(named.unwrap_or(value))
}

pub fn default_accent() -> [u8; RGB] {
    parse_hex(ACCENT_PRESETS[0].1).expect("the generated presets are hex colours")
}

fn rgba([r, g, b, a]: [u8; RGBA]) -> Color32 {
    Color32::from_rgba_unmultiplied(r, g, b, a)
}

/// `color-mix(in srgb, a p%, b)`: premultiplied interpolation, as the browser does it.
fn mix(a: [u8; RGBA], pct: f32, b: [u8; RGBA]) -> Color32 {
    let t = pct / PCT;
    let (aa, ba) = (f32::from(a[RGB]) / f32::from(u8::MAX), f32::from(b[RGB]) / f32::from(u8::MAX));
    let alpha = aa * t + ba * (1.0 - t);
    if alpha <= 0.0 {
        return Color32::TRANSPARENT;
    }
    let ch = |i: usize| ((f32::from(a[i]) * aa * t + f32::from(b[i]) * ba * (1.0 - t)) / alpha).round() as u8;
    Color32::from_rgba_unmultiplied(ch(0), ch(1), ch(2), (alpha * f32::from(u8::MAX)).round() as u8)
}

fn tone(t: Tone, accent: [u8; RGB]) -> Color32 {
    match t {
        Tone::Rgba(c) => rgba(c),
        Tone::Accent { pct, other } => {
            let [r, g, b] = accent;
            mix([r, g, b, u8::MAX], pct, other)
        }
    }
}

/// `top` laid over `bottom`, the result opaque (source-over compositing).
fn over(top: Color32, bottom: Color32) -> Color32 {
    let [r, g, b, a] = top.to_srgba_unmultiplied();
    let [br, bg, bb, _] = bottom.to_srgba_unmultiplied();
    let k = f32::from(a) / f32::from(u8::MAX);
    let ch = |t: u8, u: u8| (f32::from(t) * k + f32::from(u) * (1.0 - k)).round() as u8;
    Color32::from_rgb(ch(r, br), ch(g, bg), ch(b, bb))
}

/// `scaleLightness` of accent.ts: same hue and saturation, lightness × factor.
fn scale_lightness(c: [u8; RGB], factor: f32) -> Color32 {
    let rgb = egui::Rgba::from_srgba_unmultiplied(c[0], c[1], c[2], u8::MAX);
    let mut hsl = egui::ecolor::Hsva::from(rgb);
    // HSV value approximates the CSS lightness scaling closely enough for a derived shade.
    hsl.v = (hsl.v * factor).clamp(0.0, 1.0);
    Color32::from(hsl)
}

fn luminance(c: [u8; RGB]) -> f32 {
    const WEIGHTS: [f32; RGB] = [0.2126, 0.7152, 0.0722];
    const KNEE: f32 = 0.039_28;
    const LOW_DIV: f32 = 12.92;
    const OFFSET: f32 = 0.055;
    const GAMMA: f32 = 2.4;
    let lin = |v: u8| {
        let s = f32::from(v) / f32::from(u8::MAX);
        if s <= KNEE { s / LOW_DIV } else { ((s + OFFSET) / (1.0 + OFFSET)).powf(GAMMA) }
    };
    c.iter().zip(WEIGHTS).map(|(v, w)| w * lin(*v)).sum()
}

fn contrast(a: [u8; RGB], b: [u8; RGB]) -> f32 {
    const FLARE: f32 = 0.05;
    let (la, lb) = (luminance(a), luminance(b));
    (la.max(lb) + FLARE) / (la.min(lb) + FLARE)
}

impl Theme {
    pub fn new(ground: &str, accent: [u8; RGB]) -> Self {
        let p: &Palette = GROUNDS.iter().find(|g| g.ground == ground).or_else(|| GROUNDS.iter().find(|g| g.ground == DEFAULT_GROUND)).expect("day ground generated");
        let t = |x: Tone| tone(x, accent);
        let on = if contrast(ON_ACCENT_DARK, accent) >= contrast(ON_ACCENT_LIGHT, accent) { ON_ACCENT_DARK } else { ON_ACCENT_LIGHT };
        Theme {
            ground: p.ground,
            dark: p.dark,
            accent: Color32::from_rgb(accent[0], accent[1], accent[2]),
            accent_hi: scale_lightness(accent, LIT_LIGHTNESS),
            accent_d: scale_lightness(accent, SHADED_LIGHTNESS),
            on_accent: Color32::from_rgb(on[0], on[1], on[2]),
            page0: t(p.page_0),
            page1: t(p.page_1),
            txt: t(p.txt),
            txt_hi: t(p.txt_hi),
            muted: t(p.muted),
            faint: t(p.faint),
            solid: t(p.solid),
            surface: t(p.surface),
            card: over(t(p.surface), t(p.page_0)),
            surface2: t(p.surface_2),
            band: t(p.band),
            border: t(p.border),
            hair: t(p.hair),
            hair2: t(p.hair_2),
            tile_fill: t(p.tile_fill),
            tile_bevel: t(p.tile_bevel),
            tile_border: t(p.tile_border),
            glow_in: t(p.glow_in),
            glow_out: t(p.glow_out),
            amb: [t(p.amb_a), t(p.amb_b), t(p.amb_c)],
            lime: t(p.lime),
            lime_ink: t(p.lime_ink),
            lime_glow: t(p.lime_glow),
            emerald: t(p.emerald),
            amber: t(p.amber),
            rose: t(p.rose),
            blue2: t(p.blue_2),
            accent_soft: t(p.accent_soft),
        }
    }

    /// Accent over transparent at `pct` percent (`color-mix(in srgb, var(--accent) p%, transparent)`).
    pub fn accent_alpha(&self, pct: f32) -> Color32 {
        self.accent.gamma_multiply(pct / PCT)
    }

    /// egui's own widgets (text fields, scroll bars, menus) dressed in the palette.
    pub fn visuals(&self) -> egui::Visuals {
        let mut v = if self.dark { egui::Visuals::dark() } else { egui::Visuals::light() };
        v.override_text_color = Some(self.txt);
        v.panel_fill = self.page0;
        v.window_fill = self.solid;
        v.extreme_bg_color = self.solid;
        v.selection.bg_fill = self.accent_alpha(QUARTER);
        v.selection.stroke.color = self.accent;
        v.hyperlink_color = self.accent;
        v.widgets.noninteractive.bg_stroke.color = self.hair;
        v.widgets.inactive.bg_fill = self.solid;
        v.widgets.inactive.weak_bg_fill = self.solid;
        v.widgets.inactive.bg_stroke.color = self.hair;
        v.widgets.hovered.bg_stroke.color = self.accent_alpha(QUARTER);
        v.widgets.active.bg_stroke.color = self.accent;
        v.text_cursor.stroke.color = self.accent;
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accent_names_hex_and_junk() {
        assert_eq!(resolve_accent("green"), Some([0x22, 0xC5, 0x5E]), "legacy Tk name, lowercase");
        assert_eq!(resolve_accent("#2563eb"), Some([0x25, 0x63, 0xEB]));
        assert_eq!(resolve_accent("#abc"), Some([0xAA, 0xBB, 0xCC]));
        assert_eq!(resolve_accent("chartreuse"), None);
        assert_eq!(default_accent(), [0x25, 0x63, 0xEB], "V12 blue is the default");
    }

    #[test]
    fn every_ground_resolves_and_unknown_falls_back_to_day() {
        for g in ["white", "dark", "amoled", "deepblue", "terminal"] {
            assert_eq!(Theme::new(g, default_accent()).ground, g);
        }
        assert_eq!(Theme::new("sepia", default_accent()).ground, "white");
        assert!(!Theme::new("white", default_accent()).dark);
        assert!(Theme::new("terminal", default_accent()).dark);
    }

    #[test]
    fn label_on_accent_is_the_readable_one() {
        assert_eq!(Theme::new("white", [0xC8, 0xA2, 0x4A]).on_accent, Color32::from_rgb(0x0B, 0x0E, 0x12), "dark ink on gold");
        assert_eq!(Theme::new("white", [0x10, 0x20, 0x60]).on_accent, Color32::from_rgb(0xF0, 0xF4, 0xF8), "light ink on navy");
    }

    #[test]
    fn day_card_is_the_mock_white_not_grey() {
        // rgba(255,255,255,.72) over #eaf0f6: what the V12 mock shows inside a card (#F9FBFD).
        let c = Theme::new("white", default_accent()).card;
        assert_eq!(c.to_srgba_unmultiplied(), [0xF9, 0xFB, 0xFD, 0xFF]);
    }

    #[test]
    fn mix_matches_the_browser() {
        // color-mix(in srgb, #22d3ee 30%, transparent) = rgba(34,211,238,.3)
        assert_eq!(mix([0x22, 0xD3, 0xEE, 255], 30.0, [0, 0, 0, 0]), Color32::from_rgba_unmultiplied(0x22, 0xD3, 0xEE, 77));
    }
}
