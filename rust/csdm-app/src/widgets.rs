//! Small V12 controls shared by the shell and the tabs: chip, tip, confirm dialog,
//! the "waiting for the database" note.

use crate::paint::{mono, regular, semibold, spaced_galley};
use crate::theme::Theme;
use csdm_core::ui_values::{CHIP_PAD, DIALOG_WIDTH, FONT_BODY, FONT_CHIP, FONT_SMALL, FONT_TOOL_CHIP, SPACING_TOOL_CHIP, TOOL_CHIP_PAD};
use eframe::egui::{self, Color32, Pos2, Response, Sense, Stroke, StrokeKind, Vec2};

const DOT: f32 = 3.5;
const DOT_GAP: f32 = 7.0;
/// `.chip:hover` border: `color-mix(in srgb, var(--accent) 28%, transparent)`.
const HOVER_EDGE_PCT: f32 = 28.0;

/// The mock's `.chip`: a pill, lime when on. `on: None` = a plain button chip.
/// `label` is the accessible name when it differs from the visible text (3.5 `aria-label`).
pub fn chip(ui: &mut egui::Ui, t: &Theme, text: &str, on: Option<bool>, label: Option<&str>, enabled: bool) -> Response {
    let lit = on == Some(true);
    let font = if lit { semibold(FONT_CHIP) } else { regular(FONT_CHIP) };
    draw_chip(ui, t, text, on, label, enabled, font, 0.0, CHIP_PAD, on.is_some())
}

/// The console header's compact chip (3.5 `.console .ch .chip`): mono, tracked, no dot.
pub fn tool_chip(ui: &mut egui::Ui, t: &Theme, text: &str, on: Option<bool>, label: Option<&str>, enabled: bool) -> Response {
    draw_chip(ui, t, text, on, label, enabled, mono(FONT_TOOL_CHIP), SPACING_TOOL_CHIP, TOOL_CHIP_PAD, false)
}

#[allow(clippy::too_many_arguments)]
fn draw_chip(ui: &mut egui::Ui, t: &Theme, text: &str, on: Option<bool>, label: Option<&str>, enabled: bool, font: egui::FontId, spacing_em: f32, pad: [f32; 2], dot: bool) -> Response {
    let lit = on == Some(true);
    let ink = if lit { t.lime_ink } else if enabled { t.muted } else { t.faint };
    let extra = if dot { DOT * 2.0 + DOT_GAP } else { 0.0 };
    let mut galley = spaced_galley(ui.painter(), text, font.clone(), ink, spacing_em);
    // A chip wider than a whole row (narrow card) is cut with an ellipsis, as 3.5.1's `.chip`:
    // left whole it widened the card and pushed the text after it past the card's edge. The
    // row's full width, not what is left of it: a chip that fits a fresh row wraps to it instead.
    let room = ui.max_rect().width() - pad[0] * 2.0 - extra;
    if galley.size().x > room && room > 0.0 {
        let mut job = egui::text::LayoutJob::default();
        let spacing = spacing_em * font.size;
        job.append(text, 0.0, egui::TextFormat { font_id: font, color: ink, extra_letter_spacing: spacing, ..Default::default() });
        job.wrap = egui::text::TextWrapping::truncate_at_width(room);
        galley = ui.painter().layout_job(job);
    }
    let size = Vec2::new(galley.size().x + pad[0] * 2.0 + extra, galley.size().y + pad[1] * 2.0);
    let sense = if enabled { Sense::click() } else { Sense::hover() };
    let (rect, resp) = ui.allocate_exact_size(size, sense);
    let name = label.unwrap_or(text).to_string();
    resp.widget_info(|| match on {
        Some(v) => egui::WidgetInfo::selected(egui::Role::CheckBox, enabled, v, &name),
        None => egui::WidgetInfo::labeled(egui::Role::Button, enabled, &name),
    });
    if resp.hovered() && enabled {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    let p = ui.painter();
    let radius = rect.height() / 2.0;
    let (fill, stroke) = if lit { (t.lime, t.lime_glow) } else { (t.solid, t.hair) };
    let stroke = if resp.hovered() && enabled && !lit { t.accent_alpha(HOVER_EDGE_PCT) } else { stroke };
    p.rect(rect, radius, fill, Stroke::new(1.0, stroke), StrokeKind::Inside);
    let mut x = rect.left() + pad[0];
    if dot {
        p.circle_filled(Pos2::new(x + DOT, rect.center().y), DOT, if lit { t.lime_ink } else { ink.gamma_multiply(1.0 / 2.0) });
        x += extra;
    }
    p.galley(Pos2::new(x, rect.center().y - galley.size().y / 2.0), galley, ink);
    resp
}

/// A control's explanation: on hover, or always written under it when the user
/// asked for it (`ui_always_show_tooltips`, 3.5 `persistent-tip`).
pub fn tip(ui: &mut egui::Ui, t: &Theme, resp: Response, text: &str, always: bool) -> Response {
    if always {
        ui.label(egui::RichText::new(text).font(regular(FONT_SMALL)).color(t.faint));
        resp
    } else {
        resp.on_hover_text(text)
    }
}

/// What a card that needs the database shows until it answers (3.5 `DatabasePending`).
pub const DB_UNREACHABLE_HINT: &str = "Database not reachable. Check SETTINGS › PostgreSQL Connection (same values as in CS Demo Manager), then press Test & Reload.";
pub const DB_WAITING: &str = "Waiting for DB…";

pub fn database_pending(ui: &mut egui::Ui, t: &Theme, error: Option<&str>) {
    let (text, color) = match error {
        Some(_) => (DB_UNREACHABLE_HINT, t.amber),
        None => (DB_WAITING, t.muted),
    };
    let r = ui.label(egui::RichText::new(text).font(regular(FONT_BODY)).color(color));
    if let Some(e) = error {
        r.on_hover_text(e);
    }
}

/// Answer of a confirmation dialog.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Confirm { Pending, Cancelled, Confirmed }

/// A modal question (3.5 `ConfirmDialog`): title, message, Cancel / Confirm. `danger` tints Confirm.
pub fn confirm_dialog(ctx: &egui::Context, t: &Theme, title: &str, message: &str, danger: bool) -> Confirm {
    let mut out = Confirm::Pending;
    let modal = egui::Modal::new(egui::Id::unique(("confirm", title)))
        .backdrop_color(Color32::BLACK.gamma_multiply(1.0 / 2.0 / 2.0))
        .frame(egui::Frame::new().fill(t.solid).stroke(Stroke::new(1.0, t.hair)).corner_radius(egui::CornerRadius::same(crate::CORNER_MID)).inner_margin(egui::Margin::same(crate::DIALOG_PAD)));
    let resp = modal.show(ctx, |ui| {
        ui.set_width(DIALOG_WIDTH);
        ui.label(egui::RichText::new(title).font(semibold(FONT_BODY)).color(t.txt));
        ui.label(egui::RichText::new(message).font(regular(FONT_BODY)).color(t.muted));
        ui.add_space(crate::DIALOG_PAD.into());
        ui.horizontal(|ui| {
            let cancel = chip(ui, t, "Cancel", None, None, true);
            // 3.5 ConfirmDialog: keyboard users land on the safe choice.
            if ui.memory(|m| m.focused().is_none()) {
                cancel.request_focus();
            }
            if cancel.clicked() {
                out = Confirm::Cancelled;
            }
            let c = if danger { t.rose } else { t.accent };
            let b = egui::Button::new(egui::RichText::new("Confirm").font(semibold(FONT_CHIP)).color(Color32::WHITE)).fill(c).corner_radius(egui::CornerRadius::same(crate::CORNER_MID));
            if ui.add(b).clicked() {
                out = Confirm::Confirmed;
            }
        });
    });
    if out == Confirm::Pending && resp.should_close() {
        out = Confirm::Cancelled;
    }
    out
}
