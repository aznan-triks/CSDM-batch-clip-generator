//! Demo Selection, `timeline` style (3.5 `demoSelection/TimelineView.tsx`, `RangeStrip.tsx`,
//! `parts.tsx`, `DemoPicker.tsx`, `DateField.tsx`): the range is the control.

use super::kit::{button, hint, kick, lab, mark, text};
use super::model::{active_shortcut, fmt_day, parse_day, shortcut_range, shortcuts, strip_start, strip_ticks};
use super::{CaptureTab, DemoRow};
use crate::cardstyle::{action_word, choice_token, icon_tile, paint_glyph, prose_line, prose_word, style_of, text_word, tile_grid, TileGlyph};
use crate::grid::CardCx;
use crate::paint::{mono, regular, semibold};
use crate::theme::Theme;
use crate::widgets::chip;
use chrono::{Datelike, Duration, NaiveDate};
use csdm_core::ui_values::{CardStyle, DEMO_STRIP_INSET, DEMO_STRIP_LABEL_GAP, DEMO_STRIP_PAGE_DAYS};
use eframe::egui::{self, pos2, vec2, Rect, Sense, Stroke, StrokeKind};
use serde_json::json;

const SHORTCUT_TILE_MIN_W: f32 = 120.0;

const TIP_FROM: &str = "Filter demos played on or after this date (dd-mm-yyyy)";
const TIP_TO: &str = "Filter demos played on or before this date (dd-mm-yyyy)";
const TIP_TODAY: &str = "Set end date to today";
const TIP_CLEAR: &str = "Clear date range and reset demo selection";
const TIP_MANUAL: &str = "Toggle between automated date range demo query and loading all demos from database";
const TIP_CALENDAR: &str = "Open a calendar to pick this date";

/// `.ds-strip` geometry.
const STRIP_H: f32 = 74.0;
const BAND_TOP: f32 = 24.0;
const BAND_H: f32 = 22.0;
const AXIS_Y: f32 = 54.0;
const HANDLE: [f32; 2] = [14.0, 30.0];
const READOUT_TOP: f32 = 4.0;
const DEMO_TICK: [f32; 2] = [2.0, 8.0];
const FONT_AXIS: f32 = 9.5;
const FONT_BAND: f32 = 10.5;
const RADIUS: f32 = 12.0;
const BAND_ALPHA: f32 = 0.22;
/// Date box and picker table.
const DATE_W: f32 = 96.0;
const ROW_H: f32 = 22.0;
const TABLE_H: f32 = 240.0;
const COL_W: [f32; 3] = [24.0, 120.0, 110.0];
/// Most of a narrow table Date and Map may take, so the demo name keeps the rest.
const DEMO_FIXED_SHARE: f32 = 0.6;
const FONT_ROW: f32 = 11.5;
const CAL_CELL: f32 = 26.0;
const WEEK: usize = 7;
const CAL_ROWS: usize = 6;
const OFF_ALPHA: f32 = 0.5;
/// `dd-mm` of a `dd-mm-yyyy`.
const DAY_MONTH: usize = 5;
const RING: f32 = 3.0;
const POP_GAP: f32 = 4.0;
const MONTH_TITLE: &str = "%B %Y";
/// Days that always reach into the next month.
const NEXT_MONTH_DAYS: i64 = 32;
const ROW_RADIUS: f32 = 6.0;

fn days(a: NaiveDate, b: NaiveDate) -> i64 {
    (b - a).num_days()
}

pub fn card(tab: &mut CaptureTab, ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    let today = tab.today();
    let from = text(cx, "date_from");
    let to = text(cx, "date_to");
    let mut changes: Option<(String, String)> = None;
    mark(ui, "date_from");
    mark(ui, "date_to");
    let list_shortcuts: Vec<_> = shortcuts().collect();
    let active = active_shortcut(&from, &to, today);

    let date_row = |ui: &mut egui::Ui, changes: &mut Option<(String, String)>| {
        let single_field_w = DATE_W + ROW_H * 2.0;
        let fits_one_row = ui.available_width() >= single_field_w * 2.0 + DATE_W;
        if fits_one_row {
            ui.horizontal(|ui| {
                if let Some(v) = date_field(ui, t, "From", &from, TIP_FROM, today) {
                    *changes = Some((v, changes.as_ref().map_or(to.clone(), |c| c.1.clone())));
                }
                ui.add_space(RADIUS);
                if let Some(v) = date_field(ui, t, "To", &to, TIP_TO, today) {
                    *changes = Some((changes.as_ref().map_or(from.clone(), |c| c.0.clone()), v));
                }
                if button(ui, t, "Today", "Today", TIP_TODAY, true) {
                    *changes = Some((from.clone(), fmt_day(today)));
                }
            });
        } else {
            ui.horizontal(|ui| {
                if let Some(v) = date_field(ui, t, "From", &from, TIP_FROM, today) {
                    *changes = Some((v, changes.as_ref().map_or(to.clone(), |c| c.1.clone())));
                }
            });
            ui.horizontal(|ui| {
                if let Some(v) = date_field(ui, t, "To", &to, TIP_TO, today) {
                    *changes = Some((changes.as_ref().map_or(from.clone(), |c| c.0.clone()), v));
                }
                if button(ui, t, "Today", "Today", TIP_TODAY, true) {
                    *changes = Some((from.clone(), fmt_day(today)));
                }
            });
        }
    };

    match style_of(cx, "demo-selection") {
        CardStyle::Timeline => {
            ui.horizontal(|ui| {
                kick(ui, t, "Played between");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if button(ui, t, "Clear all", "Clear all", TIP_CLEAR, true) {
                        changes = Some((String::new(), String::new()));
                        reset_picker(tab);
                    }
                });
            });
            if let Some(r) = strip(tab, ui, t, &from, &to, today) {
                changes = Some(r);
            }
            ui.horizontal_wrapped(|ui| {
                for s in &list_shortcuts {
                    let on = active == Some(s.label);
                    let r = chip(ui, t, s.label, Some(on), Some(s.label), true).on_hover_text(s.title);
                    if r.clicked() {
                        changes = Some(shortcut_range(s, today));
                        if s.kind == "all" {
                            reset_picker(tab);
                        }
                    }
                }
            });
            date_row(ui, &mut changes);
            ui.horizontal_wrapped(|ui| {
                lab(ui, t, "Demo selection:");
                let label = "Manual mode (load ALL demos from DB)";
                if chip(ui, t, label, Some(tab.demos.manual), Some(label), true).on_hover_text(TIP_MANUAL).clicked() {
                    tab.demos.manual = !tab.demos.manual;
                    if tab.demos.manual {
                        tab.load_demos(cx);
                    }
                }
                if let Some(e) = &tab.demos.error {
                    ui.label(egui::RichText::new(e).font(regular(FONT_ROW)).color(t.rose));
                }
            });
            picker(tab, ui, t);
        }
        CardStyle::Sentence => {
            let range_words = active
                .and_then(|lbl| list_shortcuts.iter().find(|s| s.label == lbl))
                .map(|s| s.words.to_string())
                .unwrap_or_else(|| if from.is_empty() && to.is_empty() { "at any time".to_string() } else { format!("between {} and {}", if from.is_empty() { "any" } else { &from }, if to.is_empty() { "today" } else { &to }) });
            prose_line(ui, |ui| {
                prose_word(ui, t, "Use the demos played");
                choice_token(ui, t, "ds-range", &range_words, "Date range", false, TIP_FROM, true, |ui, close| {
                    ui.horizontal_wrapped(|ui| {
                        for s in &list_shortcuts {
                            let on = active == Some(s.label);
                            if chip(ui, t, s.label, Some(on), Some(s.label), true).on_hover_text(s.title).clicked() {
                                changes = Some(shortcut_range(s, today));
                                if s.kind == "all" {
                                    reset_picker(tab);
                                }
                                *close = true;
                            }
                        }
                    });
                });
                prose_word(ui, t, "— from");
                text_word(ui, cx, "date_from", "From date", "any date", false, false, false, TIP_FROM);
                prose_word(ui, t, "to");
                text_word(ui, cx, "date_to", "To date", "today", false, false, false, TIP_TO);
                if action_word(ui, t, "Today", "Today", false, false, TIP_TODAY, true) {
                    changes = Some((from.clone(), fmt_day(today)));
                }
                prose_word(ui, t, "· picked");
                if action_word(
                    ui,
                    t,
                    "Manual mode (load ALL demos from DB)",
                    if tab.demos.manual { "by hand (manual mode)" } else { "from that date range" },
                    false,
                    tab.demos.manual,
                    TIP_MANUAL,
                    true,
                ) {
                    tab.demos.manual = !tab.demos.manual;
                    if tab.demos.manual {
                        tab.load_demos(cx);
                    }
                }
                prose_word(ui, t, "·");
                if action_word(ui, t, "Clear all", "Clear all", false, false, TIP_CLEAR, true) {
                    changes = Some((String::new(), String::new()));
                    reset_picker(tab);
                }
                prose_word(ui, t, ".");
            });
            if let Some(e) = &tab.demos.error {
                ui.label(egui::RichText::new(e).font(regular(FONT_ROW)).color(t.rose));
            }
            if tab.demos.manual || tab.demos.rows.is_some() {
                picker(tab, ui, t);
            }
        }
        CardStyle::Tiles => {
            ui.horizontal(|ui| {
                kick(ui, t, "Quick ranges");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if button(ui, t, "Clear all", "Clear all", TIP_CLEAR, true) {
                        changes = Some((String::new(), String::new()));
                        reset_picker(tab);
                    }
                });
            });
            tile_grid(ui, SHORTCUT_TILE_MIN_W, list_shortcuts.len(), |ui, idx, w| {
                let s = &list_shortcuts[idx];
                let on = active == Some(s.label);
                if icon_tile(ui, t, w, crate::cardstyle::ICON_TILE_H, s.label, s.words, None, on, false, false, s.title, |p, r, c| paint_glyph(p, r, TileGlyph::Icon("demoSelection"), c)).clicked() {
                    changes = Some(shortcut_range(s, today));
                    if s.kind == "all" {
                        reset_picker(tab);
                    }
                }
            });
            ui.add_space(POP_GAP);
            date_row(ui, &mut changes);
            ui.add_space(POP_GAP);
            let manual_cap = if tab.demos.manual { "Loaded all demos from database" } else { "Click to load ALL demos and pick rows manually" };
            let label = "Manual mode (load ALL demos from DB)";
            if icon_tile(ui, t, ui.available_width(), crate::cardstyle::ICON_TILE_H, label, manual_cap, None, tab.demos.manual, false, false, TIP_MANUAL, |p, r, c| paint_glyph(p, r, TileGlyph::CheckList, c)).clicked() {
                tab.demos.manual = !tab.demos.manual;
                if tab.demos.manual {
                    tab.load_demos(cx);
                }
            }
            if let Some(e) = &tab.demos.error {
                ui.label(egui::RichText::new(e).font(regular(FONT_ROW)).color(t.rose));
            }
            picker(tab, ui, t);
        }
    }
    if let Some((f, tt)) = changes {
        if f != from {
            cx.link.set(cx.now, "date_from", json!(f));
        }
        if tt != to {
            cx.link.set(cx.now, "date_to", json!(tt));
        }
    }
    None
}

fn reset_picker(tab: &mut CaptureTab) {
    tab.demos.manual = false;
    tab.demos.rows = None;
    tab.demos.checked.clear();
    tab.demos.selected.clear();
    tab.demos.anchor = None;
}

/// The calendar strip: dates along the bottom, the range as a band, a handle at each end.
fn strip(tab: &mut CaptureTab, ui: &mut egui::Ui, t: &Theme, from: &str, to: &str, today: NaiveDate) -> Option<(String, String)> {
    let (fd, td) = (parse_day(from), parse_day(to));
    let start = tab.demos.strip_drag.map_or_else(|| strip_start(fd, td, today), |(_, s)| s);
    let span = days(start, today).max(1);
    let (outer, _) = ui.allocate_exact_size(vec2(ui.available_width(), STRIP_H), Sense::hover());
    let rail = outer.width() - DEMO_STRIP_INSET * 2.0;
    let at = |d: NaiveDate| (days(start, d) as f32 / span as f32).clamp(0.0, 1.0);
    let x = |d: NaiveDate| outer.left() + DEMO_STRIP_INSET + rail * at(d);
    let p = ui.painter();
    p.rect(outer, RADIUS, t.surface2, Stroke::new(1.0, t.hair), StrokeKind::Inside);
    p.line_segment([pos2(outer.left(), outer.top() + AXIS_Y), pos2(outer.right(), outer.top() + AXIS_Y)], Stroke::new(1.0, t.hair));
    let mut last = f32::NEG_INFINITY;
    for (d, label, strong) in strip_ticks(start, today) {
        let px = x(d);
        p.line_segment([pos2(px, outer.top() + AXIS_Y - DEMO_TICK[1] / 2.0), pos2(px, outer.top() + AXIS_Y + DEMO_TICK[1] / 2.0)], Stroke::new(1.0, if strong { t.muted } else { t.hair }));
        if px - last >= DEMO_STRIP_LABEL_GAP && px <= outer.right() - DEMO_STRIP_LABEL_GAP / 2.0 {
            last = px;
            p.text(pos2(px, outer.top() + AXIS_Y + DEMO_TICK[1]), egui::Align2::CENTER_TOP, label, if strong { semibold(FONT_AXIS) } else { regular(FONT_AXIS) }, if strong { t.muted } else { t.faint });
        }
    }
    let lo = fd.filter(|f| *f > start).unwrap_or(start);
    let hi = td.unwrap_or(today);
    let open = fd.is_none() && td.is_none();
    let band = Rect::from_min_max(pos2(x(lo), outer.top() + BAND_TOP), pos2(x(hi).max(x(lo) + 2.0), outer.top() + BAND_TOP + BAND_H));
    p.rect(band, BAND_H / 2.0, t.accent.gamma_multiply(if open { BAND_ALPHA / 2.0 } else { BAND_ALPHA }), Stroke::new(1.0, t.accent.gamma_multiply(BAND_ALPHA * 2.0)), StrokeKind::Inside);
    let n = days(lo, hi) + 1;
    let words = if open { "every demo".to_string() } else { format!("{n} day{}", if n == 1 { "" } else { "s" }) };
    let g = p.layout_no_wrap(words, semibold(FONT_BAND), t.accent);
    if g.size().x < band.width() {
        p.galley(band.center() - g.size() / 2.0, g, t.accent);
    }
    let caption = if open { "any date".to_string() } else { format!("{} → {}", if fd.is_some() { fmt_day(lo)[..DAY_MONTH].to_string() } else { "any".into() }, if td.is_some() { fmt_day(hi)[..DAY_MONTH].to_string() } else { "today".into() }) };
    let cx_mid = ((x(lo) + x(hi)) / 2.0).clamp(outer.left() + DEMO_STRIP_LABEL_GAP, outer.right() - DEMO_STRIP_LABEL_GAP);
    p.text(pos2(cx_mid, outer.top() + READOUT_TOP), egui::Align2::CENTER_TOP, caption, mono(FONT_AXIS), t.muted);
    // One tick per day holding at least one loaded demo.
    if let Some(rows) = &tab.demos.rows {
        let mut seen = std::collections::BTreeMap::new();
        for r in rows {
            if let Some(d) = parse_day(&r.date).filter(|d| *d >= start && *d <= today) {
                *seen.entry(d).or_insert(0) += 1;
            }
        }
        for d in seen.keys() {
            let px = x(*d);
            p.rect_filled(Rect::from_center_size(pos2(px, band.bottom() + DEMO_TICK[1] / 2.0), vec2(DEMO_TICK[0], DEMO_TICK[1] / 2.0)), 0.0, t.emerald);
        }
    }
    // Today's mark.
    p.circle_filled(pos2(x(today), outer.top() + AXIS_Y), DEMO_TICK[0] * 2.0, t.accent);

    let mut out = None;
    for (is_from, day, set) in [(true, lo, fd.is_some()), (false, hi, td.is_some())] {
        let hx = x(day);
        let r = Rect::from_center_size(pos2(hx, band.center().y), vec2(HANDLE[0], HANDLE[1]));
        let id = ui.scope_id().with(("strip-handle", is_from));
        let resp = ui.interact(r, id, Sense::click_and_drag());
        let name = if is_from { "From date" } else { "To date" };
        let value = if set { fmt_day(day) } else { "no limit".into() };
        resp.widget_info(|| {
            let mut i = egui::WidgetInfo::labeled(egui::Role::Slider, true, name);
            i.current_text_value = Some(value.clone());
            i.value = Some(days(start, day) as f64);
            i
        });
        let resp = resp.on_hover_text(format!("{}. Drag, or use the arrow keys (Page Up/Down: 30 days)", if is_from { TIP_FROM } else { TIP_TO }));
        if resp.drag_started() {
            tab.demos.strip_drag = Some((is_from, start));
            resp.request_focus();
        }
        let mut target = None;
        if resp.dragged() {
            if let Some(pos) = resp.interact_pointer_pos() {
                let ratio = ((pos.x - outer.left() - DEMO_STRIP_INSET) / rail).clamp(0.0, 1.0);
                let d = start + Duration::days((ratio * span as f32).round() as i64);
                if d != day {
                    target = Some(d);
                }
            }
        }
        if resp.drag_stopped() {
            tab.demos.strip_drag = None;
        }
        if resp.has_focus() {
            let step = ui.input(|i| {
                let k = |key| i.key_pressed(key);
                if k(egui::Key::ArrowLeft) || k(egui::Key::ArrowDown) { -1 }
                else if k(egui::Key::ArrowRight) || k(egui::Key::ArrowUp) { 1 }
                else if k(egui::Key::PageDown) { -DEMO_STRIP_PAGE_DAYS }
                else if k(egui::Key::PageUp) { DEMO_STRIP_PAGE_DAYS }
                else { 0 }
            });
            if step != 0 {
                target = Some(day + Duration::days(step));
            }
        }
        let lit = resp.hovered() || resp.dragged() || resp.has_focus();
        let p = ui.painter();
        if lit {
            p.rect_filled(r.expand(RING), HANDLE[0], t.accent_soft);
            crate::cursor::snap_here(ui.ctx(), r);
        }
        p.rect(r, HANDLE[0] / 2.0, t.solid, Stroke::new(2.0, t.accent), StrokeKind::Inside);
        if let Some(d) = target {
            // `set`: never past today, never past the other bound.
            let d = d.min(today);
            out = Some(if is_from { (fmt_day(d.min(hi)), to.to_string()) } else { (from.to_string(), fmt_day(d.max(lo))) });
        }
    }
    out
}

/// `DateField`: `dd-mm-yyyy` typed, or picked on a small month calendar.
fn date_field(ui: &mut egui::Ui, t: &Theme, label: &str, value: &str, tip: &str, today: NaiveDate) -> Option<String> {
    lab(ui, t, label);
    let mut v = value.to_string();
    let r = ui.add(egui::TextEdit::singleline(&mut v).hint_text("dd-mm-yyyy").desired_width(DATE_W).font(mono(FONT_ROW)));
    let name = format!("{label} date");
    r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, &name));
    let r = r.on_hover_text(tip);
    let mut out = r.changed().then(|| v.clone());
    let id = ui.scope_id().with(("cal", label));
    let cal = crate::widgets::chip(ui, t, "📅", None, Some(&format!("Open calendar {label}")), true).on_hover_text(TIP_CALENDAR);
    let mut open: Option<NaiveDate> = ui.data(|d| d.get_temp(id));
    if cal.clicked() {
        open = if open.is_some() { None } else { Some(parse_day(value).unwrap_or(today).with_day(1).expect("day 1")) };
    }
    if let Some(month) = open {
        let mut next_month = Some(month);
        let area = egui::Area::new(id.with("pop")).order(egui::Order::Foreground).fixed_pos(cal.rect.left_bottom() + vec2(0.0, POP_GAP)).show(ui.ctx(), |ui| {
            egui::Frame::popup(ui.style()).fill(t.solid).stroke(Stroke::new(1.0, t.hair)).show(ui, |ui| {
                ui.horizontal(|ui| {
                    if ui.small_button("‹").clicked() {
                        next_month = Some(month - Duration::days(1)).map(|d| d.with_day(1).expect("day 1"));
                    }
                    ui.label(egui::RichText::new(month.format(MONTH_TITLE).to_string()).font(semibold(FONT_ROW)).color(t.txt));
                    if ui.small_button("›").clicked() {
                        next_month = Some(month + Duration::days(NEXT_MONTH_DAYS)).map(|d| d.with_day(1).expect("day 1"));
                    }
                });
                egui::Grid::new(id.with("grid")).spacing(vec2(2.0, 2.0)).show(ui, |ui| {
                    for d in ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] {
                        ui.label(egui::RichText::new(d).font(regular(FONT_AXIS)).color(t.faint));
                    }
                    ui.end_row();
                    let first = month - Duration::days(i64::from(month.weekday().num_days_from_monday()));
                    for w in 0..CAL_ROWS {
                        for k in 0..WEEK {
                            let d = first + Duration::days((w * WEEK + k) as i64);
                            let ink = if d.month() == month.month() { t.txt } else { t.faint.gamma_multiply(OFF_ALPHA) };
                            let picked = parse_day(value) == Some(d);
                            let b = egui::Button::new(egui::RichText::new(d.day().to_string()).font(regular(FONT_ROW)).color(if picked { t.on_accent } else { ink }))
                                .fill(if picked { t.accent } else { t.solid })
                                .min_size(vec2(CAL_CELL, CAL_CELL));
                            if ui.add(b).clicked() {
                                out = Some(fmt_day(d));
                                next_month = None;
                            }
                        }
                        ui.end_row();
                    }
                });
            });
        });
        let outside = ui.input(|i| i.pointer.any_click() && i.pointer.interact_pos().is_some_and(|p| !area.response.rect.contains(p) && !cal.rect.contains(p)));
        open = if outside { None } else { next_month };
    }
    ui.data_mut(|d| {
        match open {
            Some(m) => {
                d.insert_temp(id, m);
            }
            None => d.remove::<NaiveDate>(id),
        }
    });
    out
}

/// Date, Map and Demo widths for a table `width` wide: Date and Map at their size, shrunk in
/// proportion when the card is narrow, Demo takes what is left (at least its share).
fn columns(width: f32) -> [f32; COL_W.len()] {
    let room = (width - COL_W[0]).max(0.0);
    let fixed = COL_W[1] + COL_W[2];
    let k = (room * DEMO_FIXED_SHARE / fixed).min(1.0);
    [COL_W[1] * k, COL_W[2] * k, room - fixed * k]
}

/// The ✓ / Date / Map / Demo table; only the rows in view are drawn.
fn picker(tab: &mut CaptureTab, ui: &mut egui::Ui, t: &Theme) {
    let rows: Vec<DemoRow> = tab.demos.rows.clone().unwrap_or_default();
    let total = rows.len();
    let on = rows.iter().filter(|r| tab.demos.checked.get(&r.path) == Some(&true)).count();
    // Wrapped, never right-to-left: four buttons wider than a narrow card pushed the table off its left edge.
    ui.horizontal_wrapped(|ui| {
        let words = if total == 0 { "no demos loaded".to_string() } else { format!("{on}/{total} selected") };
        lab(ui, t, &words);
        let sel: Vec<String> = tab.demos.selected.iter().cloned().collect();
        if button(ui, t, "✓ Check all", "Check all", "Include all listed demos for clip extraction", true) {
            for r in &rows {
                tab.demos.checked.insert(r.path.clone(), true);
            }
        }
        if button(ui, t, "✕ Uncheck all", "Uncheck all", "Exclude all listed demos from clip extraction", true) {
            for r in &rows {
                tab.demos.checked.insert(r.path.clone(), false);
            }
        }
        if button(ui, t, "✓ Check selected", "Check selected", "Checks the rows highlighted by click, Ctrl+click or Shift+click", true) {
            for p in &sel {
                tab.demos.checked.insert(p.clone(), true);
            }
        }
        if button(ui, t, "✕ Uncheck selected", "Uncheck selected", "Unchecks only the rows currently highlighted (click, Ctrl+click, Shift+click)", true) {
            for p in &sel {
                tab.demos.checked.insert(p.clone(), false);
            }
        }
    });
    egui::Frame::new().fill(t.solid).stroke(Stroke::new(1.0, t.hair)).corner_radius(egui::CornerRadius::same(RADIUS as u8)).inner_margin(egui::Margin::same(DEMO_STRIP_INSET as i8)).show(ui, |ui| {
        ui.set_width(ui.available_width());
        let cols = columns(ui.available_width());
        let (head, _) = ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::hover());
        let mut x = head.left() + COL_W[0];
        for (w, h) in cols.iter().zip(["Date", "Map", "Demo"]) {
            ui.painter().with_clip_rect(Rect::from_min_size(pos2(x, head.top()), vec2(*w, ROW_H))).text(pos2(x, head.center().y), egui::Align2::LEFT_CENTER, h, semibold(FONT_AXIS), t.faint);
            x += w;
        }
        if rows.is_empty() {
            hint(ui, t, "No demos loaded -- run a Preview, or turn on Manual mode.");
            return;
        }
        egui::ScrollArea::vertical().max_height(TABLE_H).auto_shrink([false, true]).show_rows(ui, ROW_H, total, |ui, range| {
            for i in range {
                let row = &rows[i];
                let checked = tab.demos.checked.get(&row.path) == Some(&true);
                let selected = tab.demos.selected.contains(&row.path);
                let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::click());
                let name = format!("{} {}", row.date, row.name);
                resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Row, true, selected, &name));
                let tip = match row.status.as_str() {
                    "warn" => Some(format!("Recorded before a CS2 breaking update ({}) -- {}", row.brk, row.tip)),
                    "missing" => Some("Demo file not found on disk".to_string()),
                    _ => None,
                };
                let resp = match &tip { Some(s) => resp.on_hover_text(s), None => resp };
                let p = ui.painter();
                if selected {
                    p.rect_filled(r, ROW_RADIUS, t.accent_soft);
                } else if resp.hovered() {
                    p.rect_filled(r, ROW_RADIUS, t.hair2);
                }
                let ink = match row.status.as_str() {
                    "warn" => t.amber,
                    "missing" => t.rose,
                    _ => t.txt,
                };
                let ink = if checked { ink } else { ink.gamma_multiply(OFF_ALPHA) };
                let check = Rect::from_min_size(r.min, vec2(COL_W[0], ROW_H));
                let cresp = ui.interact(check, ui.scope_id().with(("dp-check", &row.path)), Sense::click());
                let cn = format!("Include {}", row.name);
                cresp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, checked, &cn));
                let p = ui.painter();
                p.text(check.center(), egui::Align2::CENTER_CENTER, if checked { "✓" } else { "✕" }, semibold(FONT_ROW), if checked { t.emerald } else { t.faint });
                let mut x = r.left() + COL_W[0];
                for (k, (w, s)) in cols.iter().zip([&row.date, &row.map, &row.name]).enumerate() {
                    let font = if k == 0 { mono(FONT_ROW - 1.0) } else { regular(FONT_ROW) };
                    p.with_clip_rect(Rect::from_min_size(pos2(x, r.top()), vec2(*w, ROW_H)).intersect(p.clip_rect())).text(pos2(x, r.center().y), egui::Align2::LEFT_CENTER, s, font, ink);
                    x += w;
                }
                if cresp.clicked() {
                    tab.demos.checked.insert(row.path.clone(), !checked);
                } else if resp.clicked() {
                    let mods = ui.input(|i| i.modifiers);
                    if mods.shift && tab.demos.anchor.is_some() {
                        let a = tab.demos.anchor.unwrap_or(i);
                        let (s, e) = (a.min(i), a.max(i));
                        tab.demos.selected = rows[s..=e].iter().map(|r| r.path.clone()).collect();
                    } else if mods.command {
                        if !tab.demos.selected.remove(&row.path) {
                            tab.demos.selected.insert(row.path.clone());
                        }
                        tab.demos.anchor = Some(i);
                    } else {
                        tab.demos.selected = [row.path.clone()].into_iter().collect();
                        tab.demos.anchor = Some(i);
                    }
                }
            }
        });
    });
}
