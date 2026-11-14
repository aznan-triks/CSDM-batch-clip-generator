//! A tab's cards on the grid (3.5 `shell/SectionList.tsx` + `components/Card.tsx`):
//! move by the grip, resize by the corner, fold by the header, height follows content
//! unless set by hand, columns follow the pane width, layout saved per tab only when a
//! gesture ends. Placement rules: `csdm_core::grid`; stored shape: `csdm_core::card_layout`.

use crate::link::Link;
use crate::paint::{caret, cut_plate, grip, regular, semibold, spaced};
use crate::theme::Theme;
use crate::Cx;
use csdm_core::card_layout::{migrate, Decl, TabLayout};
use csdm_core::grid::{self, Geom, Item};
use csdm_core::ui_values::{
    CARD_BODY_PAD, CARD_BRACKET, CARD_BRACKET_INSET, CARD_GLYPH, CARD_GLYPH_ICON, CARD_HANDLE, CARD_HEADER_PAD, CARD_RADIUS, CARD_SPOT_RADIUS, FONT_CARD_COUNT, FONT_CARD_TITLE, GRID_GAP, SHADOW_ALPHA, SHADOW_BLUR, SHADOW_OFFSET, SPACING_COUNT,
};
use eframe::egui::{self, epaint, Align2, Color32, Pos2, Rect, Sense, Stroke, StrokeKind, Vec2};
use serde_json::{Map, Value};
use std::collections::HashMap;

const HEADER_H: f32 = CARD_GLYPH + CARD_HEADER_PAD[1] * 2.0;
const SEP: f32 = 1.0;
const GRIP: Vec2 = Vec2::new(8.0, 12.0);
const GLYPH_CUT: f32 = 7.0;
const BRACKET_ALPHA: f32 = 0.3;
const SPOT_SEGMENTS: usize = 96;
const SPOT_WIDTH: f32 = 1.5;
const HOVER_LIFT: f32 = 2.0;
const CARET_SIZE: f32 = 8.0;
const RESIZE_LINES: [f32; 3] = [4.0, 8.0, 12.0];
const RESIZE_INSET: f32 = 3.0;
const FALLBACK_BLOCK: f64 = 48.0;
const FALLBACK_ROW: f64 = 24.0;
const FALLBACK_COLLAPSED: f64 = 2.0;

/// A card a tab declares (title shown in the header, `count` the mock's `.cnt`).
pub struct CardDecl {
    pub id: &'static str,
    pub title: String,
    /// Glyph of `icons_data` shown in the header tile (3.5 `Card.tsx` `.gl`); `None`: no tile.
    pub icon: Option<&'static str>,
    pub count: Option<String>,
    /// Full width in the reference layout (the mock's `wide`).
    pub wide: bool,
}

/// What a card body receives.
pub struct CardCx<'a> {
    pub theme: &'a Theme,
    pub link: &'a mut Link,
    pub now: f64,
    /// `ui_always_show_tooltips`: write explanations under controls instead of on hover.
    pub always_tips: bool,
    /// Set by a body to put every tab's cards back on the reference layout (3.5 resetCards).
    pub reset_cards: bool,
}

/// A tab's content. T7-T11 implement it; the shell draws the cards it declares.
/// - `cards()`: one `CardDecl` per card, in 3.5 reading order (`id` = its key in `ui_sections`,
///   `icon` = a glyph name of `icons_data`, `wide` = full row in the reference layout).
/// - `body(id, ui, cx)`: draws card `id`. Settings: `cx.link.get(key)` / `cx.link.set(cx.now, key, v)`
///   (saved 400 ms after the last change); engine: `cx.link.send(cx.now, Command::…)`;
///   explanations: `widgets::tip(ui, cx.theme, resp, text, cx.always_tips)`.
/// - Registered with `Shell::with_tab(TabId::…, Box::new(view))` (one line in `main.rs`). Driven
///   tests: `tests/common::rig_with(scenario, Motion::Still, Some((TabId::…, Box::new(view))), false)`,
///   then `Rig::click(label)`, `Rig::setting(key)`, `Rig::sent()`.
pub trait TabView {
    fn cards(&self) -> Vec<CardDecl> {
        Vec::new()
    }
    fn body(&mut self, _id: &str, _ui: &mut egui::Ui, _cx: &mut CardCx) {}
    /// Tabs without a card grid (EDITING) draw their whole pane here.
    fn uses_grid(&self) -> bool {
        true
    }
    fn free(&mut self, _ui: &mut egui::Ui, _cx: &mut CardCx) {}
    /// Lets tests reach the concrete view.
    fn as_any_mut(&mut self) -> Option<&mut dyn std::any::Any> {
        None
    }
}

/// A tab with nothing on it yet.
pub struct EmptyTab {
    pub grid: bool,
}

impl TabView for EmptyTab {
    fn uses_grid(&self) -> bool {
        self.grid
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode { Move, Resize }

struct Drag {
    index: u32,
    mode: Mode,
    start: Vec<Item>,
    /// Pointer travel last seen: egui forgets the press origin on the release frame.
    travel: Vec2,
}

/// Per-tab render state: the gesture under way and the content heights measured last frame.
#[derive(Default)]
pub struct GridState {
    drag: Option<Drag>,
    measured: HashMap<String, i32>,
    /// Items as drawn last frame (tests read them).
    pub drawn: Vec<(String, Item)>,
}

fn setting_num(link: &Link, key: &str, fallback: f64) -> f64 {
    link.get(key).and_then(Value::as_f64).filter(|v| v.is_finite() && *v > 0.0).unwrap_or(fallback)
}

/// Geometry for a pane `width` px wide (3.5: one column = one block, as many as fit).
pub fn geometry(link: &Link, width: f32) -> Geom {
    let block = setting_num(link, "ui_card_block_size", FALLBACK_BLOCK) as f32;
    let row = setting_num(link, "ui_card_row_height", FALLBACK_ROW) as f32;
    let cols = (((width + GRID_GAP) / (block + GRID_GAP)).floor() as i32).max(1);
    Geom { cols, col: block, row, gap: GRID_GAP }
}

pub fn collapsed_rows(link: &Link) -> i32 {
    setting_num(link, "ui_card_collapsed_rows", FALLBACK_COLLAPSED).round().max(1.0) as i32
}

pub fn tab_layout(link: &Link, tab: &str, decls: &[CardDecl], cols: i32) -> TabLayout {
    let d: Vec<Decl> = decls.iter().map(|c| Decl { id: c.id, wide: c.wide }).collect();
    migrate(link.get("ui_sections").and_then(|s| s.get(tab)), &d, cols)
}

fn store(link: &mut Link, now: f64, tab: &str, layout: &TabLayout) {
    let mut all = link.get("ui_sections").and_then(Value::as_object).cloned().unwrap_or_else(Map::new);
    all.insert(tab.into(), layout.to_json());
    link.set(now, "ui_sections", Value::Object(all));
}

/// Draws `tab`'s cards inside `ui` (a vertical scroll area's content); returns their height.
pub fn show(ui: &mut egui::Ui, cx: &Cx, link: &mut Link, view: &mut dyn TabView, tab: &str, state: &mut GridState, reset: &mut bool) {
    let t = cx.theme;
    let decls = view.cards();
    let width = ui.available_width();
    let geom = geometry(link, width);
    let mut layout = tab_layout(link, tab, &decls, geom.cols);
    let folded_rows = collapsed_rows(link);
    let origin = ui.cursor().min;

    // Items for this frame: stored rectangles, heights fitted to content (render state only).
    let mut items = layout.items();
    if state.drag.is_none() {
        for (k, (id, _)) in layout.slots.iter().enumerate() {
            if layout.is_collapsed(id) {
                continue;
            }
            if let Some(rows) = state.measured.get(id) {
                grid::fit(&mut items, k as u32, *rows);
            }
        }
    }
    let travel = ui.input(|i| i.pointer.interact_pos().zip(i.pointer.press_origin()).map(|(p, o)| p - o));
    if let Some(d) = &mut state.drag {
        if let Some(tr) = travel {
            d.travel = tr;
        }
        let tr = d.travel;
        let (dc, dr) = geom.cells(tr.x, tr.y);
        let mut v = d.start.clone();
        let o = v[d.index as usize];
        match d.mode {
            Mode::Move => grid::move_card(&mut v, d.index, o.x + dc, o.y + dr, geom.cols),
            Mode::Resize => grid::resize_card(&mut v, d.index, o.w + dc, o.h + dr, geom.cols),
        }
        items = v;
    }

    let bottom = items.iter().map(|it| geom.rect(it)).map(|(_, y, _, h)| y + h).fold(0.0, f32::max);
    ui.allocate_space(Vec2::new(width, bottom));
    let pointer = ui.input(|i| i.pointer.hover_pos());
    let mut measured = HashMap::new();
    let mut gesture: Option<(u32, Mode, bool)> = None; // (index, mode, started) / stopped
    let mut toggled: Option<String> = None;
    let mut card_cx = CardCx { theme: t, link, now: cx.now, always_tips: false, reset_cards: false };
    card_cx.always_tips = card_cx.link.get("ui_always_show_tooltips") == Some(&Value::Bool(true));

    for (k, decl) in decls.iter().enumerate() {
        let it = items[k];
        let (x, y, w, h) = geom.rect(&it);
        let mut rect = Rect::from_min_size(origin + Vec2::new(x, y), Vec2::new(w, h));
        let folded = layout.is_collapsed(decl.id);
        let hovered = pointer.is_some_and(|p| rect.contains(p)) && state.drag.is_none();
        if hovered && cx.motion {
            rect = rect.translate(Vec2::new(0.0, -HOVER_LIFT));
        }
        paint_card(ui, t, rect, decl, folded, if hovered { pointer } else { None });

        // Header: the whole row folds; the grip moves.
        let header = Rect::from_min_size(rect.min, Vec2::new(w, HEADER_H));
        let grip_rect = Rect::from_center_size(Pos2::new(rect.left() + CARD_HEADER_PAD[0] + GRIP.x / 2.0, header.center().y), GRIP + Vec2::splat(CARD_HEADER_PAD[1]));
        let fold = ui.interact(header, ui.scope_id().with(("fold", decl.id)), Sense::click());
        let title = decl.title.clone();
        fold.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, if folded { format!("Expand {title} card") } else { format!("Collapse {title} card") }));
        let mover = ui.interact(grip_rect, ui.scope_id().with(("move", decl.id)), Sense::drag());
        mover.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, format!("Move {title}")));
        let mover = mover.on_hover_text("Drag to move this card within the grid");
        if mover.hovered() || mover.dragged() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
        }
        if fold.clicked() {
            toggled = Some(decl.id.to_string());
        }
        if mover.drag_started() {
            gesture = Some((k as u32, Mode::Move, true));
        }
        if mover.drag_stopped() {
            gesture = Some((k as u32, Mode::Move, false));
        }

        if !folded {
            let corner = Rect::from_min_size(rect.max - Vec2::splat(CARD_HANDLE), Vec2::splat(CARD_HANDLE));
            let handle = ui.interact(corner, ui.scope_id().with(("resize", decl.id)), Sense::drag());
            handle.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, format!("Resize {title}")));
            if handle.hovered() || handle.dragged() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::ResizeNwSe);
            }
            for o in RESIZE_LINES {
                ui.painter().line_segment([corner.max - Vec2::new(o, RESIZE_INSET), corner.max - Vec2::new(RESIZE_INSET, o)], Stroke::new(1.0, t.faint));
            }
            if handle.drag_started() {
                gesture = Some((k as u32, Mode::Resize, true));
            }
            if handle.drag_stopped() {
                gesture = Some((k as u32, Mode::Resize, false));
            }

            // Body: laid out at the card's width, its natural height measured for the next frame.
            let body = Rect::from_min_max(Pos2::new(rect.left() + CARD_BODY_PAD[0], rect.top() + HEADER_H + SEP), Pos2::new(rect.right() - CARD_BODY_PAD[0], rect.bottom() - CARD_BODY_PAD[1]));
            let mut child = ui.new_child(egui::UiBuilder::new().max_rect(body).id_salt(("card", decl.id)));
            child.set_clip_rect(body.intersect(ui.clip_rect()));
            let out = egui::ScrollArea::vertical().id_salt(("card-scroll", decl.id)).auto_shrink([false, true]).max_height(body.height().max(0.0)).show(&mut child, |ui| {
                ui.set_width(body.width());
                view.body(decl.id, ui, &mut card_cx);
            });
            let natural = HEADER_H + SEP + out.content_size.y + CARD_BODY_PAD[1];
            measured.insert(decl.id.to_string(), geom.rows_for(natural));
        }
    }
    *reset |= card_cx.reset_cards;
    let link = card_cx.link;

    // Gestures: start remembers the layout, stop writes it back (the only time a rectangle is saved).
    if let Some((index, mode, started)) = gesture {
        if started {
            state.drag = Some(Drag { index, mode, start: items.clone(), travel: Vec2::ZERO });
        } else if let Some(d) = state.drag.take() {
            let resized = (d.mode == Mode::Resize).then_some(d.index);
            layout.save_items(&items, resized);
            store(link, cx.now, tab, &layout);
        }
        ui.ctx().request_repaint();
    }
    if let Some(id) = toggled {
        let mut fresh = layout.clone();
        // Fold from what is on screen, so the remembered height is the fitted one.
        fresh.save_items(&items, None);
        fresh.toggle_collapsed(&id, folded_rows);
        store(link, cx.now, tab, &fresh);
    }
    // Content heights apply on the next frame (egui measures while drawing).
    if measured != state.measured && state.drag.is_none() {
        state.measured = measured;
        ui.ctx().request_repaint();
    }
    state.drawn = decls.iter().map(|d| d.id.to_string()).zip(items).collect();
}

fn paint_card(ui: &egui::Ui, t: &Theme, rect: Rect, decl: &CardDecl, folded: bool, pointer: Option<Pos2>) {
    let p = ui.painter();
    p.add(epaint::Shadow { offset: SHADOW_OFFSET, blur: SHADOW_BLUR, spread: 0, color: Color32::from_black_alpha(SHADOW_ALPHA) }.as_shape(rect, CARD_RADIUS));
    p.rect(rect, CARD_RADIUS, t.surface, Stroke::new(1.0, t.border), StrokeKind::Inside);
    // Corner brackets (`.cbr`).
    let bc = t.accent.gamma_multiply(BRACKET_ALPHA);
    let s = Stroke::new(2.0, bc);
    let tl = rect.min + Vec2::splat(CARD_BRACKET_INSET);
    p.line_segment([tl, tl + Vec2::new(CARD_BRACKET, 0.0)], s);
    p.line_segment([tl, tl + Vec2::new(0.0, CARD_BRACKET)], s);
    let br = rect.max - Vec2::splat(CARD_BRACKET_INSET);
    p.line_segment([br, br - Vec2::new(CARD_BRACKET, 0.0)], s);
    p.line_segment([br, br - Vec2::new(0.0, CARD_BRACKET)], s);
    if let Some(at) = pointer {
        spotlight(p, rect, at, t.accent);
    }
    // Header row.
    let cy = rect.top() + HEADER_H / 2.0;
    let mut x = rect.left() + CARD_HEADER_PAD[0];
    grip(p, Rect::from_center_size(Pos2::new(x + GRIP.x / 2.0, cy), GRIP), t.faint);
    x += GRIP.x + CARD_HEADER_PAD[1] / 2.0;
    if let Some(icon) = decl.icon {
        // `.sh .gl`: 30 px tile, 16 px glyph in the accent.
        let glyph = Rect::from_min_size(Pos2::new(x, cy - CARD_GLYPH / 2.0), Vec2::splat(CARD_GLYPH));
        cut_plate(p, glyph, GLYPH_CUT, t.accent_soft, Stroke::NONE);
        crate::icons::paint(p, icon, Rect::from_center_size(glyph.center(), Vec2::splat(CARD_GLYPH_ICON)), t.accent);
        x = glyph.right() + CARD_HEADER_PAD[1] - 2.0;
    }
    p.text(Pos2::new(x, cy), Align2::LEFT_CENTER, &decl.title, semibold(FONT_CARD_TITLE), t.txt);
    let right = rect.right() - CARD_HEADER_PAD[0];
    caret(p, Pos2::new(right - CARET_SIZE / 2.0, cy), CARET_SIZE, t.faint, !folded);
    if let Some(c) = &decl.count {
        spaced(p, Pos2::new(right - CARET_SIZE - CARD_HEADER_PAD[1], cy), Align2::RIGHT_CENTER, &c.to_uppercase(), regular(FONT_CARD_COUNT), t.muted, SPACING_COUNT);
    }
    if !folded {
        p.hline(rect.left() + CARD_HEADER_PAD[0]..=rect.right() - CARD_HEADER_PAD[0], rect.top() + HEADER_H, Stroke::new(SEP, t.hair2));
    }
}

/// The cursor-follow rim (`.spot`): the border lit in the accent near the pointer.
fn spotlight(p: &egui::Painter, rect: Rect, at: Pos2, accent: Color32) {
    let r = CARD_RADIUS;
    let inner = rect.shrink(r);
    let mut pts = Vec::with_capacity(SPOT_SEGMENTS);
    for i in 0..SPOT_SEGMENTS {
        let a = i as f32 / SPOT_SEGMENTS as f32 * std::f32::consts::TAU;
        let d = Vec2::new(a.cos(), a.sin());
        let c = Pos2::new(if d.x >= 0.0 { inner.right() } else { inner.left() }, if d.y >= 0.0 { inner.bottom() } else { inner.top() });
        pts.push(c + d * r);
    }
    let mut m = epaint::Mesh::default();
    for q in &pts {
        let k = (1.0 - q.distance(at) / CARD_SPOT_RADIUS).clamp(0.0, 1.0);
        let col = accent.gamma_multiply(k);
        let n = (*q - rect.center()).normalized();
        m.colored_vertex(*q, col);
        m.colored_vertex(*q - n * SPOT_WIDTH, col);
    }
    let n = SPOT_SEGMENTS as u32;
    for i in 0..n {
        let (a, b) = (2 * i, 2 * ((i + 1) % n));
        m.add_triangle(a, a + 1, b);
        m.add_triangle(a + 1, b + 1, b);
    }
    p.add(m);
}
