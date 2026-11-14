//! The bottom band (3.5 `shell/ActionBar.tsx` + `weapon/WeaponBand.tsx`): the weapon band
//! (status, progress, summary, stats, animated silhouette) and the action buttons.
//!
//! D18 of 3.5, kept: a click sends exactly one command; the weapon animates only on the
//! engine's own states (`on_state`), never on a click. Button states come from the engine.

use crate::link::Link;
use crate::paint::{cut_plate, gradient_pill, hrule, mono, regular, ring, semibold, spaced};
use crate::tabs::TabId;
use crate::theme::Theme;
use crate::Cx;
use csdm_core::ui_values::{
    ACTBAR_GAP, ACTBAR_PAD, BTN_CUT, BTN_ICON, BTN_ICON_GAP, BTN_PAD, BUTTON_HIT_S, C4_BEAT_S, C4_SIZE, DETONATION_S, FONT_BAND, FONT_BUTTON, KILL_RETRACT_PX, KILL_RETRACT_S, PROGRESS_BAR, RECOIL_PX, RETICLE_IN_S, RETICLE_IN_SIZE, RING_PERIOD_S, SHOT_S, SPACING_BUTTON,
    WEAK_SHOT_FACTOR, WEAPON_SIZE, WEAPON_SVG_SCALE,
};
use csdm_engine::event::StateName;
use csdm_engine::Command;
use eframe::egui::{self, Align2, Color32, Pos2, Rect, Sense, Stroke, Vec2};
use serde_json::{json, Value};

const AK47_SVG: &[u8] = include_bytes!("../assets/ak47.svg");
/// `weapons.ts::WEAPONS.ak47.muzzle`: 4.1 % from the left, 52 % down.
const MUZZLE: [f32; 2] = [0.041, 0.52];
const WEAPON_ALPHA: f32 = 0.85;
const NOTHING_YET: &str = "--";
const SECS_PER_MIN: u64 = 60;
const MINS_PER_HOUR: u64 = 60;
const META_GAP: f32 = 12.0;
const BAND_HEIGHT: f32 = 40.0;
const FLASH_RADIUS: f32 = 11.0;
const TRACER_W: f32 = 2.0;
const HIT_SQUASH: f32 = 0.07;
const BURST_RAYS: u32 = 8;
const BURST_RADIUS: f32 = 30.0;
const PRIMARY_GLOW_PCT: f32 = 75.0;
const DISABLED_ALPHA: f32 = 0.45;
const SHAKE_PX: f32 = 4.0;
const SHAKE_HZ: f64 = 30.0;

pub fn bar_height() -> f32 {
    BAND_HEIGHT + ACTBAR_PAD[1] * 2.0
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Effect { Shot, WeakShot, Detonation, Retract }

/// The weapon's animation state, driven by engine states only.
#[derive(Default)]
pub struct Weapon {
    texture: Option<egui::TextureHandle>,
    pub effect: Option<(Effect, f64)>,
    /// The charge is set and beating until the engine confirms the process is gone.
    pub armed_since: Option<f64>,
}

impl Weapon {
    /// 3.5 `weapon/controller.ts`: which state plays which sequence.
    pub fn on_state(&mut self, name: StateName, now: f64, motion: bool) {
        if !motion {
            self.armed_since = None;
            return;
        }
        match name {
            StateName::RunStarted => self.effect = Some((Effect::Shot, now)),
            StateName::PreviewStarted => self.effect = Some((Effect::WeakShot, now)),
            StateName::StopRequested if self.armed_since.is_none() => {
                self.armed_since = Some(now);
                self.effect = None;
            }
            StateName::ProcessExited if self.armed_since.is_some() => {
                self.armed_since = None;
                self.effect = Some((Effect::Detonation, now));
            }
            StateName::KillRequested => {
                self.armed_since = None;
                self.effect = Some((Effect::Retract, now));
            }
            _ => {}
        }
    }

    fn texture(&mut self, ctx: &egui::Context) -> Option<egui::TextureHandle> {
        if self.texture.is_none() {
            self.texture = rasterise(ctx);
        }
        self.texture.clone()
    }
}

/// The silhouette as a white alpha mask (tinted when drawn); `None` if the SVG cannot be read.
fn rasterise(ctx: &egui::Context) -> Option<egui::TextureHandle> {
    use resvg::{tiny_skia, usvg};
    let tree = usvg::Tree::from_data(AK47_SVG, &usvg::Options::default()).ok()?;
    let size = tree.size();
    let (w, h) = ((size.width() * WEAPON_SVG_SCALE).ceil() as u32, (size.height() * WEAPON_SVG_SCALE).ceil() as u32);
    let mut pix = tiny_skia::Pixmap::new(w, h)?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(WEAPON_SVG_SCALE, WEAPON_SVG_SCALE), &mut pix.as_mut());
    let img = egui::ColorImage::from_rgba_premultiplied([w as usize, h as usize], pix.data());
    Some(ctx.load_texture("weapon-ak47", img, egui::TextureOptions::LINEAR))
}

fn hms(seconds: f64) -> String {
    let whole = seconds.round().max(0.0) as u64;
    let (h, m, s) = (whole / (SECS_PER_MIN * MINS_PER_HOUR), whole / SECS_PER_MIN % MINS_PER_HOUR, whole % SECS_PER_MIN);
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m}:{s:02}") }
}

/// `n/total` in a progress line, as a fraction.
fn fraction(text: &str) -> Option<f32> {
    text.split_whitespace().find_map(|w| {
        let (a, b) = w.split_once('/')?;
        let (a, b): (f32, f32) = (a.trim_matches(|c: char| !c.is_ascii_digit()).parse().ok()?, b.trim_matches(|c: char| !c.is_ascii_digit()).parse().ok()?);
        (b > 0.0).then(|| (a / b).clamp(0.0, 1.0))
    })
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Face { Primary, Ghost, Danger }

struct Btn<'a> {
    label: &'a str,
    /// Glyph of `icons_data` (3.5 `ActionBar.tsx`).
    icon: &'a str,
    face: Face,
    enabled: bool,
    tip: &'a str,
}

/// What the bar asks of the shell after a frame.
#[derive(Default)]
pub struct BarOut {
    pub go_capture: bool,
}

#[derive(Default)]
pub struct ActionBar {
    pub weapon: Weapon,
    hit: Option<(String, f64)>,
}

impl ActionBar {
    pub fn show(&mut self, ui: &mut egui::Ui, rect: Rect, cx: &Cx, link: &mut Link, tab: TabId) -> BarOut {
        let t = cx.theme;
        let mut out = BarOut::default();
        let p = ui.painter_at(rect);
        p.rect_filled(rect, 0.0, t.band);
        p.hline(rect.x_range(), rect.top(), Stroke::new(1.0, t.hair));
        hrule(&p, Rect::from_min_size(rect.min, Vec2::new(rect.width(), 1.0)), &[Color32::TRANSPARENT, t.accent_alpha(PCT_RULE), Color32::TRANSPARENT]);
        let inner = rect.shrink2(Vec2::from(ACTBAR_PAD));
        let s = &link.state;
        let busy = s.busy;
        let problem = link.inputs_problem.clone();
        let editing = tab == TabId::Editing;
        let (has_preview, has_selected) = (link.preview_count() > 0, link.selected_count() > 0);
        let buttons: Vec<Btn> = if editing {
            let no_preview = "Run PREVIEW on the CAPTURE tab first: this tab lists the clips it finds";
            let busy_tip = "Wait for the current run or preview to finish";
            let gen_tip = if busy { busy_tip } else if !has_preview { no_preview } else if !has_selected { "Check at least one clip below" } else { problem.as_deref().unwrap_or("Run only the clips checked below, not a full batch") };
            let save_tip = if busy { busy_tip } else if !has_preview { no_preview } else { "Save the current settings and selection as a reusable preset" };
            vec![
                Btn { label: "GENERATE", icon: "run", face: Face::Primary, enabled: has_selected && !busy && problem.is_none(), tip: gen_tip },
                Btn { label: "SAVE", icon: "presets", face: Face::Ghost, enabled: has_preview && !busy, tip: save_tip },
                Btn { label: "CANCEL", icon: "editing", face: Face::Ghost, enabled: true, tip: "Discard this preview and return to the Capture tab" },
            ]
        } else {
            let stop = if s.stop_label.to_lowercase().contains("preview") { "STOP PREVIEW" } else { "STOP" };
            vec![
                Btn { label: "PREVIEW", icon: "preview", face: Face::Ghost, enabled: problem.is_none(), tip: problem.as_deref().unwrap_or("Scan and list candidate clips for review, without recording video yet") },
                Btn { label: stop, icon: "stop", face: Face::Danger, enabled: s.stop_enabled, tip: "Ask the current run to stop gracefully after the in-progress clip" },
                Btn { label: "KILL", icon: "kill", face: Face::Danger, enabled: s.kill_enabled, tip: "Force-terminate the run immediately, without a clean shutdown" },
                Btn { label: "RUN", icon: "run", face: Face::Primary, enabled: s.run_enabled && problem.is_none(), tip: problem.as_deref().unwrap_or("Start a full batch run using the current settings") },
            ]
        };

        // Buttons from the right edge.
        let mut x = inner.right();
        let mut placed = Vec::new();
        for b in buttons.iter().rev() {
            let g = crate::paint::spaced_galley(&p, b.label, mono(FONT_BUTTON), Color32::WHITE, SPACING_BUTTON);
            let size = Vec2::new(BTN_ICON + BTN_ICON_GAP + g.size().x + BTN_PAD[0] * 2.0, inner.height().min(g.size().y.max(BTN_ICON) + BTN_PAD[1] * 2.0));
            let r = Rect::from_min_size(Pos2::new(x - size.x, inner.center().y - size.y / 2.0), size);
            x = r.left() - ACTBAR_GAP;
            placed.push((r, b));
        }
        placed.reverse();
        let mut clicked = None;
        for (r, b) in &placed {
            let resp = ui.interact(*r, ui.scope_id().with(("action", b.label)), if b.enabled { Sense::click() } else { Sense::hover() });
            let (label, enabled) = (b.label.to_string(), b.enabled);
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, enabled, &label));
            let resp = resp.on_hover_text(b.tip);
            if resp.hovered() {
                crate::cursor::snap_here(ui.ctx(), *r);
            }
            if resp.clicked() {
                clicked = Some(b.label);
                self.hit = Some((b.label.to_string(), cx.now));
            }
            self.paint_button(ui, *r, b, t, cx);
        }
        if let Some(label) = clicked {
            let cfg = link.settings.clone();
            let now = cx.now;
            match label {
                "PREVIEW" => { link.send(now, Command::StartPreview { cfg }); }
                "RUN" => { link.send(now, Command::StartRun { cfg, selected_clips: None }); }
                "STOP" | "STOP PREVIEW" => { link.send(now, Command::RequestStop); }
                "KILL" => { link.send(now, Command::RequestKill); }
                "GENERATE" => {
                    let clips = link.selected_clips();
                    link.send(now, Command::StartRun { cfg, selected_clips: Some(clips) });
                }
                "SAVE" => {
                    let clips = link.selected_clips();
                    link.send(now, Command::SavePreset { preset: String::new(), cats: vec!["full".into()], cfg, selected_clips: Some(clips), ask_name: true });
                }
                _ => out.go_capture = true,
            }
        }

        let band = Rect::from_min_max(inner.min, Pos2::new(x, inner.max.y));
        let targets: Vec<(String, Rect)> = placed.iter().map(|(r, b)| (b.label.to_string(), *r)).collect();
        self.weapon_band(ui, band, cx, link, &targets);
        out
    }

    fn paint_button(&self, ui: &egui::Ui, r: Rect, b: &Btn, t: &Theme, cx: &Cx) {
        let p = ui.painter();
        let hit = self.hit.as_ref().filter(|(l, at)| l == b.label && cx.motion && cx.now - at < BUTTON_HIT_S).map(|(_, at)| ((cx.now - at) / BUTTON_HIT_S) as f32);
        let squash = hit.map(|k| 1.0 - HIT_SQUASH * (1.0 - (k * 2.0 - 1.0).abs())).unwrap_or(1.0);
        let r = Rect::from_center_size(r.center(), r.size() * squash);
        let dim = |c: Color32| if b.enabled { c } else { c.gamma_multiply(DISABLED_ALPHA) };
        let ink = match b.face {
            Face::Primary => {
                p.add(egui::epaint::Shadow { offset: PRIMARY_SHADOW_OFFSET, blur: PRIMARY_SHADOW_BLUR, spread: 0, color: t.accent_alpha(PRIMARY_GLOW_PCT) }.as_shape(r, r.height() / 2.0));
                if cx.motion && b.enabled {
                    let phase = (cx.now / RING_PERIOD_S * std::f64::consts::TAU) as f32;
                    ring(p, r.expand(2.0), phase, t.lime_glow, t.accent);
                    ui.ctx().request_repaint();
                }
                gradient_pill(p, r, dim(t.blue2), dim(t.accent));
                dim(Color32::WHITE)
            }
            Face::Ghost => {
                cut_plate(p, r, BTN_CUT, t.solid, Stroke::new(1.0, t.hair));
                dim(t.txt)
            }
            Face::Danger => {
                cut_plate(p, r, BTN_CUT, t.rose.gamma_multiply(DANGER_FILL), Stroke::new(1.0, t.rose.gamma_multiply(DANGER_EDGE)));
                dim(t.rose)
            }
        };
        // `.btn`: glyph, 8 px gap, label, centred together.
        let g = crate::paint::spaced_galley(p, b.label, mono(FONT_BUTTON), ink, SPACING_BUTTON);
        let left = r.center().x - (BTN_ICON + BTN_ICON_GAP + g.size().x) / 2.0;
        crate::icons::paint(p, b.icon, Rect::from_min_size(Pos2::new(left, r.center().y - BTN_ICON / 2.0), Vec2::splat(BTN_ICON)), ink);
        spaced(p, Pos2::new(left + BTN_ICON + BTN_ICON_GAP, r.center().y), Align2::LEFT_CENTER, b.label, mono(FONT_BUTTON), ink, SPACING_BUTTON);
        if let Some(k) = hit {
            // Flash and conic burst of the click (`.btn.hit`): the button took the click.
            p.rect_filled(r, r.height() / 2.0, Color32::WHITE.gamma_multiply((1.0 - k) * FLASH_PEAK));
            for i in 0..BURST_RAYS {
                let a = i as f32 / BURST_RAYS as f32 * std::f32::consts::TAU;
                let d = Vec2::angled(a) * BURST_RADIUS * (1.0 / 2.0 + k);
                p.line_segment([r.center() + d * (1.0 / 2.0), r.center() + d], Stroke::new(2.0, t.accent.gamma_multiply(1.0 - k)));
            }
            ui.ctx().request_repaint();
        }
    }

    fn weapon_band(&mut self, ui: &mut egui::Ui, band: Rect, cx: &Cx, link: &Link, targets: &[(String, Rect)]) {
        let t = cx.theme;
        let now = cx.now;
        let p = ui.painter_at(band.expand(BURST_RADIUS));
        // Shake of the band (the mock shakes the whole window).
        let shaking = matches!(self.weapon.effect, Some((Effect::Detonation | Effect::Retract, at)) if now - at < SHOT_S * 2.0);
        let shake = if shaking && cx.motion { Vec2::new((now * SHAKE_HZ).sin() as f32 * SHAKE_PX, 0.0) } else { Vec2::ZERO };
        let gun = Rect::from_min_size(Pos2::new(band.left(), band.center().y - WEAPON_SIZE[1] / 2.0), Vec2::from(WEAPON_SIZE)).translate(shake);
        let mut offset = Vec2::ZERO;
        let mut alpha = WEAPON_ALPHA;
        let mut animating = false;
        if let Some((effect, at)) = self.weapon.effect {
            let age = now - at;
            let length = match effect { Effect::Shot | Effect::WeakShot => SHOT_S, Effect::Detonation => DETONATION_S, Effect::Retract => KILL_RETRACT_S };
            let length = if effect == Effect::WeakShot { length.max(RETICLE_IN_S) } else { length };
            if age >= length || !cx.motion {
                self.weapon.effect = None;
            } else {
                animating = true;
                let k = (age / length) as f32;
                let muzzle = gun.min + Vec2::new(gun.width() * MUZZLE[0], gun.height() * MUZZLE[1]);
                let target_name = match effect { Effect::Shot => "RUN", Effect::WeakShot => "PREVIEW", _ => "KILL" };
                let target = targets.iter().find(|(n, _)| n == target_name || (target_name == "RUN" && n == "GENERATE")).map(|(_, r)| r.center()).unwrap_or(band.right_center());
                match effect {
                    Effect::Shot | Effect::WeakShot => {
                        let power = if effect == Effect::WeakShot { WEAK_SHOT_FACTOR } else { 1.0 };
                        let shot_k = ((age / SHOT_S) as f32).min(1.0);
                        offset.x = RECOIL_PX * power * (1.0 - shot_k) * if shot_k < 1.0 { 1.0 } else { 0.0 };
                        if shot_k < 1.0 {
                            p.circle_filled(muzzle, FLASH_RADIUS * power * (1.0 - shot_k), t.amber.gamma_multiply(1.0 - shot_k));
                            let head = muzzle.lerp(target, shot_k);
                            let tail = muzzle.lerp(target, (shot_k - SHOT_TAIL).max(0.0));
                            p.line_segment([tail, head], Stroke::new(TRACER_W, Color32::WHITE.lerp_to_gamma(t.amber, 1.0 / 2.0).gamma_multiply(1.0 - shot_k)));
                        }
                        if effect == Effect::WeakShot {
                            // PREVIEW's opening reticle over the window.
                            let rk = ((age / RETICLE_IN_S) as f32).min(1.0);
                            let c = ui.ctx().content_rect().center();
                            let size = RETICLE_IN_SIZE * (1.0 + (1.0 - rk) * (1.0 / 2.0));
                            let a = if rk < RETICLE_FADE { 1.0 } else { (1.0 - rk) / (1.0 - RETICLE_FADE) };
                            let fp = ui.ctx().layer_painter(egui::LayerId::new(egui::Order::Foreground, egui::Id::unique("reticle-in")));
                            let s = Stroke::new(2.0, t.accent.gamma_multiply(a));
                            fp.line_segment([c - Vec2::new(size / 2.0, 0.0), c + Vec2::new(size / 2.0, 0.0)], s);
                            fp.line_segment([c - Vec2::new(0.0, size / 2.0), c + Vec2::new(0.0, size / 2.0)], s);
                            fp.circle_stroke(c, RETICLE_RING, s);
                        }
                    }
                    Effect::Detonation => {
                        let fp = ui.ctx().layer_painter(egui::LayerId::new(egui::Order::Foreground, egui::Id::unique("boom")));
                        let a = if k < BOOM_PEAK { k / BOOM_PEAK } else { (1.0 - k) / (1.0 - BOOM_PEAK) };
                        let screen = ui.ctx().content_rect();
                        crate::paint::radial_glow(&fp, Pos2::new(screen.left() + screen.width() * BOOM_AT[0], screen.top() + screen.height() * BOOM_AT[1]), screen.size(), t.amber.gamma_multiply(a), BOOM_FADE);
                    }
                    Effect::Retract => {
                        offset.x = -KILL_RETRACT_PX * k * k;
                        alpha *= 1.0 - k;
                    }
                }
            }
        }
        if let Some(since) = self.weapon.armed_since {
            // The charge waits, beating, until the engine says the process is gone.
            let beat = (((now - since) / C4_BEAT_S).fract() * 2.0) < 1.0;
            let c4 = Rect::from_min_size(gun.right_center() + Vec2::new(ACTBAR_GAP, -C4_SIZE[1] / 2.0), Vec2::from(C4_SIZE));
            let (fill, ink) = if beat || !cx.motion { (t.rose, Color32::WHITE) } else { (Color32::WHITE, t.rose) };
            p.rect(c4, C4_RADIUS, fill, Stroke::new(1.0, Color32::from_black_alpha(C4_EDGE)), egui::StrokeKind::Inside);
            p.text(c4.center(), Align2::CENTER_CENTER, "C4", mono(FONT_BAND - 2.0), ink);
            if cx.motion {
                ui.ctx().request_repaint_after_secs((C4_BEAT_S / 2.0) as f32);
            }
        }
        if let Some(tex) = self.weapon.texture(ui.ctx()) {
            let size = tex.size_vec2();
            let h = WEAPON_SIZE[1];
            let w = size.x / size.y * h;
            let r = Rect::from_min_size(gun.min + offset, Vec2::new(w, h));
            p.image(tex.id(), r, Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)), t.accent.gamma_multiply(alpha));
        }
        if animating {
            ui.ctx().request_repaint();
        }

        // Status, progress bar, summary and the compact stats.
        let s = &link.state;
        let status = s.progress.clone().unwrap_or_else(|| if s.busy { "working…".into() } else { "idle".into() });
        let mut x = gun.right() + ACTBAR_GAP + if self.weapon.armed_since.is_some() { C4_SIZE[0] + ACTBAR_GAP } else { 0.0 };
        let cy = band.center().y;
        let r = spaced(&p, Pos2::new(x, cy), Align2::LEFT_CENTER, &status, mono(FONT_BAND), t.muted, 0.0);
        let st = ui.interact(r, ui.scope_id().with("band-status"), Sense::hover());
        st.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, &status));
        x = r.right() + META_GAP;
        let bar = Rect::from_min_size(Pos2::new(x, cy - PROGRESS_BAR[1] / 2.0), Vec2::from(PROGRESS_BAR));
        p.rect_filled(bar, PROGRESS_BAR[1] / 2.0, t.hair);
        if let Some(f) = s.progress.as_deref().and_then(fraction) {
            p.rect_filled(Rect::from_min_size(bar.min, Vec2::new(bar.width() * f, bar.height())), PROGRESS_BAR[1] / 2.0, t.accent);
        }
        x = bar.right() + META_GAP;
        let counter = s.summary.as_ref().map(|m| m.text.clone()).unwrap_or_default();
        if !counter.is_empty() {
            let r = spaced(&p, Pos2::new(x, cy), Align2::LEFT_CENTER, &counter, semibold(FONT_BAND), t.txt, 0.0);
            let c = ui.interact(r, ui.scope_id().with("band-counter"), Sense::hover());
            c.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, &counter));
            x = r.right() + META_GAP;
        }
        let m = s.summary.clone().unwrap_or_default();
        let count = |v: Option<f64>| v.map(|n| format!("{}", n.round() as i64)).unwrap_or_else(|| NOTHING_YET.into());
        let time = |v: Option<f64>| v.map(hms).unwrap_or_else(|| NOTHING_YET.into());
        let stats = [("DEMOS", count(m.demos), t.txt), ("CLIPS", count(m.clips), t.accent), ("TOTAL", time(m.total_s), t.emerald), ("AVG / CLIP", time(m.avg_s), t.txt)];
        for (k, v, c) in stats {
            if x > band.right() - META_GAP * 2.0 { break; }
            let r = spaced(&p, Pos2::new(x, cy), Align2::LEFT_CENTER, k, regular(FONT_BAND - 2.0), t.faint, SPACING_BUTTON);
            let r2 = spaced(&p, Pos2::new(r.right() + META_GAP / 2.0, cy), Align2::LEFT_CENTER, &v, semibold(FONT_BAND), c, 0.0);
            x = r2.right() + META_GAP;
        }
    }
}

const PCT_RULE: f32 = 45.0;
const DANGER_FILL: f32 = 0.08;
const DANGER_EDGE: f32 = 0.3;
const FLASH_PEAK: f32 = 0.85;
const SHOT_TAIL: f32 = 0.18;
const RETICLE_FADE: f32 = 0.78;
const RETICLE_RING: f32 = 17.0;
const BOOM_PEAK: f32 = 0.08;
const BOOM_AT: [f32; 2] = [0.18, 0.7];
const BOOM_FADE: f32 = 0.68;
const C4_EDGE: u8 = 51;
const C4_RADIUS: f32 = 3.0;
const PRIMARY_SHADOW_OFFSET: [i8; 2] = [0, 7];
const PRIMARY_SHADOW_BLUR: u8 = 18;

impl Link {
    /// The checked preview clips, as `start_run` / `save_preset` take them.
    /// shortcut: carries the raw preview sequences; EDITING (T8) adds the per-clip edits.
    pub fn selected_clips(&self) -> Value {
        json!(self.state.preview_selected.iter().enumerate().filter(|(_, s)| **s).map(|(k, _)| json!({"index": k})).collect::<Vec<_>>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_fraction_and_clock() {
        assert_eq!(fraction("▰▰▱▱ 3/12 clips"), Some(0.25));
        assert_eq!(fraction("working"), None);
        assert_eq!(fraction("0/0"), None);
        assert_eq!(hms(59.6), "1:00");
        assert_eq!(hms(3725.0), "1:02:05");
    }

    #[test]
    fn weapon_follows_engine_states_only() {
        let mut w = Weapon::default();
        w.on_state(StateName::ProcessExited, 0.0, true);
        assert!(w.effect.is_none(), "nothing to detonate");
        w.on_state(StateName::StopRequested, 1.0, true);
        assert_eq!(w.armed_since, Some(1.0));
        w.on_state(StateName::StopRequested, 2.0, true);
        assert_eq!(w.armed_since, Some(1.0), "already armed");
        w.on_state(StateName::ProcessExited, 3.0, true);
        assert_eq!((w.armed_since, w.effect.map(|e| e.0)), (None, Some(Effect::Detonation)));
        w.on_state(StateName::RunStarted, 4.0, false);
        assert_eq!(w.effect.map(|e| e.0), Some(Effect::Detonation), "no motion: nothing new plays");
    }
}
