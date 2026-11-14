//! The CAPTURE cards' small controls, V12 look (3.5 `Segmented` + `.seg`, `ToggleGroup` +
//! `.cs-mseg`, `.pc-kick`, framed groups, `Field`): each control that writes a setting records its
//! key (`mark`), so the coverage guard measures what is really on screen, as 3.5's did.

use crate::grid::CardCx;
use crate::paint::{regular, semibold};
use crate::theme::Theme;
use eframe::egui::{self, pos2, vec2, Color32, Rect, Response, Sense, Stroke, StrokeKind};
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// `.seg` / `.cs-mseg` trays and their options.
const TRAY_PAD: f32 = 3.0;
const TRAY_GAP: f32 = 2.0;
const TRAY_RADIUS: f32 = 10.0;
const SEG_PAD: [f32; 2] = [12.0, 6.0];
const MSEG_PAD: [f32; 2] = [8.0, 5.0];
const OPT_RADIUS: f32 = 8.0;
const MSEG_BOX: f32 = 6.0;
const MSEG_BOX_GAP: f32 = 6.0;
const FONT_SEG: f32 = 11.5;
const DOT: f32 = 4.0;
/// `.cs-mseg` tray: hair at 55 %; the disabled option at 45 %.
const TRAY_HAIR_ALPHA: f32 = 0.55;
const DISABLED_ALPHA: f32 = 0.45;
const SHADOW_ALPHA: f32 = 0.16;
/// `.pc-kick`-like kicker: small upper-case, tracked.
const FONT_KICK: f32 = 10.0;
const KICK_SPACING: f32 = 0.12;
/// Framed group (`.pc-lineup`, `.tr-lane`, `.cf-matrix`): corner, padding.
const FRAME_RADIUS: f32 = 14.0;
const FRAME_PAD: f32 = 10.0;
/// `.fld` height.
pub const FIELD_W: f32 = 64.0;

/// Keys written by a control drawn this frame (the coverage guard reads them back).
#[derive(Clone, Default)]
pub struct Seen(pub BTreeSet<String>);

pub fn seen_id() -> egui::Id {
    egui::Id::unique("capture-seen-keys")
}

/// Records that a control for `key` is on screen.
pub fn mark(ui: &egui::Ui, key: &str) {
    ui.ctx().data_mut(|d| {
        d.get_temp_mut_or_default::<Seen>(seen_id()).0.insert(key.to_string());
    });
}

pub fn kick(ui: &mut egui::Ui, t: &Theme, text: &str) -> Response {
    ui.label(egui::RichText::new(text.to_uppercase()).font(semibold(FONT_KICK)).color(t.accent).extra_letter_spacing(KICK_SPACING * FONT_KICK))
}

/// Small grey words (`.lab`, `.capture-hint`).
pub fn lab(ui: &mut egui::Ui, t: &Theme, text: &str) -> Response {
    ui.label(egui::RichText::new(text).font(regular(FONT_SEG)).color(t.muted))
}

pub fn hint(ui: &mut egui::Ui, t: &Theme, text: &str) -> Response {
    ui.add(egui::Label::new(egui::RichText::new(text).font(regular(FONT_SEG)).color(t.muted).italics()).wrap())
}

/// A framed group: a soft solid plate with a hairline.
pub fn framed<R>(ui: &mut egui::Ui, t: &Theme, add: impl FnOnce(&mut egui::Ui) -> R) -> R {
    egui::Frame::new()
        .fill(t.solid.gamma_multiply(TRAY_HAIR_ALPHA))
        .stroke(Stroke::new(1.0, t.hair))
        .corner_radius(egui::CornerRadius::same(FRAME_RADIUS as u8))
        .inner_margin(egui::Margin::same(FRAME_PAD as i8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            add(ui)
        })
        .inner
}

fn tray(ui: &egui::Ui, t: &Theme, r: Rect, hair_alpha: f32) {
    ui.painter().rect(r, TRAY_RADIUS, t.hair.gamma_multiply(hair_alpha).blend(t.surface2.gamma_multiply(hair_alpha)), Stroke::new(1.0, t.hair), StrokeKind::Inside);
}

/// One option of a tray: (visible words, lit, disabled, accessible name, dot colour).
struct Opt<'a> {
    text: &'a str,
    on: bool,
    disabled: bool,
    name: String,
    dot: Option<Color32>,
    tip: &'a str,
}

/// Lays out a tray of options; returns the index clicked. `radio`: one-of-N (`.seg`), else
/// independent checks (`.cs-mseg`).
fn options_tray(ui: &mut egui::Ui, t: &Theme, opts: &[Opt], radio: bool) -> Option<usize> {
    let pad = if radio { SEG_PAD } else { MSEG_PAD };
    let font = semibold(FONT_SEG);
    let galleys: Vec<_> = opts.iter().map(|o| ui.painter().layout_no_wrap(o.text.to_string(), font.clone(), t.muted)).collect();
    let lead = |o: &Opt| if !radio { MSEG_BOX + MSEG_BOX_GAP } else if o.dot.is_some() { DOT * 2.0 + MSEG_BOX_GAP } else { 0.0 };
    let widths: Vec<f32> = opts.iter().zip(&galleys).map(|(o, g)| g.size().x + pad[0] * 2.0 + lead(o)).collect();
    let h = galleys.first().map_or(0.0, |g| g.size().y) + pad[1] * 2.0;
    let total = widths.iter().sum::<f32>() + TRAY_GAP * (opts.len().saturating_sub(1)) as f32 + TRAY_PAD * 2.0;
    let (rect, _) = ui.allocate_exact_size(vec2(total, h + TRAY_PAD * 2.0), Sense::hover());
    tray(ui, t, rect, if radio { 1.0 } else { TRAY_HAIR_ALPHA });
    let mut x = rect.left() + TRAY_PAD;
    let mut clicked = None;
    for (i, (o, g)) in opts.iter().zip(galleys).enumerate() {
        let r = Rect::from_min_size(pos2(x, rect.top() + TRAY_PAD), vec2(widths[i], h));
        x += widths[i] + TRAY_GAP;
        let id = ui.scope_id().with(("opt", &o.name));
        let resp = ui.interact(r, id, if o.disabled { Sense::hover() } else { Sense::click() });
        let name = o.name.clone();
        let (on, enabled) = (o.on, !o.disabled);
        resp.widget_info(|| egui::WidgetInfo::selected(if radio { egui::Role::RadioButton } else { egui::Role::CheckBox }, enabled, on, &name));
        let resp = if o.tip.is_empty() { resp } else { resp.on_hover_text(o.tip) };
        if resp.clicked() && !o.disabled {
            clicked = Some(i);
        }
        if resp.hovered() && !o.disabled {
            crate::cursor::snap_here(ui.ctx(), r);
        }
        let p = ui.painter();
        let ink = match (radio, o.on) {
            (true, true) => t.accent,
            (false, true) => t.lime_ink,
            _ => t.muted,
        };
        let ink = if o.disabled { ink.gamma_multiply(DISABLED_ALPHA) } else { ink };
        if o.on {
            if radio {
                p.rect_filled(r.translate(vec2(0.0, 2.0)), OPT_RADIUS, Color32::BLACK.gamma_multiply(SHADOW_ALPHA / 2.0));
                p.rect_filled(r, OPT_RADIUS, t.solid);
            } else {
                p.rect(r, OPT_RADIUS, t.lime, Stroke::new(1.0, t.lime_glow), StrokeKind::Inside);
            }
        } else if resp.hovered() && !o.disabled {
            p.rect_filled(r, OPT_RADIUS, t.solid.gamma_multiply(TRAY_HAIR_ALPHA));
        }
        let mut tx = r.left() + pad[0];
        if !radio {
            let b = Rect::from_center_size(pos2(tx + MSEG_BOX / 2.0, r.center().y), vec2(MSEG_BOX, MSEG_BOX));
            if o.on {
                p.rect_filled(b, 2.0, t.lime_ink);
            } else {
                p.rect_stroke(b, 2.0, Stroke::new(1.0, ink.gamma_multiply(TRAY_HAIR_ALPHA)), StrokeKind::Middle);
            }
            tx += MSEG_BOX + MSEG_BOX_GAP;
        } else if let Some(c) = o.dot {
            p.circle_filled(pos2(tx + DOT, r.center().y), DOT, c);
            tx += DOT * 2.0 + MSEG_BOX_GAP;
        }
        p.galley(pos2(tx, r.center().y - g.size().y / 2.0), g, ink);
    }
    clicked
}

/// `Segmented`: one value out of N. Accessible names are "`name`: `option`".
#[allow(clippy::too_many_arguments)]
pub fn seg(ui: &mut egui::Ui, t: &Theme, name: &str, options: &[&str], current: &str, disabled: bool, tip: &str, dots: Option<&[Color32]>) -> Option<String> {
    let opts: Vec<Opt> = options
        .iter()
        .enumerate()
        .map(|(i, o)| Opt { text: o, on: *o == current, disabled, name: format!("{name}: {o}"), dot: dots.and_then(|d| d.get(i).copied()), tip })
        .collect();
    options_tray(ui, t, &opts, true).filter(|i| options[*i] != current).map(|i| options[i].to_string())
}

/// One independent on/off setting of a `ToggleGroup`.
pub struct Toggle<'a> {
    pub key: &'a str,
    pub label: &'a str,
    pub on: bool,
    pub disabled: bool,
    pub tip: &'a str,
}

/// `ToggleGroup`: several settings sharing one tray; returns the index clicked.
pub fn mseg(ui: &mut egui::Ui, t: &Theme, toggles: &[Toggle]) -> Option<usize> {
    for tg in toggles {
        mark(ui, tg.key);
    }
    let opts: Vec<Opt> = toggles.iter().map(|tg| Opt { text: tg.label, on: tg.on, disabled: tg.disabled, name: tg.label.to_string(), dot: None, tip: tg.tip }).collect();
    options_tray(ui, t, &opts, false)
}

/// A chip that flips one boolean setting.
pub fn toggle_chip(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, label: &str, tip: &str) -> bool {
    mark(ui, key);
    let on = cx.link.get(key).and_then(Value::as_bool).unwrap_or(false);
    let r = crate::widgets::chip(ui, cx.theme, label, Some(on), Some(label), true);
    let clicked = crate::widgets::tip(ui, cx.theme, r, tip, false).clicked();
    if clicked {
        cx.link.set(cx.now, key, json!(!on));
    }
    clicked
}

/// A plain button chip.
pub fn button(ui: &mut egui::Ui, t: &Theme, text: &str, name: &str, tip: &str, enabled: bool) -> bool {
    crate::widgets::chip(ui, t, text, None, Some(name), enabled).on_hover_text(tip).clicked()
}

/// The text a setting shows in a box: an empty value shows `fallback` (`asText`).
pub fn as_text(v: Option<&Value>, fallback: &Value) -> String {
    let shown = match v {
        None | Some(Value::Null) => fallback,
        Some(Value::String(s)) if s.is_empty() => fallback,
        Some(v) => v,
    };
    match shown {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// A number setting in a small box. A typed value that is not a number is not stored.
pub fn number_field(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, fallback: &Value, width: f32, tip: &str) -> Response {
    mark(ui, key);
    let id = ui.scope_id().with(("num", key));
    let shown = as_text(cx.link.get(key), fallback);
    let mut text: String = ui.data(|d| d.get_temp(id)).unwrap_or(shown);
    let r = ui.add(egui::TextEdit::singleline(&mut text).desired_width(width).font(crate::paint::mono(FONT_SEG)));
    let n = name.to_string();
    r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, &n));
    if r.changed() {
        if let Ok(v) = text.trim().parse::<f64>() {
            let value = if v.fract() == 0.0 { json!(v as i64) } else { json!(v) };
            cx.link.set(cx.now, key, value);
        }
    }
    if r.has_focus() || r.changed() {
        ui.data_mut(|d| d.insert_temp(id, text));
    } else {
        ui.data_mut(|d| d.remove::<String>(id));
    }
    r.on_hover_text(tip)
}

/// A text setting in a box.
pub fn text_field(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, hint_text: &str, width: f32, tip: &str) -> Response {
    mark(ui, key);
    let mut value = match cx.link.get(key) {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    let r = ui.add(egui::TextEdit::singleline(&mut value).hint_text(hint_text).desired_width(width));
    let n = name.to_string();
    r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, &n));
    if r.changed() {
        cx.link.set(cx.now, key, json!(value));
    }
    r.on_hover_text(tip)
}

/// Reads a boolean setting, `fallback` when absent or not a boolean.
pub fn flag(cx: &CardCx, key: &str, fallback: bool) -> bool {
    cx.link.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

pub fn text(cx: &CardCx, key: &str) -> String {
    match cx.link.get(key) {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

pub fn list(cx: &CardCx, key: &str) -> Vec<String> {
    cx.link.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default()
}

pub fn set_list(cx: &mut CardCx, key: &str, items: &[String]) {
    cx.link.set(cx.now, key, json!(items));
}

pub fn default_of(key: &str) -> Value {
    csdm_core::settings::reference().settings.iter().find(|d| d.key == key).map(|d| d.default.clone()).unwrap_or(Value::Null)
}
