//! The Tag Range card, in all three styles (`timeline`, `sentence`, `tiles`) after
//! 3.5 `TagRangeCard.tsx`.

use super::parts::{kicker, note};
use super::{active_ids, names_of, tags, Range, TagsTab};
use crate::cardstyle::{action_word, prose_bold, prose_line, prose_word, style_of, tile_grid};
use crate::grid::CardCx;
use crate::paint::{mono, regular, semibold, spaced_galley};
use crate::theme::Theme;
use crate::widgets::{chip, tip};
use csdm_core::ui_values::{
    CardStyle, FONT_BODY, FONT_SMALL, FONT_TAG_RANGE, FONT_TAG_RANGE_SMALL, TAG_ITEM_GAP, TAG_RANGE_BAR_H, TAG_RANGE_DASH, TAG_RANGE_MARK, TAG_RANGE_SPAN_TAIL, TAG_ROW_GAP,
};
use eframe::egui::{self, vec2, Align2, Pos2, Rect, Response, Sense, Shape, Stroke, StrokeKind, Vec2};
use serde_json::json;

/// `useTagRange.ts::TIPS`.
const TIP_CALC: &str = "Compute the earliest and latest demo dates for the selected tags";
const CALC_ICON_INSET: f32 = 2.5;
const CALC_TEXT_INSET: f32 = 5.0;
const SEP_STEP_TAIL: usize = 3;
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
const TILE_MIN_W: f32 = 128.0;
const TILE_H: f32 = 82.0;
const TILE_ART_H: f32 = 22.0;
const TILE_PAD: f32 = 8.0;
const TILE_RADIUS: f32 = 12.0;
const CALC_H: f32 = 50.0;

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

fn paint_range_art(p: &egui::Painter, rect: Rect, t: &Theme, part: Part, enabled: bool) {
    let y = rect.center().y;
    let (l, r) = (rect.left() + TILE_PAD, rect.right() - TILE_PAD);
    let (t1, t2) = (l + (r - l) * 0.14, l + (r - l) * 0.72); // allow-hardcode: two range tick positions
    p.line_segment([Pos2::new(l, y), Pos2::new(r, y)], Stroke::new(2.0, t.hair));
    for tx in [t1, t2] {
        p.line_segment([Pos2::new(tx, y - 5.0), Pos2::new(tx, y + 5.0)], Stroke::new(1.5, t.muted)); // allow-hardcode: tick half-height
    }
    let lit = if enabled { if part == Part::Tail { t.emerald } else { t.accent } } else { t.faint };
    let (a, b) = match part {
        Part::Start => (t1, (t1 + t2) / 2.0),
        Part::End => ((t1 + t2) / 2.0, t2),
        Part::Span => (t1, t2),
        Part::Tail => (t2, r),
    };
    p.line_segment([Pos2::new(a, y), Pos2::new(b, y)], Stroke::new(3.0, lit)); // allow-hardcode: lit bar thickness
}

pub fn show(tab: &mut TagsTab, ui: &mut egui::Ui, cx: &mut CardCx) {
    let t = cx.theme;
    let names = names_of(&tags(cx), &active_ids(cx));
    ui.spacing_mut().item_spacing = Vec2::splat(TAG_ITEM_GAP);
    let mut calc = false;
    let r = tab.range.range.clone();
    let mut applied = None;
    let ghost = r.as_ref().is_none_or(|r| r.start.is_none());
    let part_labels = labels(r.as_ref());

    match style_of(cx, "tag-range") {
        CardStyle::Timeline => {
            ui.horizontal(|ui| {
                kicker(ui, t, "Tagged");
                ui.label(egui::RichText::new(tag_words(&names)).font(semibold(FONT_BODY)).color(t.txt));
                ui.allocate_ui_with_layout(egui::vec2(ui.available_width(), 0.0), egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let btn = chip(ui, t, "Calculate range", None, None, !tab.range.busy);
                    calc = tip(ui, t, btn, TIP_CALC, false).clicked();
                });
            });
            ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);
            let w = ui.available_width();
            let font = mono(FONT_TAG_RANGE);
            let end_w = |i: usize| text_width(ui, &part_labels[i].0, font.clone()).max(text_width(ui, part_labels[i].1, regular(FONT_TAG_RANGE_SMALL))) + PAD * 2.0;
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
                let resp = range_button(ui, t, rect, part, &part_labels[k], value.is_some(), ghost);
                let tip_text = [TIP_START, TIP_FULL, TIP_END, TIP_AFTER][k];
                if resp.on_hover_text(tip_text).clicked() {
                    applied = value;
                }
            }
            if cx.always_tips {
                note(ui, t, &format!("{TIP_CALC}. {TIP_START}. {TIP_END}. {TIP_FULL}. {TIP_AFTER}."), t.faint);
            }
        }
        CardStyle::Sentence => {
            prose_line(ui, |ui| {
                prose_word(ui, t, "The demos tagged");
                prose_bold(ui, t, &tag_words(&names));
                if let Some(rr) = r.as_ref().filter(|rr| rr.start.is_some() && rr.end.is_some()) {
                    prose_word(ui, t, "run from");
                    prose_bold(ui, t, rr.start.as_deref().unwrap_or_default());
                    prose_word(ui, t, "to");
                    prose_bold(ui, t, rr.end.as_deref().unwrap_or_default());
                    prose_word(ui, t, &format!("({} demos).", rr.count));
                } else {
                    prose_word(ui, t, "run over dates not computed yet.");
                }
                if action_word(ui, t, if r.is_some() { "compute again" } else { "compute them" }, "Calculate range", false, false, TIP_CALC, !tab.range.busy) {
                    calc = true;
                }
            });
            let actions = [
                (Part::Start, "from the first demo", "Apply start", TIP_START, false),
                (Part::End, "up to the last one", "Apply end", TIP_END, false),
                (Part::Span, "over the whole range", "Apply full range", TIP_FULL, false),
                (Part::Tail, "to what came after", "After range", TIP_AFTER, true),
            ];
            prose_line(ui, |ui| {
                prose_word(ui, t, "Filter Capture");
                for (i, (part, text, acc, tip_text, alt)) in actions.into_iter().enumerate() {
                    if i == 1 || i == 2 {
                        prose_word(ui, t, ",");
                    } else if i == SEP_STEP_TAIL {
                        prose_word(ui, t, "or");
                    }
                    let val = apply_value(r.as_ref(), part);
                    if action_word(ui, t, text, acc, alt, false, tip_text, val.is_some()) {
                        applied = val;
                    }
                }
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), CALC_H), if tab.range.busy { Sense::hover() } else { Sense::click() });
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, !tab.range.busy, "Calculate range"));
            let p = ui.painter();
            p.rect(rect, TILE_RADIUS, t.solid, Stroke::new(1.0, if resp.hovered() { t.accent } else { t.hair }), StrokeKind::Inside);
            crate::icons::paint(p, "tagRange", Rect::from_center_size(Pos2::new(rect.left() + TILE_PAD * CALC_ICON_INSET, rect.center().y), Vec2::splat(TAG_RANGE_MARK[1])), t.accent);
            let headline = r.as_ref().map_or_else(|| "Calculate range".into(), |rr| format!("{} demo(s)", rr.count));
            let sub = r.as_ref().and_then(|rr| rr.start.as_ref().map(|s| format!("{s} -> {}", rr.end.as_deref().unwrap_or("?")))).unwrap_or_else(|| tag_words(&names));
            p.text(Pos2::new(rect.left() + TILE_PAD * CALC_TEXT_INSET, rect.center().y - FONT_SMALL / 2.0), Align2::LEFT_CENTER, headline, semibold(FONT_BODY), t.txt);
            p.text(Pos2::new(rect.left() + TILE_PAD * CALC_TEXT_INSET, rect.center().y + FONT_BODY / 2.0 + 2.0), Align2::LEFT_CENTER, sub, regular(FONT_SMALL), t.muted);
            if resp.on_hover_text(TIP_CALC).clicked() && !tab.range.busy {
                calc = true;
            }
            ui.add_space(TAG_ROW_GAP - TAG_ITEM_GAP);
            let specs = [
                (Part::Start, "From start", r.as_ref().and_then(|rr| rr.start.clone()).unwrap_or_else(|| "Apply start".into()), "Apply start", TIP_START),
                (Part::End, "Up to end", r.as_ref().and_then(|rr| rr.end.clone()).unwrap_or_else(|| "Apply end".into()), "Apply end", TIP_END),
                (Part::Span, "Whole range", "Apply full range".into(), "Apply full range", TIP_FULL),
                (Part::Tail, "After it", r.as_ref().and_then(|rr| rr.after.clone()).unwrap_or_else(|| "After range".into()), "After range", TIP_AFTER),
            ];
            tile_grid(ui, TILE_MIN_W, specs.len(), |ui, idx, w| {
                let (part, title, sub, acc, tip_text) = &specs[idx];
                let val = apply_value(r.as_ref(), *part);
                let enabled = val.is_some();
                let (trect, tresp) = ui.allocate_exact_size(vec2(w, TILE_H), if enabled { Sense::click() } else { Sense::hover() });
                tresp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, enabled, *acc));
                let tp = ui.painter();
                tp.rect(trect, TILE_RADIUS, t.solid, Stroke::new(1.0, if tresp.hovered() && enabled { t.accent } else { t.hair }), StrokeKind::Inside);
                let art_r = Rect::from_min_size(trect.min + vec2(0.0, TILE_PAD), vec2(w, TILE_ART_H));
                paint_range_art(tp, art_r, t, *part, enabled);
                tp.text(Pos2::new(trect.center().x, art_r.bottom() + FONT_BODY / 2.0 + 2.0), Align2::CENTER_CENTER, *title, semibold(FONT_BODY), if enabled { t.txt } else { t.faint });
                tp.text(Pos2::new(trect.center().x, trect.bottom() - TILE_PAD), Align2::CENTER_BOTTOM, sub, regular(FONT_SMALL - 1.0), t.muted);
                if tresp.on_hover_text(*tip_text).clicked() && enabled {
                    applied = val;
                }
            });
        }
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
fn labels(r: Option<&Range>) -> [(String, &'static str); 4] { // allow-hardcode: one label pair per Part (four variants)
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
