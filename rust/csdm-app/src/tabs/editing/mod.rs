//! The EDITING tab (3.5 `tabs/EditingTab.tsx`): the clips of the last PREVIEW, chosen and edited
//! before GENERATE. No card grid: a header, then the Timeline (one lane per demo, a clip opens in
//! the inspector) or the List (the checklist). The pager pages clips in the list, lanes on the
//! timeline.
//!
//! The clips live in `Link::state.preview` (`csdm_core::editing::Preview`), where the action bar and
//! the preset loader read them too. This tab only draws them and asks for changes: every rule
//! (edited window, totals, lanes, overlap) is `csdm-core`'s.

mod inspector;
pub mod timeline;

use crate::grid::{CardCx, TabView};
use crate::paint::{mono, regular, semibold};
use crate::tabs::capture::kit::seg;
use crate::theme::Theme;
use crate::widgets::chip;
use csdm_core::editing::{event_meta, format_duration, format_total, EmptyReason, Kind, Lane, Preview};
use csdm_core::ui_values::{EDITING_LANES_PER_PAGE, EDITING_LIST_PAGE_SIZE, FONT_BODY, FONT_SMALL};
use eframe::egui::{self, pos2, vec2, Align, Color32, Layout, Rect, Response, Sense, Stroke, StrokeKind};
use serde_json::Value;
use std::collections::HashMap;

/// The header's view switch; the first one is where the tab opens (3.5 `EDITING_VIEWS`).
pub const VIEWS: [&str; 2] = ["Timeline", "List"];
const VIEW_TIP: &str = "Timeline: clips on each demo's time axis, editable one by one. List: the plain checklist.";
const NO_PREVIEW: &str = "No preview available. Run a PREVIEW first.";
const ROW_TIP: &str = "Click to include or exclude this clip from the recording run";
const BADGE_TIP: &str = "Type of in-game event that triggered this clip";
const EDITED: &str = "✎ edited";
const EDITED_TIP: &str = "Edited on the timeline";

/// `.edtl` hues of the event families (`--edtl-damage`, `--edtl-shot`); kills wear the accent.
const DAMAGE: Color32 = Color32::from_rgb(0xF9, 0x73, 0x16);
const SHOT: Color32 = Color32::from_rgb(0x14, 0xB8, 0xA6);
/// `color-mix(in srgb, <hue> 16%, transparent)` of the list badges.
const BADGE_FILL_PCT: f32 = 16.0;
const PCT: f32 = 100.0;
/// `--sp-1` … `--sp-4`.
pub(crate) const SP: [f32; 4] = [4.0, 8.0, 12.0, 16.0];
/// `.editing-clip`: row and its parts.
const ROW_GAP: f32 = 2.0;
const CHECK: f32 = 16.0;
const CHECK_RADIUS: f32 = 4.0;
const CHECK_MARK: [[f32; 2]; 3] = [[0.25, 0.52], [0.43, 0.70], [0.76, 0.32]];
const DURATION_WIDTH: f32 = 56.0;
const BADGE_PAD: [f32; 2] = [8.0, 2.0];
const BADGE_RADIUS: f32 = 6.0;
const BADGE_WIDTH: f32 = 78.0;
const EMPTY_WIDTH: f32 = 520.0;
/// `.editing-empty`: `--sp-4` across, `--sp-3` down.
const EMPTY_PAD: [i8; 2] = [16, 12];
const COUNT_WIDTH: f32 = 64.0;
const GROUP: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum View { Timeline, List }

/// A change this frame's drawing asked for, applied once the drawing has let go of the preview.
#[derive(Clone, Debug, PartialEq)]
pub enum Edit { Toggle(usize), Before(usize, i64), After(usize, i64), Reset(usize), Event(usize, String) }

pub struct EditingTab {
    pub view: View,
    pub page: usize,
    /// The clip open in the inspector.
    pub active: Option<usize>,
    pub zoom: timeline::Zoom,
    /// The preview these fields belong to; a new one starts on page 1, nothing open, zoom fitted.
    serial: u64,
    lanes: Vec<Lane>,
    cameras: inspector::Cameras,
    /// Height the inspector took last frame: the lanes keep the rest.
    inspector_height: f32,
    /// SteamID → name, from the database read (`connect_db`), rebuilt when that read changes.
    names: HashMap<String, String>,
    names_of: (usize, usize),
}

impl Default for EditingTab {
    fn default() -> Self {
        Self::new()
    }
}

impl EditingTab {
    pub fn new() -> Self {
        Self { view: View::Timeline, page: 0, active: None, zoom: timeline::Zoom::default(), serial: 0, lanes: Vec::new(), cameras: inspector::Cameras::default(), inspector_height: 0.0, names: HashMap::new(), names_of: (0, 0) }
    }

    fn follow_preview(&mut self, cx: &CardCx) {
        let serial = cx.link.state.preview_serial;
        if serial != self.serial || (self.lanes.is_empty() && !cx.link.state.preview.clips.is_empty()) {
            self.serial = serial;
            self.page = 0;
            self.active = None;
            self.zoom = timeline::Zoom::default();
            self.lanes = cx.link.state.preview.lanes();
        }
    }

    /// 3.5 shows the SteamID of the tracked player; the name the database read knows reads better.
    fn follow_names(&mut self, cx: &CardCx) {
        let rows = cx.link.database.as_ref().and_then(|d| d.get("players")).and_then(Value::as_array);
        let key = rows.map_or((0, 0), |r| (r.as_ptr() as usize, r.len()));
        if key == self.names_of {
            return;
        }
        self.names_of = key;
        self.names = rows.into_iter().flatten().filter_map(|r| Some((r.get(1)?.as_str()?.to_string(), r.get(2)?.as_str()?.to_string()))).filter(|(_, name)| !name.is_empty()).collect();
    }

    /// The camera spans the engine planned for the open, edited clip (`None`: not asked or not answered yet).
    pub fn planned_cameras(&self) -> Option<&[csdm_core::editing::CameraSpan]> {
        self.cameras.planned()
    }

    fn player<'a>(&'a self, steam_id: &'a str) -> &'a str {
        self.names.get(steam_id).map_or(steam_id, String::as_str)
    }
}

impl TabView for EditingTab {
    fn uses_grid(&self) -> bool {
        false
    }

    fn as_any_mut(&mut self) -> Option<&mut dyn std::any::Any> {
        Some(self)
    }

    fn free(&mut self, ui: &mut egui::Ui, cx: &mut CardCx) {
        let t = cx.theme;
        self.follow_preview(cx);
        if cx.link.state.preview.clips.is_empty() {
            empty(ui, t, cx.link.state.preview.empty_reason.as_ref());
            return;
        }
        self.follow_names(cx);
        self.cameras.sync(cx.link, cx.now, if self.view == View::Timeline { self.active } else { None });
        let mut edits = Vec::new();
        let preview = &cx.link.state.preview;
        let on_list = self.view == View::List;
        let (count, per_page) = if on_list { (preview.clips.len(), EDITING_LIST_PAGE_SIZE) } else { (self.lanes.len(), EDITING_LANES_PER_PAGE) };
        let pages = count.div_ceil(per_page).max(1);
        self.page = self.page.min(pages - 1);
        self.header(ui, t, preview, pages);
        ui.add_space(SP[1]);
        let start = self.page * per_page;
        if on_list {
            self.list(ui, t, preview, start, &mut edits);
        } else {
            self.timeline(ui, t, preview, start, &mut edits);
        }
        let preview = &mut cx.link.state.preview;
        for e in edits {
            match e {
                Edit::Toggle(i) => preview.toggle(i),
                Edit::Before(i, s) => preview.set_before(i, s),
                Edit::After(i, s) => preview.set_after(i, s),
                Edit::Reset(i) => preview.reset(i),
                Edit::Event(i, key) => preview.toggle_event(i, &key),
            }
        }
    }
}

impl EditingTab {
    /// `.editing-header`: "N of M clips · total", the view switch, the pager.
    fn header(&mut self, ui: &mut egui::Ui, t: &Theme, preview: &Preview, pages: usize) {
        ui.horizontal(|ui| {
            let mut job = egui::text::LayoutJob::default();
            let fmt = |strong: bool| egui::TextFormat { font_id: if strong { semibold(FONT_BODY) } else { regular(FONT_BODY) }, color: if strong { t.txt } else { t.muted }, ..Default::default() };
            for (words, strong) in [(preview.selected_count().to_string(), true), (" of ".into(), false), (preview.clips.len().to_string(), true), (" clips · ".into(), false), (format_total(preview.total_s()), true)] {
                job.append(&words, 0.0, fmt(strong));
            }
            ui.label(job);
            // Bounded to its content: a right-to-left row would otherwise take the pane's height.
            ui.allocate_ui_with_layout(vec2(ui.available_width(), 0.0), Layout::right_to_left(Align::Center), |ui| {
                if pages > 1 {
                    if chip(ui, t, "›", None, Some("Next page"), self.page + 1 < pages).on_hover_text("Go to next page").clicked() {
                        self.page += 1;
                    }
                    ui.label(egui::RichText::new(format!("{} / {pages}", self.page + 1)).font(regular(FONT_SMALL)).color(t.muted));
                    if chip(ui, t, "‹", None, Some("Previous page"), self.page > 0).on_hover_text("Go to previous page").clicked() {
                        self.page -= 1;
                    }
                    ui.add_space(SP[1]);
                }
                let current = VIEWS[if self.view == View::Timeline { 0 } else { 1 }];
                if let Some(v) = seg(ui, t, "Editing view", &VIEWS, current, false, VIEW_TIP, None) {
                    self.view = if v == VIEWS[0] { View::Timeline } else { View::List };
                    self.page = 0;
                }
            });
        });
    }

    /// Timeline view: the lanes of this page fill the pane; the open clip's inspector stays under them.
    fn timeline(&mut self, ui: &mut egui::Ui, t: &Theme, preview: &Preview, start: usize, edits: &mut Vec<Edit>) {
        let lanes = &self.lanes[start..(start + EDITING_LANES_PER_PAGE).min(self.lanes.len())];
        let active_lane = self.active.and_then(|i| self.lanes.iter().find(|l| l.indices.contains(&i)));
        let rest = ui.available_rect_before_wrap();
        let reserved = if active_lane.is_some() { self.inspector_height + SP[1] } else { 0.0 };
        let top = Rect::from_min_max(rest.min, pos2(rest.right(), (rest.bottom() - reserved).max(rest.top() + timeline::MIN_HEIGHT)));
        let mut lanes_ui = ui.new_child(egui::UiBuilder::new().max_rect(top).id_salt("editing-lanes"));
        if let Some(clicked) = timeline::show(&mut lanes_ui, t, preview, lanes, self.active, &mut self.zoom) {
            self.active = Some(clicked);
        }
        if let (Some(index), Some(lane)) = (self.active, active_lane) {
            let under = Rect::from_min_max(pos2(rest.left(), top.bottom() + SP[1]), rest.max);
            let mut child = ui.new_child(egui::UiBuilder::new().max_rect(under).id_salt("editing-inspector"));
            if inspector::show(&mut child, t, preview, index, lane, &self.cameras, edits) {
                self.active = None;
            }
            let height = child.min_rect().height();
            if (height - self.inspector_height).abs() > 1.0 / 2.0 {
                // The lanes give the inspector its room on the next frame.
                self.inspector_height = height;
                ui.ctx().request_repaint();
            }
        }
        ui.allocate_rect(rest, Sense::hover());
    }

    /// List view: one row per clip of this page; the whole row carries the click.
    fn list(&self, ui: &mut egui::Ui, t: &Theme, preview: &Preview, start: usize, edits: &mut Vec<Edit>) {
        egui::ScrollArea::vertical().id_salt("editing-list").auto_shrink(false).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = ROW_GAP;
            for (idx, clip) in preview.clips.iter().enumerate().skip(start).take(EDITING_LIST_PAGE_SIZE) {
                let (label, kind) = event_meta(&clip.event_type);
                let duration = format_duration(clip.window(preview.tickrate).map_or(0.0, |w| w.duration_s));
                let font = regular(FONT_SMALL);
                let height = CHECK.max(ui.fonts_mut(|f| f.row_height(&font)) + BADGE_PAD[1] * 2.0) + SP[0] * 2.0;
                let (row, resp) = ui.allocate_exact_size(vec2(ui.available_width(), height), Sense::click());
                let player = self.player(&clip.player);
                let name = format!("Clip {}: {label}, {duration}, {player}", idx + 1);
                resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, clip.selected, &name));
                let resp = resp.on_hover_text(ROW_TIP);
                if resp.hovered() {
                    crate::cursor::snap_here(ui.ctx(), row);
                }
                if resp.clicked() {
                    edits.push(Edit::Toggle(idx));
                }
                let p = ui.painter();
                p.rect_filled(row, f32::from(crate::CORNER_SMALL), if resp.hovered() { t.surface2 } else { t.surface });
                let mid = row.center().y;
                let mut x = row.left() + SP[1];
                check_box(p, t, Rect::from_min_size(pos2(x, mid - CHECK / 2.0), vec2(CHECK, CHECK)), clip.selected, resp.hovered());
                x += CHECK + SP[1];
                p.text(pos2(x, mid), egui::Align2::LEFT_CENTER, &duration, mono(FONT_SMALL), t.accent);
                x += DURATION_WIDTH + SP[1];
                let badge = Rect::from_min_size(pos2(x, row.top() + SP[0]), vec2(BADGE_WIDTH, row.height() - SP[0] * 2.0));
                let (ink, fill) = badge_colors(t, kind);
                p.rect_filled(badge, BADGE_RADIUS, fill);
                p.text(badge.center(), egui::Align2::CENTER_CENTER, &label, semibold(FONT_SMALL), ink);
                ui.interact(badge, resp.id.with("badge"), Sense::hover()).on_hover_text(BADGE_TIP);
                x += BADGE_WIDTH + SP[1];
                p.text(pos2(x, mid), egui::Align2::LEFT_CENTER, player, font, t.muted);
                if clip.edited() {
                    let r = p.text(pos2(row.right() - SP[1], mid), egui::Align2::RIGHT_CENTER, EDITED, regular(FONT_SMALL), t.accent);
                    ui.interact(r, resp.id.with("edited"), Sense::hover()).on_hover_text(EDITED_TIP);
                }
            }
        });
    }
}

/// The hue of an event family on the timeline and in the badges.
pub(super) fn kind_color(t: &Theme, kind: Kind) -> Color32 {
    match kind {
        Kind::Kill => t.accent,
        Kind::Damage => DAMAGE,
        Kind::Shot => SHOT,
        Kind::Other => t.muted,
    }
}

/// `color-mix(in srgb, a pct%, b)`.
pub(super) fn mix(a: Color32, b: Color32, pct_a: f32) -> Color32 {
    b.lerp_to_gamma(a, pct_a / PCT)
}

/// `.clip-badge--*`: ink and fill of a list badge.
fn badge_colors(t: &Theme, kind: Kind) -> (Color32, Color32) {
    match kind {
        Kind::Kill => (t.accent_hi, t.accent_soft),
        Kind::Other => (t.muted, t.surface2),
        _ => (kind_color(t, kind), kind_color(t, kind).gamma_multiply(BADGE_FILL_PCT / PCT)),
    }
}

/// `.clip-check`: the hand-drawn check, accent when on.
pub(super) fn check_box(p: &egui::Painter, t: &Theme, b: Rect, on: bool, hovered: bool) {
    if on {
        p.rect_filled(b, CHECK_RADIUS, t.accent);
        let at = |k: usize| b.left_top() + vec2(CHECK_MARK[k][0], CHECK_MARK[k][1]) * b.width();
        p.line(vec![at(0), at(1), at(2)], Stroke::new(2.0, t.on_accent));
    } else {
        p.rect(b, CHECK_RADIUS, t.solid, Stroke::new(2.0, if hovered { t.accent } else { t.border }), StrokeKind::Inside);
    }
}

/// A count as 3.5 wrote it (`toLocaleString("en-US")`): 12,345.
fn grouped(n: f64) -> String {
    let digits = format!("{:.0}", n.abs());
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(GROUP) {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0.0 { format!("-{out}") } else { out }
}

/// No clip: why, in the engine's words (`explain_empty_result`), or that no preview ran yet.
fn empty(ui: &mut egui::Ui, t: &Theme, reason: Option<&EmptyReason>) -> Response {
    ui.centered_and_justified(|ui| {
        egui::Frame::new().fill(t.surface).stroke(Stroke::new(1.0, t.hair)).corner_radius(egui::CornerRadius::same(crate::CORNER_MID)).inner_margin(egui::Margin::symmetric(EMPTY_PAD[0], EMPTY_PAD[1])).show(ui, |ui| {
            ui.set_max_width(EMPTY_WIDTH);
            let Some(reason) = reason else {
                ui.label(egui::RichText::new(NO_PREVIEW).font(regular(FONT_BODY)).italics().color(t.muted));
                return;
            };
            ui.with_layout(Layout::top_down(Align::Min), |ui| {
                ui.label(egui::RichText::new(&reason.headline).font(semibold(FONT_BODY)).color(t.txt));
                ui.add_space(SP[1]);
                for (k, (label, count)) in reason.stages.iter().enumerate() {
                    ui.horizontal(|ui| {
                        ui.label(egui::RichText::new(format!("{}.", k + 1)).font(regular(FONT_SMALL)).color(t.faint));
                        ui.allocate_ui_with_layout(vec2(COUNT_WIDTH, 0.0), Layout::right_to_left(Align::Center), |ui| {
                            ui.label(egui::RichText::new(grouped(*count)).font(mono(FONT_SMALL)).color(t.txt));
                        });
                        ui.label(egui::RichText::new(label).font(regular(FONT_SMALL)).color(t.muted));
                    });
                }
                ui.add_space(SP[1]);
                ui.label(egui::RichText::new(&reason.hint).font(regular(FONT_BODY)).color(t.muted));
            });
        });
    })
    .response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_read_like_3_5() {
        assert_eq!(grouped(0.0), "0");
        assert_eq!(grouped(999.0), "999");
        assert_eq!(grouped(12345.0), "12,345");
        assert_eq!(grouped(1234567.0), "1,234,567");
    }

    /// The badge words come from `csdm-core`, which the shell's own glyph scan does not read.
    #[test]
    fn every_badge_symbol_has_a_glyph() {
        let ctx = egui::Context::default();
        crate::paint::install_fonts(&ctx);
        ctx.run_ui(egui::RawInput::default(), |_| {}).textures_delta.clear();
        let missing: Vec<String> = ["kill", "death", "damage_actor", "damage_target", "shot", "knife_swing"]
            .iter()
            .flat_map(|k| event_meta(k).0.chars().collect::<Vec<_>>())
            .filter(|c| !c.is_ascii() && !ctx.fonts_mut(|f| f.has_glyph(&semibold(FONT_SMALL), *c)))
            .map(|c| format!("{c} (U+{:04X})", c as u32))
            .collect();
        assert!(missing.is_empty(), "no glyph for: {missing:?}");
    }
}
