//! The Operations card, in all three styles (`timeline`, `sentence`, `tiles`) after
//! 3.5 `TagOpsCard.tsx`.

use super::parts::{kicker, note};
use super::{active_ids, names_of, tags, By, TagsTab};
use crate::cardstyle::{action_word, prose_line, prose_word, style_of, tile_grid};
use crate::grid::CardCx;
use crate::paint::{regular, semibold};
use crate::theme::Theme;
use crate::widgets::{chip, confirm_dialog, tip, Confirm};
use csdm_core::ui_values::{CardStyle, FONT_BODY, FONT_SMALL, TAG_ITEM_GAP, TAG_OPS_BADGE, TAG_OPS_GAP, TAG_OPS_PAD, TAG_OPS_RADIUS, TAG_OPS_STEPS, TAG_ROW_GAP};
use eframe::egui::{self, vec2, Align2, Color32, Margin, Pos2, Rect, Sense, Stroke, StrokeKind, Vec2};

/// `useTagOps.ts::TIPS`.
const TIP_BY_TAG: &str = "Find demos that have all the selected tags applied";
const TIP_BY_CONFIG: &str = "Find demos matching the selected tags plus the current filter settings";
const TIP_TAG_SEL: &str = "Apply the active tags to the selected demos";
const TIP_TAG_ALL: &str = "Apply the active tags to all found demos";
const TIP_REMOVE: &str = "Remove the active tags from the selected demos";
const TIP_EXPORT: &str = "Export the selected tags, or all tags if none are selected";
const TIP_IMPORT: &str = "Import tags from a file; missing tags are created automatically";
/// The tag names shown in full up to this many (`tagWords`).
const NAMES_SHOWN: usize = 2;
/// The found list's height before it scrolls.
const LIST_MAX_H: f32 = 180.0;
const OP_TILE_MIN_W: f32 = 118.0;
const OP_TILE_H: f32 = 66.0;
const OP_TILE_RADIUS: f32 = 12.0;
const OP_TILE_PAD: f32 = 8.0;
const OP_ICON: f32 = 18.0;

/// "Aces and Clutch", "Aces, Clutch +3" (`tagWords`).
fn tag_words(names: &[String]) -> String {
    match names.len() {
        0 => "the tags in use".into(),
        n if n <= NAMES_SHOWN => names.join(" and "),
        n => format!("{} +{}", names[..NAMES_SHOWN].join(", "), n - NAMES_SHOWN),
    }
}

enum Act {
    Search(By),
    TagPicked,
    TagAll,
    AskRemove,
    Export,
    Import,
}

pub fn show(tab: &mut TagsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let names = names_of(&tags(cx), &active_ids(cx));
    let always = cx.always_tips;
    ui.spacing_mut().item_spacing = Vec2::splat(TAG_ITEM_GAP);
    let mut acts = Vec::new();
    let tw = tag_words(&names);
    let picked_n = tab.ops.picked.len();
    let found_n = tab.ops.found.len();

    match style_of(cx, "operations") {
        CardStyle::Timeline => {
            let total = ui.available_width() - TAG_OPS_GAP * 2.0;
            let sum: f32 = TAG_OPS_STEPS.iter().sum();
            let widths = TAG_OPS_STEPS.map(|w| (total * w / sum).max(0.0));
            ui.horizontal_top(|ui| {
                ui.spacing_mut().item_spacing.x = TAG_OPS_GAP;
                step(ui, t, widths[0], 1, "Find demos", |ui| {
                    ui.horizontal_wrapped(|ui| {
                        let r = chip(ui, t, "By tag", None, None, true);
                        if tip(ui, t, r, TIP_BY_TAG, always).clicked() {
                            acts.push(Act::Search(By::Tag));
                        }
                        let r = chip(ui, t, "By config", None, None, true);
                        if tip(ui, t, r, TIP_BY_CONFIG, always).clicked() {
                            acts.push(Act::Search(By::Config));
                        }
                    });
                });
                step(ui, t, widths[1], 2, "Pick", |ui| found_list(tab, ui, t));
                step(ui, t, widths[2], 3, &format!("Apply {tw}"), |ui| { // allow-hardcode: the third of the card's three numbered steps
                    ui.horizontal_wrapped(|ui| {
                        let r = chip(ui, t, "Tag sel.", None, None, true);
                        if tip(ui, t, r, TIP_TAG_SEL, always).clicked() {
                            acts.push(Act::TagPicked);
                        }
                        let r = chip(ui, t, "Tag ALL", None, None, true);
                        if tip(ui, t, r, TIP_TAG_ALL, always).clicked() {
                            acts.push(Act::TagAll);
                        }
                        let r = danger_chip(ui, t, "Remove sel.");
                        if tip(ui, t, r, TIP_REMOVE, always).clicked() {
                            acts.push(Act::AskRemove);
                        }
                    });
                });
            });
            ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);
            ui.horizontal_wrapped(|ui| {
                kicker(ui, t, "Tags file");
                let r = chip(ui, t, "Export", None, Some("Export tags"), true);
                if tip(ui, t, r, TIP_EXPORT, false).clicked() {
                    acts.push(Act::Export);
                }
                let r = chip(ui, t, "Import", None, Some("Import tags"), true);
                if tip(ui, t, r, TIP_IMPORT, false).clicked() {
                    acts.push(Act::Import);
                }
            });
            if always {
                note(ui, t, &format!("{TIP_EXPORT}. {TIP_IMPORT}."), t.faint);
            }
        }
        CardStyle::Sentence => {
            prose_line(ui, |ui| {
                prose_word(ui, t, "Find demos");
                if action_word(ui, t, &format!("tagged {tw}"), "By tag", false, false, TIP_BY_TAG, true) {
                    acts.push(Act::Search(By::Tag));
                }
                prose_word(ui, t, "or");
                if action_word(ui, t, "that also match my Capture filters", "By config", true, false, TIP_BY_CONFIG, true) {
                    acts.push(Act::Search(By::Config));
                }
                prose_word(ui, t, ".");
            });
            prose_line(ui, |ui| {
                prose_word(ui, t, "Tag");
                if action_word(ui, t, &format!("the {picked_n} picked"), "Tag sel.", false, false, TIP_TAG_SEL, true) {
                    acts.push(Act::TagPicked);
                }
                prose_word(ui, t, "or");
                if action_word(ui, t, &format!("all {found_n} found"), "Tag ALL", false, false, TIP_TAG_ALL, true) {
                    acts.push(Act::TagAll);
                }
                prose_word(ui, t, &format!("with {tw}, or"));
                if action_word(ui, t, "untag the picked ones", "Remove sel.", false, true, TIP_REMOVE, true) {
                    acts.push(Act::AskRemove);
                }
                prose_word(ui, t, ".");
            });
            prose_line(ui, |ui| {
                prose_word(ui, t, "Tags file:");
                if action_word(ui, t, "save to a file", "Export tags", false, false, TIP_EXPORT, true) {
                    acts.push(Act::Export);
                }
                prose_word(ui, t, "or");
                if action_word(ui, t, "load from a file", "Import tags", false, false, TIP_IMPORT, true) {
                    acts.push(Act::Import);
                }
                prose_word(ui, t, ".");
            });
            found_list(tab, ui, t);
        }
        CardStyle::Tiles => {
            let specs = [
                ("Find by tag", "demos with every tag in use", "By tag", TIP_BY_TAG, Act::Search(By::Tag), false, false, "tags"),
                ("Find by config", "tags + Capture's filters", "By config", TIP_BY_CONFIG, Act::Search(By::Config), false, false, "capture"),
                ("Tag picked", &format!("{picked_n} demo(s)"), "Tag sel.", TIP_TAG_SEL, Act::TagPicked, false, false, "operations"),
                ("Tag all", &format!("{found_n} found"), "Tag ALL", TIP_TAG_ALL, Act::TagAll, false, false, "operations"),
                ("Untag picked", "asks first", "Remove sel.", TIP_REMOVE, Act::AskRemove, true, false, "operations"),
                ("Export", "tags to a file", "Export tags", TIP_EXPORT, Act::Export, false, true, "tagRange"),
                ("Import", "creates missing tags", "Import tags", TIP_IMPORT, Act::Import, false, true, "tagRange"),
            ];
            let mut chosen_idx = None;
            tile_grid(ui, OP_TILE_MIN_W, specs.len(), |ui, idx, w| {
                let (title, sub, acc, tip_text, _, danger, alt, icon) = &specs[idx];
                let (rect, resp) = ui.allocate_exact_size(vec2(w, OP_TILE_H), Sense::click());
                resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, *acc));
                let p = ui.painter();
                let edge = if resp.hovered() { if *danger { t.rose } else { t.accent } } else if *danger { t.rose.gamma_multiply(0.4) } else { t.hair }; // allow-hardcode: danger edge alpha
                p.rect(rect, OP_TILE_RADIUS, t.solid, Stroke::new(1.0, edge), StrokeKind::Inside);
                let ink = if *danger { t.rose } else if *alt { t.emerald } else { t.accent };
                crate::icons::paint(p, icon, Rect::from_center_size(Pos2::new(rect.center().x, rect.top() + OP_TILE_PAD + OP_ICON / 2.0), Vec2::splat(OP_ICON)), ink);
                p.text(Pos2::new(rect.center().x, rect.top() + OP_TILE_PAD * 2.0 + OP_ICON), Align2::CENTER_TOP, *title, semibold(FONT_SMALL), t.txt);
                p.text(Pos2::new(rect.center().x, rect.bottom() - OP_TILE_PAD), Align2::CENTER_BOTTOM, *sub, regular(FONT_SMALL - 1.0), t.muted);
                if resp.on_hover_text(*tip_text).clicked() {
                    chosen_idx = Some(idx);
                }
            });
            if let Some(act) = chosen_idx.and_then(|i| [Act::Search(By::Tag), Act::Search(By::Config), Act::TagPicked, Act::TagAll, Act::AskRemove, Act::Export, Act::Import].into_iter().nth(i)) {
                acts.push(act);
            }
            ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);
            found_list(tab, ui, t);
        }
    }

    if !tab.ops.status.is_empty() {
        note(ui, t, &tab.ops.status, t.muted);
    }

    if tab.ops.pending_remove {
        let message = format!("Remove {} tag(s) from {} selected demo(s)? This cannot be undone.", names.len(), tab.ops.picked.len());
        match confirm_dialog(ui.ctx(), t, "Remove tags", &message, true) {
            Confirm::Pending => {}
            Confirm::Cancelled => tab.ops.pending_remove = false,
            Confirm::Confirmed => {
                tab.ops.pending_remove = false;
                tab.remove_picked(cx);
            }
        }
    }

    for a in acts {
        match a {
            Act::Search(by) => tab.search(cx, by),
            Act::TagPicked => {
                let paths = tab.ops.picked.clone();
                tab.tag_demos(cx, paths);
            }
            Act::TagAll => {
                let paths = tab.ops.found.iter().map(|d| d.path.clone()).collect();
                tab.tag_demos(cx, paths);
            }
            Act::AskRemove => tab.ops.pending_remove = true,
            Act::Export => tab.export(cx),
            Act::Import => tab.import(cx),
        }
    }
}

/// One `.tgo-step`: a framed column with its title and number badge.
fn step(ui: &mut egui::Ui, t: &Theme, width: f32, n: u8, title: &str, body: impl FnOnce(&mut egui::Ui)) {
    let inner = (width - TAG_OPS_PAD * 2.0 - 2.0).max(0.0);
    let out = egui::Frame::new()
        .fill(t.solid)
        .stroke(Stroke::new(1.0, t.hair))
        .corner_radius(TAG_OPS_RADIUS)
        .inner_margin(Margin::same(TAG_OPS_PAD as i8))
        .show(ui, |ui| {
            ui.set_width(inner);
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing = Vec2::splat(TAG_ITEM_GAP);
                ui.horizontal(|ui| {
                    ui.set_width(inner - TAG_OPS_BADGE);
                    ui.add(egui::Label::new(egui::RichText::new(title).font(semibold(FONT_BODY)).color(t.txt)).wrap());
                });
                body(ui);
            });
        });
    let r = out.response.rect;
    let badge = Rect::from_min_size(Pos2::new(r.right() - TAG_OPS_PAD - TAG_OPS_BADGE, r.top() + TAG_OPS_PAD - 1.0), Vec2::splat(TAG_OPS_BADGE));
    let p = ui.painter();
    p.circle_filled(badge.center(), TAG_OPS_BADGE / 2.0, t.accent);
    p.text(badge.center(), Align2::CENTER_CENTER, n.to_string(), semibold(FONT_SMALL), Color32::WHITE);
}

/// `.chip.danger`: the rose chip of a destructive action.
fn danger_chip(ui: &mut egui::Ui, t: &Theme, text: &str) -> egui::Response {
    let r = chip(ui, t, text, None, None, true);
    let p = ui.painter();
    p.rect_stroke(r.rect, r.rect.height() / 2.0, Stroke::new(1.0, t.rose), egui::StrokeKind::Inside);
    r
}

/// The found demos, each with its tick, and one tick for all of them (`FoundList`).
fn found_list(tab: &mut TagsTab, ui: &mut egui::Ui, t: &Theme) {
    let ops = &mut tab.ops;
    if ops.found.is_empty() {
        let text = if ops.found_by.is_some() { "No demo found." } else { "Search to list demos here." };
        note(ui, t, text, t.faint);
        return;
    }
    let mut all = ops.picked.len() == ops.found.len();
    let label = format!("{} of {} picked", ops.picked.len(), ops.found.len());
    if super::parts::tick(ui, t, &label, all, t.muted).clicked() {
        all = !all;
        ops.picked = if all { ops.found.iter().map(|d| d.path.clone()).collect() } else { Vec::new() };
    }
    egui::ScrollArea::vertical().id_salt("tags-found").max_height(LIST_MAX_H).auto_shrink([false, true]).show(ui, |ui| {
        for demo in &ops.found {
            let picked = ops.picked.contains(&demo.path);
            if super::parts::tick(ui, t, &demo.name, picked, t.txt).clicked() {
                if picked {
                    ops.picked.retain(|p| p != &demo.path);
                } else {
                    ops.picked.push(demo.path.clone());
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_words_shorten_after_two() {
        let n = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(tag_words(&[]), "the tags in use");
        assert_eq!(tag_words(&n(&["a", "b"])), "a and b");
        assert_eq!(tag_words(&n(&["a", "b", "c", "d"])), "a, b +2");
    }
}
