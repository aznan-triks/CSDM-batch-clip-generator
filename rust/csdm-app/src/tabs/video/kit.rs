//! The VIDEO cards' pieces beyond the shared SETTINGS controls: shortcut values, codec list, the
//! words around a value. Each control that writes a setting records its key (`mark`), so the
//! coverage guard measures what is really on screen, as 3.5's did.

use crate::grid::CardCx;
use crate::paint::{mono, regular};
use crate::tabs::settings::controls::{num_of, text_of};
use crate::theme::Theme;
use crate::widgets::tip;
use csdm_core::ui_values::{FONT_BODY, FONT_SMALL, SETTINGS_FIELD_WIDTH, SETTINGS_LABEL_WIDTH};
use eframe::egui;
use serde_json::json;

pub use crate::controls::{mark, seen_id, Seen};

const TEXT_MIN_W: f32 = 80.0;
const TEXT_FRAME_ALLOWANCE: f32 = 14.0;

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

/// Single-line text setting bounded to the card's remaining width so it never stretches a narrow card.
pub fn text_row(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, name: &str, hint_text: &str, tip_text: &str) {
    let mut value = text_of(cx, key);
    let mut changed = false;
    ui.horizontal(|ui| {
        let l = ui.add_sized(
            [SETTINGS_LABEL_WIDTH, ui.spacing().interact_size.y],
            egui::Label::new(egui::RichText::new(name).font(regular(FONT_BODY)).color(cx.theme.muted)).truncate(),
        );
        let w = SETTINGS_FIELD_WIDTH.min((ui.available_width() - TEXT_FRAME_ALLOWANCE).max(TEXT_MIN_W));
        let r = ui.add(egui::TextEdit::singleline(&mut value).font(mono(FONT_SMALL)).hint_text(hint_text).desired_width(w)).labelled_by(l.id);
        changed = r.changed();
        tip(ui, cx.theme, r, tip_text, false);
    });
    mark(ui, key);
    if changed {
        cx.link.set(cx.now, key, json!(value));
    }
}

/// `.vk-warn`: a setting that does nothing as things stand.
pub fn warn(ui: &mut egui::Ui, t: &Theme, text: &str) {
    ui.label(egui::RichText::new(text).font(regular(FONT_SMALL)).color(t.amber));
}
