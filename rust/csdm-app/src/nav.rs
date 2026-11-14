//! The top band (3.5 `shell/HudNav.tsx`, mock `.hud-nav`): brand and version chip, the five
//! tabs, the DB and preset pills.

use crate::link::{DbState, Link};
use crate::paint::{cut_plate, hrule, regular, semibold, spaced, vgradient};
use crate::tabs::{TabId, TABS};
use crate::Cx;
use csdm_core::ui_values::{
    BRAND_CUT, BRAND_MARK, FONT_BRAND, FONT_BRAND_SUB, FONT_PILL, FONT_TAB, NAV_GAP, NAV_PAD_X, PILL_PAD, SPACING_BRAND, SPACING_BRAND_SUB, SPACING_TAB, TAB_ICON_GAP, TAB_LIFT, TAB_OVERLAP, TAB_PAD_LEFT, TAB_PAD_RIGHT, TAB_SLANT,
};
use eframe::egui::{self, Align2, Color32, Pos2, Rect, Sense, Shape, Stroke, StrokeKind, Vec2};
use serde_json::Value;

const TICK: f32 = 3.0;
const BADGE: f32 = 3.5;
const RULE_PCT: f32 = 45.0;
const IND_HEIGHT: f32 = 2.0;
const PLAY: f32 = 6.0;
const NOTHING: &str = "--";

/// Draws the band in `rect`; returns the tab the user picked, if any.
pub fn show(ui: &mut egui::Ui, rect: Rect, cx: &Cx, link: &Link, active: TabId, editing_badge: bool) -> Option<TabId> {
    let t = cx.theme;
    let p = ui.painter_at(rect);
    p.rect_filled(rect, 0.0, t.band);
    p.hline(rect.x_range(), rect.bottom(), Stroke::new(1.0, t.hair));
    hrule(&p, Rect::from_min_size(rect.left_bottom() - Vec2::new(0.0, 1.0), Vec2::new(rect.width(), 1.0)), &[Color32::TRANSPARENT, t.accent_alpha(RULE_PCT), Color32::TRANSPARENT]);

    // Brand: cut-corner mark, product line, version chip.
    let cy = rect.center().y;
    let mut x = rect.left() + NAV_PAD_X;
    let mark = Rect::from_min_size(Pos2::new(x, cy - BRAND_MARK / 2.0), Vec2::splat(BRAND_MARK));
    cut_plate(&p, mark, BRAND_CUT, t.accent, Stroke::NONE);
    vgradient(&p, mark.shrink(BRAND_CUT).translate(Vec2::new(0.0, 0.0)), t.blue2.gamma_multiply(1.0 / 2.0), Color32::TRANSPARENT);
    let c = mark.center();
    p.add(Shape::convex_polygon(vec![c + Vec2::new(-PLAY / 2.0, -PLAY), c + Vec2::new(PLAY, 0.0), c + Vec2::new(-PLAY / 2.0, PLAY)], Color32::WHITE, Stroke::NONE));
    x = mark.right() + TAB_ICON_GAP;
    let b = spaced(&p, Pos2::new(x, cy - 1.0), Align2::LEFT_BOTTOM, "CSDM", semibold(FONT_BRAND), t.txt, SPACING_BRAND);
    let s = spaced(&p, Pos2::new(x, cy + 1.0), Align2::LEFT_TOP, "BATCH CLIPS", regular(FONT_BRAND_SUB), t.faint, SPACING_BRAND_SUB);
    x = b.right().max(s.right()) + TAB_ICON_GAP;
    if let Some(v) = &link.version {
        let r = pill(ui, &p, Pos2::new(x, cy), v, None, t);
        let chip = ui.interact(r, ui.scope_id().with("version-chip"), Sense::hover());
        let label = format!("Version {v}");
        chip.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, &label));
        chip.on_hover_text(label);
        x = r.right() + TAB_ICON_GAP;
    }
    x += NAV_GAP / 2.0;
    p.vline(x, rect.top() + NAV_PAD_X..=rect.bottom() - NAV_PAD_X, Stroke::new(1.0, t.hair));
    x += NAV_GAP;

    // Tabs: slanted plates, the active one lifted and lit.
    let mut picked = None;
    let mut active_rect = None;
    for (k, tab) in TABS.iter().enumerate() {
        let is_active = tab.id == active;
        let g = crate::paint::spaced_galley(&p, tab.label, semibold(FONT_TAB), t.muted, SPACING_TAB);
        let w = TAB_PAD_LEFT + TICK * 2.0 + TAB_ICON_GAP + g.size().x + TAB_PAD_RIGHT;
        let left = if k == 0 { x } else { x - TAB_OVERLAP };
        let lift = if is_active { TAB_LIFT } else { 0.0 };
        let r = Rect::from_min_max(Pos2::new(left, rect.top() - lift), Pos2::new(left + w, rect.bottom() - lift));
        let resp = ui.interact(r, ui.scope_id().with(("tab", tab.key)), Sense::click());
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Tab, true, is_active, tab.label));
        let resp = resp.on_hover_text(tab.tip);
        if resp.clicked() {
            picked = Some(tab.id);
        }
        let fill = if is_active { t.solid } else if resp.hovered() { t.surface } else { t.surface2 };
        let shape = vec![Pos2::new(r.left() + TAB_SLANT, r.top()), r.right_top(), Pos2::new(r.right() - TAB_SLANT, r.bottom()), r.left_bottom()];
        p.add(Shape::convex_polygon(shape, fill, Stroke::new(1.0, t.hair)));
        if is_active {
            hrule(&p, Rect::from_min_size(Pos2::new(r.left() + TAB_SLANT, r.top()), Vec2::new(r.width() - TAB_SLANT, IND_HEIGHT)), &[t.lime_glow, t.accent, Color32::TRANSPARENT]);
            active_rect = Some(r);
        }
        let ink = if is_active || resp.hovered() { t.txt } else { t.muted };
        let tick_c = Pos2::new(r.left() + TAB_PAD_LEFT + TICK, cy - lift);
        let tick_color = if is_active { t.accent } else { ink.gamma_multiply(1.0 / 2.0) };
        p.add(Shape::convex_polygon(vec![tick_c - Vec2::new(0.0, TICK), tick_c + Vec2::new(TICK, 0.0), tick_c + Vec2::new(0.0, TICK), tick_c - Vec2::new(TICK, 0.0)], tick_color, Stroke::NONE));
        let tr = spaced(&p, Pos2::new(tick_c.x + TICK + TAB_ICON_GAP, cy - lift), Align2::LEFT_CENTER, tab.label, semibold(FONT_TAB), ink, SPACING_TAB);
        if tab.id == TabId::Editing && editing_badge {
            p.circle_filled(Pos2::new(tr.right() + BADGE * 2.0, tr.top() + BADGE), BADGE, t.lime_glow);
        }
        x = r.right();
    }
    if let Some(r) = active_rect {
        hrule(&p, Rect::from_min_size(Pos2::new(r.left(), rect.bottom() - IND_HEIGHT), Vec2::new(r.width(), IND_HEIGHT)), &[t.lime_glow, t.accent]);
    }

    // Pills: the shared connection and the active encoding preset.
    let db_name = link.get("pg_db").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(NOTHING).to_string();
    let (db_label, db_tip) = match &link.db {
        DbState::Error(_) => ("offline".to_string(), "Not connected to the database: see SETTINGS › PostgreSQL Connection"),
        DbState::Pending => (db_name, "Connecting to the PostgreSQL database…"),
        DbState::Ok => (db_name, "PostgreSQL database currently connected for this session"),
    };
    let preset = link.get("video_preset").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(NOTHING).to_string();
    let right = rect.right() - NAV_PAD_X;
    let pr = pill_size(&p, "Preset", &preset);
    let r_preset = pill(ui, &p, Pos2::new(right - pr.x, cy), &preset, Some("Preset"), t);
    let dr = pill_size(&p, "DB", &db_label);
    let r_db = pill(ui, &p, Pos2::new(r_preset.left() - TAB_ICON_GAP - dr.x, cy), &db_label, Some("DB"), t);
    for (r, name, tip) in [(r_db, format!("DB {db_label}"), db_tip), (r_preset, format!("Preset {preset}"), "Active video encoding preset used when recording clips")] {
        let resp = ui.interact(r, ui.scope_id().with(("pill", tip)), Sense::hover());
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, &name));
        resp.on_hover_text(tip);
    }
    picked
}

fn pill_size(p: &egui::Painter, key: &str, value: &str) -> Vec2 {
    let k = p.layout_no_wrap(format!("{key} "), regular(FONT_PILL), Color32::WHITE).size();
    let v = p.layout_no_wrap(value.to_string(), semibold(FONT_PILL), Color32::WHITE).size();
    Vec2::new(k.x + v.x + PILL_PAD[0] * 2.0, v.y.max(k.y) + PILL_PAD[1] * 2.0)
}

/// `.navtools .p`: a rounded pill, "key value" with the value in bold. Left-centre at `at`.
fn pill(_ui: &egui::Ui, p: &egui::Painter, at: Pos2, value: &str, key: Option<&str>, t: &crate::theme::Theme) -> Rect {
    let size = pill_size(p, key.unwrap_or(""), value);
    let r = Rect::from_min_size(Pos2::new(at.x, at.y - size.y / 2.0), size);
    p.rect(r, r.height() / 2.0, t.surface, Stroke::new(1.0, t.hair), StrokeKind::Inside);
    let mut x = r.left() + PILL_PAD[0];
    if let Some(k) = key {
        let kr = p.text(Pos2::new(x, r.center().y), Align2::LEFT_CENTER, format!("{k} "), regular(FONT_PILL), t.muted);
        x = kr.right();
    }
    p.text(Pos2::new(x, r.center().y), Align2::LEFT_CENTER, value, semibold(FONT_PILL), t.txt);
    r
}
