//! The VIDEO cards' pieces beyond the shared SETTINGS controls: shortcut values, codec list, the
//! words around a value. Each control that writes a setting records its key (`mark`), so the
//! coverage guard measures what is really on screen, as 3.5's did.

use crate::grid::CardCx;
use crate::paint::{mono, regular};
use crate::tabs::settings::controls::{num_of, stored_number, text_of};
use crate::theme::Theme;
use crate::widgets::{chip, tip};
use csdm_core::ui_values::{FONT_BODY, FONT_SMALL, SETTINGS_FIELD_WIDTH, SETTINGS_LABEL_WIDTH};
use eframe::egui;
use serde_json::json;

pub use crate::controls::{mark, seen_id, Seen};

/// The key's default from the settings table: the value shown while it is unset or not a number.
pub fn fallback(key: &str) -> f64 {
    csdm_core::settings::def(key).and_then(|d| d.default.as_f64()).unwrap_or_default()
}

pub fn num(cx: &CardCx, key: &str) -> f64 {
    num_of(cx, key, fallback(key))
}

/// A number as 3.5 wrote it: `1920`, `0.5`.
pub fn shown(v: f64) -> String {
    format!("{v}")
}

/// The shortcut values beside a number (3.5 `QuickChips`, the CS2 Effects ruler): one chip each,
/// the current value lit.
pub fn quick(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, values: &[f64], decimals: i32) {
    let current = num(cx, key);
    let mut picked = None;
    ui.horizontal_wrapped(|ui| {
        ui.add_space(SETTINGS_LABEL_WIDTH + ui.spacing().item_spacing.x);
        for &q in values {
            let r = chip(ui, cx.theme, &shown(q), Some(q == current), Some(&format!("{name} {}", shown(q))), true);
            if r.on_hover_text(format!("Set {name} to {}", shown(q))).clicked() {
                picked = Some(q);
            }
        }
    });
    if let Some(q) = picked {
        cx.link.set(cx.now, key, stored_number(q, decimals));
    }
}

/// A codec list (3.5 `CodecSelect`): the table's codecs, and the stored one first when the table
/// does not hold it, so the box never shows another codec than the one the run will use.
pub fn codec(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, table: &[String], tip_text: &str) {
    let value = text_of(cx, key);
    let mut options: Vec<String> = table.to_vec();
    if !value.is_empty() && !options.contains(&value) {
        options.insert(0, value.clone());
    }
    let mut picked = None;
    ui.horizontal(|ui| {
        let l = ui.add_sized([SETTINGS_LABEL_WIDTH, ui.spacing().interact_size.y], egui::Label::new(egui::RichText::new(name).font(regular(FONT_BODY)).color(cx.theme.muted)));
        let r = egui::ComboBox::from_id_salt(("video-codec", key))
            .selected_text(egui::RichText::new(&value).font(mono(FONT_BODY)))
            .width(SETTINGS_FIELD_WIDTH.min(ui.available_width()))
            // Every codec in view, as 3.5's native `<select>` showed them (no scrolled-away entry).
            .height(ui.ctx().content_rect().height())
            .show_ui(ui, |ui| {
                for o in &options {
                    if ui.selectable_label(*o == value, egui::RichText::new(o).font(mono(FONT_BODY))).clicked() && *o != value {
                        picked = Some(o.clone());
                    }
                }
            });
        let r = r.response.labelled_by(l.id);
        tip(ui, cx.theme, r, tip_text, false);
    });
    mark(ui, key);
    if let Some(c) = picked {
        cx.link.set(cx.now, key, json!(c));
    }
}

/// A short readout beside a value: the words a number means ("visually lossless").
pub fn note(ui: &mut egui::Ui, t: &Theme, text: &str) {
    ui.label(egui::RichText::new(text).font(regular(FONT_SMALL)).color(t.faint));
}

/// `.vk-warn`: a setting that does nothing as things stand.
pub fn warn(ui: &mut egui::Ui, t: &Theme, text: &str) {
    ui.label(egui::RichText::new(text).font(regular(FONT_SMALL)).color(t.amber));
}

/// Monospace words (a console command, the FFmpeg line).
pub fn code(ui: &mut egui::Ui, t: &Theme, text: &str) {
    ui.add(egui::Label::new(egui::RichText::new(text).font(mono(FONT_SMALL)).color(t.muted)).wrap());
}
