//! The EDITING inspector (3.5 `tabs/editing/ClipInspector.tsx`, `useClipCameras.ts`): one clip,
//! edited on its own.
//!
//! The clip is drawn with the Capture & Timing card's time axis, seconds relative to its first
//! kept event: the bar is painted by the camera spans the recording will follow, the two handles
//! set this clip's seconds before and after, and every event is a marker (a ghost once taken out).
//! Every change is an `Edit` on the preview list, never a setting: the edits travel with the
//! selection on GENERATE / SAVE.

use super::{check_box, Edit, SP};
use crate::link::Link;
use crate::paint::{mono, regular, semibold};
use crate::tabs::capture::timeline::{self as axis, Handle, Marker, Span, Timeline, Tone};
use crate::theme::Theme;
use crate::widgets::chip;
use csdm_core::editing::{event_meta, format_clock, CameraSpan, Lane, Preview, PreviewClip};
use csdm_core::ui_values::{EDITING_AXIS_MARGIN_S, FONT_SMALL};
use csdm_engine::Command;
use eframe::egui::{self, pos2, vec2, Align, Layout, Response, Sense, Stroke, StrokeKind};
use serde_json::Value;

const INCLUDE_TIP: &str = "Record this clip on GENERATE, or skip it";
const RESET_TIP: &str = "Put this clip back as the preview found it";
const NO_EVENT_LEFT: &str = "Every event is taken out: this clip will not be recorded";
const OVERLAP: &str = "This clip now overlaps another kept clip of the same demo: they will be recorded as one.";
const CHECK: f32 = 14.0;
const CHECK_GAP: f32 = 6.0;
/// `.edtl-insp-event`: padding, radius, the look of an event taken out.
const EVENT_PAD: [f32; 2] = [8.0, 2.0];
const EVENT_RADIUS: f32 = 9.0;
const EVENT_GAP: f32 = 5.0;
const OUT_ALPHA: f32 = 0.55;
const DASH: f32 = 3.0;
const FONT_EVENT: f32 = 10.5;

/// Who the camera follows in the open clip, as the run will record it (3.5 `useClipCameras`).
///
/// An unedited clip shows the spans its preview planned. Once edited, the engine plans them again
/// for the edited clip (`clip_cameras`); until the answer comes the preview's spans stay on screen.
#[derive(Default)]
pub struct Cameras {
    /// The entry the last question was asked for.
    asked: String,
    pending: Option<u64>,
    /// Questions overtaken by a newer edit: their answers are taken and dropped.
    stale: Vec<u64>,
    planned: Option<Vec<CameraSpan>>,
    /// The engine could not plan them: its sentence, shown under the axis.
    pub error: Option<String>,
}

impl Cameras {
    pub fn sync(&mut self, link: &mut Link, now: f64, active: Option<usize>) {
        self.stale.retain(|id| link.take_reply(*id).is_none());
        let entry = active.and_then(|i| link.state.preview.clips.get(i)).filter(|c| c.edited()).map(|c| c.entry().to_json());
        let Some(entry) = entry else {
            self.stale.extend(self.pending.take());
            (self.asked, self.planned, self.error) = (String::new(), None, None);
            return;
        };
        let key = entry.to_string();
        if key != self.asked {
            self.stale.extend(self.pending.take());
            (self.asked, self.planned, self.error) = (key, None, None);
            self.pending = Some(link.request(now, Command::ClipCameras { clip: entry }));
        }
        let Some(reply) = self.pending.and_then(|id| link.take_reply(id)) else { return };
        self.pending = None;
        match reply {
            Ok(v) => self.planned = Some(v.get("cameras").and_then(Value::as_array).map(|a| a.iter().map(CameraSpan::from_json).collect()).unwrap_or_default()),
            Err(e) => self.error = Some(e),
        }
    }

    pub fn planned(&self) -> Option<&[CameraSpan]> {
        self.planned.as_deref()
    }

    fn spans<'a>(&'a self, clip: &'a PreviewClip) -> &'a [CameraSpan] {
        self.planned.as_deref().filter(|_| clip.edited()).unwrap_or(&clip.cameras)
    }
}

/// Draws the inspector of clip `index`; returns whether it was closed.
pub fn show(ui: &mut egui::Ui, t: &Theme, preview: &Preview, index: usize, lane: &Lane, cameras: &Cameras, edits: &mut Vec<Edit>) -> bool {
    let clip = &preview.clips[index];
    let rate = preview.tickrate as f64;
    let win = clip.window(preview.tickrate);
    let clock = |tick: i64| format_clock(tick as f64 / rate);
    let mut close = false;
    let frame = egui::Frame::new().fill(t.solid).stroke(Stroke::new(1.0, t.hair)).corner_radius(egui::CornerRadius::same(crate::CORNER_MID)).inner_margin(egui::Margin::same(SP[1] as i8));
    frame.show(ui, |ui| {
        ui.spacing_mut().item_spacing.y = SP[1];
        // Bounded to its content: a right-to-left row would otherwise take the pane's height.
        ui.allocate_ui_with_layout(vec2(ui.available_width(), 0.0), Layout::right_to_left(Align::Center), |ui| {
            if chip(ui, t, "✕", None, Some("Close the inspector"), true).on_hover_text("Close").clicked() {
                close = true;
            }
            if chip(ui, t, "Reset", None, None, clip.edited()).on_hover_text(RESET_TIP).clicked() {
                edits.push(Edit::Reset(index));
            }
            let when = match &win {
                Some(w) => format!("{} → {} · {:.1} s", clock(w.start_tick), clock(w.end_tick), w.duration_s),
                None => NO_EVENT_LEFT.to_string(),
            };
            ui.label(egui::RichText::new(when).font(mono(FONT_SMALL)).color(t.txt));
            ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
                if include(ui, t, clip.selected).on_hover_text(INCLUDE_TIP).clicked() {
                    edits.push(Edit::Toggle(index));
                }
                let mut job = egui::text::LayoutJob::default();
                let fmt = |strong: bool| egui::TextFormat { font_id: if strong { semibold(FONT_SMALL) } else { regular(FONT_SMALL) }, color: if strong { t.txt } else { t.muted }, ..Default::default() };
                job.append(&lane.name, 0.0, fmt(true));
                let position = lane.indices.iter().position(|&i| i == index).map_or(0, |k| k + 1);
                job.append(&format!(" · clip {position} of {}", lane.indices.len()), 0.0, fmt(false));
                ui.add(egui::Label::new(job).truncate());
            });
        });

        if let Some(w) = &win {
            // Axis origin: the first kept event.
            let origin = w.kept.first().map_or(clip.start_tick, |&i| clip.events[i].tick);
            let rel = |tick: i64| (tick - origin) as f64 / rate;
            let (start_at, end_at) = (rel(w.start_tick), rel(w.end_tick));
            let last_kept_at = w.kept.last().map_or(0.0, |&i| rel(clip.events[i].tick));
            let markers: Vec<Marker> = clip.events.iter().map(|e| Marker { at: rel(e.tick), label: event_meta(&e.kind).0.split(' ').next().unwrap_or_default().to_string(), ghost: clip.is_excluded(&e.key) }).collect();
            let first_event_at = markers.iter().map(|m| m.at).fold(0.0, f64::min);
            let last_event_at = markers.iter().map(|m| m.at).fold(0.0, f64::max);
            let handle = |id, at, label: &str, readout: String, value: f64, tip: &str| Handle { id, at, alt: false, label: label.into(), readout, value, tip: tip.into() };
            let tl = Timeline {
                spans: camera_spans(cameras.spans(clip), w.start_tick, w.end_tick, &rel),
                handles: vec![
                    handle("start", start_at, "Seconds before this clip's first event", format!("-{}s", w.lead_s.round()), w.lead_s.round(), "Drag to change how early this clip starts"),
                    handle("end", end_at, "Seconds after this clip's last event", format!("+{}s", w.tail_s.round()), w.tail_s.round(), "Drag to change how late this clip ends"),
                ],
                markers,
                extent: ((start_at.min(first_event_at) - EDITING_AXIS_MARGIN_S).floor(), (end_at.max(last_event_at) + EDITING_AXIS_MARGIN_S).ceil()),
                ..Default::default()
            };
            match axis::show(ui, t, "editing-clip", &tl, "This clip, around its events") {
                Some((0, at)) => edits.push(Edit::Before(index, (-at).round() as i64)),
                Some((_, at)) => edits.push(Edit::After(index, (at - last_kept_at).round() as i64)),
                None => {}
            }
        }

        if let Some(e) = &cameras.error {
            ui.label(egui::RichText::new(format!("The camera plan of this edited clip could not be read: {e}")).font(regular(FONT_SMALL)).color(t.amber));
        }
        if preview.overlaps_another(lane, index) {
            ui.label(egui::RichText::new(OVERLAP).font(regular(FONT_SMALL)).color(t.accent));
        }

        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = vec2(SP[0], SP[0]);
            for (n, e) in clip.events.iter().enumerate() {
                let out = clip.is_excluded(&e.key);
                if event_chip(ui, t, &event_meta(&e.kind).0, &clock(e.tick), out, n + 1).clicked() {
                    edits.push(Edit::Event(index, e.key.clone()));
                }
            }
        });
    });
    close
}

/// The camera spans of the edited clip, cut to its edges: the first and last span stretch to the
/// new edges (the recording holds its target), one colour per change of player.
fn camera_spans(cameras: &[CameraSpan], start: i64, end: i64, rel: &dyn Fn(i64) -> f64) -> Vec<Span> {
    let inside: Vec<&CameraSpan> = cameras.iter().filter(|c| c.to_tick > start && c.from_tick < end).collect();
    if inside.is_empty() {
        return vec![Span { from: rel(start), to: rel(end), tone: Tone::Primary, label: String::new(), small: String::new() }];
    }
    let last = inside.len() - 1;
    inside
        .iter()
        .enumerate()
        .map(|(i, c)| Span {
            from: rel(if i == 0 { start } else { c.from_tick }),
            to: rel(if i == last { end } else { c.to_tick }),
            tone: if i % 2 == 0 { Tone::Primary } else { Tone::Alt },
            label: format!("cam {}", [&c.name, &c.steam_id].into_iter().find(|s| !s.is_empty()).map_or("?", String::as_str)),
            small: String::new(),
        })
        .collect()
}

/// `.edtl-insp-include`: the check and its word.
fn include(ui: &mut egui::Ui, t: &Theme, on: bool) -> Response {
    let g = ui.painter().layout_no_wrap("Include".into(), semibold(FONT_SMALL), t.txt);
    let (rect, resp) = ui.allocate_exact_size(vec2(CHECK + CHECK_GAP + g.size().x, g.size().y.max(CHECK)), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, on, "Include"));
    check_box(ui.painter(), t, egui::Rect::from_min_size(pos2(rect.left(), rect.center().y - CHECK / 2.0), vec2(CHECK, CHECK)), on, resp.hovered());
    ui.painter().galley(pos2(rect.left() + CHECK + CHECK_GAP, rect.center().y - g.size().y / 2.0), g, t.txt);
    resp
}

/// `.edtl-insp-event`: one event of the clip; a click takes it out or puts it back.
fn event_chip(ui: &mut egui::Ui, t: &Theme, label: &str, clock: &str, out: bool, nth: usize) -> Response {
    let fade = |c: egui::Color32| if out { c.gamma_multiply(OUT_ALPHA) } else { c };
    let words = ui.painter().layout_no_wrap(label.to_string(), regular(FONT_EVENT), fade(t.txt));
    let time = ui.painter().layout_no_wrap(clock.to_string(), mono(FONT_EVENT), fade(t.muted));
    let size = vec2(words.size().x + EVENT_GAP + time.size().x + EVENT_PAD[0] * 2.0, words.size().y.max(time.size().y) + EVENT_PAD[1] * 2.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    let name = format!("Event {nth}: {label} {clock}");
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, true, !out, &name));
    if resp.hovered() {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    let p = ui.painter();
    let edge = Stroke::new(1.0, if resp.hovered() { t.accent } else { t.hair });
    if out {
        p.rect_filled(rect, EVENT_RADIUS, t.solid);
        p.add(egui::Shape::dashed_line(&[rect.left_top(), rect.right_top(), rect.right_bottom(), rect.left_bottom(), rect.left_top()], edge, DASH, DASH));
    } else {
        p.rect(rect, EVENT_RADIUS, t.solid, edge, StrokeKind::Inside);
    }
    let left = rect.left() + EVENT_PAD[0];
    let (words_width, words_height, time_height) = (words.size().x, words.size().y, time.size().y);
    p.galley(pos2(left, rect.center().y - words_height / 2.0), words, t.txt);
    p.galley(pos2(left + words_width + EVENT_GAP, rect.center().y - time_height / 2.0), time, t.muted);
    if out {
        p.hline(left..=rect.right() - EVENT_PAD[0], rect.center().y, Stroke::new(1.0, fade(t.txt)));
    }
    resp.on_hover_text(if out { "Put this event back in the clip" } else { "Take this event out of the clip" })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cam(from: i64, to: i64, name: &str, steam_id: &str) -> CameraSpan {
        CameraSpan { from_tick: from, to_tick: to, steam_id: steam_id.into(), name: name.into() }
    }

    #[test]
    fn camera_spans_are_cut_to_the_edited_clip() {
        let rel = |tick: i64| tick as f64;
        let none = camera_spans(&[], 10, 50, &rel);
        assert_eq!((none.len(), none[0].from, none[0].to, none[0].label.as_str()), (1, 10.0, 50.0, ""));
        // The first and last span stretch to the clip's edges; a span outside it is dropped.
        let cams = [cam(0, 5, "Gone", "1"), cam(12, 30, "Me", "2"), cam(30, 44, "", "765"), cam(44, 48, "", "")];
        let spans = camera_spans(&cams, 10, 50, &rel);
        assert_eq!(spans.iter().map(|s| (s.from, s.to, s.label.as_str(), s.tone)).collect::<Vec<_>>(), vec![(10.0, 30.0, "cam Me", Tone::Primary), (30.0, 44.0, "cam 765", Tone::Alt), (44.0, 50.0, "cam ?", Tone::Primary)]);
    }
}
