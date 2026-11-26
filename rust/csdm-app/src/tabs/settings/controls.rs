//! The SETTINGS cards' controls: a setting's text box, path box with Browse, switch, segmented
//! choice, number box, slider, and the small words around them (3.5 `Field`, `PathField`,
//! `ToggleSwitch`, `Segmented`, `Slider`, `.sx-kick`, `.settings-hint`).

use crate::grid::CardCx;
use crate::paint::{regular, semibold};
use crate::theme::Theme;
use crate::widgets::{chip, tip};
use csdm_core::ui_values::{CHIP_PAD, FONT_BODY, FONT_CHIP, FONT_SMALL, SETTINGS_FIELD_WIDTH, SETTINGS_LABEL_WIDTH, SETTINGS_PATH_LABEL_WIDTH};
use eframe::egui::{self, Response, Vec2};
use serde_json::{json, Value};

/// `.sx-kick`: tracked uppercase words over a group.
const KICK_SPACING: f32 = 0.14;
const DECIMAL_BASE: f64 = 10.0;

/// Which native picker a Browse opens.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PickKind { File, Folder }

/// Opens a native picker; `None` = cancelled. Tests give their own.
pub type Picker = Box<dyn FnMut(PickKind) -> Option<String>>;

/// The native pickers (3.5 `pickPath` → Electron `dialog.showOpenDialog`).
pub fn native_picker() -> Picker {
    Box::new(|kind| {
        let d = rfd::FileDialog::new();
        let picked = match kind {
            PickKind::File => d.pick_file(),
            PickKind::Folder => d.pick_folder(),
        };
        picked.map(|p| p.to_string_lossy().into_owned())
    })
}

pub fn text_of(cx: &CardCx, key: &str) -> String {
    match cx.link.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(v) => v.to_string(),
    }
}

pub fn bool_of(cx: &CardCx, key: &str) -> bool {
    cx.link.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub fn num_of(cx: &CardCx, key: &str, fallback: f64) -> f64 {
    match cx.link.get(key) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(fallback),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(fallback),
        _ => fallback,
    }
}

pub fn kick(ui: &mut egui::Ui, t: &Theme, text: &str) {
    let size = FONT_SMALL;
    ui.label(egui::RichText::new(text.to_uppercase()).font(semibold(size)).color(t.faint).extra_letter_spacing(KICK_SPACING * size));
}

/// `.settings-hint`: an explanation that is always written, wrapped.
pub fn hint(ui: &mut egui::Ui, t: &Theme, text: &str) {
    ui.add(egui::Label::new(egui::RichText::new(text).font(regular(FONT_SMALL)).color(t.muted)).wrap());
}

/// The field's label, fixed width and left-aligned so the boxes of a card line up.
fn label_w(ui: &mut egui::Ui, t: &Theme, text: &str, width: f32) -> Response {
    let size = Vec2::new(width, ui.spacing().interact_size.y);
    ui.allocate_ui_with_layout(size, egui::Layout::left_to_right(egui::Align::Center), |ui| {
        ui.set_min_width(width);
        ui.add(egui::Label::new(egui::RichText::new(text).font(regular(FONT_BODY)).color(t.muted)).truncate())
    })
    .inner
}

fn label(ui: &mut egui::Ui, t: &Theme, text: &str) -> Response {
    label_w(ui, t, text, SETTINGS_LABEL_WIDTH)
}

/// A text setting's box. `hint_text` says what an empty value means. Returns whether it changed.
pub fn text_box(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, hint_text: &str, tip_text: &str, password: bool) -> bool {
    text_box_w(ui, cx, key, name, SETTINGS_LABEL_WIDTH, hint_text, tip_text, password)
}

/// `text_box` with a custom label column width (e.g. inside the compact PostgreSQL nodes).
#[allow(clippy::too_many_arguments)]
pub fn text_box_w(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, label_width: f32, hint_text: &str, tip_text: &str, password: bool) -> bool {
    let mut value = text_of(cx, key);
    let mut changed = false;
    ui.horizontal(|ui| {
        let l = label_w(ui, cx.theme, name, label_width);
        let edit = egui::TextEdit::singleline(&mut value).password(password).hint_text(hint_text).desired_width(SETTINGS_FIELD_WIDTH.min(ui.available_width()));
        let r = ui.add(edit).labelled_by(l.id);
        changed = r.changed();
        tip(ui, cx.theme, r, tip_text, false);
    });
    if cx.always_tips {
        hint(ui, cx.theme, tip_text);
    }
    if changed {
        cx.link.set(cx.now, key, json!(value));
    }
    changed
}

/// A path setting: its box and a Browse that opens the native picker (Cancel keeps the typed value).
#[allow(clippy::too_many_arguments)]
pub fn path_box(ui: &mut egui::Ui, cx: &mut CardCx, picker: &mut Picker, key: &str, name: &str, hint_text: &str, tip_text: &str, kind: PickKind) {
    let mut value = text_of(cx, key);
    let mut browse = false;
    let mut changed = false;
    // 3.5.1 Paths: the field's title above its box, Browse at the box's end.
    let l = ui.label(egui::RichText::new(name).font(semibold(FONT_SMALL)).color(cx.theme.txt));
    ui.horizontal(|ui| {
        let browse_w = ui.painter().layout_no_wrap("Browse…".into(), regular(FONT_CHIP), cx.theme.muted).size().x + CHIP_PAD[0] * 2.0 + ui.spacing().item_spacing.x;
        let width = (ui.available_width() - browse_w).max(SETTINGS_PATH_LABEL_WIDTH);
        let r = ui.add(egui::TextEdit::singleline(&mut value).hint_text(hint_text).desired_width(width)).labelled_by(l.id);
        changed = r.changed();
        tip(ui, cx.theme, r, tip_text, false);
        let what = if kind == PickKind::File { "Opens a native file picker" } else { "Opens a native folder picker" };
        browse = chip(ui, cx.theme, "Browse…", None, Some(&format!("Browse for {name}")), true).on_hover_text(what).clicked();
    });
    if cx.always_tips {
        hint(ui, cx.theme, tip_text);
    }
    if browse {
        if let Some(p) = picker(kind) {
            value = p;
            changed = true;
        }
    }
    if changed {
        cx.link.set(cx.now, key, json!(value));
    }
}

/// `ToggleSwitch` (`.cs-switch`, the shared one) bound to a boolean setting.
pub fn switch(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, tip_text: &str) {
    let on = bool_of(cx, key);
    let t = cx.theme;
    let r = crate::controls::switch(ui, t, name, on);
    let r = tip(ui, t, r, tip_text, cx.always_tips);
    if r.clicked() {
        cx.link.set(cx.now, key, json!(!on));
    }
}

/// `Segmented` (`.seg`, the shared tray): the current option lit. Returns the option clicked.
/// Each option is named "`name`: `option`".
pub fn segmented(ui: &mut egui::Ui, t: &Theme, name: &str, options: &[&str], current: &str, tip_text: &str, always: bool) -> Option<String> {
    use crate::controls::{options_tray, Opt};
    let mut picked = None;
    ui.horizontal_wrapped(|ui| {
        label(ui, t, name);
        let opts: Vec<Opt> = options.iter().map(|o| Opt { text: o, on: *o == current, disabled: false, name: format!("{name}: {o}"), dot: None, tip: tip_text }).collect();
        if let Some(k) = options_tray(ui, t, &opts, true) {
            if options[k] != current {
                picked = Some(options[k].to_string());
            }
        }
    });
    if always {
        hint(ui, t, tip_text);
    }
    picked
}

/// A whole-number setting typed in a box; a value that is not a number is not stored.
pub fn number_box(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, fallback: f64, tip_text: &str) {
    decimal_box(ui, cx, key, name, fallback, 0, tip_text);
}

/// `number_box` keeping `decimals` places (0 = stored as a whole number, as 3.5 `toStoredNumber`).
pub fn decimal_box(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, fallback: f64, decimals: i32, tip_text: &str) {
    let shown = num_of(cx, key, fallback);
    let id = ui.scope_id().with(("num", key));
    let mut text: String = ui.data(|d| d.get_temp(id)).unwrap_or_else(|| format!("{shown}"));
    let mut commit = None;
    ui.horizontal(|ui| {
        let l = label(ui, cx.theme, name);
        let r = ui.add(egui::TextEdit::singleline(&mut text).desired_width(SETTINGS_LABEL_WIDTH)).labelled_by(l.id);
        if r.changed() {
            commit = text.trim().parse::<f64>().ok().filter(|v| v.is_finite());
        }
        if r.has_focus() || r.changed() {
            ui.data_mut(|d| d.insert_temp(id, text.clone()));
        } else {
            ui.data_mut(|d| d.remove::<String>(id));
        }
        tip(ui, cx.theme, r, tip_text, false);
    });
    if cx.always_tips {
        hint(ui, cx.theme, tip_text);
    }
    if let Some(v) = commit {
        cx.link.set(cx.now, key, stored_number(v, decimals));
    }
}

/// A number rounded to `decimals` places; whole numbers are stored without a fraction.
pub fn stored_number(v: f64, decimals: i32) -> Value {
    if decimals <= 0 {
        return json!(v.round() as i64);
    }
    let p = DECIMAL_BASE.powi(decimals);
    json!((v * p).round() / p)
}

/// `Slider` over whole numbers with its readout.
#[allow(clippy::too_many_arguments)]
pub fn slider(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, range: [i64; 2], step: i64, fallback: f64, unit: &str, tip_text: &str) {
    let mut v = (num_of(cx, key, fallback).round() as i64).clamp(range[0], range[1]);
    let before = v;
    ui.horizontal(|ui| {
        let l = label(ui, cx.theme, name);
        let s = egui::Slider::new(&mut v, range[0]..=range[1]).step_by(step as f64).suffix(unit);
        let r = ui.add(s).labelled_by(l.id);
        tip(ui, cx.theme, r, tip_text, false);
    });
    if cx.always_tips {
        hint(ui, cx.theme, tip_text);
    }
    if v != before {
        cx.link.set(cx.now, key, json!(v));
    }
}

/// A chip button with its explanation.
pub fn action(ui: &mut egui::Ui, t: &Theme, text: &str, tip_text: &str, enabled: bool) -> bool {
    chip(ui, t, text, None, Some(text), enabled).on_hover_text(tip_text).clicked()
}
