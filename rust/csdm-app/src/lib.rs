//! The window (T6): top band with the five tabs, the tab's cards on the grid, the console,
//! the action band, the backdrop, the reticle. Talks to the engine only through
//! `csdm_engine::Engine` (`Command` out, `EngineEvent` in), held by `link::Link`.
//!
//! Tabs (T7-T11) plug in with `Shell::with_tab` and a `grid::TabView`.

pub mod actionbar;
pub mod backdrop;
pub mod cardstyle;
pub mod console;
pub mod controls;
pub mod cursor;
pub mod grid;
pub mod icons;
mod icons_data;
pub mod link;
pub mod narrate;
pub mod nav;
pub mod paint;
pub mod sys;
pub mod tabs;
pub mod theme;
pub mod widgets;

use crate::actionbar::ActionBar;
use crate::backdrop::Backdrop;
use crate::console::Console;
use crate::cursor::Cursor;
use crate::grid::{EmptyTab, GridState, TabView};
use crate::link::{Link, Notice};
use crate::tabs::{TabId, TABS};
use crate::theme::Theme;
use csdm_core::ui_values::{
    EXPORT_DIR_ENV, EXPORT_SUBDIR, MOTION_ENV, NAV_HEIGHT, PANE_LEFT_MIN, PANE_RIGHT_MIN, SHELL_GAP, SHELL_PAD, SPLIT_PCT_DEFAULT, SPLIT_PCT_MAX, SPLIT_PCT_MIN,
};
use csdm_engine::event::{Level, StateName};
use csdm_engine::Engine;
use eframe::egui::{self, Align2, Color32, Pos2, Rect, Sense, Stroke, Vec2};
use serde_json::{json, Value};
use std::path::PathBuf;

pub const CORNER_MID: u8 = 13;
pub const CORNER_SMALL: u8 = 10;
pub const DIALOG_PAD: i8 = 18;
pub const ASK_PAD: i8 = 8;
pub const CONSOLE_BODY_ID: &str = "console-body";
const AMBIENT: [([f32; 2], [f32; 2]); 3] = [([0.84, -0.04], [1100.0, 560.0]), ([1.12, 0.46], [900.0, 640.0]), ([-0.06, 1.16], [760.0, 480.0])];
const AMBIENT_FADE: f32 = 0.56;
const BANNER_HEIGHT: f32 = 34.0;
const PCT: f64 = 100.0;
const HANDLE_GRIP: Vec2 = Vec2::new(2.0, 28.0);

/// Whether animations run (3.5 motion gate): `Auto` follows the window (inactive or
/// minimised window, or Windows "show animations" off ⇒ still).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Motion { Auto, Full, Still }

impl Motion {
    /// `CSDM_MOTION=full|none` for the bench and tests; anything else follows the window.
    pub fn from_env() -> Self {
        match std::env::var(MOTION_ENV).as_deref() {
            Ok("full") => Motion::Full,
            Ok("none") => Motion::Still,
            _ => Motion::Auto,
        }
    }
}

/// 3.5 motion gate: an inactive or minimised window, or Windows' reduced motion, animates nothing.
pub fn motion_gate(focused: bool, minimized: bool, reduced_motion: bool) -> bool {
    focused && !minimized && !reduced_motion
}

pub struct ShellOptions {
    pub motion: Motion,
    /// Where exported files land (3.5: the downloads folder).
    pub export_dir: PathBuf,
}

impl ShellOptions {
    pub fn from_env() -> Self {
        let home = std::env::var_os(EXPORT_DIR_ENV).map(PathBuf::from).unwrap_or_default();
        Self { motion: Motion::from_env(), export_dir: home.join(EXPORT_SUBDIR) }
    }
}

/// What a frame's drawing code reads.
pub struct Cx<'a> {
    pub theme: &'a Theme,
    pub now: f64,
    pub motion: bool,
}

pub struct Shell {
    pub link: Link,
    pub active: TabId,
    views: Vec<Box<dyn TabView>>,
    pub grids: Vec<GridState>,
    pub console: Console,
    pub bar: ActionBar,
    backdrop: Backdrop,
    pub cursor: Cursor,
    theme: Theme,
    theme_key: (String, String),
    motion: Motion,
    pub editing_badge: bool,
    last_preview_serial: u64,
    accent_warned: bool,
    window_applied: bool,
    reduced: (bool, f64),
    /// `ui_font_family` last applied (T11).
    font_key: Option<String>,
}

fn text_setting(link: &Link, key: &str) -> String {
    link.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

impl Shell {
    pub fn new(ctx: &egui::Context, engine: Box<dyn Engine>, options: ShellOptions) -> Self {
        paint::install_fonts(ctx);
        let theme = Theme::new("", theme::default_accent());
        ctx.set_visuals(theme.visuals());
        let mut link = Link::new(engine);
        link.boot(ctx.input(|i| i.time));
        let views: Vec<Box<dyn TabView>> = TABS.iter().map(|t| Box::new(EmptyTab { grid: t.id != TabId::Editing }) as Box<dyn TabView>).collect();
        Self {
            link,
            active: TabId::Capture,
            views,
            grids: TABS.iter().map(|_| GridState::default()).collect(),
            console: Console::new(options.export_dir),
            bar: ActionBar::default(),
            backdrop: Backdrop::default(),
            cursor: Cursor::default(),
            theme,
            theme_key: (String::new(), String::new()),
            motion: options.motion,
            editing_badge: false,
            last_preview_serial: 0,
            accent_warned: false,
            window_applied: false,
            reduced: (false, f64::NEG_INFINITY),
            font_key: None,
        }
    }

    /// Puts a tab's content in place (T7-T11).
    pub fn with_tab(mut self, id: TabId, view: Box<dyn TabView>) -> Self {
        self.views[tabs::index(id)] = view;
        self
    }

    /// The concrete view of a tab, when it offers one (tests).
    pub fn view<T: 'static>(&mut self, id: TabId) -> Option<&mut T> {
        self.views[tabs::index(id)].as_any_mut()?.downcast_mut::<T>()
    }

    pub fn theme(&self) -> &Theme {
        &self.theme
    }

    fn motion_on(&mut self, ctx: &egui::Context, now: f64) -> bool {
        match self.motion {
            Motion::Full => true,
            Motion::Still => false,
            Motion::Auto => {
                let (focused, minimized) = ctx.input(|i| (i.focused, i.viewport().minimized.unwrap_or(false)));
                if now - self.reduced.1 >= 1.0 {
                    self.reduced = (sys::reduced_motion(), now);
                }
                motion_gate(focused, minimized, self.reduced.0)
            }
        }
    }

    fn refresh_theme(&mut self, ctx: &egui::Context, now: f64) {
        let key = (text_setting(&self.link, "theme_bg"), text_setting(&self.link, "theme_accent"));
        if key == self.theme_key || !self.link.settings_loaded {
            return;
        }
        let accent = match theme::resolve_accent(&key.1) {
            Some(a) => a,
            None => {
                if !self.accent_warned && !key.1.is_empty() {
                    self.accent_warned = true;
                    self.console.flash(&format!("The saved accent colour \"{}\" is not a colour: the default blue is used.", key.1), Level::Warn, now);
                }
                theme::default_accent()
            }
        };
        self.theme = Theme::new(&key.0, accent);
        ctx.set_visuals(self.theme.visuals());
        ctx.request_repaint();
        self.theme_key = key;
    }

    /// Window size and split are remembered (`ui_remember_layout`).
    fn remember_window(&mut self, ctx: &egui::Context, now: f64) {
        if !self.link.settings_loaded || self.link.get("ui_remember_layout") == Some(&Value::Bool(false)) {
            return;
        }
        let size = ctx.input(|i| i.viewport().inner_rect.map(|r| r.size()));
        let Some(size) = size else { return };
        let stored = |k: &str| self.link.get(k).and_then(Value::as_f64);
        if !self.window_applied {
            self.window_applied = true;
            if let (Some(w), Some(h)) = (stored("ui_window_w"), stored("ui_window_h")) {
                if (w as f32, h as f32) != (size.x, size.y) {
                    ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(Vec2::new(w as f32, h as f32)));
                }
            }
            return;
        }
        self.link.set(now, "ui_window_w", json!(size.x.round() as i64));
        self.link.set(now, "ui_window_h", json!(size.y.round() as i64));
    }

    fn react(&mut self, notices: &[Notice], now: f64, motion: bool) {
        for n in notices {
            if let Notice::State { name, .. } = n {
                self.bar.weapon.on_state(*name, now, motion);
                if *name == StateName::PreviewReady && self.link.state.preview_serial != self.last_preview_serial {
                    self.last_preview_serial = self.link.state.preview_serial;
                    // A preview with clips takes the user to them (3.5 AppShell).
                    if self.link.preview_count() > 0 {
                        self.active = TabId::Editing;
                    }
                    self.editing_badge = self.link.preview_count() > 0 && self.active != TabId::Editing;
                }
            }
        }
    }

    pub fn split_pct(&self) -> f64 {
        self.link.get("ui_split_pct").and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(SPLIT_PCT_DEFAULT).clamp(SPLIT_PCT_MIN, SPLIT_PCT_MAX)
    }

    /// One frame of the whole window.
    pub fn frame(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let now = ctx.input(|i| i.time);
        let motion = self.motion_on(&ctx, now);
        let mut notices = self.link.pump(now);
        self.react(&notices, now, motion);
        self.console.take(&mut notices, &self.link, now);
        self.refresh_theme(&ctx, now);
        let font = text_setting(&self.link, "ui_font_family");
        // Applied once typing has settled (no save pending): one font load, one message.
        if self.link.settings_loaded && self.link.save_due_in(now).is_none() && self.font_key.as_ref() != Some(&font) {
            if let Err(e) = tabs::settings::font::apply_mono(&ctx, &font) {
                self.console.flash(&e, Level::Warn, now);
            }
            self.font_key = Some(font);
        }
        self.remember_window(&ctx, now);
        if ctx.input(|i| i.viewport().close_requested()) {
            self.link.flush(now);
        }
        if let Some(wait) = self.link.save_due_in(now) {
            ctx.request_repaint_after_secs(wait as f32);
        }
        if self.active == TabId::Editing {
            self.editing_badge = false;
        }

        let theme = self.theme.clone();
        let cx = Cx { theme: &theme, now, motion };
        let full = ui.max_rect();
        let bg = ui.painter().clone();
        crate::paint::vgradient(&bg, full, theme.page0, theme.page1);
        for ((at, radius), color) in AMBIENT.iter().zip(theme.amb) {
            crate::paint::radial_glow(&bg, Pos2::new(full.left() + full.width() * at[0], full.top() + full.height() * at[1]), Vec2::from(*radius), color, 1.0 - AMBIENT_FADE / 2.0);
        }
        let pointer = ctx.input(|i| i.pointer.hover_pos());
        if let Some(wait) = self.backdrop.paint(&bg, full, &Cx { theme: &theme, now, motion }, tabs::spec(self.active).key, pointer) {
            ctx.request_repaint_after_secs(wait as f32);
        }

        let nav = Rect::from_min_size(full.min, Vec2::new(full.width(), NAV_HEIGHT));
        let bar_h = actionbar::bar_height();
        let bar = Rect::from_min_max(Pos2::new(full.left(), full.bottom() - bar_h), full.max);
        let mut shell = Rect::from_min_max(Pos2::new(full.left(), nav.bottom()), Pos2::new(full.right(), bar.top())).shrink2(Vec2::from(SHELL_PAD));
        if self.link.lost {
            let banner = Rect::from_min_size(Pos2::new(full.left(), bar.top() - BANNER_HEIGHT), Vec2::new(full.width(), BANNER_HEIGHT));
            shell.max.y = banner.top() - SHELL_PAD[1];
            ui.painter().rect_filled(banner, 0.0, theme.rose.gamma_multiply(1.0 / 2.0 / 2.0));
            let text = "The engine stopped. Restart the app to continue; details are in csdm_errors.log next to the settings.";
            let r = ui.painter().text(banner.center(), Align2::CENTER_CENTER, text, paint::semibold(csdm_core::ui_values::FONT_BODY), theme.txt);
            let resp = ui.interact(r, ui.scope_id().with("engine-lost"), Sense::hover());
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Alert, true, text));
        }

        // Split: content pane | handle | console.
        let pct = self.split_pct();
        let usable = shell.width() - SHELL_GAP;
        let left_w = ((usable as f64 * pct / PCT) as f32).clamp(PANE_LEFT_MIN.min(usable - PANE_RIGHT_MIN), (usable - PANE_RIGHT_MIN).max(PANE_LEFT_MIN));
        let pane = Rect::from_min_size(shell.min, Vec2::new(left_w, shell.height()));
        let handle = Rect::from_min_size(Pos2::new(pane.right(), shell.top()), Vec2::new(SHELL_GAP, shell.height()));
        let console = Rect::from_min_max(Pos2::new(handle.right(), shell.top()), shell.max);

        let k = tabs::index(self.active);
        let tab_key = tabs::spec(self.active).key;
        let mut reset = false;
        {
            let mut child = ui.new_child(egui::UiBuilder::new().max_rect(pane).id_salt(("pane", tab_key)));
            child.set_clip_rect(pane);
            let view = &mut self.views[k];
            if view.uses_grid() {
                let grid_state = &mut self.grids[k];
                let link = &mut self.link;
                egui::ScrollArea::vertical().id_salt(("grid-scroll", tab_key)).auto_shrink(false).show(&mut child, |ui| {
                    grid::show(ui, &cx, link, view.as_mut(), tab_key, grid_state, &mut reset);
                });
            } else {
                let mut card_cx = grid::CardCx { theme: &theme, link: &mut self.link, now, always_tips: false, reset_cards: false };
                view.free(&mut child, &mut card_cx);
                reset |= card_cx.reset_cards;
            }
        }
        if reset {
            self.link.set(now, "ui_sections", json!({}));
        }

        let split = ui.interact(handle, ui.scope_id().with("split"), Sense::drag());
        split.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Splitter, true, "Resize console"));
        let split = split.on_hover_text("Drag to resize the workspace and console panes");
        if split.hovered() || split.dragged() {
            ctx.set_cursor_icon(egui::CursorIcon::ResizeHorizontal);
            ui.painter().rect_filled(Rect::from_center_size(handle.center(), HANDLE_GRIP), 1.0, theme.accent_alpha(PCT as f32 / 2.0));
        }
        if split.dragged() {
            if let Some(x) = ctx.input(|i| i.pointer.interact_pos()).map(|q| q.x) {
                let v = ((x - shell.left()) as f64 / shell.width() as f64 * PCT).round().clamp(SPLIT_PCT_MIN, SPLIT_PCT_MAX);
                self.link.set(now, "ui_split_pct", json!(v as i64));
            }
        }

        self.console.show(ui, console, &cx, &mut self.link);
        if let Some(t) = nav::show(ui, nav, &cx, &self.link, self.active, self.editing_badge) {
            self.active = t;
        }
        let out = self.bar.show(ui, bar, &cx, &mut self.link, self.active);
        if out.go_capture {
            self.active = TabId::Capture;
        }
        self.cursor.finish(&ctx, &theme, now, motion);
        let _ = Color32::TRANSPARENT;
        let _ = Stroke::NONE;
    }
}

impl eframe::App for Shell {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.frame(ui);
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        self.link.flush(f64::MAX);
    }
}
