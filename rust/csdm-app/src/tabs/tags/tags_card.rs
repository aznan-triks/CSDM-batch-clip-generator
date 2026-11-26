//! The Tags card, in all three styles (`timeline`, `sentence`, `tiles`) after
//! 3.5 `TagGridCard.tsx`.

use super::parts::{fade, kicker, mix, note, separator, switch, tag_chip, tag_color, tray_pill};
use super::{active_ids, tags, visible, TagRow, TagsTab, SORTS};
use crate::cardstyle::{action_word, choice_token, paint_glyph, prose_line, prose_word, style_of, tile_grid, word_options, TileGlyph};
use crate::grid::CardCx;
use crate::paint::semibold;
use crate::theme::Theme;
use crate::widgets::{chip, confirm_dialog, tip, Confirm};
use csdm_core::ui_values::{
    CardStyle, FONT_BODY, FONT_SMALL, TAG_ITEM_GAP, TAG_PRESET_COLORS, TAG_ROW_GAP, TAG_SWATCH, TAG_TRAY_DASH, TAG_TRAY_EDGE_PCT, TAG_TRAY_MIN_H, TAG_TRAY_PAD, TAG_TRAY_RADIUS,
    TAG_TRAY_TINT_PCT,
};
use eframe::egui::{self, pos2, vec2, Align, Align2, Color32, Layout, Margin, Sense, Shape, Stroke, StrokeKind, Vec2};
use serde_json::{json, Value};

/// `useTagGrid.ts::TIPS`.
const TIP_TAG: &str = "Toggle this tag as an active filter for search and tagging below";
const NEW_TAG_PAD_MUL: f32 = 3.0;
const TIP_DELETE: &str = "Permanently delete this tag from the database";
const TIP_SEARCH: &str = "Filter displayed tags by name";
const TIP_SORT: &str = "Sort tags by name, color, or show active tags first";
const TIP_CREATE: &str = "Open form to create a new tag";
const TIP_RELOAD: &str = "Reload tags from database";
const TIP_DESELECT: &str = "Deselect all active tags";
const TIP_AUTO_TAG: &str = "Automatically apply the selected tag(s) to demos when clips are exported";
const TIP_COLOR: &str = "Use this color for the new tag";
const TIP_CUSTOM: &str = "Pick any colour";
const TIP_PILL: &str = "Stop using this tag";
const SEARCH_HINT: &str = "Filter tags…";
const NAME_HINT: &str = "Tag name";
/// `.tg-create-name`: `flex: 1 1 160px`.
const NAME_WIDTH: f32 = 160.0;
/// `.tag-swatch-selected`: the ring around the chosen colour.
const SWATCH_RING: f32 = 2.0;
/// `.tg-foot-sep` height.
const SEP_H: f32 = 18.0;
const DASH_CORNER_STEPS: usize = 6;
const TAG_TILE_MIN_W: f32 = 132.0;
const TAG_TILE_H: f32 = 54.0;
const TAG_TILE_RADIUS: f32 = 12.0;
const TAG_TILE_PAD: f32 = 10.0;
const TAG_TILE_TINT_PCT: f32 = 14.0;
const TAG_TILE_EDGE_PCT: f32 = 45.0;
const TAG_DOT_SIZE: f32 = 12.0;
const NAMES_SHOWN: usize = 2;

enum Act {
    Toggle(Value),
    AskDelete(Value, String),
    Deselect,
    Reload,
    Form,
    Submit,
    AutoTag(bool),
}

fn selection_words(names: &[String]) -> String {
    match names.len() {
        0 => "no tag yet".into(),
        n if n <= NAMES_SHOWN => names.join(" and "),
        n => format!("{}, {} and {} more", names[0], names[1], n - NAMES_SHOWN),
    }
}

fn toolbar(tab: &mut TagsTab, ui: &mut egui::Ui, t: &Theme, always: bool) {
    ui.allocate_ui_with_layout(egui::vec2(ui.available_width(), 0.0), Layout::right_to_left(Align::Center), |ui| {
        let words: Vec<&str> = SORTS.iter().map(|(_, w)| *w).collect();
        let chosen = SORTS.iter().position(|(s, _)| *s == tab.grid.sort).unwrap_or(0);
        if let Some(k) = super::parts::segmented(ui, t, &words, chosen, "sort", TIP_SORT) {
            tab.grid.sort = SORTS[k].0;
        }
        let w = ui.available_width();
        let r = super::parts::field(ui, t, &mut tab.grid.search, SEARCH_HINT, w);
        tip(ui, t, r, TIP_SEARCH, false);
    });
    if always {
        note(ui, t, &format!("{TIP_SEARCH}. {TIP_SORT}."), t.faint);
    }
}

fn palette(shown: &[TagRow], active: &[Value], ui: &mut egui::Ui, t: &Theme, always: bool, acts: &mut Vec<Act>) {
    ui.horizontal_wrapped(|ui| {
        for tag in shown {
            let (toggle, delete) = tag_chip(ui, t, tag, active.contains(&tag.id));
            if toggle.on_hover_text(TIP_TAG).clicked() {
                acts.push(Act::Toggle(tag.id.clone()));
            }
            if delete.on_hover_text(TIP_DELETE).clicked() {
                acts.push(Act::AskDelete(tag.id.clone(), tag.name.clone()));
            }
        }
    });
    if always && !shown.is_empty() {
        note(ui, t, &format!("{TIP_TAG}. × {TIP_DELETE}."), t.faint);
    }
}

fn empty_note(all: &[TagRow], shown: &[TagRow], search: &str, ui: &mut egui::Ui, t: &Theme) {
    if all.is_empty() {
        note(ui, t, "No tag in the database yet. Create one with “+ New tag”.", t.faint);
    } else if shown.is_empty() {
        note(ui, t, &format!("No tag matches “{search}”."), t.faint);
    }
}

fn tag_tile(ui: &mut egui::Ui, t: &Theme, width: f32, tag: &TagRow, on: bool, acts: &mut Vec<Act>) {
    let c = tag_color(t, &tag.color);
    let (rect, _) = ui.allocate_exact_size(vec2(width, TAG_TILE_H), Sense::hover());
    let del_w = TAG_TILE_PAD * 2.0 + FONT_SMALL;
    let face = egui::Rect::from_min_max(rect.min, pos2(rect.right() - del_w, rect.bottom()));
    let del_r = egui::Rect::from_min_max(pos2(face.right(), rect.top()), rect.max);
    let toggle = ui.interact(face, ui.scope_id().with(("ttile", &tag.name)), Sense::click());
    let delete = ui.interact(del_r, ui.scope_id().with(("ttile-del", &tag.name)), Sense::click());
    toggle.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, on, format!("tag-{}", tag.name)));
    delete.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, format!("delete-tag-{}", tag.name)));
    let p = ui.painter();
    let fill = if on { mix(c, t.solid, TAG_TILE_TINT_PCT) } else { t.solid };
    let edge = if on { fade(c, TAG_TILE_EDGE_PCT) } else if toggle.hovered() { t.accent } else { t.hair };
    p.rect(rect, TAG_TILE_RADIUS, fill, Stroke::new(if on { 2.0 } else { 1.0 }, edge), StrokeKind::Inside);
    p.circle_filled(pos2(rect.left() + TAG_TILE_PAD + TAG_DOT_SIZE / 2.0, rect.center().y), TAG_DOT_SIZE / 2.0, c);
    p.text(pos2(rect.left() + TAG_TILE_PAD * 2.0 + TAG_DOT_SIZE, rect.center().y), Align2::LEFT_CENTER, &tag.name, semibold(FONT_BODY), t.txt);
    if on {
        p.text(pos2(del_r.left() - 2.0, rect.center().y), Align2::RIGHT_CENTER, "✓", semibold(FONT_SMALL), c);
    }
    p.text(del_r.center(), Align2::CENTER_CENTER, "×", semibold(FONT_BODY), if delete.hovered() { t.rose } else { t.muted });
    if toggle.on_hover_text(TIP_TAG).clicked() {
        acts.push(Act::Toggle(tag.id.clone()));
    }
    if delete.on_hover_text(TIP_DELETE).clicked() {
        acts.push(Act::AskDelete(tag.id.clone(), tag.name.clone()));
    }
}

pub fn show(tab: &mut TagsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let all = tags(cx);
    let active = active_ids(cx);
    let always = cx.always_tips;
    let auto = cx.link.get("tag_enabled") == Some(&Value::Bool(true));
    let mut acts = Vec::new();
    ui.spacing_mut().item_spacing = Vec2::splat(TAG_ITEM_GAP);

    match style_of(cx, "tag-grid") {
        CardStyle::Timeline => {
            let tray = egui::Frame::new()
                .fill(mix(t.accent, t.solid, TAG_TRAY_TINT_PCT))
                .corner_radius(TAG_TRAY_RADIUS)
                .inner_margin(Margin::symmetric(TAG_TRAY_PAD[0] as i8, TAG_TRAY_PAD[1] as i8))
                .show(ui, |ui| {
                    ui.set_min_height(TAG_TRAY_MIN_H - TAG_TRAY_PAD[1] * 2.0);
                    ui.set_width(ui.available_width());
                    ui.allocate_ui_with_layout(egui::vec2(ui.available_width(), 0.0), Layout::right_to_left(Align::Center), |ui| {
                        let r = chip(ui, t, "Deselect all", None, None, true);
                        if tip(ui, t, r, TIP_DESELECT, false).clicked() {
                            acts.push(Act::Deselect);
                        }
                        ui.allocate_ui_with_layout(egui::vec2(ui.available_width(), 0.0), Layout::left_to_right(Align::Center).with_main_wrap(true), |ui| {
                            kicker(ui, t, "In use");
                            let in_use: Vec<_> = all.iter().filter(|x| active.contains(&x.id)).collect();
                            if in_use.is_empty() {
                                note(ui, t, "No tag selected -- click a tag below to use it", t.faint);
                            }
                            for tag in in_use {
                                if tray_pill(ui, t, tag).on_hover_text(TIP_PILL).clicked() {
                                    acts.push(Act::Toggle(tag.id.clone()));
                                }
                            }
                        });
                    });
                });
            dashed_border(ui, tray.response.rect, fade(t.accent, TAG_TRAY_EDGE_PCT));
            if always {
                note(ui, t, TIP_DESELECT, t.faint);
            }
            ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);
            toolbar(tab, ui, t, always);
            let shown = visible(&all, &tab.grid.search, tab.grid.sort, &active);
            palette(&shown, &active, ui, t, always, &mut acts);
            empty_note(&all, &shown, &tab.grid.search, ui, t);
            ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);
            ui.horizontal_wrapped(|ui| {
                let r = chip(ui, t, "+ New tag", tab.grid.form_open.then_some(true), Some("New tag"), true);
                if tip(ui, t, r, TIP_CREATE, false).clicked() {
                    acts.push(Act::Form);
                }
                let r = chip(ui, t, "Reload", None, None, true);
                if tip(ui, t, r, TIP_RELOAD, false).clicked() {
                    acts.push(Act::Reload);
                }
                separator(ui, t, SEP_H);
                let r = switch(ui, t, "Auto-tag on export", auto);
                if tip(ui, t, r, TIP_AUTO_TAG, false).clicked() {
                    acts.push(Act::AutoTag(!auto));
                }
            });
            if always {
                note(ui, t, &format!("{TIP_CREATE}. {TIP_RELOAD}. {TIP_AUTO_TAG}."), t.faint);
            }
        }
        CardStyle::Sentence => {
            let active_names = super::names_of(&all, &active);
            prose_line(ui, |ui| {
                prose_word(ui, t, "Work with");
                choice_token(ui, t, "active-tags", &selection_words(&active_names), "Active tags", false, TIP_TAG, true, |ui, _| {
                    ui.label(egui::RichText::new("Tags in use").font(semibold(FONT_SMALL)).color(t.muted));
                    toolbar(tab, ui, t, false);
                    let shown = visible(&all, &tab.grid.search, tab.grid.sort, &active);
                    palette(&shown, &active, ui, t, false, &mut acts);
                    empty_note(&all, &shown, &tab.grid.search, ui, t);
                    if chip(ui, t, "Deselect all", None, None, true).on_hover_text(TIP_DESELECT).clicked() {
                        acts.push(Act::Deselect);
                    }
                });
                prose_word(ui, t, &format!("({} of {} tags).", active_names.len(), all.len()));
            });
            prose_line(ui, |ui| {
                prose_word(ui, t, "When clips are exported,");
                choice_token(ui, t, "tag_enabled", if auto { "tag their demos" } else { "leave demos as they are" }, "Auto-tag on export", true, TIP_AUTO_TAG, false, |ui, close| {
                    ui.label(egui::RichText::new("Auto-tag on export").font(semibold(FONT_SMALL)).color(t.muted));
                    if let Some(v) = word_options(ui, t, &[("on", "tag their demos", "the tags in use are added to each exported demo"), ("off", "leave demos as they are", "exporting never changes a demo's tags")], if auto { "on" } else { "off" }) {
                        acts.push(Act::AutoTag(v == "on"));
                        *close = true;
                    }
                });
                prose_word(ui, t, ".");
            });
            ui.horizontal_wrapped(|ui| {
                if action_word(ui, t, "+ New tag", "New tag", false, false, TIP_CREATE, true) {
                    acts.push(Act::Form);
                }
                if action_word(ui, t, "Reload from the database", "Reload", false, false, TIP_RELOAD, true) {
                    acts.push(Act::Reload);
                }
            });
        }
        CardStyle::Tiles => {
            toolbar(tab, ui, t, always);
            let shown = visible(&all, &tab.grid.search, tab.grid.sort, &active);
            tile_grid(ui, TAG_TILE_MIN_W, shown.len() + 1, |ui, idx, w| {
                if idx < shown.len() {
                    let tag = &shown[idx];
                    tag_tile(ui, t, w, tag, active.contains(&tag.id), &mut acts);
                } else {
                    let (rect, resp) = ui.allocate_exact_size(vec2(w, TAG_TILE_H), Sense::click());
                    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, tab.grid.form_open, "New tag"));
                    let p = ui.painter();
                    let edge = if tab.grid.form_open || resp.hovered() { t.accent } else { t.hair };
                    p.rect(rect, TAG_TILE_RADIUS, t.surface2, Stroke::new(1.0, edge), StrokeKind::Inside);
                    paint_glyph(p, egui::Rect::from_center_size(pos2(rect.left() + TAG_TILE_PAD * 2.0, rect.center().y), Vec2::splat(FONT_BODY)), TileGlyph::Plus, t.accent);
                    p.text(pos2(rect.left() + TAG_TILE_PAD * NEW_TAG_PAD_MUL + FONT_BODY, rect.center().y), Align2::LEFT_CENTER, "New tag", semibold(FONT_BODY), t.txt);
                    if resp.on_hover_text(TIP_CREATE).clicked() {
                        acts.push(Act::Form);
                    }
                }
            });
            empty_note(&all, &shown, &tab.grid.search, ui, t);
            ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);
            ui.horizontal_wrapped(|ui| {
                let r = switch(ui, t, "Auto-tag on export", auto);
                if tip(ui, t, r, TIP_AUTO_TAG, false).clicked() {
                    acts.push(Act::AutoTag(!auto));
                }
                separator(ui, t, SEP_H);
                if chip(ui, t, "Deselect all", None, None, true).on_hover_text(TIP_DESELECT).clicked() {
                    acts.push(Act::Deselect);
                }
                if chip(ui, t, "Reload", None, None, true).on_hover_text(TIP_RELOAD).clicked() {
                    acts.push(Act::Reload);
                }
            });
        }
    }

    if tab.grid.form_open {
        ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);
        new_tag_form(tab, ui, cx, &mut acts);
    }
    if !tab.grid.status.is_empty() {
        note(ui, t, &tab.grid.status, t.muted);
    }

    if let Some((_, name)) = &tab.grid.pending_delete {
        match confirm_dialog(ui.ctx(), t, "Delete tag", &format!("Delete tag \"{name}\"? This cannot be undone."), true) {
            Confirm::Pending => {}
            Confirm::Cancelled => tab.grid.pending_delete = None,
            Confirm::Confirmed => {
                if let Some((id, name)) = tab.grid.pending_delete.take() {
                    tab.delete(cx, id, name);
                }
            }
        }
    }

    for a in acts {
        match a {
            Act::Toggle(id) => tab.toggle(cx, &id),
            Act::AskDelete(id, name) => tab.grid.pending_delete = Some((id, name)),
            Act::Deselect => tab.deselect_all(cx),
            Act::Reload => tab.reload(cx),
            Act::Form => tab.grid.form_open = !tab.grid.form_open,
            Act::Submit => tab.submit(cx),
            Act::AutoTag(on) => cx.link.set(cx.now, "tag_enabled", json!(on)),
        }
    }
}

/// The new-tag form: a name, twenty swatches and a free colour (`NewTagForm`).
fn new_tag_form(tab: &mut TagsTab, ui: &mut egui::Ui, cx: &mut CardCx, acts: &mut Vec<Act>) {
    let t = cx.theme;
    egui::Frame::new()
        .fill(t.surface2)
        .stroke(Stroke::new(1.0, t.hair))
        .corner_radius(TAG_TRAY_RADIUS)
        .inner_margin(Margin::symmetric(TAG_TRAY_PAD[0] as i8 + 1, TAG_TRAY_PAD[1] as i8 + 2))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal_wrapped(|ui| {
                let name = super::parts::field(ui, t, &mut tab.grid.name, NAME_HINT, NAME_WIDTH);
                if name.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                    acts.push(Act::Submit);
                }
                for hex in TAG_PRESET_COLORS {
                    let selected = tab.grid.color.eq_ignore_ascii_case(hex);
                    let (rect, r) = ui.allocate_exact_size(Vec2::splat(TAG_SWATCH), Sense::click());
                    r.widget_info(|| egui::WidgetInfo::selected(egui::Role::RadioButton, true, selected, format!("colour-{hex}")));
                    let p = ui.painter();
                    p.circle_filled(rect.center(), TAG_SWATCH / 2.0, super::parts::tag_color(t, hex));
                    if selected {
                        p.circle_stroke(rect.center(), TAG_SWATCH / 2.0 - SWATCH_RING / 2.0, Stroke::new(SWATCH_RING, t.txt_hi));
                    }
                    if r.on_hover_text(TIP_COLOR).clicked() {
                        tab.grid.color = hex.to_string();
                    }
                }
                let mut rgb = crate::theme::parse_hex(&tab.grid.color).unwrap_or([0, 0, 0]);
                ui.label(egui::RichText::new("Custom…").font(crate::paint::regular(csdm_core::ui_values::FONT_SMALL)).color(t.muted));
                let r = ui.color_edit_button_srgb(&mut rgb).on_hover_text(TIP_CUSTOM);
                r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, "Custom colour"));
                if r.changed() {
                    tab.grid.color = free_colour(rgb);
                }
                if chip(ui, t, "Create", Some(true), Some("Create"), true).clicked() {
                    acts.push(Act::Submit);
                }
            });
        });
}

/// `.tg-tray`'s `1px dashed` border, rounded like the tray.
/// The picker's colour as the `#rrggbb` text `tag_create` stores (3.5 `<input type="color">`).
fn free_colour(rgb: [u8; 3]) -> String { // allow-hardcode: three RGB channels
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}

fn dashed_border(ui: &egui::Ui, r: egui::Rect, color: Color32) {
    let rad = TAG_TRAY_RADIUS;
    let mut pts = Vec::new();
    let corner = |c: egui::Pos2, from: f32, pts: &mut Vec<egui::Pos2>| {
        for k in 0..=DASH_CORNER_STEPS {
            let a = from + std::f32::consts::FRAC_PI_2 * k as f32 / DASH_CORNER_STEPS as f32;
            pts.push(c + rad * Vec2::angled(a));
        }
    };
    let r = r.shrink(1.0 / 2.0);
    corner(egui::pos2(r.right() - rad, r.top() + rad), -std::f32::consts::FRAC_PI_2, &mut pts);
    corner(egui::pos2(r.right() - rad, r.bottom() - rad), 0.0, &mut pts);
    corner(egui::pos2(r.left() + rad, r.bottom() - rad), std::f32::consts::FRAC_PI_2, &mut pts);
    corner(egui::pos2(r.left() + rad, r.top() + rad), std::f32::consts::PI, &mut pts);
    pts.push(pts[0]);
    ui.painter().extend(Shape::dashed_line(&pts, Stroke::new(1.0, color), TAG_TRAY_DASH[0], TAG_TRAY_DASH[1]));
}

#[cfg(test)]
mod tests {
    #[test]
    fn free_colour_is_lowercase_hex_and_reads_back() {
        assert_eq!(super::free_colour([0x8B, 0x5C, 0xF6]), "#8b5cf6");
        assert_eq!(crate::theme::parse_hex(&super::free_colour([1, 2, 255])), Some([1, 2, 255]));
    }
}
