//! The Tag Range card, timeline style (3.5 `TagRangeCard.tsx` `TimelineView`): the tagged demos
//! as a span on a date line; each end, the span and the open tail after it apply that range to
//! Capture's date filter (`date_from` / `date_to`).

use super::parts::{kicker, note};
use super::{active_ids, names_of, tags, Range, TagsTab};
use crate::grid::CardCx;
use crate::paint::{mono, regular, semibold, spaced_galley};
use crate::theme::Theme;
use crate::widgets::{chip, tip};
use csdm_core::ui_values::{FONT_BODY, FONT_SMALL, FONT_TAG_RANGE, FONT_TAG_RANGE_SMALL, TAG_ITEM_GAP, TAG_RANGE_BAR_H, TAG_RANGE_DASH, TAG_RANGE_MARK, TAG_RANGE_SPAN_TAIL, TAG_ROW_GAP};
use eframe::egui::{self, Align2, Pos2, Rect, Response, Sense, Shape, Stroke, Vec2};
use serde_json::json;

/// `useTagRange.ts::TIPS`.
const TIP_CALC: &str = "Compute the earliest and latest demo dates for the selected tags";
const TIP_START: &str = "Set date_from in Capture to the earliest demo date of the selected tags";
const TIP_END: &str = "Set date_to in Capture to the latest demo date of the selected tags";
const TIP_FULL: &str = "Set both date_from and date_to in Capture to the range of the selected tags";
const TIP_AFTER: &str = "Set the date filter to everything after this tag's most recent demo";
/// `.tgr-line button` padding, space between its two lines.
const PAD: f32 = 4.0;
const LINE_GAP: f32 = 2.0;
/// `.tgr-span::before` top margin.
const BAR_TOP: f32 = 6.0;
/// `.tgr-end i` margin-bottom and corner.
const MARK_GAP: f32 = 4.0;
const MARK_RADIUS: f32 = 5.0;
/// `.tgr-span::before` gradient end: `color-mix(in srgb, var(--cam-k) 70%, var(--solid))`.
const BAR_FADE_PCT: f32 = 70.0;
/// The tagged-tag names shown in full up to this many (`tagWords`).
const NAMES_SHOWN: usize = 3;

/// "Aces, Clutch, Entry +2" (`tagWords`).
fn tag_words(names: &[String]) -> String {
    match names.len() {
        0 => "(no tag selected)".into(),
        n if n <= NAMES_SHOWN => names.join(", "),
        n => format!("{} +{}", names[..NAMES_SHOWN].join(", "), n - NAMES_SHOWN),
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Part { Start, Span, End, Tail }

pub fn show(tab: &mut TagsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let names = names_of(&tags(cx), &active_ids(cx));
    ui.spacing_mut().item_spacing = Vec2::splat(TAG_ITEM_GAP);
    let mut calc = false;
    ui.horizontal(|ui| {
        kicker(ui, t, "Tagged");
        ui.label(egui::RichText::new(tag_words(&names)).font(semibold(FONT_BODY)).color(t.txt));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let r = chip(ui, t, "Calculate range", None, None, !tab.range.busy);
            calc = tip(ui, t, r, TIP_CALC, false).clicked();
        });
    });
    ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);

    let r = tab.range.range.clone();
    let mut applied = None;
    let ghost = r.as_ref().is_none_or(|r| r.start.is_none());
    let w = ui.available_width();
    let labels = labels(r.as_ref());
    let font = mono(FONT_TAG_RANGE);
    let end_w = |i: usize| text_width(ui, &labels[i].0, font.clone()).max(text_width(ui, labels[i].1, regular(FONT_TAG_RANGE_SMALL))) + PAD * 2.0;
    let (sw, ew) = (end_w(0), end_w(2));
    let rest = (w - sw - ew).max(0.0);
    let weights = TAG_RANGE_SPAN_TAIL[0] + TAG_RANGE_SPAN_TAIL[1];
    let widths = [sw, rest * TAG_RANGE_SPAN_TAIL[0] / weights, ew, rest * TAG_RANGE_SPAN_TAIL[1] / weights];
    let h = TAG_RANGE_MARK[1] + MARK_GAP + line_height(ui, font.clone()) + LINE_GAP + line_height(ui, regular(FONT_TAG_RANGE_SMALL)) + PAD;
    let (row, _) = ui.allocate_exact_size(Vec2::new(w, h), Sense::hover());
    let mut x = row.left();
    for (k, part) in [Part::Start, Part::Span, Part::End, Part::Tail].into_iter().enumerate() {
        let rect = Rect::from_min_size(Pos2::new(x, row.top()), Vec2::new(widths[k], h));
        x += widths[k];
        let value = apply_value(r.as_ref(), part);
        let resp = range_button(ui, t, rect, part, &labels[k], value.is_some(), ghost);
        let tip_text = [TIP_START, TIP_FULL, TIP_END, TIP_AFTER][k];
        if resp.on_hover_text(tip_text).clicked() {
            applied = value;
        }
    }
    if cx.always_tips {
        note(ui, t, &format!("{TIP_CALC}. {TIP_START}. {TIP_END}. {TIP_FULL}. {TIP_AFTER}."), t.faint);
    }
    if !tab.range.status.is_empty() {
        note(ui, t, &tab.range.status, t.muted);
    }
    let from = cx.link.get("date_from").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let to = cx.link.get("date_to").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing.x = TAG_ITEM_GAP / 2.0;
        ui.label(egui::RichText::new("Capture's date filter now:").font(regular(FONT_SMALL)).color(t.faint));
        ui.label(egui::RichText::new(if from.is_empty() { "any date" } else { &from }).font(mono(FONT_SMALL)).color(t.muted));
        ui.label(egui::RichText::new("→").font(regular(FONT_SMALL)).color(t.faint));
        ui.label(egui::RichText::new(if to.is_empty() { "today" } else { &to }).font(mono(FONT_SMALL)).color(t.muted));
    });

    if calc {
        tab.calc(cx);
    }
    if let Some((from, to)) = applied {
        if let Some(f) = from {
            cx.link.set(cx.now, "date_from", json!(f));
        }
        if let Some(t) = to {
            cx.link.set(cx.now, "date_to", json!(t));
        }
    }
}

/// What each part writes: (date_from, date_to); `None` while it has nothing to apply.
type Apply = (Option<String>, Option<String>);

fn apply_value(r: Option<&Range>, part: Part) -> Option<Apply> {
    let r = r?;
    match part {
        Part::Start => r.start.clone().map(|s| (Some(s), None)),
        Part::End => r.end.clone().map(|e| (None, Some(e))),
        Part::Span => Some((Some(r.start.clone()?), Some(r.end.clone()?))),
        Part::Tail => r.after.clone().map(|a| (Some(a), Some(String::new()))),
    }
}

/// Each part's two lines: the value, then what clicking does.
fn labels(r: Option<&Range>) -> [(String, &'static str); 4] {
    let start = r.and_then(|r| r.start.clone()).unwrap_or_else(|| "first demo".into());
    let end = r.and_then(|r| r.end.clone()).unwrap_or_else(|| "last demo".into());
    let span = r.map_or_else(|| "tagged demos".into(), |r| format!("{} demo(s)", r.count));
    [(start, "Apply start"), (span, "Apply full range"), (end, "Apply end"), ("after →".into(), "After range")]
}

fn text_width(ui: &egui::Ui, text: &str, font: egui::FontId) -> f32 {
    spaced_galley(ui.painter(), text, font, egui::Color32::WHITE, 0.0).size().x
}

fn line_height(ui: &egui::Ui, font: egui::FontId) -> f32 {
    ui.fonts_mut(|f| f.row_height(&font))
}

/// One part of the date line: marker or bar on top, the value, then its action.
fn range_button(ui: &mut egui::Ui, t: &Theme, rect: Rect, part: Part, label: &(String, &'static str), enabled: bool, ghost: bool) -> Response {
    let id = ui.scope_id().with(("tgr", label.1));
    let resp = ui.interact(rect, id, if enabled { Sense::click() } else { Sense::hover() });
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, enabled, label.1));
    let p = ui.painter();
    let k = if ghost { t.hair } else { t.accent };
    let top = rect.top();
    match part {
        Part::Start | Part::End => {
            let m = Rect::from_center_size(Pos2::new(rect.center().x, top + TAG_RANGE_MARK[1] / 2.0), TAG_RANGE_MARK.into());
            p.rect_filled(m, MARK_RADIUS, k);
        }
        Part::Span => {
            let bar = Rect::from_min_max(Pos2::new(rect.left() - PAD, top + BAR_TOP), Pos2::new(rect.right() + PAD, top + BAR_TOP + TAG_RANGE_BAR_H));
            let fade = if ghost { t.hair } else { super::parts::mix(t.accent, t.solid, BAR_FADE_PCT) };
            crate::paint::hrule(p, bar, &[k, fade]);
        }
        Part::Tail => {
            let tail = if ghost { t.hair } else { t.emerald };
            let mut x = rect.left() - PAD;
            let y = top + BAR_TOP + TAG_RANGE_BAR_H / 2.0;
            while x < rect.right() {
                let x2 = (x + TAG_RANGE_DASH[0]).min(rect.right());
                p.add(Shape::line_segment([Pos2::new(x, y), Pos2::new(x2, y)], Stroke::new(TAG_RANGE_BAR_H, tail)));
                x += TAG_RANGE_DASH[0] + TAG_RANGE_DASH[1];
            }
        }
    }
    let value_y = top + TAG_RANGE_MARK[1] + MARK_GAP;
    let value_font = if part == Part::Span { semibold(FONT_TAG_RANGE) } else { mono(FONT_TAG_RANGE) };
    let ink = if ghost { t.faint } else { t.txt };
    let v = p.text(Pos2::new(rect.center().x, value_y), Align2::CENTER_TOP, &label.0, value_font, ink);
    let action = if resp.hovered() && enabled { t.accent } else { t.faint };
    p.text(Pos2::new(rect.center().x, v.bottom() + LINE_GAP), Align2::CENTER_TOP, label.1, regular(FONT_TAG_RANGE_SMALL), action);
    if resp.hovered() && enabled {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_part_applies_its_own_dates() {
        let r = Range { start: Some("01-02-2024".into()), end: Some("09-03-2024".into()), after: Some("10-03-2024".into()), count: 3 };
        assert_eq!(apply_value(Some(&r), Part::Start), Some((Some("01-02-2024".into()), None)));
        assert_eq!(apply_value(Some(&r), Part::End), Some((None, Some("09-03-2024".into()))));
        assert_eq!(apply_value(Some(&r), Part::Span), Some((Some("01-02-2024".into()), Some("09-03-2024".into()))));
        assert_eq!(apply_value(Some(&r), Part::Tail), Some((Some("10-03-2024".into()), Some(String::new()))));
        let none = Range { count: 2, ..Default::default() };
        assert!([Part::Start, Part::Span, Part::End, Part::Tail].iter().all(|p| apply_value(Some(&none), *p).is_none()));
        assert_eq!(apply_value(None, Part::Start), None);
    }

    #[test]
    fn tag_words_shorten_after_three() {
        let n = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(tag_words(&[]), "(no tag selected)");
        assert_eq!(tag_words(&n(&["a", "b", "c"])), "a, b, c");
        assert_eq!(tag_words(&n(&["a", "b", "c", "d", "e"])), "a, b, c +2");
    }
}
