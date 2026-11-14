//! The Tags card, timeline style (3.5 `TagGridCard.tsx` `TimelineView`): the selection as a tray
//! above the palette of every tag; click a tag to move it in or out.

use super::parts::{kicker, mix, note, separator, switch, tag_chip, tray_pill};
use super::{active_ids, tags, visible, TagsTab, SORTS};
use crate::grid::CardCx;
use crate::widgets::{chip, confirm_dialog, tip, Confirm};
use csdm_core::ui_values::{TAG_ITEM_GAP, TAG_PRESET_COLORS, TAG_ROW_GAP, TAG_SWATCH, TAG_TRAY_DASH, TAG_TRAY_EDGE_PCT, TAG_TRAY_MIN_H, TAG_TRAY_PAD, TAG_TRAY_RADIUS, TAG_TRAY_TINT_PCT};
use eframe::egui::{self, Align, Color32, Layout, Margin, Sense, Shape, Stroke, Vec2};
use serde_json::{json, Value};

/// `useTagGrid.ts::TIPS`.
const TIP_TAG: &str = "Toggle this tag as an active filter for search and tagging below";
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

enum Act {
    Toggle(Value),
    AskDelete(Value, String),
    Deselect,
    Reload,
    Form,
    Submit,
    AutoTag(bool),
}

pub fn show(tab: &mut TagsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let all = tags(cx);
    let active = active_ids(cx);
    let always = cx.always_tips;
    let mut acts = Vec::new();
    ui.spacing_mut().item_spacing = Vec2::splat(TAG_ITEM_GAP);

    // The tray: what is in use.
    let tray = egui::Frame::new()
        .fill(mix(t.accent, t.solid, TAG_TRAY_TINT_PCT))
        .corner_radius(TAG_TRAY_RADIUS)
        .inner_margin(Margin::symmetric(TAG_TRAY_PAD[0] as i8, TAG_TRAY_PAD[1] as i8))
        .show(ui, |ui| {
            ui.set_min_height(TAG_TRAY_MIN_H - TAG_TRAY_PAD[1] * 2.0);
            ui.set_width(ui.available_width());
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                let r = chip(ui, t, "Deselect all", None, None, true);
                if tip(ui, t, r, TIP_DESELECT, false).clicked() {
                    acts.push(Act::Deselect);
                }
                ui.with_layout(Layout::left_to_right(Align::Center).with_main_wrap(true), |ui| {
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
    dashed_border(ui, tray.response.rect, mix(t.accent, Color32::TRANSPARENT, TAG_TRAY_EDGE_PCT));
    if always {
        note(ui, t, TIP_DESELECT, t.faint);
    }
    ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);

    // Toolbar: search and sort.
    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
        for (sort, word) in SORTS.iter().rev() {
            let r = chip(ui, t, word, Some(tab.grid.sort == *sort), Some(&format!("sort-{word}")), true);
            if r.on_hover_text(TIP_SORT).clicked() {
                tab.grid.sort = *sort;
            }
        }
        let field = egui::TextEdit::singleline(&mut tab.grid.search).hint_text(SEARCH_HINT).desired_width(ui.available_width());
        let r = ui.add(field);
        r.widget_info(|| egui::WidgetInfo::text_edit(true, "", SEARCH_HINT, ""));
        tip(ui, t, r, TIP_SEARCH, false);
    });
    if always {
        note(ui, t, &format!("{TIP_SEARCH}. {TIP_SORT}."), t.faint);
    }

    // The palette.
    let shown = visible(&all, &tab.grid.search, tab.grid.sort, &active);
    ui.horizontal_wrapped(|ui| {
        for tag in &shown {
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
    if all.is_empty() {
        note(ui, t, "No tag in the database yet. Create one with “+ New tag”.", t.faint);
    } else if shown.is_empty() {
        note(ui, t, &format!("No tag matches “{}”.", tab.grid.search), t.faint);
    }
    ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);

    // Foot: create, reload, auto-tag on export.
    let auto = cx.link.get("tag_enabled") == Some(&Value::Bool(true));
    ui.horizontal_wrapped(|ui| {
        let r = chip(ui, t, "+ New tag", Some(tab.grid.form_open), Some("New tag"), true);
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
                let name = ui.add(egui::TextEdit::singleline(&mut tab.grid.name).hint_text(NAME_HINT).desired_width(NAME_WIDTH));
                name.widget_info(|| egui::WidgetInfo::text_edit(true, "", NAME_HINT, ""));
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
                    tab.grid.color = format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2]);
                }
                if chip(ui, t, "Create", Some(true), Some("Create"), true).clicked() {
                    acts.push(Act::Submit);
                }
            });
        });
}

/// `.tg-tray`'s `1px dashed` border, rounded like the tray.
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
