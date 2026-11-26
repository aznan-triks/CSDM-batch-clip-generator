//! Match Types, Map Filter and Weapon Filter, `timeline` style (3.5 `matchTypes/TimelineView.tsx`
//! queue board, `mapFilter/TimelineView.tsx` veto pool, `WeaponFilterCard.tsx` rack).

use super::kit::{button, flag, hint, kick, lab, list, mark, set_list};
use super::model::{gun_width, kept_words, list_words, map_name, map_shade, split_badge};
use super::{pending, CaptureTab};
use crate::cardstyle::{action_word, bool_word, choice_token, icon_tile, prose_line, prose_word, style_of, tile_grid};
use crate::grid::CardCx;
use crate::paint::{regular, semibold};
use crate::theme::Theme;
use crate::widgets::chip;
use csdm_core::ui_values::{CardStyle, GUN_RACK_HEIGHT};
use eframe::egui::{self, pos2, vec2, Color32, Rect, Response, Sense, Stroke, StrokeKind};
use serde_json::{json, Value};

const SET_TILE_MIN_W: f32 = 115.0;
const WEAPON_TILE_MIN_W: f32 = 120.0;

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

/// Shared Set Filter Sentence builder (`match-types` & `map-filter`).
struct SetItem {
    id: String,
    name: String,
    badge: String,
    tip: String,
    on: bool,
    usable: bool,
}

struct SetSentence<'a> {
    master_key: &'a str,
    master_label: &'a str,
    on_words: &'a str,
    off_words: &'a str,
    master_tip: &'a str,
    token_id: &'a str,
    token_label: &'a str,
    all_label: &'a str,
}

fn set_filter_sentence(ui: &mut egui::Ui, cx: &mut CardCx, spec: &SetSentence<'_>, items: &[SetItem]) -> Option<usize> {
    let t = cx.theme;
    let enabled = flag(cx, spec.master_key, false);
    let picked: Vec<&str> = items.iter().filter(|i| i.on).map(|i| i.name.as_str()).collect();
    let summary = if picked.is_empty() { spec.all_label.to_string() } else { list_words(&picked.iter().map(|s| (*s).to_string()).collect::<Vec<_>>(), spec.all_label) };
    let mut toggled = None;
    prose_line(ui, |ui| {
        bool_word(ui, cx, spec.master_key, spec.master_label, spec.on_words, spec.off_words, false, spec.master_tip);
        if enabled {
            prose_word(ui, t, ":");
            choice_token(ui, t, spec.token_id, &summary, spec.token_label, false, spec.master_tip, true, |ui, _| {
                ui.horizontal_wrapped(|ui| {
                    for (idx, item) in items.iter().enumerate() {
                        if chip(ui, t, &item.name, Some(item.on), Some(&item.name), item.usable).on_hover_text(&item.tip).clicked() && item.usable {
                            toggled = Some(idx);
                        }
                    }
                });
            });
        }
        prose_word(ui, t, ".");
    });
    toggled
}

/// The Match Types queue board.
pub fn match_types(tab: &mut CaptureTab, ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    let enabled = flag(cx, "match_type_filter_enabled", false);
    let Some(tables) = tab.tables.clone() else {
        master(ui, cx, "match_type_filter_enabled", "Filter by type", MT_TIP);
        lab(ui, t, "Loading match types…");
        return None;
    };
    let db = super::CaptureTab::database(cx).cloned();
    if db.is_none() {
        pending(ui, cx);
    }
    let found: Vec<String> = db.as_ref().and_then(|d| d.get("match_types")).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_lowercase).collect()).unwrap_or_default();
    let reg = &csdm_core::registries::registries().match_types;
    let items: Vec<SetItem> = tables
        .get("match_types")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|m| {
            let key = m["key"].as_str().unwrap_or_default().to_string();
            let label = m["label"].as_str().unwrap_or_default();
            let tip = m["tip"].as_str().unwrap_or_default();
            mark(ui, &key);
            let on = flag(cx, &key, false);
            let in_db = db.is_none() || reg.iter().find(|r| r.key == key).is_none_or(|r| r.db_values.iter().any(|v| found.contains(&v.to_lowercase())));
            let usable = !(db.is_none() || !enabled) && (in_db || on);
            let (badge, name) = split_badge(label);
            let tip = if in_db { tip.to_string() } else { format!("{tip}\n{ABSENT_TIP}") };
            let badge = if badge.is_empty() { name.chars().next().map(String::from).unwrap_or_default() } else { badge };
            SetItem { id: key, name, badge, tip, on, usable }
        })
        .collect();
    let picked = items.iter().filter(|i| i.on).count();
    match style_of(cx, "match-types") {
        CardStyle::Timeline => {
            master(ui, cx, "match_type_filter_enabled", "Filter by type", MT_TIP);
            ui.add_space(TILE_GAP);
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = vec2(TILE_GAP, TILE_GAP);
                for item in &items {
                    let (rect, resp) = tile(ui, t, TICKET, &item.name, item.on, item.usable, &item.tip);
                    let alpha = if item.usable || item.on { 1.0 } else { LOCKED_ALPHA };
                    let p = ui.painter();
                    let ink = if item.on { t.accent } else { t.txt }.gamma_multiply(alpha);
                    p.text(rect.center() - vec2(0.0, FONT_BADGE / 2.0), egui::Align2::CENTER_CENTER, &item.badge, regular(FONT_BADGE), ink);
                    p.text(pos2(rect.center().x, rect.bottom() - FONT_TILE), egui::Align2::CENTER_CENTER, &item.name, semibold(FONT_TILE), ink);
                    if resp.clicked() && item.usable {
                        cx.link.set(cx.now, &item.id, json!(!item.on));
                    }
                }
            });
        }
        CardStyle::Sentence => {
            let spec = SetSentence {
                master_key: "match_type_filter_enabled",
                master_label: "Filter by type",
                on_words: "Keep only selected match types",
                off_words: "Keep all match types",
                master_tip: MT_TIP,
                token_id: "match-types-pick",
                token_label: "Match types",
                all_label: "any match type",
            };
            if let Some(idx) = set_filter_sentence(ui, cx, &spec, &items) {
                let item = &items[idx];
                cx.link.set(cx.now, &item.id, json!(!item.on));
            }
        }
        CardStyle::Tiles => {
            master(ui, cx, "match_type_filter_enabled", "Filter by type", MT_TIP);
            ui.add_space(TILE_GAP);
            tile_grid(ui, SET_TILE_MIN_W, items.len(), |ui, idx, w| {
                let item = &items[idx];
                let cap = if item.on { "Included" } else if item.usable { "Ignored" } else { "Not in DB" };
                let resp = icon_tile(ui, t, w, crate::cardstyle::ICON_TILE_H, &item.name, cap, None, item.on, !item.usable, false, &item.tip, |p, r, c| {
                    p.text(r.center(), egui::Align2::CENTER_CENTER, &item.badge, regular(FONT_BADGE), c);
                });
                if resp.clicked() && item.usable {
                    cx.link.set(cx.now, &item.id, json!(!item.on));
                }
            });
        }
    }
    Some(kept_words(enabled, picked, items.len()))
}

/// The Map Filter veto pool.
pub fn maps(ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    let enabled = flag(cx, "map_filter_enabled", false);
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
    let items: Vec<SetItem> = maps
        .iter()
        .map(|(display, raw)| {
            let name = map_name(display);
            let on = picked.contains(display);
            let tip = format!("{name} ({}): record only demos on the picked maps while the filter is on", raw.join(", "));
            let badge = display.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
            SetItem { id: display.clone(), name, badge, tip, on, usable: !locked }
        })
        .collect();
    let toggle_map = |cx: &mut CardCx, display: &str, on: bool| {
        let next: Vec<String> = if on { picked.iter().filter(|m| *m != display).cloned().collect() } else { picked.iter().cloned().chain([display.to_string()]).collect() };
        set_list(cx, "map_filter", &next);
    };
    match style_of(cx, "map-filter") {
        CardStyle::Timeline => {
            master(ui, cx, "map_filter_enabled", "Filter by map", MF_TIP);
            ui.add_space(TILE_GAP);
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = vec2(TILE_GAP, TILE_GAP);
                for (item, (display, _)) in items.iter().zip(maps.iter()) {
                    let (rect, resp) = tile(ui, t, MAP_CARD, &item.name, item.on, !locked, &item.tip);
                    let alpha = if locked { LOCKED_ALPHA } else { 1.0 };
                    let p = ui.painter();
                    let mono = Rect::from_center_size(pos2(rect.center().x, rect.top() + MONO_SIZE / 2.0 + GUN_PAD[0]), vec2(MONO_SIZE, MONO_SIZE));
                    let base = if item.on { t.accent } else { t.muted };
                    p.rect_filled(mono, TILE_GAP, base.gamma_multiply(LIT_TINT * 2.0 * alpha));
                    let clip = p.with_clip_rect(mono);
                    let shade = map_shade(display) as f32;
                    let mut x = mono.left() - MONO_SIZE;
                    while x < mono.right() + MONO_SIZE {
                        let dx = MONO_SIZE * (shade - SHADE_MID) / 2.0;
                        clip.line_segment([pos2(x, mono.bottom()), pos2(x + dx, mono.top())], Stroke::new(1.0, base.gamma_multiply(LIT_TINT * 2.0 * alpha)));
                        x += STRIPE_STEP;
                    }
                    p.text(mono.center(), egui::Align2::CENTER_CENTER, &item.badge, semibold(FONT_TILE + MONO_FONT_PLUS), base.gamma_multiply(alpha));
                    let mut job = egui::text::LayoutJob::single_section(item.name.clone(), egui::TextFormat::simple(semibold(FONT_TILE), t.txt.gamma_multiply(alpha)));
                    job.wrap = egui::text::TextWrapping::truncate_at_width(rect.width() - GUN_PAD[0] * 2.0);
                    let g = p.layout_job(job);
                    p.galley(pos2(rect.center().x, mono.bottom() + FONT_TILE) - g.size() / 2.0, g, t.txt);
                    p.text(pos2(rect.center().x, rect.bottom() - FONT_STATE), egui::Align2::CENTER_CENTER, if item.on { "PICK" } else { "pool" }, semibold(FONT_STATE), if item.on { t.accent } else { t.faint });
                    if resp.clicked() && !locked {
                        toggle_map(cx, display, item.on);
                    }
                }
            });
        }
        CardStyle::Sentence => {
            let spec = SetSentence {
                master_key: "map_filter_enabled",
                master_label: "Filter by map",
                on_words: "Keep only demos on",
                off_words: "Keep demos on any map",
                master_tip: MF_TIP,
                token_id: "map-filter-pick",
                token_label: "Maps",
                all_label: "any map",
            };
            if let Some(idx) = set_filter_sentence(ui, cx, &spec, &items) {
                toggle_map(cx, &items[idx].id, items[idx].on);
            }
        }
        CardStyle::Tiles => {
            master(ui, cx, "map_filter_enabled", "Filter by map", MF_TIP);
            ui.add_space(TILE_GAP);
            tile_grid(ui, SET_TILE_MIN_W, items.len(), |ui, idx, w| {
                let item = &items[idx];
                let cap = if item.on { "PICK" } else { "pool" };
                let resp = icon_tile(ui, t, w, crate::cardstyle::ICON_TILE_H, &item.name, cap, None, item.on, locked, false, &item.tip, |p, r, c| {
                    p.text(r.center(), egui::Align2::CENTER_CENTER, &item.badge, semibold(FONT_BADGE), c);
                });
                if resp.clicked() && !locked {
                    toggle_map(cx, &item.id, item.on);
                }
            });
        }
    }
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
    let tips = tables.get("weapon_category_tips").cloned().unwrap_or(Value::Null);
    match style_of(cx, "weapon-filter") {
        CardStyle::Timeline => {
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
                            let name_w = ui.painter().layout_no_wrap(name.clone(), regular(FONT_GUN), t.faint).size().x;
                            let (rect, resp) = tile(ui, t, [w.max(name_w) + GUN_PAD[0] * 2.0, GUN_RACK_HEIGHT + GUN_PAD[1] * 2.0 + FONT_GUN], name, on, true, &format!("Filter clips with {name}"));
                            let ink = if on { t.accent } else { t.muted };
                            let gun = Rect::from_center_size(pos2(rect.center().x, rect.top() + GUN_PAD[1] + GUN_RACK_HEIGHT / 2.0), vec2(w, GUN_RACK_HEIGHT));
                            match tab.art.get(ui.ctx(), name, GUN_RACK_HEIGHT) {
                                Some((tex, ratio)) => {
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
        }
        CardStyle::Sentence => {
            prose_line(ui, |ui| {
                prose_word(ui, t, "Keep kills made with");
                choice_token(ui, t, "weapons", &summary, "Weapons", false, "Pick specific weapons (empty = any weapon)", true, |ui, _| {
                    ui.horizontal_wrapped(|ui| {
                        for name in &all {
                            let on = selected.contains(name);
                            if chip(ui, t, name, Some(on), Some(name), true).clicked() {
                                let base = next.clone().unwrap_or_else(|| selected.clone());
                                next = Some(if on { base.into_iter().filter(|w| w != name).collect() } else { base.into_iter().chain([name.clone()]).collect() });
                            }
                        }
                    });
                });
                prose_word(ui, t, "(");
                for (cat, names) in &cats {
                    let picked = names.iter().filter(|n| selected.contains(n)).count();
                    let label = if picked == 0 { cat.clone() } else { format!("{cat} {picked}/{}", names.len()) };
                    choice_token(ui, t, &format!("weapon-cat-{cat}"), &label, cat, picked > 0, tips.get(cat).and_then(Value::as_str).unwrap_or(cat), true, |ui, _| {
                        ui.horizontal(|ui| {
                            if button(ui, t, "All", "All", "Pick all in category", true) {
                                let base = next.clone().unwrap_or_else(|| selected.clone());
                                next = Some(base.iter().cloned().chain(names.iter().filter(|n| !base.contains(n)).cloned()).collect());
                            }
                            if button(ui, t, "None", "None", "Clear category", true) {
                                let base = next.clone().unwrap_or_else(|| selected.clone());
                                next = Some(base.into_iter().filter(|w| !names.contains(w)).collect());
                            }
                        });
                        ui.horizontal_wrapped(|ui| {
                            for name in names {
                                let on = selected.contains(name);
                                if chip(ui, t, name, Some(on), Some(name), true).clicked() {
                                    let base = next.clone().unwrap_or_else(|| selected.clone());
                                    next = Some(if on { base.into_iter().filter(|w| w != name).collect() } else { base.into_iter().chain([name.clone()]).collect() });
                                }
                            }
                        });
                    });
                }
                prose_word(ui, t, ") ·");
                if action_word(ui, t, "Select all", "Select all", false, false, SELECT_ALL_TIP, true) {
                    next = Some(all.clone());
                }
                prose_word(ui, t, "·");
                if action_word(ui, t, "Deselect all", "Deselect all", false, false, DESELECT_ALL_TIP, true) && selected.iter().any(|w| all.contains(w)) {
                    next = Some(Vec::new());
                }
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            ui.horizontal(|ui| {
                lab(ui, t, "empty = all");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if button(ui, t, "Deselect all", "Deselect all", DESELECT_ALL_TIP, true) && selected.iter().any(|w| all.contains(w)) {
                        next = Some(Vec::new());
                    }
                    if button(ui, t, "Select all", "Select all", SELECT_ALL_TIP, true) {
                        next = Some(all.clone());
                    }
                });
            });
            for (cat, names) in &cats {
                let picked = names.iter().filter(|n| selected.contains(n)).count();
                ui.add_space(TILE_GAP / 2.0);
                ui.horizontal(|ui| {
                    kick(ui, t, &format!("{cat} ({picked}/{})", names.len()));
                    if chip(ui, t, if picked == names.len() { "None" } else { "All" }, Some(picked > 0), Some(&format!("{cat} category")), true).clicked() {
                        let base = next.clone().unwrap_or_else(|| selected.clone());
                        next = Some(if picked == names.len() { base.into_iter().filter(|w| !names.contains(w)).collect() } else { base.iter().cloned().chain(names.iter().filter(|n| !base.contains(n)).cloned()).collect() });
                    }
                });
                tile_grid(ui, WEAPON_TILE_MIN_W, names.len(), |ui, idx, w| {
                    let name = &names[idx];
                    let on = selected.contains(name);
                    let h = GUN_RACK_HEIGHT + GUN_PAD[1] * 2.0 + FONT_GUN;
                    let (rect, resp) = tile(ui, t, [w, h], name, on, true, &format!("Filter clips with {name}"));
                    let ink = if on { t.accent } else { t.muted };
                    let gw = gun_width(super::art::ratio(name), GUN_RACK_HEIGHT).min(w - GUN_PAD[0] * 2.0);
                    let gun = Rect::from_center_size(pos2(rect.center().x, rect.top() + GUN_PAD[1] + GUN_RACK_HEIGHT / 2.0), vec2(gw, GUN_RACK_HEIGHT));
                    match tab.art.get(ui.ctx(), name, GUN_RACK_HEIGHT) {
                        Some((tex, ratio)) => {
                            let aw = (GUN_RACK_HEIGHT * ratio).min(gw);
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
                });
            }
        }
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
