//! Match Types, Map Filter and Weapon Filter, `timeline` style (3.5 `matchTypes/TimelineView.tsx`
//! queue board, `mapFilter/TimelineView.tsx` veto pool, `WeaponFilterCard.tsx` rack).

use super::kit::{button, flag, hint, kick, lab, list, mark, set_list};
use super::model::{gun_width, kept_words, list_words, map_name, map_shade, split_badge};
use super::{pending, CaptureTab};
use crate::grid::CardCx;
use crate::paint::{regular, semibold};
use crate::theme::Theme;
use csdm_core::ui_values::GUN_RACK_HEIGHT;
use eframe::egui::{self, pos2, vec2, Color32, Rect, Response, Sense, Stroke, StrokeKind};
use serde_json::{json, Value};

const MT_TIP: &str = "When off, all match types are included; the boxes below only apply while this is on";
const MF_TIP: &str = "Turns map filtering on; when off, all maps are included regardless of selections below";
const ABSENT_TIP: &str = "Not present in your database";
const SELECT_ALL_TIP: &str = "Select all available weapons";
const DESELECT_ALL_TIP: &str = "Clear weapon selection";

/// `.mt-ticket` / `.mf-map` geometry.
const TICKET: [f32; 2] = [92.0, 70.0];
const MAP_CARD: [f32; 2] = [96.0, 74.0];
const TILE_GAP: f32 = 8.0;
const TILE_RADIUS: f32 = 12.0;
const FONT_BADGE: f32 = 22.0;
const FONT_TILE: f32 = 11.5;
const FONT_STATE: f32 = 9.0;
const MONO_SIZE: f32 = 30.0;
const LOCKED_ALPHA: f32 = 0.45;
const LIT_TINT: f32 = 0.10;
/// Rack: shelf name column, gun cell padding.
const SHELF_NAME_W: f32 = 108.0;
const GUN_PAD: [f32; 2] = [8.0, 5.0];
const FONT_GUN: f32 = 10.0;
const STRIPE_STEP: f32 = 7.0;
/// The four stripe slants are centred on the middle one.
const SHADE_MID: f32 = 1.5;
const MONO_FONT_PLUS: f32 = 4.0;

/// The master switch of a set filter: the lime switch (`FilterSwitch`).
fn master(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, label: &str, tip: &str) {
    mark(ui, key);
    crate::tabs::settings::controls::switch(ui, cx, key, label, tip);
}

/// A clickable tile with a lit state; returns its response (click handled by the caller).
fn tile(ui: &mut egui::Ui, t: &Theme, size: [f32; 2], name: &str, on: bool, enabled: bool, tip: &str) -> (Rect, Response) {
    let (rect, resp) = ui.allocate_exact_size(vec2(size[0], size[1]), if enabled { Sense::click() } else { Sense::hover() });
    let n = name.to_string();
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, enabled, on, &n));
    let resp = resp.on_hover_text(tip);
    let p = ui.painter();
    let (fill, edge) = if on { (t.solid.lerp_to_gamma(t.accent, LIT_TINT), t.accent) } else { (t.solid, t.hair) };
    p.rect(rect, TILE_RADIUS, fill, Stroke::new(if on { 2.0 } else { 1.0 }, edge), StrokeKind::Inside);
    if resp.hovered() && enabled {
        p.rect_stroke(rect.expand(2.0), TILE_RADIUS + 2.0, Stroke::new(2.0, t.accent_soft), StrokeKind::Outside);
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    (rect, resp)
}

/// The Match Types queue board.
pub fn match_types(tab: &mut CaptureTab, ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    let enabled = flag(cx, "match_type_filter_enabled", false);
    master(ui, cx, "match_type_filter_enabled", "Filter by type", MT_TIP);
    let Some(tables) = tab.tables.clone() else {
        lab(ui, t, "Loading match types…");
        return None;
    };
    let db = super::CaptureTab::database(cx).cloned();
    if db.is_none() {
        pending(ui, cx);
    }
    let found: Vec<String> = db.as_ref().and_then(|d| d.get("match_types")).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_lowercase).collect()).unwrap_or_default();
    let reg = &csdm_core::registries::registries().match_types;
    let types: Vec<(String, String, String)> = tables.get("match_types").and_then(Value::as_array).into_iter().flatten()
        .map(|m| (m["key"].as_str().unwrap_or_default().to_string(), m["label"].as_str().unwrap_or_default().to_string(), m["tip"].as_str().unwrap_or_default().to_string()))
        .collect();
    let locked = db.is_none() || !enabled;
    let mut picked = 0;
    ui.add_space(TILE_GAP);
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = vec2(TILE_GAP, TILE_GAP);
        for (key, label, tip) in &types {
            mark(ui, key);
            let on = flag(cx, key, false);
            picked += usize::from(on);
            // Greyed when the database never recorded this mode (the window's `in_db`), never hidden.
            let in_db = db.is_none() || reg.iter().find(|m| &m.key == key).is_none_or(|m| m.db_values.iter().any(|v| found.contains(&v.to_lowercase())));
            let usable = !locked && (in_db || on);
            let (badge, name) = split_badge(label);
            let tip = if in_db { tip.clone() } else { format!("{tip}\n{ABSENT_TIP}") };
            let (rect, resp) = tile(ui, t, TICKET, &name, on, usable, &tip);
            let alpha = if usable || on { 1.0 } else { LOCKED_ALPHA };
            let p = ui.painter();
            let ink = if on { t.accent } else { t.txt }.gamma_multiply(alpha);
            let b = if badge.is_empty() { name.chars().next().map(String::from).unwrap_or_default() } else { badge };
            p.text(rect.center() - vec2(0.0, FONT_BADGE / 2.0), egui::Align2::CENTER_CENTER, b, regular(FONT_BADGE), ink);
            p.text(pos2(rect.center().x, rect.bottom() - FONT_TILE), egui::Align2::CENTER_CENTER, &name, semibold(FONT_TILE), ink);
            if resp.clicked() && usable {
                cx.link.set(cx.now, key, json!(!on));
            }
        }
    });
    Some(kept_words(enabled, picked, types.len()))
}

/// The Map Filter veto pool.
pub fn maps(ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    let enabled = flag(cx, "map_filter_enabled", false);
    master(ui, cx, "map_filter_enabled", "Filter by map", MF_TIP);
    let db = super::CaptureTab::database(cx).cloned();
    if db.is_none() {
        pending(ui, cx);
    }
    let picked = list(cx, "map_filter");
    mark(ui, "map_filter");
    let maps: Vec<(String, Vec<String>)> = db.as_ref().and_then(|d| d.get("maps")).and_then(Value::as_array).into_iter().flatten().filter_map(|m| {
        let a = m.as_array()?;
        Some((a.first()?.as_str()?.to_string(), a.get(1).and_then(Value::as_array).map(|r| r.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default()))
    }).collect();
    let locked = db.is_none() || !enabled;
    ui.add_space(TILE_GAP);
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = vec2(TILE_GAP, TILE_GAP);
        for (display, raw) in &maps {
            let on = picked.contains(display);
            let name = map_name(display);
            let tip = format!("{name} ({}): record only demos on the picked maps while the filter is on", raw.join(", "));
            let (rect, resp) = tile(ui, t, MAP_CARD, &name, on, !locked, &tip);
            let alpha = if locked { LOCKED_ALPHA } else { 1.0 };
            let p = ui.painter();
            // The monogram: a rounded square striped at one of four angles.
            let mono = Rect::from_center_size(pos2(rect.center().x, rect.top() + MONO_SIZE / 2.0 + GUN_PAD[0]), vec2(MONO_SIZE, MONO_SIZE));
            let base = if on { t.accent } else { t.muted };
            p.rect_filled(mono, TILE_GAP, base.gamma_multiply(LIT_TINT * 2.0 * alpha));
            let clip = p.with_clip_rect(mono);
            let shade = map_shade(display) as f32;
            let mut x = mono.left() - MONO_SIZE;
            while x < mono.right() + MONO_SIZE {
                let dx = MONO_SIZE * (shade - SHADE_MID) / 2.0;
                clip.line_segment([pos2(x, mono.bottom()), pos2(x + dx, mono.top())], Stroke::new(1.0, base.gamma_multiply(LIT_TINT * 2.0 * alpha)));
                x += STRIPE_STEP;
            }
            p.text(mono.center(), egui::Align2::CENTER_CENTER, display.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default(), semibold(FONT_TILE + MONO_FONT_PLUS), base.gamma_multiply(alpha));
            p.text(pos2(rect.center().x, mono.bottom() + FONT_TILE), egui::Align2::CENTER_CENTER, &name, semibold(FONT_TILE), t.txt.gamma_multiply(alpha));
            p.text(pos2(rect.center().x, rect.bottom() - FONT_STATE), egui::Align2::CENTER_CENTER, if on { "PICK" } else { "pool" }, semibold(FONT_STATE), if on { t.accent } else { t.faint });
            if resp.clicked() && !locked {
                let next: Vec<String> = if on { picked.iter().filter(|m| *m != display).cloned().collect() } else { picked.iter().cloned().chain([display.clone()]).collect() };
                set_list(cx, "map_filter", &next);
            }
        }
    });
    Some(kept_words(enabled, maps.iter().filter(|(d, _)| picked.contains(d)).count(), maps.len()))
}

/// The weapon rack: one shelf per category, every weapon the database holds as its silhouette.
pub fn weapons(tab: &mut CaptureTab, ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    let Some(tables) = tab.tables.clone() else {
        lab(ui, t, "Loading weapons…");
        return None;
    };
    let Some(db) = super::CaptureTab::database(cx).cloned() else {
        pending(ui, cx);
        return None;
    };
    mark(ui, "weapons");
    let selected = list(cx, "weapons");
    let present: Vec<String> = db.get("weapons").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
    // The engine's table lists every weapon CS2 shipped; only those this database recorded are offered.
    let cats: Vec<(String, Vec<String>)> = tables.get("weapon_categories").and_then(Value::as_object).into_iter().flatten()
        .map(|(c, names)| (c.clone(), names.as_array().into_iter().flatten().filter_map(Value::as_str).filter(|n| present.iter().any(|p| p == n)).map(String::from).collect::<Vec<_>>()))
        .filter(|(_, n)| !n.is_empty())
        .collect();
    let all: Vec<String> = cats.iter().flat_map(|(_, n)| n.clone()).collect();
    let summary = list_words(&selected, "any weapon");
    let mut next: Option<Vec<String>> = None;
    ui.horizontal(|ui| {
        lab(ui, t, "empty = all");
        ui.label(egui::RichText::new("Keeps kills with ").font(regular(FONT_TILE + 1.0)).color(t.muted));
        ui.label(egui::RichText::new(&summary).font(semibold(FONT_TILE + 1.0)).color(t.accent));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if button(ui, t, "Deselect all", "Deselect all", DESELECT_ALL_TIP, true) && selected.iter().any(|w| all.contains(w)) {
                next = Some(Vec::new());
            }
            if button(ui, t, "Select all", "Select all", SELECT_ALL_TIP, true) {
                next = Some(all.clone());
            }
        });
    });
    ui.add_space(TILE_GAP);
    let tips = tables.get("weapon_category_tips").cloned().unwrap_or(Value::Null);
    for (cat, names) in &cats {
        let picked = names.iter().filter(|n| selected.contains(n)).count();
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing = vec2(TILE_GAP / 2.0, TILE_GAP / 2.0);
            let tip = format!("{} — click to pick or drop the whole category", tips.get(cat).and_then(Value::as_str).unwrap_or(cat));
            let (r, resp) = ui.allocate_exact_size(vec2(SHELF_NAME_W, GUN_RACK_HEIGHT + GUN_PAD[1] * 2.0 + FONT_GUN), Sense::click());
            let n = format!("{cat} category");
            resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, picked == names.len(), &n));
            let resp = resp.on_hover_text(tip);
            let lit = picked > 0;
            ui.painter().rect(r, TILE_RADIUS, if lit { t.lime } else { t.surface2 }, Stroke::new(1.0, if lit { t.lime_glow } else { t.hair }), StrokeKind::Inside);
            let ink = if lit { t.lime_ink } else { t.txt };
            ui.painter().text(r.left_center() + vec2(GUN_PAD[0], -FONT_GUN / 2.0), egui::Align2::LEFT_CENTER, cat, semibold(FONT_TILE), ink);
            ui.painter().text(r.left_center() + vec2(GUN_PAD[0], FONT_GUN), egui::Align2::LEFT_CENTER, format!("{picked}/{}", names.len()), regular(FONT_GUN), ink);
            if resp.clicked() {
                let base = next.clone().unwrap_or_else(|| selected.clone());
                next = Some(if picked == names.len() { base.into_iter().filter(|w| !names.contains(w)).collect() } else { base.iter().cloned().chain(names.iter().filter(|n| !base.contains(n)).cloned()).collect() });
            }
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = vec2(TILE_GAP / 2.0, TILE_GAP / 2.0);
                for name in names {
                    let on = selected.contains(name);
                    let w = gun_width(super::art::ratio(name), GUN_RACK_HEIGHT);
                    let (rect, resp) = tile(ui, t, [w + GUN_PAD[0] * 2.0, GUN_RACK_HEIGHT + GUN_PAD[1] * 2.0 + FONT_GUN], name, on, true, &format!("Filter clips with {name}"));
                    let ink = if on { t.accent } else { t.muted };
                    let gun = Rect::from_min_size(rect.min + vec2(GUN_PAD[0], GUN_PAD[1]), vec2(w, GUN_RACK_HEIGHT));
                    match tab.art.get(ui.ctx(), name, GUN_RACK_HEIGHT) {
                        Some((tex, ratio)) => {
                            // Fit the art in its slot at its own proportions.
                            let aw = (GUN_RACK_HEIGHT * ratio).min(w);
                            let ah = aw / ratio;
                            let r = Rect::from_center_size(gun.center(), vec2(aw, ah));
                            ui.painter().image(tex.id(), r, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), ink);
                        }
                        None => {
                            ui.painter().rect_stroke(gun.shrink(GUN_PAD[1]), TILE_GAP / 2.0, Stroke::new(1.0, ink), StrokeKind::Inside);
                        }
                    }
                    ui.painter().text(pos2(rect.center().x, rect.bottom() - GUN_PAD[1] - FONT_GUN / 2.0), egui::Align2::CENTER_CENTER, name, regular(FONT_GUN), if on { t.accent } else { t.faint });
                    if resp.clicked() {
                        let base = next.clone().unwrap_or_else(|| selected.clone());
                        next = Some(if on { base.into_iter().filter(|w| w != name).collect() } else { base.into_iter().chain([name.clone()]).collect() });
                    }
                }
            });
        });
        ui.add_space(TILE_GAP / 2.0);
    }
    if cats.is_empty() {
        hint(ui, t, "No weapon recorded in this database yet.");
    }
    if let Some(n) = next {
        set_list(cx, "weapons", &n);
    }
    let _ = Color32::TRANSPARENT;
    Some(if selected.is_empty() { "all".into() } else { format!("{} active", selected.len()) })
}

#[allow(dead_code)]
fn kick_row(ui: &mut egui::Ui, t: &Theme, s: &str) {
    kick(ui, t, s);
}
