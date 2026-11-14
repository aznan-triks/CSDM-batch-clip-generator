//! The console column (3.5 `shell/LogConsole.tsx`): every narrated line, search,
//! timestamps, badges, copy, exports, the engine's question panel and the mute prompt.
//!
//! The lines are one read-only `TextEdit` with a colouring layouter, so a selection
//! can be read back for « Copy sel. » (labels give no access to their selection).

use crate::link::{Link, Notice};
use crate::narrate::{narrate, prompt_for, recite_selection, Narrated};
use crate::paint::{mono, regular, semibold};
use crate::theme::Theme;
use crate::widgets::{chip, tool_chip};
use crate::Cx;
use csdm_core::ui_values::{
    FONT_TOOL_CHIP,
    CARET_PERIOD_S, CONSOLE_BODY_PAD, CONSOLE_FLASH_S, CONSOLE_HEADER_PAD, CONSOLE_HTML_FILE, CONSOLE_LINE_HEIGHT, CONSOLE_LOG_FILE, CONSOLE_MAX_RENDERED, CONSOLE_TOOL_GAP, FONT_CONSOLE,
    FONT_CONSOLE_TITLE, FONT_SMALL, SPACING_CONSOLE_TITLE, TRACE_FILE, TYPE_CHAR_S, TYPE_LINE_GAP_S, TYPE_MAX_TYPED,
};
use csdm_engine::event::{Ask, AskKind, Level};
use eframe::egui::{self, text::LayoutJob, Color32, Pos2, Rect, Stroke, TextFormat, Vec2};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

const SEARCH_WIDTH: f32 = 96.0;
const CARET: Vec2 = Vec2::new(7.0, 12.0);
const MARK_PCT: f32 = 28.0;
const CURRENT_PCT: f32 = 12.0;
const TOP_RULE: f32 = 2.0;
/// `.console .ch b`: `color-mix(in srgb, var(--accent) 60%, var(--muted))`.
const TITLE_ACCENT_SHARE: f32 = 0.6;
/// Light console ink (`.console .body` colour); night grounds use their text colour.
const DAY_INK: Color32 = Color32::from_rgb(0x3b, 0x4a, 0x61);

#[derive(Clone, Debug)]
pub struct Line {
    pub key: u64,
    runs: Vec<(String, Level)>,
    text: String,
    level: Level,
    ts: String,
    flash_until: Option<f64>,
}

/// The console's own typewriter (3.5 `useTypewriter`): one line at a time, at most the
/// last `TYPE_MAX_TYPED` typed, everything at once when motion is off.
#[derive(Default)]
struct Typewriter {
    done: usize,
    chars: usize,
    next_at: f64,
}

impl Typewriter {
    /// Advances to `now`; returns the delay to the next character, if any is left.
    fn tick(&mut self, lengths: &[usize], now: f64, motion: bool) -> Option<f64> {
        let total = lengths.len();
        if !motion {
            self.done = total;
            self.chars = 0;
            return None;
        }
        let floor = total.saturating_sub(TYPE_MAX_TYPED);
        if self.done < floor {
            self.done = floor;
            self.chars = 0;
        }
        if self.done >= total {
            self.next_at = now;
            return None;
        }
        while self.done < total && now >= self.next_at {
            if self.chars >= lengths[self.done] {
                self.done += 1;
                self.chars = 0;
                self.next_at += TYPE_LINE_GAP_S;
            } else {
                self.chars += 1;
                self.next_at += TYPE_CHAR_S;
            }
        }
        (self.done < total).then(|| (self.next_at - now).max(0.0))
    }

    fn budget(&self, index: usize) -> usize {
        match index.cmp(&self.done) {
            std::cmp::Ordering::Less => usize::MAX,
            std::cmp::Ordering::Equal => self.chars,
            std::cmp::Ordering::Greater => 0,
        }
    }
}

pub struct Console {
    lines: Vec<Line>,
    next_key: u64,
    asks: VecDeque<Ask>,
    ask_text: String,
    /// The front question's text field took the focus once (3.5 `autoFocus`).
    ask_focused: bool,
    pub search: String,
    search_index: i64,
    focus_search: bool,
    pub autoscroll: bool,
    pub timestamps: bool,
    pub badges: bool,
    pub copy_status: String,
    prompt: &'static str,
    typer: Typewriter,
    export_dir: PathBuf,
    scroll_to_current: bool,
    /// Last text placed on the clipboard (tests read it; egui owns the real clipboard).
    pub last_copied: Option<String>,
}

fn level_name(l: Level) -> &'static str {
    match l {
        Level::Err => "err",
        Level::Warn => "warn",
        Level::Ok => "ok",
        Level::Dim => "dim",
        Level::Info => "info",
        Level::Plain => "",
    }
}

fn ink(t: &Theme, l: Level) -> Color32 {
    match l {
        Level::Err => t.rose,
        Level::Warn => t.amber,
        Level::Ok => t.emerald,
        Level::Dim => t.faint,
        Level::Info => t.accent,
        Level::Plain => if t.dark { t.txt } else { DAY_INK },
    }
}

/// `name.ext`, or `name (n).ext` when taken: an export never overwrites an earlier one.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (1..).map(|n| dir.join(format!("{stem} ({n}).{ext}"))).find(|p| !p.exists()).expect("an unused name exists")
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

impl Console {
    pub fn new(export_dir: PathBuf) -> Self {
        Self {
            lines: Vec::new(),
            next_key: 0,
            asks: VecDeque::new(),
            ask_text: String::new(),
            ask_focused: false,
            search: String::new(),
            search_index: 0,
            focus_search: false,
            autoscroll: true,
            timestamps: true,
            badges: false,
            copy_status: String::new(),
            prompt: "",
            typer: Typewriter::default(),
            export_dir,
            scroll_to_current: false,
            last_copied: None,
        }
    }

    fn push(&mut self, n: Narrated, flash_until: Option<f64>) {
        self.next_key += 1;
        let text = n.runs.iter().map(|(t, _)| t.as_str()).collect();
        self.lines.push(Line { key: self.next_key, runs: n.runs, text, level: n.level, ts: crate::sys::local_hms(), flash_until });
    }

    /// Every line, flattened (what search and exports read).
    pub fn texts(&self) -> Vec<String> {
        self.lines.iter().map(|l| l.text.clone()).collect()
    }

    pub fn pending_asks(&self) -> usize {
        self.asks.len()
    }

    /// A status line that leaves by itself after `CONSOLE_FLASH_S` (3.5 P4).
    pub fn flash(&mut self, text: &str, level: Level, now: f64) {
        self.push(Narrated { runs: vec![(text.to_string(), level)], level }, Some(now + CONSOLE_FLASH_S));
    }

    /// Takes the notices of a frame: narration, selection recital, prompt, questions, files.
    pub fn take(&mut self, notices: &mut Vec<Notice>, link: &Link, now: f64) {
        for n in notices.iter() {
            if let Some(p) = prompt_for(n) {
                self.prompt = p;
            }
            if let Some(line) = narrate(n) {
                self.push(line, None);
            }
            for line in recite_selection(n, &link.settings) {
                self.push(line, None);
            }
        }
        for n in notices.drain(..) {
            match n {
                Notice::Ask(a) => self.asks.push_back(a),
                Notice::PreviewExport { content, filename, clips } => match self.save(&filename, &content) {
                    Ok(_) => self.flash(&format!("✓ Preview exported ({clips} clips)"), Level::Ok, now),
                    Err(e) => self.flash(&format!("✗ The preview could not be saved: {e}"), Level::Err, now),
                },
                Notice::Injection(rows) => {
                    self.push(Narrated { runs: vec![("── CS2 injection preview ──".into(), Level::Dim)], level: Level::Dim }, None);
                    for (text, kind) in rows {
                        let l = if kind == "dim" { Level::Dim } else if kind == "key" { Level::Info } else { Level::Plain };
                        self.push(Narrated { runs: vec![(text, l)], level: l }, None);
                    }
                }
                _ => {}
            }
        }
    }

    /// Writes an exported file into the export folder; the path, or a sentence.
    pub fn save(&self, name: &str, content: &str) -> Result<PathBuf, String> {
        std::fs::create_dir_all(&self.export_dir).map_err(|e| format!("{} ({e})", self.export_dir.display()))?;
        let path = free_path(&self.export_dir, name);
        std::fs::write(&path, content).map_err(|e| format!("{} ({e})", path.display()))?;
        Ok(path)
    }

    fn recorded(&self) -> impl Iterator<Item = &Line> {
        self.lines.iter().filter(|l| l.flash_until.is_none())
    }

    pub fn as_text(&self) -> String {
        self.recorded().map(|l| format!("{} {}", l.ts, l.text)).collect::<Vec<_>>().join("\n")
    }

    pub fn as_html(&self) -> String {
        let body: Vec<String> = self.recorded().map(|l| format!("<div class=\"line-{}\">{}</div>", level_name(l.level), escape_html(&l.text))).collect();
        format!("<!doctype html><html><head><meta charset=\"utf-8\"><title>CSDM console export</title></head><body><pre>{}</pre></body></html>", body.join("\n"))
    }

    fn answer(&mut self, value: Option<String>) {
        if let Some(a) = self.asks.pop_front() {
            // The engine thread waits on this; a closed engine is already reported by the link.
            let _ = a.reply.send(value);
            self.ask_text.clear();
            self.ask_focused = false;
        }
    }

    fn needle(&self) -> String {
        self.search.trim().to_lowercase()
    }

    /// The console column in `rect`.
    pub fn show(&mut self, ui: &mut egui::Ui, rect: Rect, cx: &Cx, link: &mut Link) {
        let t = cx.theme;
        let now = cx.now;
        // Flash lines leave on time.
        let before = self.lines.len();
        self.lines.retain(|l| l.flash_until.is_none_or(|u| u > now));
        if let Some(next) = self.lines.iter().filter_map(|l| l.flash_until).reduce(f64::min) {
            ui.ctx().request_repaint_after_secs((next - now).max(0.0) as f32);
        }
        if before != self.lines.len() {
            ui.ctx().request_repaint();
        }
        if ui.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, egui::Key::F)) {
            self.focus_search = true;
        }

        let p = ui.painter_at(rect);
        let radius = csdm_core::ui_values::CARD_RADIUS;
        p.add(egui::epaint::Shadow { offset: csdm_core::ui_values::SHADOW_OFFSET, blur: csdm_core::ui_values::SHADOW_BLUR, spread: 0, color: Color32::from_black_alpha(csdm_core::ui_values::SHADOW_ALPHA) }.as_shape(rect, radius));
        p.rect(rect, radius, t.band, Stroke::new(1.0, t.accent_alpha(MARK_PCT).lerp_to_gamma(t.hair, 1.0 / 2.0)), egui::StrokeKind::Inside);
        crate::paint::hrule(&p, Rect::from_min_size(rect.min + Vec2::new(radius, 0.0), Vec2::new(rect.width() - radius * 2.0, TOP_RULE)), &[t.lime_glow, t.accent, Color32::TRANSPARENT]);

        let mut col = ui.new_child(egui::UiBuilder::new().max_rect(rect.shrink2(Vec2::from(CONSOLE_HEADER_PAD))).layout(egui::Layout::top_down(egui::Align::Min)));
        col.set_clip_rect(rect);
        self.header(&mut col, cx, link);
        if !self.needle().is_empty() {
            self.search_bar(&mut col, t);
        }
        if !self.asks.is_empty() {
            self.ask_panel(&mut col, t);
        }
        col.add_space(CONSOLE_BODY_PAD[1] - CONSOLE_HEADER_PAD[1]);
        self.body(&mut col, cx);
    }

    fn header(&mut self, ui: &mut egui::Ui, cx: &Cx, link: &mut Link) {
        let t = cx.theme;
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing.x = CONSOLE_TOOL_GAP;
            let ink = t.accent.lerp_to_gamma(t.muted, 1.0 - TITLE_ACCENT_SHARE);
            let title = crate::paint::spaced_galley(ui.painter(), "CONSOLE", semibold(FONT_CONSOLE_TITLE), ink, SPACING_CONSOLE_TITLE);
            let r = ui.allocate_space(Vec2::new(title.size().x, FONT_CONSOLE_TITLE * 2.0)).1;
            ui.painter().galley(Pos2::new(r.left(), r.center().y - title.size().y / 2.0), title, ink);
            let search = egui::TextEdit::singleline(&mut self.search).hint_text("filter…").desired_width(SEARCH_WIDTH).font(mono(FONT_CONSOLE));
            let resp = ui.add(search).on_hover_text("Search the console (Ctrl+F). Enter: next match, Shift+Enter: previous, Esc: close");
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, "Search"));
            if self.focus_search {
                resp.request_focus();
                self.focus_search = false;
            }
            if resp.changed() {
                self.search_index = 0;
                self.scroll_to_current = true;
            }
            if resp.has_focus() || resp.lost_focus() {
                let (enter, shift, esc) = ui.input(|i| (i.key_pressed(egui::Key::Enter), i.modifiers.shift, i.key_pressed(egui::Key::Escape)));
                if enter {
                    self.step(if shift { -1 } else { 1 });
                    resp.request_focus();
                }
                if esc {
                    self.close_search();
                }
            }
            let toggles = [
                ("↓", "Auto-scroll", "Auto-scroll the console to the newest line", self.autoscroll),
                ("TS", "Timestamps", "Show the time each console line arrived", self.timestamps),
                ("Badges", "Level badges", "Show a colored level label (ERR/WARN/OK) on each line", self.badges),
                ("DEBUG", "Debug trace", "Record every command sent to the engine, every answer and every state event, with timings. Off by default; export the recording from the Export menu", link.trace.on),
            ];
            for (k, (text, label, tip, on)) in toggles.into_iter().enumerate() {
                if tool_chip(ui, t, text, Some(on), Some(label), true).on_hover_text(tip).clicked() {
                    match k {
                        0 => self.autoscroll = !on,
                        1 => self.timestamps = !on,
                        2 => self.badges = !on,
                        _ => {
                            link.trace.on = !on;
                            if !on { link.trace.lines.clear(); }
                        }
                    }
                }
            }
            if tool_chip(ui, t, "Copy all", None, None, true).on_hover_text("Copy all console output to clipboard").clicked() {
                let all = self.texts().join("\n");
                self.copy_status = if all.is_empty() { String::new() } else { "✓ All copied".into() };
                self.copy(ui.ctx(), all);
            }
            if tool_chip(ui, t, "Copy sel.", None, None, true).on_hover_text("Copy the currently highlighted console text").clicked() {
                let sel = self.selection(ui.ctx());
                self.copy_status = if sel.is_empty() { "Nothing selected".into() } else { "✓ Selection copied".into() };
                if !sel.is_empty() {
                    self.copy(ui.ctx(), sel);
                }
            }
            if !self.copy_status.is_empty() {
                ui.label(egui::RichText::new(&self.copy_status).font(regular(FONT_SMALL)).color(t.emerald));
            }
            self.export_menu(ui, cx, link);
        });
    }

    fn copy(&mut self, ctx: &egui::Context, text: String) {
        self.last_copied = Some(text.clone());
        ctx.copy_text(text);
    }

    fn export_menu(&mut self, ui: &mut egui::Ui, cx: &Cx, link: &mut Link) {
        let t = cx.theme;
        let now = cx.now;
        let button = ui.menu_button(egui::RichText::new("Export ▾").font(mono(FONT_TOOL_CHIP)).color(t.muted), |ui| {
            let group = |ui: &mut egui::Ui, s: &str| ui.label(egui::RichText::new(s).font(semibold(FONT_SMALL)).color(t.faint));
            let item = |ui: &mut egui::Ui, text: &str, label: &str, tip: &str, enabled: bool| {
                let r = ui.add_enabled(enabled, egui::Button::new(text)).on_hover_text(tip).on_disabled_hover_text(tip);
                r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::MenuItem, enabled, label));
                r.clicked()
            };
            group(ui, "Console log");
            if item(ui, "Text (.txt)", "Console log, Text (.txt)", "Save every console line, with its time, to a text file", true) {
                match self.save(CONSOLE_LOG_FILE, &self.as_text()) {
                    Ok(p) => self.flash(&format!("✓ Log saved ({})", p.display()), Level::Ok, now),
                    Err(e) => self.flash(&format!("✗ The log could not be saved: {e}"), Level::Err, now),
                }
                ui.close();
            }
            if item(ui, "HTML (.html)", "Console log, HTML (.html)", "Save every console line, with its colour, to an HTML page", true) {
                match self.save(CONSOLE_HTML_FILE, &self.as_html()) {
                    Ok(p) => self.flash(&format!("✓ Log saved ({})", p.display()), Level::Ok, now),
                    Err(e) => self.flash(&format!("✗ The log could not be saved: {e}"), Level::Err, now),
                }
                ui.close();
            }
            group(ui, "Preview clip list");
            let tip = "Every clip the last PREVIEW found: date, demo, weapon, filters, tick and its playdemo command";
            for (text, label, format) in [("HTML (.html)", "Preview clips, HTML (.html)", "html"), ("Text (.txt)", "Preview clips, Text (.txt)", "txt"), ("JSON (.json)", "Preview clips, JSON (.json)", "json")] {
                if item(ui, text, label, tip, true) {
                    link.export_preview(now, format);
                    ui.close();
                }
            }
            group(ui, "Inspect");
            if item(ui, "CS2 injection preview", "CS2 injection preview", "Write into the console the arguments and commands a run with the current settings injects into CS2", true) {
                link.injection_preview(now);
                ui.close();
            }
            let on = link.trace.on;
            let tip = if on { "Save the recorded command/answer timeline" } else { "Turn DEBUG on first: there is nothing recorded yet" };
            if item(ui, "Debug trace (.txt)", "Debug trace (.txt)", tip, on) {
                match self.save(TRACE_FILE, &link.trace.lines.join("\n")) {
                    Ok(p) => self.flash(&format!("✓ Trace saved ({})", p.display()), Level::Ok, now),
                    Err(e) => self.flash(&format!("✗ The trace could not be saved: {e}"), Level::Err, now),
                }
                ui.close();
            }
        });
        button.response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, "Export"));
    }

    fn matching(&self) -> Vec<usize> {
        let n = self.needle();
        (0..self.lines.len()).filter(|&i| n.is_empty() || self.lines[i].text.to_lowercase().contains(&n)).collect()
    }

    fn step(&mut self, delta: i64) {
        self.search_index += delta;
        self.scroll_to_current = true;
    }

    fn close_search(&mut self) {
        self.search.clear();
        self.search_index = 0;
    }

    /// Index (into `matching`) of the current match.
    fn current(&self, count: usize) -> Option<usize> {
        (count > 0 && !self.needle().is_empty()).then(|| self.search_index.rem_euclid(count as i64) as usize)
    }

    fn search_bar(&mut self, ui: &mut egui::Ui, t: &Theme) {
        let count = self.matching().len();
        ui.horizontal(|ui| {
            let text = match self.current(count) {
                Some(c) => format!("{}/{count}", c + 1),
                None => "0 results".into(),
            };
            ui.label(egui::RichText::new(text).font(regular(FONT_SMALL)).color(t.muted));
            if chip(ui, t, "▲", None, Some("Previous match"), count > 0).on_hover_text("Previous match (Shift+Enter)").clicked() {
                self.step(-1);
            }
            if chip(ui, t, "▼", None, Some("Next match"), count > 0).on_hover_text("Next match (Enter)").clicked() {
                self.step(1);
            }
            if chip(ui, t, "Esc", None, Some("Close search"), true).on_hover_text("Close the search (Esc)").clicked() {
                self.close_search();
            }
        });
    }

    fn ask_panel(&mut self, ui: &mut egui::Ui, t: &Theme) {
        let Some(a) = self.asks.front() else { return };
        let (kind, title, choices) = match a.kind {
            AskKind::Error => (AskKind::Error, a.message.clone(), Vec::new()),
            k => (k, a.options.first().cloned().unwrap_or_else(|| a.message.clone()), a.options.iter().skip(1).cloned().collect::<Vec<_>>()),
        };
        let mut answer: Option<Option<String>> = None;
        egui::Frame::new().fill(t.accent_soft).stroke(Stroke::new(1.0, t.accent_alpha(MARK_PCT))).corner_radius(egui::CornerRadius::same(crate::CORNER_SMALL)).inner_margin(egui::Margin::same(crate::ASK_PAD)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            let title_resp = ui.label(egui::RichText::new(&title).font(semibold(FONT_SMALL)).color(t.txt));
            ui.horizontal_wrapped(|ui| {
                if kind == AskKind::Text {
                    let field = ui.add(egui::TextEdit::singleline(&mut self.ask_text).desired_width(SEARCH_WIDTH * 2.0)).labelled_by(title_resp.id);
                    if !self.ask_focused {
                        field.request_focus();
                        self.ask_focused = true;
                    }
                    let blank = self.ask_text.trim().is_empty();
                    let confirm = choices.first().cloned().unwrap_or_else(|| "OK".into());
                    let enter = field.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                    if (chip(ui, t, &confirm, None, None, !blank).clicked() || enter) && !blank {
                        answer = Some(Some(self.ask_text.clone()));
                    }
                } else {
                    for c in &choices {
                        if chip(ui, t, c, None, None, true).clicked() {
                            answer = Some(Some(c.clone()));
                        }
                    }
                }
                if kind == AskKind::Error {
                    if chip(ui, t, "OK", None, None, true).clicked() {
                        answer = Some(Some("ok".into()));
                    }
                } else if chip(ui, t, "Cancel", None, None, true).clicked() {
                    answer = Some(None);
                }
            });
        });
        if let Some(v) = answer {
            self.answer(v);
        }
    }

    fn selection(&self, ctx: &egui::Context) -> String {
        let Some(state) = egui::TextEdit::load_state(ctx, egui::Id::unique(crate::CONSOLE_BODY_ID)) else { return String::new() };
        let Some(range) = state.cursor.char_range() else { return String::new() };
        let (a, b) = (range.primary.index.0.min(range.secondary.index.0), range.primary.index.0.max(range.secondary.index.0));
        self.rendered_text().chars().skip(a).take(b - a).collect()
    }

    /// The text the body shows, without colours (selection indices point into it).
    fn rendered_text(&self) -> String {
        self.compose(None, false).0
    }

    /// Display text and its colour sections for the visible lines.
    fn compose(&self, theme: Option<&Theme>, caret_on: bool) -> (String, Vec<(std::ops::Range<usize>, Level, Option<Color32>)>, Option<usize>) {
        let matching = self.matching();
        let visible = &matching[matching.len().saturating_sub(CONSOLE_MAX_RENDERED)..];
        let needle = self.needle();
        let current = self.current(matching.len()).map(|c| matching[c]);
        let mut text = String::new();
        let mut sections = Vec::new();
        let mut current_offset = None;
        let mark = theme.map(|t| t.accent_alpha(MARK_PCT));
        let cur_bg = theme.map(|t| t.accent_alpha(CURRENT_PCT));
        for (vi, &li) in visible.iter().enumerate() {
            let line = &self.lines[li];
            let is_current = current == Some(li);
            if is_current {
                current_offset = Some(text.len());
            }
            let bg = if is_current { cur_bg } else { None };
            let mut add = |s: &str, l: Level, bg: Option<Color32>, text: &mut String| {
                let start = text.len();
                text.push_str(s);
                sections.push((start..text.len(), l, bg));
            };
            if self.timestamps {
                add(&format!("{} ", line.ts), Level::Dim, bg, &mut text);
            }
            if self.badges && line.level != Level::Plain {
                add(&format!("{} ", level_name(line.level).to_uppercase()), line.level, bg, &mut text);
            }
            let budget = self.typer.budget(vi);
            let mut used = 0usize;
            let lower = line.text.to_lowercase();
            let hits: Vec<(usize, usize)> = if needle.is_empty() { Vec::new() } else { lower.match_indices(&needle).map(|(at, m)| (at, at + m.len())).collect() };
            let mut byte = 0usize;
            for (piece, level) in &line.runs {
                let take = piece.chars().count().min(budget.saturating_sub(used));
                used += piece.chars().count();
                let shown: String = piece.chars().take(take).collect();
                // Split the shown piece at search hits so each part keeps its colour.
                let mut cursor = 0usize;
                for (hs, he) in &hits {
                    let (s, e) = (hs.saturating_sub(byte).min(shown.len()), he.saturating_sub(byte).min(shown.len()));
                    if e <= cursor || s >= shown.len() || s >= e { continue; }
                    let s = s.max(cursor);
                    if !shown.is_char_boundary(s) || !shown.is_char_boundary(e) { continue; }
                    add(&shown[cursor..s], *level, bg, &mut text);
                    add(&shown[s..e], *level, mark, &mut text);
                    cursor = e;
                }
                add(&shown[cursor..], *level, bg, &mut text);
                byte += piece.len();
            }
            // Every character belongs to a section: the layout job drops what none covers.
            let nl = text.len();
            text.push('\n');
            sections.push((nl..text.len(), Level::Plain, None));
        }
        let start = text.len();
        text.push_str("csdm>");
        sections.push((start..text.len(), Level::Info, None));
        if !self.prompt.is_empty() {
            let s = text.len();
            text.push(' ');
            text.push_str(self.prompt);
            sections.push((s..text.len(), Level::Plain, None));
        }
        let _ = caret_on;
        (text, sections, current_offset)
    }

    fn body(&mut self, ui: &mut egui::Ui, cx: &Cx) {
        let t = cx.theme;
        let lengths: Vec<usize> = {
            let m = self.matching();
            m[m.len().saturating_sub(CONSOLE_MAX_RENDERED)..].iter().map(|&i| self.lines[i].text.chars().count()).collect()
        };
        if let Some(wait) = self.typer.tick(&lengths, cx.now, cx.motion) {
            ui.ctx().request_repaint_after_secs(wait as f32);
        }
        let caret_on = !cx.motion || (cx.now / (CARET_PERIOD_S / 2.0)) as u64 % 2 == 0;
        if cx.motion {
            let next_toggle = CARET_PERIOD_S / 2.0 - cx.now % (CARET_PERIOD_S / 2.0);
            ui.ctx().request_repaint_after_secs(next_toggle as f32);
        }
        let (text, sections, current_offset) = self.compose(Some(t), caret_on);
        let font = mono(FONT_CONSOLE);
        let theme = t.clone();
        let mut layouter = |ui: &egui::Ui, buf: &dyn egui::TextBuffer, wrap: f32| {
            let s = buf.as_str();
            let mut job = LayoutJob::default();
            job.wrap.max_width = wrap;
            for (range, level, bg) in &sections {
                if range.end <= s.len() {
                    job.append(&s[range.clone()], 0.0, TextFormat { font_id: font.clone(), color: ink(&theme, *level), background: bg.unwrap_or(Color32::TRANSPARENT), line_height: Some(CONSOLE_LINE_HEIGHT), ..Default::default() });
                }
            }
            ui.painter().layout_job(job)
        };
        let searching = !self.needle().is_empty();
        let scroll = egui::ScrollArea::vertical().id_salt("console-body").auto_shrink(false).stick_to_bottom(self.autoscroll && !searching);
        let scroll_to = std::mem::take(&mut self.scroll_to_current);
        scroll.show(ui, |ui| {
            let mut buf = text.as_str();
            let out = egui::TextEdit::multiline(&mut buf).id(egui::Id::unique(crate::CONSOLE_BODY_ID)).frame(egui::Frame::NONE).desired_width(f32::INFINITY).layouter(&mut layouter).show(ui);
            out.response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, "Console"));
            let end = out.galley.pos_from_cursor(egui::text::CCursor::new(text.chars().count()));
            if caret_on {
                let at = out.galley_pos + end.left_top().to_vec2();
                ui.painter().rect_filled(Rect::from_min_size(Pos2::new(at.x + 2.0, at.y + (CONSOLE_LINE_HEIGHT - CARET.y) / 2.0), CARET), 0.0, t.accent);
            }
            if scroll_to {
                if let Some(off) = current_offset {
                    let chars = text[..off].chars().count();
                    let r = out.galley.pos_from_cursor(egui::text::CCursor::new(chars)).translate(out.galley_pos.to_vec2());
                    ui.scroll_to_rect(r, Some(egui::Align::Center));
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_cover_every_character_so_lines_stay_apart() {
        let mut c = Console::new(std::path::PathBuf::new());
        c.timestamps = true;
        for m in ["engine ready", "second line"] {
            c.push(Narrated { runs: vec![(m.into(), Level::Ok)], level: Level::Ok }, None);
        }
        c.typer.tick(&[usize::MAX; 2], 0.0, false); // no motion: every line shown whole
        let (text, sections, _) = c.compose(None, false);
        assert!(text.contains("engine ready\n"), "{text:?}");
        let mut at = 0;
        for (r, _, _) in &sections {
            assert_eq!(r.start, at, "gap before {r:?} in {text:?}");
            at = r.end;
        }
        assert_eq!(at, text.len());
    }

    #[test]
    fn typewriter_types_then_rests_and_jumps_a_burst() {
        let mut w = Typewriter::default();
        assert_eq!(w.tick(&[3], 0.0, true).is_some(), true);
        assert_eq!(w.budget(0), 1, "the first character shows at once");
        w.tick(&[3], TYPE_CHAR_S * 2.0, true);
        assert!(w.budget(0) >= 2);
        assert!(w.tick(&[3], 1.0, true).is_none(), "done after the line gap");
        assert_eq!(w.budget(0), usize::MAX);
        let burst = vec![5; TYPE_MAX_TYPED + 30];
        w.tick(&burst, 1.0, true);
        assert!(w.done >= burst.len() - TYPE_MAX_TYPED, "old lines land at once");
        let mut still = Typewriter::default();
        assert!(still.tick(&[9, 9], 0.0, false).is_none());
        assert_eq!(still.budget(1), usize::MAX, "no motion: everything shown");
    }

    #[test]
    fn exports_never_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let c = Console::new(dir.path().into());
        let a = c.save("log.txt", "1").unwrap();
        let b = c.save("log.txt", "2").unwrap();
        assert_ne!(a, b);
        assert_eq!(std::fs::read_to_string(a).unwrap(), "1");
        assert!(b.file_name().unwrap().to_string_lossy().contains("(1)"));
    }
}
