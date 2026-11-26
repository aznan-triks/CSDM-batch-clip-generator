//! The CAPTURE cards' small controls, V12 look (3.5 `Segmented` + `.seg`, `ToggleGroup` +
//! `.cs-mseg`, `.pc-kick`, framed groups, `Field`): each control that writes a setting records its
//! key (`mark`), so the coverage guard measures what is really on screen, as 3.5's did.

use crate::grid::CardCx;
use crate::paint::{regular, semibold};
use crate::theme::Theme;
pub use crate::controls::{mark, seen_id, Seen, FONT_SEG};
use crate::controls::{options_tray, Opt, TRAY_HAIR_ALPHA};
use eframe::egui::{self, Color32, Response, Stroke};
use serde_json::{json, Value};

/// `.pc-kick`-like kicker: small upper-case, tracked.
const FONT_KICK: f32 = 10.0;
const KICK_SPACING: f32 = 0.12;
/// Framed group (`.pc-lineup`, `.tr-lane`, `.cf-matrix`): corner, padding.
const FRAME_RADIUS: f32 = 14.0;
const FRAME_PAD: f32 = 10.0;
/// `.fld` height.
pub const FIELD_W: f32 = 64.0;

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
