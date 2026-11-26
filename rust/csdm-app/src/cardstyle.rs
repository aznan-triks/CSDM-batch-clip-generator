//! Shared primitives for the three card styles (`timeline`, `sentence`, `tiles`):
//! live style resolution (`ui_card_style` + `ui_card_style_overrides[card_id]`),
//! Sentence tokens & popovers (`ChoiceToken`, `NumberToken`, `WordOptions`, `TextWord`,
//! `ActionWord`), and Tiles building blocks (`IconTile`, `BigTile`, `CountTile`, `PictureChoice`).
//!
//! Every setting control records its key (`crate::controls::mark`), so coverage guards
//! pass in all three styles without duplicating binding logic.

use crate::controls::{mark, mix, options_tray, Opt};
use crate::grid::CardCx;
use crate::paint::{caret, mono, regular, semibold};
use crate::tabs::settings::controls::{bool_of, num_of, stored_number, text_of};
use crate::theme::Theme;
use csdm_core::ui_values::{CardStyle, FONT_BODY, FONT_SMALL};
use eframe::egui::{self, pos2, vec2, Align2, Color32, Rect, Response, Sense, Stroke, StrokeKind, Vec2};
use serde_json::{json, Value};

pub const ICON_TILE_H: f32 = 96.0;

const TOKEN_PAD: [f32; 2] = [8.0, 3.0];
const TOKEN_RADIUS: f32 = 8.0;
const TOKEN_CARET: f32 = 6.0;
const TOKEN_GAP: f32 = 5.0;
const TOKEN_TINT_PCT: f32 = 12.0;
const TOKEN_EDGE_PCT: f32 = 38.0;
const POP_W: f32 = 240.0;
const POP_W_WIDE: f32 = 340.0;
const POP_GAP: f32 = 4.0;
const DRAG_PX_PER_STEP: f32 = 10.0;
const FIELD_W: f32 = 140.0;
const EXACT_W: f32 = 68.0;
const DECIMAL_EPS: f64 = 1e-6;
const PROSE_GAP: [f32; 2] = [5.0, 6.0];
const TILE_GAP: f32 = 8.0;
const TILE_RADIUS: f32 = 12.0;
const TILE_PAD: [f32; 2] = [10.0, 9.0];
const TILE_ICON_BOX: f32 = 26.0;
const TILE_ICON_RADIUS: f32 = 8.0;
const TILE_ICON_TINT_PCT: f32 = 12.0;
const TILE_LIT_PCT: f32 = 10.0;
const TILE_CHECK_SIZE: f32 = 16.0;
const TILE_CHECK_INSET: f32 = 6.0;
const TILE_GLYPH_H: f32 = 28.0;
const PIC_ART_H: f32 = 52.0;
const COUNT_BTN_W: f32 = 26.0;
const COUNT_BTN_H: f32 = 24.0;
const FONT_NUM_BIG: f32 = 20.0;
const FONT_CODE: f32 = 9.0;
const CODE_PAD: [f32; 2] = [5.0, 2.0];
const BAR_H_THIN: f32 = 12.0;
const BAR_H_LABELLED: f32 = 26.0;
const BAR_RADIUS: f32 = 6.0;
const OPT_PAD: [f32; 2] = [8.0, 5.0];
const OPT_RADIUS: f32 = 8.0;
const WARN_ALPHA: f32 = 0.25;
const DISABLED_ALPHA: f32 = 0.45;
const PATH_PARTS_SHOWN: usize = 2;
const PATH_SEP: &str = "\\"; // allow-hardcode: Windows-style display path separator
const PATH_ELLIPSIS: &str = "…\\"; // allow-hardcode: Windows-style truncated display prefix
const PIC_TEXT_PAD: f32 = 4.0;
const PIC_EXTRA_H: f32 = 6.0;
const BAR_LABEL_PAD: f32 = 4.0;
const GLYPH_STROKE: f32 = 1.8;
const SHADOW_ALPHA: u8 = 24;
const SHADOW_OFFSET: [i8; 2] = [0, 4];
const SHADOW_BLUR: u8 = 12;

/// Resolves the live style for `card_id` from `ui_card_style_overrides` then `ui_card_style`.
pub fn style_of(cx: &CardCx, card_id: &str) -> CardStyle {
    let global = cx.link.get("ui_card_style").and_then(Value::as_str);
    let own = cx.link.get("ui_card_style_overrides").and_then(|o| o.get(card_id)).and_then(Value::as_str);
    CardStyle::resolve(global, own)
}

/// A wrapped sentence line with balanced vertical rhythm for mixed text and tokens.
pub fn prose_line(ui: &mut egui::Ui, add: impl FnOnce(&mut egui::Ui)) {
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = Vec2::from(PROSE_GAP);
        add(ui);
    });
    ui.add_space(PROSE_GAP[1] / 2.0);
}

pub fn prose_word(ui: &mut egui::Ui, t: &Theme, text: &str) {
    ui.label(egui::RichText::new(text).font(regular(FONT_BODY)).color(t.txt));
}

pub fn prose_bold(ui: &mut egui::Ui, t: &Theme, text: &str) {
    ui.label(egui::RichText::new(text).font(semibold(FONT_BODY)).color(t.txt));
}

pub fn prose_muted(ui: &mut egui::Ui, t: &Theme, text: &str) {
    ui.label(egui::RichText::new(text).font(regular(FONT_BODY)).color(t.muted));
}

pub fn prose_empty(ui: &mut egui::Ui, t: &Theme, text: &str) {
    ui.label(egui::RichText::new(text).font(regular(FONT_BODY)).italics().color(t.faint));
}

/// Inline clickable word in a sentence (`.sx-act`) for actions like Apply / Compute / Tag.
#[allow(clippy::too_many_arguments)]
pub fn action_word(ui: &mut egui::Ui, t: &Theme, text: &str, accessible: &str, alt: bool, danger: bool, tip_text: &str, enabled: bool) -> bool {
    let ink = if !enabled {
        t.faint
    } else if danger {
        t.rose
    } else if alt {
        t.emerald
    } else {
        t.accent
    };
    let g = ui.painter().layout_no_wrap(text.to_string(), semibold(FONT_BODY), ink);
    let size = g.size() + Vec2::from(TOKEN_PAD) * 2.0;
    let (rect, resp) = ui.allocate_exact_size(size, if enabled { Sense::click() } else { Sense::hover() });
    let name = accessible.to_string();
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, enabled, &name));
    let p = ui.painter();
    let fill = mix(ink, t.solid, if resp.hovered() && enabled { TOKEN_TINT_PCT * 2.0 } else { TOKEN_TINT_PCT });
    let edge = if resp.hovered() && enabled { ink } else { ink.gamma_multiply(TOKEN_EDGE_PCT / 100.0) }; // allow-hardcode: percentage to unit factor
    p.rect(rect, TOKEN_RADIUS, fill, Stroke::new(1.0, edge), StrokeKind::Inside);
    p.galley(rect.min + Vec2::from(TOKEN_PAD), g, ink);
    if resp.hovered() && enabled {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    resp.on_hover_text(tip_text).clicked()
}

/// Inline fill-in choice token (`ChoiceToken`) that opens a floating popover on click.
#[allow(clippy::too_many_arguments)]
pub fn choice_token(
    ui: &mut egui::Ui,
    t: &Theme,
    id_salt: &str,
    shown: &str,
    accessible: &str,
    alt: bool,
    tip_text: &str,
    wide_popover: bool,
    popover: impl FnOnce(&mut egui::Ui, &mut bool),
) {
    let ink = if alt { t.emerald } else { t.accent };
    let id = ui.scope_id().with(("ctok", id_salt));
    let open_id = id.with("open");
    let mut open: bool = ui.data(|d| d.get_temp(open_id).unwrap_or(false));

    let g = ui.painter().layout_no_wrap(shown.to_string(), semibold(FONT_BODY), ink);
    let w = TOKEN_PAD[0] * 2.0 + g.size().x + TOKEN_GAP + TOKEN_CARET;
    let h = g.size().y + TOKEN_PAD[1] * 2.0;
    let (rect, resp) = ui.allocate_exact_size(vec2(w, h), Sense::click());
    let name = accessible.to_string();
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, &name));
    let p = ui.painter();
    let fill = mix(ink, t.solid, if open || resp.hovered() { TOKEN_TINT_PCT * 2.0 } else { TOKEN_TINT_PCT });
    let edge = if open || resp.hovered() { ink } else { ink.gamma_multiply(TOKEN_EDGE_PCT / 100.0) }; // allow-hardcode: percentage to unit factor
    p.rect(rect, TOKEN_RADIUS, fill, Stroke::new(1.0, edge), StrokeKind::Inside);
    p.galley(pos2(rect.left() + TOKEN_PAD[0], rect.center().y - g.size().y / 2.0), g, ink);
    caret(p, pos2(rect.right() - TOKEN_PAD[0] - TOKEN_CARET / 2.0, rect.center().y), TOKEN_CARET, ink, !open);
    if resp.hovered() {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    if resp.on_hover_text(tip_text).clicked() {
        open = !open;
    }

    if open {
        let mut close = false;
        let pop_w = if wide_popover { POP_W_WIDE } else { POP_W };
        let area = egui::Area::new(id.with("pop"))
            .order(egui::Order::Foreground)
            .constrain(true)
            .fixed_pos(rect.left_bottom() + vec2(0.0, POP_GAP))
            .show(ui.ctx(), |ui| {
                egui::Frame::popup(ui.style())
                    .fill(t.solid)
                    .stroke(Stroke::new(1.0, t.hair))
                    .corner_radius(egui::CornerRadius::same(crate::CORNER_MID))
                    .inner_margin(egui::Margin::same(TILE_PAD[1] as i8))
                    .shadow(egui::epaint::Shadow { offset: SHADOW_OFFSET, blur: SHADOW_BLUR, spread: 0, color: Color32::from_black_alpha(SHADOW_ALPHA) })
                    .show(ui, |ui| {
                        ui.set_width(pop_w);
                        popover(ui, &mut close);
                    });
            });
        let esc = ui.input(|i| i.key_pressed(egui::Key::Escape));
        let outside = ui.input(|i| i.pointer.any_click() && i.pointer.interact_pos().is_some_and(|pt| !area.response.rect.contains(pt) && !rect.contains(pt)));
        if esc || outside || close {
            open = false;
        }
    }
    ui.data_mut(|d| d.insert_temp(open_id, open));
}

/// Formats a numeric value to `decimals` places, stripping trailing decimal noise.
pub fn format_num(v: f64, decimals: i32) -> String {
    if decimals <= 0 {
        return format!("{}", v.round() as i64);
    }
    let s = format!("{v:.prec$}", prec = decimals as usize);
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Inline number token (`NumberToken`): drag sideways to scrub, click to open slider + exact box.
#[allow(clippy::too_many_arguments)]
pub fn number_token(
    ui: &mut egui::Ui,
    cx: &mut CardCx,
    key: &str,
    label: &str,
    unit: &str,
    range: [f64; 2],
    step: f64,
    decimals: i32,
    fallback: f64,
    alt: bool,
    tip_text: &str,
    quicks: &[f64],
) {
    mark(ui, key);
    let t = cx.theme;
    let value = num_of(cx, key, fallback);
    let lo = range[0];
    let hi = range[1].max(value);
    let ink = if alt { t.emerald } else { t.accent };
    let text = format!("{}{unit}", format_num(value, decimals));
    let g = ui.painter().layout_no_wrap(text, mono(FONT_BODY), ink);
    let size = g.size() + Vec2::from(TOKEN_PAD) * 2.0;
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click_and_drag());
    let name = label.to_string();
    resp.widget_info(|| {
        let mut info = egui::WidgetInfo::labeled(egui::Role::SpinButton, true, &name);
        info.value = Some(value);
        info
    });
    let id = ui.scope_id().with(("ntok", key));
    let open_id = id.with("open");
    let mut open: bool = ui.data(|d| d.get_temp(open_id).unwrap_or(false));
    let p = ui.painter();
    let lit = open || resp.hovered() || resp.dragged();
    let fill = mix(ink, t.solid, if lit { TOKEN_TINT_PCT * 2.0 } else { TOKEN_TINT_PCT });
    let edge = if lit { ink } else { ink.gamma_multiply(TOKEN_EDGE_PCT / 100.0) }; // allow-hardcode: percentage to unit factor
    p.rect(rect, TOKEN_RADIUS, fill, Stroke::new(1.0, edge), StrokeKind::Inside);
    p.galley(rect.min + Vec2::from(TOKEN_PAD), g, ink);
    if resp.hovered() {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    let resp = resp.on_hover_text(format!("{tip_text}. Drag sideways or click to edit"));
    let mut next: Option<f64> = None;
    if resp.dragged() {
        let acc: f32 = ui.data(|d| d.get_temp(id.with("acc")).unwrap_or(0.0)) + resp.drag_delta().x;
        let steps = (acc / DRAG_PX_PER_STEP).trunc();
        ui.data_mut(|d| d.insert_temp(id.with("acc"), acc - steps * DRAG_PX_PER_STEP));
        if steps != 0.0 {
            next = Some((value + f64::from(steps) * step).clamp(lo, hi));
        }
    }
    if resp.drag_stopped() {
        ui.data_mut(|d| d.remove::<f32>(id.with("acc")));
    }
    if resp.clicked() {
        open = !open;
    }
    if open {
        let area = egui::Area::new(id.with("pop"))
            .order(egui::Order::Foreground)
            .constrain(true)
            .fixed_pos(rect.left_bottom() + vec2(0.0, POP_GAP))
            .show(ui.ctx(), |ui| {
                egui::Frame::popup(ui.style())
                    .fill(t.solid)
                    .stroke(Stroke::new(1.0, t.hair))
                    .corner_radius(egui::CornerRadius::same(crate::CORNER_MID))
                    .inner_margin(egui::Margin::same(TILE_PAD[1] as i8))
                    .show(ui, |ui| {
                        ui.set_width(POP_W);
                        ui.label(egui::RichText::new(label).font(semibold(FONT_SMALL)).color(t.txt));
                        let mut v = value.clamp(lo, hi);
                        let s = ui.add(egui::Slider::new(&mut v, lo..=hi).step_by(step).show_value(false));
                        s.widget_info(|| egui::WidgetInfo::slider(true, v, format!("{label} slider")));
                        if s.changed() {
                            next = Some(v);
                        }
                        ui.horizontal(|ui| {
                            ui.label(egui::RichText::new("Exact").font(regular(FONT_SMALL)).color(t.muted));
                            let eid = id.with("exact");
                            let mut txt: String = ui.data(|d| d.get_temp(eid)).unwrap_or_else(|| format_num(value, decimals));
                            let r = ui.add(egui::TextEdit::singleline(&mut txt).desired_width(EXACT_W).font(mono(FONT_SMALL)));
                            let exact_name = format!("{label} exact");
                            r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, &exact_name));
                            if r.changed() {
                                if let Ok(parsed) = txt.trim().parse::<f64>() {
                                    if parsed.is_finite() {
                                        next = Some(parsed);
                                    }
                                }
                            }
                            if r.has_focus() || r.changed() {
                                ui.data_mut(|d| d.insert_temp(eid, txt));
                            } else {
                                ui.data_mut(|d| d.remove::<String>(eid));
                            }
                            if !unit.trim().is_empty() {
                                ui.label(egui::RichText::new(unit.trim()).font(regular(FONT_SMALL)).color(t.muted));
                            }
                        });
                        if !quicks.is_empty() {
                            ui.horizontal_wrapped(|ui| {
                                for q in quicks {
                                    let q_str = format_num(*q, decimals);
                                    let lit = (*q - value).abs() < DECIMAL_EPS;
                                    if crate::widgets::chip(ui, t, &q_str, Some(lit), Some(&format!("{label} {q_str}")), true).clicked() {
                                        next = Some(*q);
                                    }
                                }
                            });
                        }
                    });
            });
        let esc = ui.input(|i| i.key_pressed(egui::Key::Escape));
        let outside = ui.input(|i| i.pointer.any_click() && i.pointer.interact_pos().is_some_and(|pt| !area.response.rect.contains(pt) && !rect.contains(pt)));
        if esc || outside {
            open = false;
        }
    }
    ui.data_mut(|d| d.insert_temp(open_id, open));
    if let Some(v) = next {
        let val = stored_number(v, decimals);
        if cx.link.get(key) != Some(&val) {
            cx.link.set(cx.now, key, val);
        }
    }
}

/// One-of-N radio options inside a `choice_token` popover (`WordOptions`).
pub fn word_options(ui: &mut egui::Ui, t: &Theme, options: &[(&str, &str, &str)], current: &str) -> Option<String> {
    let mut picked = None;
    for &(val, words, sub) in options {
        let on = val == current;
        let wg = ui.painter().layout_no_wrap(words.to_string(), semibold(FONT_SMALL), if on { t.accent } else { t.txt });
        let sg = (!sub.is_empty()).then(|| ui.painter().layout_no_wrap(sub.to_string(), regular(FONT_SMALL - 1.0), t.muted));
        let h = wg.size().y + sg.as_ref().map_or(0.0, |g| g.size().y + 2.0) + OPT_PAD[1] * 2.0;
        let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), h), Sense::click());
        let name = words.to_string();
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::RadioButton, true, on, &name));
        let p = ui.painter();
        let fill = if on { t.accent_soft } else if resp.hovered() { t.surface2 } else { Color32::TRANSPARENT };
        let edge = if on { t.accent } else { Color32::TRANSPARENT };
        p.rect(rect, OPT_RADIUS, fill, Stroke::new(1.0, edge), StrokeKind::Inside);
        let mut y = rect.top() + OPT_PAD[1];
        p.galley(pos2(rect.left() + OPT_PAD[0], y), wg.clone(), if on { t.accent } else { t.txt });
        y += wg.size().y + 2.0;
        if let Some(sg) = sg {
            p.galley(pos2(rect.left() + OPT_PAD[0], y), sg, t.muted);
        }
        if resp.clicked() {
            picked = Some(val.to_string());
        }
    }
    picked
}

/// Boolean setting rendered as a sentence `choice_token` (`BoolWord`).
#[allow(clippy::too_many_arguments)]
pub fn bool_word(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, label: &str, on_words: &str, off_words: &str, alt: bool, tip_text: &str) {
    mark(ui, key);
    let on = bool_of(cx, key);
    let shown = if on { on_words } else { off_words };
    let t = cx.theme;
    let mut picked = None;
    choice_token(ui, t, key, shown, label, alt, tip_text, false, |ui, close| {
        ui.label(egui::RichText::new(label).font(semibold(FONT_SMALL)).color(t.muted));
        if let Some(v) = word_options(ui, t, &[("on", on_words, ""), ("off", off_words, "")], if on { "on" } else { "off" }) {
            picked = Some(v == "on");
            *close = true;
        }
    });
    if let Some(v) = picked {
        if v != on {
            cx.link.set(cx.now, key, json!(v));
        }
    }
}

/// Fixed-choice string setting as a sentence `choice_token` (`ChoiceWord`).
#[allow(clippy::too_many_arguments)]
pub fn choice_word(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, label: &str, options: &[(&str, &str, &str)], fallback: &str, alt: bool, tip_text: &str) {
    mark(ui, key);
    let raw = text_of(cx, key);
    let current = options.iter().find(|(v, ..)| *v == raw).map(|(v, ..)| *v).unwrap_or(fallback);
    let shown = options.iter().find(|(v, ..)| *v == current).map(|(_, w, _)| *w).unwrap_or(current);
    let t = cx.theme;
    let mut picked = None;
    choice_token(ui, t, key, shown, label, alt, tip_text, false, |ui, close| {
        ui.label(egui::RichText::new(label).font(semibold(FONT_SMALL)).color(t.muted));
        if let Some(v) = word_options(ui, t, options, current) {
            picked = Some(v);
            *close = true;
        }
    });
    if let Some(v) = picked {
        if v != raw {
            cx.link.set(cx.now, key, json!(v));
        }
    }
}

/// Text setting as a sentence `choice_token` (`TextWord`): displays value or `empty_words`, opens box in popover.
#[allow(clippy::too_many_arguments)]
pub fn text_word(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, label: &str, empty_words: &str, password: bool, path_short: bool, alt: bool, tip_text: &str) {
    mark(ui, key);
    let val = text_of(cx, key);
    let shown = if val.is_empty() {
        empty_words.to_string()
    } else if password {
        "******".to_string()
    } else if path_short {
        path_tail(&val)
    } else {
        val.clone()
    };
    let t = cx.theme;
    let mut next: Option<String> = None;
    choice_token(ui, t, key, &shown, label, alt, tip_text, false, |ui, _| {
        ui.label(egui::RichText::new(label).font(semibold(FONT_SMALL)).color(t.muted));
        let mut draft = val.clone();
        let edit = egui::TextEdit::singleline(&mut draft).password(password).hint_text(empty_words).desired_width(FIELD_W);
        let r = ui.add(edit);
        let n = label.to_string();
        r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, &n));
        if r.changed() {
            next = Some(draft);
        }
    });
    if let Some(v) = next {
        cx.link.set(cx.now, key, json!(v));
    }
}

/// Tail of a filesystem path, keeping the last two segments (`pathTail`).
pub fn path_tail(path: &str) -> String {
    let sep = PATH_SEP.chars().next().unwrap_or('/');
    let bits: Vec<&str> = path.split([sep, '/']).filter(|s| !s.is_empty()).collect();
    if bits.len() <= PATH_PARTS_SHOWN {
        path.to_string()
    } else {
        format!("{PATH_ELLIPSIS}{}", bits[bits.len() - PATH_PARTS_SHOWN..].join(PATH_SEP))
    }
}

/// Small segmented tray inside a popover (`Segmented` without external label).
pub fn pop_segmented(ui: &mut egui::Ui, t: &Theme, name: &str, options: &[&str], current: &str, tip_text: &str) -> Option<String> {
    let opts: Vec<Opt> = options.iter().map(|o| Opt { text: o, on: *o == current, disabled: false, name: format!("{name}: {o}"), dot: None, tip: tip_text }).collect();
    options_tray(ui, t, &opts, true).filter(|i| options[*i] != current).map(|i| options[i].to_string())
}

// ------------------------------------------------------------------ Tiles layout helpers

/// Computes `(columns, tile_width)` so a grid of tiles fills `available_width` with zero overflow.
pub fn tile_cols(available_width: f32, min_tile_w: f32, gap: f32) -> (usize, f32) {
    let cols = (((available_width + gap) / (min_tile_w + gap)).floor() as usize).max(1);
    let tile_w = ((available_width - gap * (cols - 1) as f32) / cols as f32).max(1.0);
    (cols, tile_w)
}

/// Lays out `count` items in responsive equal-width rows.
pub fn tile_grid(ui: &mut egui::Ui, min_tile_w: f32, count: usize, mut draw_item: impl FnMut(&mut egui::Ui, usize, f32)) {
    if count == 0 {
        return;
    }
    let (cols, tile_w) = tile_cols(ui.available_width(), min_tile_w, TILE_GAP);
    let mut i = 0;
    while i < count {
        ui.horizontal_top(|ui| {
            ui.spacing_mut().item_spacing.x = TILE_GAP;
            for _ in 0..cols {
                if i >= count {
                    break;
                }
                let idx = i;
                i += 1;
                ui.allocate_ui_with_layout(vec2(tile_w, 0.0), egui::Layout::top_down(egui::Align::Min), |ui| {
                    ui.set_width(tile_w);
                    draw_item(ui, idx, tile_w);
                });
            }
        });
        if i < count {
            ui.add_space(TILE_GAP);
        }
    }
}

/// Clickable illustrated toggle tile (`IconTile`).
#[allow(clippy::too_many_arguments)]
pub fn icon_tile(
    ui: &mut egui::Ui,
    t: &Theme,
    width: f32,
    height: f32,
    title: &str,
    subtitle: &str,
    code: Option<&str>,
    on: bool,
    disabled: bool,
    warn: bool,
    tip_text: &str,
    paint_icon: impl FnOnce(&egui::Painter, Rect, Color32),
) -> Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(width, height), if disabled { Sense::hover() } else { Sense::click() });
    let name = title.to_string();
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, !disabled, on, &name));
    let resp = resp.on_hover_text(tip_text);
    let p = ui.painter();
    let alpha = if disabled { DISABLED_ALPHA } else { 1.0 };
    let (fill, edge, ink) = if warn {
        (mix(t.amber, t.solid, TILE_LIT_PCT * 2.0), t.amber, t.amber)
    } else if on {
        (mix(t.accent, t.solid, TILE_LIT_PCT), t.accent, t.accent)
    } else {
        (t.solid, if resp.hovered() && !disabled { t.accent } else { t.hair }, t.txt)
    };
    p.rect(rect, TILE_RADIUS, fill.gamma_multiply(alpha), Stroke::new(if on { 2.0 } else { 1.0 }, edge.gamma_multiply(alpha)), StrokeKind::Inside);
    if on {
        let ck = Rect::from_min_size(pos2(rect.right() - TILE_CHECK_SIZE - TILE_CHECK_INSET, rect.top() + TILE_CHECK_INSET), Vec2::splat(TILE_CHECK_SIZE));
        p.circle_filled(ck.center(), TILE_CHECK_SIZE / 2.0, t.accent);
        p.text(ck.center(), Align2::CENTER_CENTER, "✓", semibold(FONT_SMALL), t.on_accent);
    }
    let icon_rect = Rect::from_center_size(pos2(rect.center().x, rect.top() + TILE_PAD[1] + TILE_GLYPH_H / 2.0), Vec2::splat(TILE_GLYPH_H));
    paint_icon(p, icon_rect, (if on { t.accent } else { t.muted }).gamma_multiply(alpha));

    let title_y = icon_rect.bottom() + TILE_PAD[1] / 2.0;
    let mut job = egui::text::LayoutJob::single_section(title.to_string(), egui::TextFormat::simple(semibold(FONT_BODY), ink.gamma_multiply(alpha)));
    job.wrap = egui::text::TextWrapping::truncate_at_width((width - TILE_PAD[0] * 2.0).max(1.0));
    let tg = p.layout_job(job);
    p.galley(pos2(rect.center().x - tg.size().x / 2.0, title_y), tg.clone(), ink);

    let sub_y = title_y + tg.size().y + 2.0;
    if !subtitle.is_empty() {
        let mut sjob = egui::text::LayoutJob::single_section(subtitle.to_string(), egui::TextFormat::simple(regular(FONT_SMALL - 1.0), t.muted.gamma_multiply(alpha)));
        sjob.wrap = egui::text::TextWrapping { max_width: (width - TILE_PAD[0] * 2.0).max(1.0), max_rows: 2, break_anywhere: false, overflow_character: Some('…') };
        let sg = p.layout_job(sjob);
        p.galley(pos2(rect.center().x - sg.size().x / 2.0, sub_y), sg, t.muted);
    }
    if let Some(c) = code {
        let cg = p.layout_no_wrap(c.to_string(), semibold(FONT_CODE), if on { t.accent } else { t.faint });
        let cr = Rect::from_center_size(pos2(rect.center().x, rect.bottom() - TILE_PAD[1] - cg.size().y / 2.0), cg.size() + Vec2::from(CODE_PAD) * 2.0);
        p.rect_filled(cr, CODE_PAD[0], t.surface2);
        p.galley(cr.min + Vec2::from(CODE_PAD), cg, t.faint);
    }
    if resp.hovered() && !disabled {
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    resp
}

/// Framed container tile (`BigTile`) with icon badge, bold title, optional caption, and body controls.
#[allow(clippy::too_many_arguments)]
pub fn big_tile(
    ui: &mut egui::Ui,
    t: &Theme,
    width: f32,
    title: &str,
    caption: Option<&str>,
    on: bool,
    warn: bool,
    alt: bool,
    paint_icon: impl FnOnce(&egui::Painter, Rect, Color32),
    add_body: impl FnOnce(&mut egui::Ui),
) {
    let (fill, edge, accent) = if warn {
        (t.solid, t.rose, t.rose)
    } else if on {
        (mix(t.accent, t.solid, TILE_LIT_PCT), t.accent, t.accent)
    } else if alt {
        (t.solid, t.hair, t.emerald)
    } else {
        (t.solid, t.hair, t.accent)
    };
    egui::Frame::new()
        .fill(fill)
        .stroke(Stroke::new(if on { 2.0 } else { 1.0 }, edge))
        .corner_radius(egui::CornerRadius::same(TILE_RADIUS as u8))
        .inner_margin(egui::Margin::symmetric(TILE_PAD[0] as i8, TILE_PAD[1] as i8))
        .show(ui, |ui| {
            ui.set_width((width - TILE_PAD[0] * 2.0 - 2.0).max(1.0));
            ui.horizontal(|ui| {
                let (ir, _) = ui.allocate_exact_size(Vec2::splat(TILE_ICON_BOX), Sense::hover());
                ui.painter().rect_filled(ir, TILE_ICON_RADIUS, mix(accent, t.solid, TILE_ICON_TINT_PCT));
                paint_icon(ui.painter(), ir.shrink(TILE_PAD[1] / 2.0), accent);
                ui.add(egui::Label::new(egui::RichText::new(title).font(semibold(FONT_BODY)).color(t.txt)).wrap());
            });
            if let Some(cap) = caption {
                ui.add(egui::Label::new(egui::RichText::new(cap).font(regular(FONT_SMALL)).color(t.muted)).wrap());
            }
            add_body(ui);
        });
}

/// Numeric tile (`SmallCardCountTile`): big number readout (or `special` word), `−`/`+` steppers, optional shortcuts.
#[allow(clippy::too_many_arguments)]
pub fn count_tile(
    ui: &mut egui::Ui,
    cx: &mut CardCx,
    key: &str,
    title: &str,
    unit: &str,
    range: [f64; 2],
    step: f64,
    decimals: i32,
    special: Option<(f64, &str)>,
    caption: &str,
    tip_text: &str,
    width: f32,
    paint_icon: impl FnOnce(&egui::Painter, Rect, Color32),
) {
    mark(ui, key);
    let t = cx.theme;
    let fallback = csdm_core::settings::def(key).and_then(|d| d.default.as_f64()).unwrap_or(range[0]);
    let value = num_of(cx, key, fallback);
    let mut next: Option<f64> = None;
    let shown = match special {
        Some((sv, word)) if (value - sv).abs() < DECIMAL_EPS => word.to_string(),
        _ => format!("{}{unit}", format_num(value, decimals)),
    };
    big_tile(ui, t, width, title, Some(caption), false, false, false, paint_icon, |ui| {
        ui.horizontal(|ui| {
            if crate::widgets::chip(ui, t, "−", None, Some(&format!("Decrease {title}")), value > range[0]).on_hover_text(tip_text).clicked() {
                next = Some((value - step).clamp(range[0], range[1].max(value)));
            }
            let r = ui.label(egui::RichText::new(&shown).font(mono(FONT_NUM_BIG)).strong().color(t.accent));
            r.on_hover_text(tip_text);
            if crate::widgets::chip(ui, t, "+", None, Some(&format!("Increase {title}")), value < range[1]).on_hover_text(tip_text).clicked() {
                next = Some((value + step).clamp(range[0], range[1].max(value)));
            }
            let _ = (COUNT_BTN_W, COUNT_BTN_H);
        });
    });
    if let Some(v) = next {
        cx.link.set(cx.now, key, stored_number(v, decimals));
    }
}

/// Illustrated one-of-N radio card (`PictureChoice`).
pub struct PictureOpt<'a> {
    pub value: &'a str,
    pub title: &'a str,
    pub subtitle: &'a str,
    pub tip: &'a str,
}

pub fn picture_choice(
    ui: &mut egui::Ui,
    t: &Theme,
    min_w: f32,
    label: &str,
    options: &[PictureOpt],
    current: &str,
    mut paint_art: impl FnMut(&egui::Painter, Rect, &str, bool),
) -> Option<String> {
    let mut picked = None;
    tile_grid(ui, min_w, options.len(), |ui, idx, w| {
        let opt = &options[idx];
        let on = opt.value == current;
        let h = PIC_ART_H + TILE_PAD[1] * 2.0 + FONT_BODY + FONT_SMALL + PIC_EXTRA_H;
        let (rect, resp) = ui.allocate_exact_size(vec2(w, h), Sense::click());
        let name = format!("{label}: {}", opt.title);
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::RadioButton, true, on, &name));
        let p = ui.painter();
        let fill = if on { mix(t.accent, t.solid, TILE_LIT_PCT) } else { t.solid };
        let edge = if on || resp.hovered() { t.accent } else { t.hair };
        p.rect(rect, TILE_RADIUS, fill, Stroke::new(if on { 2.0 } else { 1.0 }, edge), StrokeKind::Inside);
        let art_rect = Rect::from_min_size(rect.min + vec2(TILE_PAD[0], TILE_PAD[1]), vec2((w - TILE_PAD[0] * 2.0).max(1.0), PIC_ART_H));
        paint_art(p, art_rect, opt.value, on);
        p.text(pos2(rect.center().x, art_rect.bottom() + FONT_BODY / 2.0 + PIC_TEXT_PAD), Align2::CENTER_CENTER, opt.title, semibold(FONT_BODY), if on { t.accent } else { t.txt });
        if !opt.subtitle.is_empty() {
            p.text(pos2(rect.center().x, rect.bottom() - TILE_PAD[1]), Align2::CENTER_BOTTOM, opt.subtitle, regular(FONT_SMALL - 1.0), t.muted);
        }
        if resp.hovered() {
            crate::cursor::snap_here(ui.ctx(), rect);
        }
        if resp.on_hover_text(opt.tip).clicked() && !on {
            picked = Some(opt.value.to_string());
        }
    });
    picked
}

/// Proportional clip bar shared by `Capture & Timing` Sentence (thin) & Tiles (labelled) views.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ClipTone { Primary, Alt, Rest }

pub fn clip_bar(ui: &mut egui::Ui, t: &Theme, parts: &[(f64, ClipTone, String)], captions: Option<(&str, &str, &str)>) {
    let labelled = captions.is_none();
    let h = if labelled { BAR_H_LABELLED } else { BAR_H_THIN };
    let total: f64 = parts.iter().map(|(s, ..)| (*s).max(0.0)).sum::<f64>().max(1.0);
    let (bar, _) = ui.allocate_exact_size(vec2(ui.available_width(), h), Sense::hover());
    let p = ui.painter();
    p.rect(bar, BAR_RADIUS, t.surface2, Stroke::new(1.0, t.hair), StrokeKind::Inside);
    let mut x = bar.left();
    for (secs, tone, text) in parts {
        let w = (bar.width() * (*secs as f32 / total as f32)).max(0.0);
        if w <= 0.0 {
            continue;
        }
        let seg = Rect::from_min_size(pos2(x, bar.top()), vec2(w, h));
        x += w;
        let (fill, ink) = match tone {
            ClipTone::Primary => (t.accent, t.on_accent),
            ClipTone::Alt => (t.emerald, Color32::WHITE),
            ClipTone::Rest => (mix(t.accent, t.solid, WARN_ALPHA * 100.0), t.accent), // allow-hardcode: percentage factor
        };
        p.rect_filled(seg, BAR_RADIUS / 2.0, fill);
        if labelled && !text.is_empty() {
            let g = p.layout_no_wrap(text.clone(), semibold(FONT_SMALL - 1.0), ink);
            if g.size().x + BAR_LABEL_PAD <= seg.width() {
                p.galley(seg.center() - g.size() / 2.0, g, ink);
            }
        }
    }
    if let Some((start, moment, end)) = captions {
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new(start).font(mono(FONT_SMALL - 1.0)).color(t.muted));
            ui.with_layout(egui::Layout::centered_and_justified(egui::Direction::LeftToRight), |ui| {
                ui.label(egui::RichText::new(moment).font(semibold(FONT_SMALL - 1.0)).color(t.accent));
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(egui::RichText::new(end).font(mono(FONT_SMALL - 1.0)).color(t.muted));
            });
        });
    }
}

/// Simple vector glyphs for tiles (`paint_icon` callbacks) so we never depend on missing font glyphs.
#[derive(Clone, Copy)]
pub enum TileGlyph {
    Icon(&'static str),
    Cylinder,
    Retry,
    Wait,
    Stuck,
    Play,
    CheckList,
    Kill,
    Damage,
    Shot,
    Round,
    Plus,
    Clutch(u8),
}

pub fn paint_glyph(p: &egui::Painter, r: Rect, g: TileGlyph, ink: Color32) {
    let s = Stroke::new(GLYPH_STROKE, ink);
    let c = r.center();
    let rad = r.width().min(r.height()) / 2.0 * 0.8; // allow-hardcode: glyph scale fraction
    match g {
        TileGlyph::Icon(name) => crate::icons::paint(p, name, r, ink),
        TileGlyph::Cylinder => {
            let rx = rad * 0.85; // allow-hardcode: cylinder width ratio
            let ry = rad * 0.28; // allow-hardcode: cylinder cap ratio
            let (top, bot) = (c.y - rad * 0.6, c.y + rad * 0.6); // allow-hardcode: cylinder height ratio
            for y in [top, c.y, bot] {
                p.add(egui::Shape::ellipse_stroke(pos2(c.x, y), vec2(rx, ry), s));
            }
            p.line_segment([pos2(c.x - rx, top), pos2(c.x - rx, bot)], s);
            p.line_segment([pos2(c.x + rx, top), pos2(c.x + rx, bot)], s);
        }
        TileGlyph::Retry => {
            let steps = 16usize; // allow-hardcode: arc tessellation steps
            let pts: Vec<_> = (0..=steps).map(|k| {
                let a = std::f32::consts::PI * (0.25 + 1.5 * k as f32 / steps as f32); // allow-hardcode: arc start/sweep
                c + vec2(a.cos(), a.sin()) * rad
            }).collect();
            p.add(egui::Shape::line(pts, s));
            p.line_segment([c + vec2(rad, -rad * 0.6), c + vec2(rad, -rad * 0.1)], s); // allow-hardcode: arrow tip
        }
        TileGlyph::Wait => {
            p.circle_stroke(c, rad, s);
            p.line_segment([c, pos2(c.x, c.y - rad * 0.55)], s); // allow-hardcode: clock hand
            p.line_segment([c, pos2(c.x + rad * 0.45, c.y)], s); // allow-hardcode: clock hand
        }
        TileGlyph::Stuck => {
            p.rect_stroke(Rect::from_center_size(c, Vec2::splat(rad * 1.6)), 3.0, s, StrokeKind::Middle); // allow-hardcode: stop box
            p.rect_filled(Rect::from_center_size(c, Vec2::splat(rad * 0.7)), 1.0, ink); // allow-hardcode: inner stop square
        }
        TileGlyph::Play => {
            p.add(egui::Shape::convex_polygon(vec![c + vec2(-rad * 0.5, -rad * 0.7), c + vec2(rad * 0.8, 0.0), c + vec2(-rad * 0.5, rad * 0.7)], ink, Stroke::NONE)); // allow-hardcode: play triangle
        }
        TileGlyph::CheckList => {
            for dy in [-rad * 0.55, 0.0, rad * 0.55] { // allow-hardcode: three checklist bars
                p.line_segment([pos2(c.x - rad, c.y + dy), pos2(c.x + rad * 0.6, c.y + dy)], s); // allow-hardcode: checklist bar
            }
        }
        TileGlyph::Kill => crate::icons::paint(p, "killFilters", r, ink),
        TileGlyph::Damage => crate::icons::paint(p, "damageFilters", r, ink),
        TileGlyph::Shot => crate::icons::paint(p, "shotFilters", r, ink),
        TileGlyph::Round => {
            p.circle_stroke(c, rad, s);
            p.circle_filled(c, rad * 0.35, ink); // allow-hardcode: round center dot
        }
        TileGlyph::Plus => {
            p.line_segment([pos2(c.x - rad * 0.6, c.y), pos2(c.x + rad * 0.6, c.y)], s); // allow-hardcode: plus bar
            p.line_segment([pos2(c.x, c.y - rad * 0.6), pos2(c.x, c.y + rad * 0.6)], s); // allow-hardcode: plus bar
        }
        TileGlyph::Clutch(n) => {
            let hero = pos2(r.left() + rad * 0.4, c.y); // allow-hardcode: clutch hero offset
            p.circle_filled(hero - vec2(0.0, rad * 0.35), rad * 0.25, ink); // allow-hardcode: hero head
            p.rect_filled(Rect::from_center_size(hero + vec2(0.0, rad * 0.25), vec2(rad * 0.45, rad * 0.7)), 1.0, ink); // allow-hardcode: hero torso
            let opp_ink = ink.gamma_multiply(DISABLED_ALPHA);
            for k in 0..n {
                let ox = r.center().x + f32::from(k % 3) * (rad * 0.42); // allow-hardcode: 3 opponents per row
                let oy = if k < 3 { c.y - rad * 0.25 } else { c.y + rad * 0.35 }; // allow-hardcode: 2 rows max
                p.circle_filled(pos2(ox, oy - rad * 0.2), rad * 0.16, opp_ink); // allow-hardcode: enemy head
                p.rect_filled(Rect::from_center_size(pos2(ox, oy + rad * 0.15), vec2(rad * 0.28, rad * 0.4)), 1.0, opp_ink); // allow-hardcode: enemy torso
            }
        }
    }
}
