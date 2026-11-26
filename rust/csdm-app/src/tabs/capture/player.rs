//! Player, `timeline` style (3.5 `player/TimelineView.tsx`, `parts.tsx`, `usePlayerCard.ts`): the
//! roster board. Your lineup and your ★ roster (drag to reorder) on the left, the searchable
//! database on the right, everyone drawn as an avatar pill.
//!
//! `steam_ids` is the source of truth; `steam_id` and `player_name` follow as the first active
//! player (`_collect_cfg`). `saved_players` is written from the latest list, never a stale copy.

use super::kit::{framed, hint, kick, lab, list, mark, seg};
use super::model::{avatar_hue, find_players, player_rows, reorder, short_id, Order, PlayerRow};
use super::{pending, CaptureTab};
use crate::cardstyle::{big_tile, choice_token, prose_line, prose_muted, prose_word, style_of, tile_grid, TileGlyph};
use crate::grid::CardCx;
use crate::paint::{regular, semibold};
use crate::theme::Theme;
use csdm_core::ui_values::{CardStyle, PLAYER_PAGE_SIZE};
use eframe::egui::{self, pos2, vec2, Color32, Rect, Response, Sense, Stroke, StrokeKind};
use serde_json::{json, Value};

const TILE_MIN_W: f32 = 195.0;

pub const FIND_STEAM_ID_HINT: &str = "Your Steam ID (17 digits, 7656119…) is on your player page in CS Demo Manager, or at the end of your Steam profile URL (steamcommunity.com/profiles/…).";
const TIP_SORT: &str = "Sort players alphabetically or by most recently seen";
const TIP_REGISTERED: &str = "Click to select for capture, or drag to reorder your registered accounts";
const TIP_UNREGISTER: &str = "Remove this player from your registered accounts (does not deselect them)";
const TIP_STAR: &str = "Save this player to your Registered Accounts for quick access later";
const ORDERS: [&str; 2] = ["name", "recent"];

/// `.pc-side` share of the card, pill geometry, avatar.
const SIDE_SHARE: f32 = 0.36;
const PILL_H: f32 = 30.0;
const PILL_PAD: f32 = 4.0;
const AVATAR: f32 = 22.0;
const GAP: f32 = 6.0;
const FONT_NAME: f32 = 12.0;
const FONT_ID: f32 = 9.5;
const LIST_H: f32 = 340.0;
const ROW_W: f32 = 210.0;
const SEARCH_W: f32 = 230.0;
const CLOSE_W: f32 = 22.0;
/// Avatar colours: accent, emerald, amber, rose, blue-2 (`Player.css` `data-hue`).
fn hue(t: &Theme, h: u32) -> Color32 {
    let hues = [t.accent, t.emerald, t.amber, t.rose, t.blue2];
    hues[h as usize % hues.len()]
}

#[derive(Clone, Debug, PartialEq)]
struct Saved {
    steam_id: String,
    name: String,
}

fn saved(cx: &CardCx) -> Vec<Saved> {
    cx.link.get("saved_players").and_then(Value::as_array).map(|a| a.iter().filter_map(|p| Some(Saved { steam_id: p.get("steam_id")?.as_str()?.to_string(), name: p.get("name").and_then(Value::as_str).unwrap_or_default().to_string() })).collect()).unwrap_or_default()
}

fn write_saved(cx: &mut CardCx, list: &[Saved]) {
    cx.link.set(cx.now, "saved_players", json!(list.iter().map(|p| json!({"steam_id": p.steam_id, "name": p.name})).collect::<Vec<_>>()));
}

/// Writes the active set and keeps `steam_id` / `player_name` on the first one.
fn activate(cx: &mut CardCx, rows: &[PlayerRow], ids: &[String]) {
    let primary = ids.first().cloned().unwrap_or_default();
    let name = rows.iter().find(|r| r.steam_id == primary).map(|r| r.name.clone()).unwrap_or_default();
    cx.link.set(cx.now, "steam_ids", json!(ids));
    cx.link.set(cx.now, "steam_id", json!(primary));
    cx.link.set(cx.now, "player_name", json!(name));
}

fn avatar(p: &egui::Painter, t: &Theme, c: egui::Pos2, name: &str, steam_id: &str) {
    let color = hue(t, avatar_hue(steam_id));
    p.circle_filled(c, AVATAR / 2.0, color);
    let initial = name.trim().chars().next().map_or("?".to_string(), |ch| ch.to_uppercase().to_string());
    p.text(c, egui::Align2::CENTER_CENTER, initial, semibold(FONT_NAME - 1.0), Color32::WHITE);
}

#[allow(clippy::too_many_arguments)]
/// A V12 avatar pill; `x`: draws a close mark at its end. Returns its response.
fn pill(ui: &mut egui::Ui, t: &Theme, name: &str, sub: &str, on: bool, accessible: &str, tip: &str, grip: bool, sense: Sense) -> Response {
    let g = ui.painter().layout_no_wrap(name.to_string(), semibold(FONT_NAME), if on { t.lime_ink } else { t.txt });
    let s = (!sub.is_empty()).then(|| ui.painter().layout_no_wrap(sub.to_string(), regular(FONT_ID), t.faint));
    let text_w = g.size().x.max(s.as_ref().map_or(0.0, |s| s.size().x));
    let extra = if grip { GAP * 2.0 } else { 0.0 };
    let (rect, resp) = ui.allocate_exact_size(vec2(PILL_PAD + AVATAR + GAP + text_w + GAP * 2.0 + extra, PILL_H), sense);
    let n = accessible.to_string();
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, on, &n));
    let resp = resp.on_hover_text(tip);
    let p = ui.painter();
    let (fill, edge) = if on { (t.lime, t.lime_glow) } else { (t.solid, if resp.hovered() { t.accent } else { t.hair }) };
    p.rect(rect, PILL_H / 2.0, fill, Stroke::new(1.0, edge), StrokeKind::Inside);
    avatar(p, t, pos2(rect.left() + PILL_PAD + AVATAR / 2.0, rect.center().y), name, accessible);
    let tx = rect.left() + PILL_PAD + AVATAR + GAP;
    match s {
        Some(s) => {
            let h = g.size().y + s.size().y;
            p.galley(pos2(tx, rect.center().y - h / 2.0), g.clone(), t.txt);
            p.galley(pos2(tx, rect.center().y - h / 2.0 + g.size().y), s, t.faint);
        }
        None => {
            p.galley(pos2(tx, rect.center().y - g.size().y / 2.0), g, t.txt);
        }
    }
    if grip {
        crate::paint::grip(p, Rect::from_center_size(pos2(rect.right() - GAP * 2.0, rect.center().y), vec2(GAP, PILL_H / 2.0)), t.faint);
    }
    if resp.hovered() {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    resp
}

pub fn card(tab: &mut CaptureTab, ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    for k in ["steam_ids", "steam_id", "player_name", "saved_players"] {
        mark(ui, k);
    }
    let db = CaptureTab::database(cx).cloned();
    let rows = player_rows(db.as_ref().and_then(|d| d.get("players")));
    let active = list(cx, "steam_ids");
    let mut roster = saved(cx);
    let mut next_active: Option<Vec<String>> = None;
    let mut next_saved: Option<Vec<Saved>> = None;
    let search_bar = |tab: &mut CaptureTab, ui: &mut egui::Ui, t: &Theme, db_ready: bool| {
        ui.horizontal_wrapped(|ui| {
            let mut s = tab.player.search.clone();
            let r = ui.add(egui::TextEdit::singleline(&mut s).hint_text("Search by name or Steam ID…").desired_width(SEARCH_W));
            r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::SearchInput, true, "Search players"));
            let r = r.on_hover_text(format!("Search players by name or Steam ID. {FIND_STEAM_ID_HINT}"));
            if r.changed() {
                tab.player.search = s;
                tab.player.page = 0;
            }
            if db_ready {
                let cur = if tab.player.order == Order::Recent { ORDERS[1] } else { ORDERS[0] };
                if let Some(o) = seg(ui, t, "Sort", &ORDERS, cur, false, TIP_SORT, None) {
                    tab.player.order = if o == ORDERS[1] { Order::Recent } else { Order::Name };
                    tab.player.page = 0;
                }
            }
        });
    };

    match style_of(cx, "player") {
        CardStyle::Timeline => {
            let width = ui.available_width();
            ui.horizontal_top(|ui| {
                ui.allocate_ui(vec2(width * SIDE_SHARE, 0.0), |ui| {
                    ui.vertical(|ui| {
                        framed(ui, t, |ui| {
                            kick(ui, t, &format!("In the clips · {}", active.len()));
                            ui.horizontal_wrapped(|ui| {
                                if active.is_empty() {
                                    hint(ui, t, "No active player -- pick one below");
                                }
                                for id in &active {
                                    let name = rows.iter().find(|r| &r.steam_id == id).map_or(id.clone(), |r| r.name.clone());
                                    let r = pill(ui, t, &format!("{name}  ×"), "", true, &format!("Active {name}"), &format!("Click to remove {name} from active filter"), false, Sense::click());
                                    if r.clicked() {
                                        next_active = Some(active.iter().filter(|s| *s != id).cloned().collect());
                                    }
                                }
                            });
                        });
                        ui.add_space(GAP);
                        ui.horizontal(|ui| {
                            kick(ui, t, "★ Roster · drag to reorder");
                            lab(ui, t, &format!("{} registered", roster.len()));
                        });
                        let shown = match tab.player.drag {
                            Some((from, over)) if from != over => reorder(&roster, from, over),
                            _ => roster.clone(),
                        };
                        ui.horizontal_wrapped(|ui| {
                            if roster.is_empty() {
                                hint(ui, t, "None. Select a player below and click ★ to register.");
                            }
                            for (i, p) in shown.iter().enumerate() {
                                let on = active.contains(&p.steam_id);
                                let r = pill(ui, t, &p.name, "", on, &format!("Registered {}", p.name), TIP_REGISTERED, true, Sense::click_and_drag());
                                if r.drag_started() {
                                    tab.player.drag = Some((i, i));
                                }
                                if let Some((from, _)) = tab.player.drag {
                                    if ui.ctx().pointer_hover_pos().is_some_and(|pos| r.rect.contains(pos)) {
                                        tab.player.drag = Some((from, i));
                                    }
                                }
                                if r.drag_stopped() {
                                    if let Some((from, over)) = tab.player.drag.take() {
                                        if from != over {
                                            roster = reorder(&roster, from, over);
                                            next_saved = Some(roster.clone());
                                        }
                                    }
                                } else if r.clicked() {
                                    next_active = Some(if on { active.iter().filter(|s| **s != p.steam_id).cloned().collect() } else { active.iter().cloned().chain([p.steam_id.clone()]).collect() });
                                }
                                let close = crate::widgets::chip(ui, t, "×", None, Some(&format!("Unregister {}", p.name)), true).on_hover_text(TIP_UNREGISTER);
                                if close.clicked() {
                                    next_saved = Some(roster.iter().filter(|s| s.steam_id != p.steam_id).cloned().collect());
                                }
                                let _ = CLOSE_W;
                            }
                        });
                    });
                });
                ui.add_space(GAP * 2.0);
                ui.vertical(|ui| {
                    search_bar(tab, ui, t, db.is_some());
                    if db.is_none() {
                        pending(ui, cx);
                        return;
                    }
                    let matching = find_players(&rows, &tab.player.search, tab.player.order);
                    let pages = matching.len().div_ceil(PLAYER_PAGE_SIZE).max(1);
                    let page = tab.player.page.min(pages - 1);
                    ui.horizontal(|ui| {
                        lab(ui, t, &format!("{} player{}", matching.len(), if matching.len() == 1 { "" } else { "s" }));
                        if crate::widgets::chip(ui, t, "‹", None, Some("Previous page"), page > 0).clicked() {
                            tab.player.page = page - 1;
                        }
                        lab(ui, t, &format!("{} / {pages}", page + 1));
                        if crate::widgets::chip(ui, t, "›", None, Some("Next page"), page + 1 < pages).clicked() {
                            tab.player.page = page + 1;
                        }
                    });
                    if matching.is_empty() {
                        let words = if rows.is_empty() {
                            "No player in this database yet: analyze your demos in CS Demo Manager first, then press Test & Reload in SETTINGS.".to_string()
                        } else {
                            format!("No player matches. {FIND_STEAM_ID_HINT}")
                        };
                        hint(ui, t, &words);
                    }
                    egui::ScrollArea::vertical().max_height(LIST_H).auto_shrink([false, true]).show(ui, |ui| {
                        ui.horizontal_wrapped(|ui| {
                            for p in matching.iter().skip(page * PLAYER_PAGE_SIZE).take(PLAYER_PAGE_SIZE) {
                                let on = active.contains(&p.steam_id);
                                let registered = roster.iter().any(|s| s.steam_id == p.steam_id);
                                ui.allocate_ui(vec2(ROW_W, PILL_H), |ui| {
                                    ui.horizontal(|ui| {
                                        ui.spacing_mut().item_spacing.x = GAP / 2.0;
                                        let r = pill(ui, t, &p.name, &short_id(&p.steam_id), on, &p.name, &p.label, false, Sense::click());
                                        if r.clicked() {
                                            next_active = Some(if on { active.iter().filter(|s| **s != p.steam_id).cloned().collect() } else { active.iter().cloned().chain([p.steam_id.clone()]).collect() });
                                        }
                                        let star = crate::widgets::chip(ui, t, if registered { "★" } else { "☆" }, Some(registered), Some(&format!("Register {}", p.name)), true).on_hover_text(TIP_STAR);
                                        if star.clicked() {
                                            let base = next_saved.clone().unwrap_or_else(|| roster.clone());
                                            next_saved = Some(if base.iter().any(|s| s.steam_id == p.steam_id) { base.into_iter().filter(|s| s.steam_id != p.steam_id).collect() } else { base.into_iter().chain([Saved { steam_id: p.steam_id.clone(), name: p.name.clone() }]).collect() });
                                        }
                                    });
                                });
                            }
                        });
                    });
                });
            });
        }
        CardStyle::Sentence => {
            prose_line(ui, |ui| {
                prose_word(ui, t, "Capture clips of");
                if active.is_empty() {
                    prose_muted(ui, t, "no active player yet");
                } else {
                    for id in &active {
                        let name = rows.iter().find(|r| &r.steam_id == id).map_or(id.clone(), |r| r.name.clone());
                        if pill(ui, t, &format!("{name}  ×"), "", true, &format!("Active {name}"), &format!("Click to remove {name} from active filter"), false, Sense::click()).clicked() {
                            next_active = Some(active.iter().filter(|s| *s != id).cloned().collect());
                        }
                    }
                }
                let r_label = format!("★ roster ({})", roster.len());
                choice_token(ui, t, "player-roster", &r_label, "Registered accounts", false, TIP_REGISTERED, true, |ui, _| {
                    if roster.is_empty() {
                        hint(ui, t, "None registered yet. Click ☆ beside a player below.");
                    } else {
                        ui.horizontal_wrapped(|ui| {
                            for p in &roster {
                                let on = active.contains(&p.steam_id);
                                if crate::widgets::chip(ui, t, &p.name, Some(on), Some(&format!("Registered {}", p.name)), true).clicked() {
                                    next_active = Some(if on { active.iter().filter(|s| **s != p.steam_id).cloned().collect() } else { active.iter().cloned().chain([p.steam_id.clone()]).collect() });
                                }
                                if crate::widgets::chip(ui, t, "×", None, Some(&format!("Unregister {}", p.name)), true).on_hover_text(TIP_UNREGISTER).clicked() {
                                    next_saved = Some(roster.iter().filter(|s| s.steam_id != p.steam_id).cloned().collect());
                                }
                            }
                        });
                    }
                });
                prose_word(ui, t, ".");
            });
            search_bar(tab, ui, t, db.is_some());
            if db.is_none() {
                pending(ui, cx);
            } else {
                let matching = find_players(&rows, &tab.player.search, tab.player.order);
                let pages = matching.len().div_ceil(PLAYER_PAGE_SIZE).max(1);
                let page = tab.player.page.min(pages - 1);
                ui.horizontal(|ui| {
                    lab(ui, t, &format!("{} player{}", matching.len(), if matching.len() == 1 { "" } else { "s" }));
                    if crate::widgets::chip(ui, t, "‹", None, Some("Previous page"), page > 0).clicked() {
                        tab.player.page = page - 1;
                    }
                    lab(ui, t, &format!("{} / {pages}", page + 1));
                    if crate::widgets::chip(ui, t, "›", None, Some("Next page"), page + 1 < pages).clicked() {
                        tab.player.page = page + 1;
                    }
                });
                if matching.is_empty() {
                    hint(ui, t, if rows.is_empty() { "No player in this database yet." } else { FIND_STEAM_ID_HINT });
                } else {
                    ui.horizontal_wrapped(|ui| {
                        for p in matching.iter().skip(page * PLAYER_PAGE_SIZE).take(PLAYER_PAGE_SIZE) {
                            let on = active.contains(&p.steam_id);
                            let registered = roster.iter().any(|s| s.steam_id == p.steam_id);
                            if crate::widgets::chip(ui, t, &p.name, Some(on), Some(&p.name), true).on_hover_text(&p.label).clicked() {
                                next_active = Some(if on { active.iter().filter(|s| **s != p.steam_id).cloned().collect() } else { active.iter().cloned().chain([p.steam_id.clone()]).collect() });
                            }
                            if crate::widgets::chip(ui, t, if registered { "★" } else { "☆" }, Some(registered), Some(&format!("Register {}", p.name)), true).on_hover_text(TIP_STAR).clicked() {
                                let base = next_saved.clone().unwrap_or_else(|| roster.clone());
                                next_saved = Some(if base.iter().any(|s| s.steam_id == p.steam_id) { base.into_iter().filter(|s| s.steam_id != p.steam_id).collect() } else { base.into_iter().chain([Saved { steam_id: p.steam_id.clone(), name: p.name.clone() }]).collect() });
                            }
                        }
                    });
                }
            }
        }
        CardStyle::Tiles => {
            kick(ui, t, &format!("★ Registered ({})", roster.len()));
            if roster.is_empty() {
                hint(ui, t, "None registered yet. Click ☆ on any player tile below.");
            } else {
                tile_grid(ui, TILE_MIN_W, roster.len(), |ui, idx, tw| {
                    let p = &roster[idx];
                    let on = active.contains(&p.steam_id);
                    let cap = short_id(&p.steam_id);
                    big_tile(ui, t, tw, &p.name, Some(&cap), on, false, false, |painter, r, _| avatar(painter, t, r.center(), &p.name, &p.steam_id), |ui| {
                        ui.horizontal(|ui| {
                            if crate::widgets::chip(ui, t, if on { "Active" } else { "Select" }, Some(on), Some(&format!("Registered {}", p.name)), true).clicked() {
                                next_active = Some(if on { active.iter().filter(|s| **s != p.steam_id).cloned().collect() } else { active.iter().cloned().chain([p.steam_id.clone()]).collect() });
                            }
                            if crate::widgets::chip(ui, t, "×", None, Some(&format!("Unregister {}", p.name)), true).on_hover_text(TIP_UNREGISTER).clicked() {
                                next_saved = Some(roster.iter().filter(|s| s.steam_id != p.steam_id).cloned().collect());
                            }
                        });
                    });
                });
            }
            ui.add_space(GAP);
            kick(ui, t, &format!("In the clips · {}", active.len()));
            ui.horizontal_wrapped(|ui| {
                if active.is_empty() {
                    hint(ui, t, "No active player -- pick one below");
                }
                for id in &active {
                    let name = rows.iter().find(|r| &r.steam_id == id).map_or(id.clone(), |r| r.name.clone());
                    if pill(ui, t, &format!("{name}  ×"), "", true, &format!("Active {name}"), &format!("Click to remove {name}"), false, Sense::click()).clicked() {
                        next_active = Some(active.iter().filter(|s| *s != id).cloned().collect());
                    }
                }
            });
            ui.add_space(GAP);
            search_bar(tab, ui, t, db.is_some());
            if db.is_none() {
                pending(ui, cx);
            } else {
                let matching = find_players(&rows, &tab.player.search, tab.player.order);
                let pages = matching.len().div_ceil(PLAYER_PAGE_SIZE).max(1);
                let page = tab.player.page.min(pages - 1);
                ui.horizontal(|ui| {
                    lab(ui, t, &format!("{} player{}", matching.len(), if matching.len() == 1 { "" } else { "s" }));
                    if crate::widgets::chip(ui, t, "‹", None, Some("Previous page"), page > 0).clicked() {
                        tab.player.page = page - 1;
                    }
                    lab(ui, t, &format!("{} / {pages}", page + 1));
                    if crate::widgets::chip(ui, t, "›", None, Some("Next page"), page + 1 < pages).clicked() {
                        tab.player.page = page + 1;
                    }
                });
                let slice: Vec<&PlayerRow> = matching.iter().copied().skip(page * PLAYER_PAGE_SIZE).take(PLAYER_PAGE_SIZE).collect();
                if slice.is_empty() {
                    hint(ui, t, if rows.is_empty() { "No player in this database yet." } else { FIND_STEAM_ID_HINT });
                } else {
                    egui::ScrollArea::vertical().max_height(LIST_H).auto_shrink([false, true]).show(ui, |ui| {
                        tile_grid(ui, TILE_MIN_W, slice.len(), |ui, idx, tw| {
                            let p = slice[idx];
                            let on = active.contains(&p.steam_id);
                            let registered = roster.iter().any(|s| s.steam_id == p.steam_id);
                            let cap = short_id(&p.steam_id);
                            big_tile(ui, t, tw, &p.name, Some(&cap), on, false, false, |painter, r, c| {
                                if p.name.is_empty() {
                                    crate::cardstyle::paint_glyph(painter, r, TileGlyph::Icon("player"), c);
                                } else {
                                    avatar(painter, t, r.center(), &p.name, &p.steam_id);
                                }
                            }, |ui| {
                                ui.horizontal(|ui| {
                                    if crate::widgets::chip(ui, t, if on { "Active" } else { "Pick" }, Some(on), Some(&p.name), true).on_hover_text(&p.label).clicked() {
                                        next_active = Some(if on { active.iter().filter(|s| **s != p.steam_id).cloned().collect() } else { active.iter().cloned().chain([p.steam_id.clone()]).collect() });
                                    }
                                    if crate::widgets::chip(ui, t, if registered { "★" } else { "☆" }, Some(registered), Some(&format!("Register {}", p.name)), true).on_hover_text(TIP_STAR).clicked() {
                                        let base = next_saved.clone().unwrap_or_else(|| roster.clone());
                                        next_saved = Some(if base.iter().any(|s| s.steam_id == p.steam_id) { base.into_iter().filter(|s| s.steam_id != p.steam_id).collect() } else { base.into_iter().chain([Saved { steam_id: p.steam_id.clone(), name: p.name.clone() }]).collect() });
                                    }
                                });
                            });
                        });
                    });
                }
            }
        }
    }
    if let Some(ids) = next_active {
        activate(cx, &rows, &ids);
    }
    if let Some(s) = next_saved {
        write_saved(cx, &s);
    }
    Some(format!("{} selected", list(cx, "steam_ids").len()))
}
