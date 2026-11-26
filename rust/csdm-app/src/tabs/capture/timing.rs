//! Capture & Timing and Timing & Retries, `timeline` style (3.5 `captureTiming/TimelineView.tsx`,
//! `timingRetries/TimelineView.tsx`). Words, tips and rules are 3.5's.

use super::kit::{as_text, flag, framed, kick, lab, list, mark, mseg, seg, set_list, text_field, Toggle};
use super::model::{as_count, clip_summary, clip_window, move_handle, pacing_summary, ClipHandle, ClipInput, PERSPECTIVES};
use super::timeline::{self, Handle, Marker, Span, Timeline, Tone};
use crate::cardstyle::{clip_bar, choice_token, choice_word, count_tile, icon_tile, number_token, picture_choice, prose_line, prose_muted, prose_word, style_of, text_word, ClipTone, PictureOpt, TileGlyph, tile_grid};
use crate::grid::CardCx;
use crate::paint::{mono, regular, semibold};
use crate::theme::Theme;
use crate::widgets::chip;
use csdm_core::ui_values::{CardStyle, CLIP_RANGE_AFTER, CLIP_RANGE_BEFORE, CLIP_RANGE_SWITCH, CLIP_TIMELINE_MARGINS_S, TIMING_DEMO_SEQUENCE, TIMING_DRAG_MAX, TIMING_SHOWN_RETRIES};
use eframe::egui::{self, pos2, vec2, Align2, Color32, Rect, Sense, Stroke, StrokeKind};
use serde_json::{json, Value};

const TIPS_ACTOR: &str = "Capture events where the selected player performs the action (e.g. the kill)";
const TIPS_TARGET: &str = "Capture events where the selected player is on the receiving end (e.g. gets killed)";
const TIPS_LETHAL: &str = "Include kill and death moments. Requires Actor or Target to be selected";
const TIPS_NON_LETHAL: &str = "Include damage-dealt or damage-taken moments, without a kill";
const TIPS_OTHER: &str = "Include shots fired and knife swings, without a hit. Actor perspective only";
const TIPS_ALLY: &str = "Include events where the other player involved is a teammate";
const TIPS_ENEMY: &str = "Include events where the other player involved is an opponent";
const TIPS_ROUNDS: &str = "Also capture full-round clips, separate from the kill/death event filters";
const TIPS_PERSPECTIVE: &str = "Whose eyes the clip is filmed through: the killer, the victim, or the killer then the victim (both)";
const TIPS_MATE: &str = "Film the victim's side from the teammate with the best view of the kill, instead of the victim";
const TIPS_MATE_REQ: &str = "Skip the clip when no teammate has a clear view of the kill";
const TIPS_FEED: &str = "Name shown for your player in the clips' kill feed. Empty = the name stored in the demo";
const TIPS_BEFORE: &str = "Seconds of footage recorded before each event. Also sets how close two events must be to share one clip";
const TIPS_AFTER: &str = "Seconds of footage recorded after each event";
const TIPS_VICTIM: &str = "Both: the camera follows the killer, then switches to the victim this many seconds before the kill. These seconds are added to the seconds before";
/// The legacy `events` list item that asks for full-round clips.
const ROUNDS: &str = "Rounds";

const TIPS_RETRIES: &str = "Extra attempts for a recording that fails, before the demo is marked failed. 0 = no retry";
const TIPS_RETRY_DELAY: &str = "Seconds to wait before each retry of a failed recording";
const TIPS_TIMEOUT: &str = "A recording that runs longer than this is stopped and retried. 0 = automatic, from the length of the clips; a value here can only make the wait longer";
const TIPS_PAUSE: &str = "Seconds to pause between two demos, giving CS2 and the recorder time to reset";
const TIPS_ORDER: &str = "Order in which demos are recorded: chronological by match date, or shuffled";
const ORDERS: [&str; 2] = ["chrono", "random"];

/// `.ct-what` key column, `.ct-sum` total badge, `.tr-*` blocks.
const KEY_W: f32 = 52.0;
const FEED_W: f32 = 150.0;
const ROW_GAP: f32 = 8.0;
const FONT_TOTAL: f32 = 13.0;
const TOTAL_PAD: [f32; 2] = [8.0, 3.0];
const BLOCK: f32 = 30.0;
const BLOCK_RADIUS: f32 = 9.0;
const BADGE: f32 = 15.0;
const TRACK_PAD: f32 = 8.0;
const TOKEN_H: [f32; 2] = [28.0, 22.0];
const TOKEN_PAD: f32 = 7.0;
const FONT_TOKEN: [f32; 2] = [14.0, 11.5];
/// Pixels of sideways drag per unit on a number token.
const DRAG_PX_PER_STEP: f32 = 8.0;
const POP_W: f32 = 220.0;
const FAIL_TINT: f32 = 0.22;
const GAP_EDGE_ALPHA: f32 = 0.45;
const DEMO_EDGE_ALPHA: f32 = 0.4;
const MIN_GAP_W: f32 = 34.0;
const RING: f32 = 3.0;
const POP_GAP: f32 = 4.0;
/// The token's lower stop: solid with a hint of the camera colour (`--cam-k 5%`).
const TOKEN_TINT: f32 = 0.05;
const DASH: f32 = 4.0;
const TRACK_RADIUS: u8 = 12;
const GRID_COLS: usize = 4;
/// The demo block leaves room for its order badge, which hangs below its corner.
const PIN_ROOM: f32 = 3.0;
const BADGE_DROP: f32 = 4.0;
/// Glyph shapes, in quarters of the block: cross arm, retry arc (start, sweep in half turns, steps),
/// its arrow, the play triangle.
const CROSS: f32 = 0.7;
const ARC: [f32; 2] = [0.3, 1.6];
const ARC_STEPS: usize = 20;
const ARROW: [f32; 2] = [1.2, 0.2];
const PLAY: [f32; 3] = [0.6, 0.8, 0.9];
const QUARTER: f32 = 4.0;
const TILE_MIN_W: f32 = 160.0;
const CAM_TILE_MIN_W: f32 = 140.0;
const SEQ_TILE_MIN_W: f32 = 180.0;
const STEP_ONE: f64 = 1.0;
const CAM_BAR_H: f32 = 14.0;
const CAM_BAR_PAD: f32 = 8.0;
const DEMO_CHIP_W: f32 = 22.0;
const DEMO_CHIP_GAP: f32 = 8.0;

fn num(cx: &CardCx, key: &str, fallback: f64) -> f64 {
    match cx.link.get(key) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(fallback),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(fallback),
        _ => fallback,
    }
}

fn secs(v: f64) -> String {
    format!("{}", v as i64)
}

/// A chip whose visible words and accessible name differ ("Enable" in the Mate POV row).
fn named_chip(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, text: &str, name: &str, on: bool, tip: &str) -> bool {
    mark(ui, key);
    crate::widgets::chip(ui, cx.theme, text, Some(on), Some(name), true).on_hover_text(tip).clicked()
}

/// Capture & Timing: who, which moments, the camera, and the clip as a draggable bar.
pub fn capture(ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    let actor = flag(cx, "event_actor", true);
    let target = flag(cx, "event_target", false);
    let lethal = flag(cx, "event_lethal", true);
    let non_lethal = flag(cx, "event_non_lethal", false);
    let other = flag(cx, "event_other", false);
    let ally = flag(cx, "event_ally", false);
    let enemy = flag(cx, "event_enemy", true);
    let events = list(cx, "events");
    let rounds = events.iter().any(|e| e == ROUNDS);
    let raw_p = super::kit::text(cx, "perspective");
    let perspective = PERSPECTIVES.iter().copied().find(|p| *p == raw_p).unwrap_or(PERSPECTIVES[0]);
    let mate = flag(cx, "kill_mod_mate_pov", false);
    let mate_req = flag(cx, "kill_mod_mate_pov_req", false);
    let input = ClipInput {
        before: num(cx, "before", CLIP_RANGE_BEFORE[0] as f64),
        after: num(cx, "after", CLIP_RANGE_AFTER[0] as f64),
        perspective,
        switch_delay: num(cx, "victim_pre_s", CLIP_RANGE_SWITCH[0] as f64),
        mate_pov: mate,
    };
    let w = clip_window(&input);
    let both = perspective == "both";
    let bar_parts = |w: &super::model::ClipWindow| -> Vec<(f64, ClipTone, String)> {
        if both {
            vec![
                (w.lead, ClipTone::Primary, format!("{}s killer", secs(w.lead))),
                (w.victim_view, ClipTone::Alt, format!("{}s victim", secs(w.victim_view))),
                (w.after, ClipTone::Rest, format!("{}s after", secs(w.after))),
            ]
        } else {
            let tone = if perspective == "victim" { ClipTone::Alt } else { ClipTone::Primary };
            let who = if perspective == "victim" && mate { "mate" } else { perspective };
            vec![
                (w.before, tone, format!("{}s {who}", secs(w.before))),
                (w.after, ClipTone::Rest, format!("{}s after", secs(w.after))),
            ]
        }
    };

    match style_of(cx, "capture-timing") {
        CardStyle::Timeline => {
            // Role / Team / Action / Also: a 2 × 2 block of toggle trays.
            let mut flips: Vec<(&str, bool)> = Vec::new();
            egui::Grid::new("ct-what").num_columns(GRID_COLS).spacing(vec2(ROW_GAP, ROW_GAP)).show(ui, |ui| {
                let key = |ui: &mut egui::Ui, w: &str| {
                    ui.allocate_ui(vec2(KEY_W, ui.spacing().interact_size.y), |ui| kick(ui, t, w));
                };
                key(ui, "Role");
                let role = [Toggle { key: "event_actor", label: "Actor", on: actor, disabled: false, tip: TIPS_ACTOR }, Toggle { key: "event_target", label: "Target", on: target, disabled: false, tip: TIPS_TARGET }];
                if let Some(i) = mseg(ui, t, &role) {
                    flips.push((role[i].key, !role[i].on));
                }
                key(ui, "Team");
                let team = [Toggle { key: "event_ally", label: "Ally", on: ally, disabled: false, tip: TIPS_ALLY }, Toggle { key: "event_enemy", label: "Enemy", on: enemy, disabled: false, tip: TIPS_ENEMY }];
                if let Some(i) = mseg(ui, t, &team) {
                    flips.push((team[i].key, !team[i].on));
                }
                ui.end_row();
                key(ui, "Action");
                let action = [
                    Toggle { key: "event_lethal", label: "Lethal", on: lethal, disabled: !(actor || target), tip: TIPS_LETHAL },
                    Toggle { key: "event_non_lethal", label: "Non-lethal", on: non_lethal, disabled: false, tip: TIPS_NON_LETHAL },
                    Toggle { key: "event_other", label: "Other", on: other, disabled: !actor, tip: TIPS_OTHER },
                ];
                if let Some(i) = mseg(ui, t, &action) {
                    flips.push((action[i].key, !action[i].on));
                }
                key(ui, "Also");
                if mseg(ui, t, &[Toggle { key: "events", label: "Full rounds", on: rounds, disabled: false, tip: TIPS_ROUNDS }]).is_some() {
                    let next: Vec<String> = if rounds { events.iter().filter(|e| *e != ROUNDS).cloned().collect() } else { events.iter().cloned().chain([ROUNDS.to_string()]).collect() };
                    set_list(cx, "events", &next);
                }
                ui.end_row();
            });
            for (k, v) in flips {
                cx.link.set(cx.now, k, json!(v));
            }

            ui.add_space(ROW_GAP);
            ui.horizontal(|ui| {
                kick(ui, t, "Clip · drag the handles");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    mark(ui, "perspective");
                    let dots = [t.accent, t.emerald, t.accent.lerp_to_gamma(t.emerald, 1.0 / 2.0)];
                    if let Some(p) = seg(ui, t, "Camera", &PERSPECTIVES, perspective, false, TIPS_PERSPECTIVE, Some(&dots)) {
                        cx.link.set(cx.now, "perspective", json!(p));
                    }
                });
            });

            let ghost_start = w.merge_within - w.before;
            let mut tl = Timeline::default();
            if both {
                tl.spans.push(Span { from: -w.before, to: -w.victim_view, tone: Tone::Primary, label: format!("{}s", secs(w.lead)), small: String::new() });
                tl.spans.push(Span { from: -w.victim_view, to: 0.0, tone: Tone::Alt, label: if w.victim_view > 0.0 { format!("{}s", secs(w.victim_view)) } else { String::new() }, small: String::new() });
            } else {
                let who = if perspective == "victim" && mate { "mate" } else { perspective };
                tl.spans.push(Span { from: -w.before, to: 0.0, tone: if perspective == "victim" { Tone::Alt } else { Tone::Primary }, label: format!("{}s", secs(w.before)), small: who.into() });
            }
            tl.spans.push(Span { from: 0.0, to: w.after, tone: Tone::Rest, label: format!("{}s", secs(w.after)), small: "after".into() });
            let handle = |id, at: f64, alt, label: &str, readout: String, value: f64, tip: &str| Handle { id, at, alt, label: label.into(), readout, value, tip: tip.into() };
            let mut kinds = vec![ClipHandle::Start];
            tl.handles.push(handle("start", -w.before, false, "Seconds before", format!("−{}s", secs(w.before)), input.before, TIPS_BEFORE));
            mark(ui, "before");
            if both {
                mark(ui, "victim_pre_s");
                kinds.push(ClipHandle::Switch);
                tl.handles.push(handle("switch", -w.victim_view, true, "Victim view", format!("−{}s", secs(w.victim_view)), input.switch_delay, TIPS_VICTIM));
            }
            mark(ui, "after");
            kinds.push(ClipHandle::End);
            tl.handles.push(handle("end", w.after, false, "Seconds after", format!("+{}s", secs(w.after)), input.after, TIPS_AFTER));
            tl.markers.push(Marker { at: 0.0, label: "KILL".into(), ghost: false });
            tl.markers.push(Marker { at: w.merge_within, label: format!("+{}s", secs(w.merge_within)), ghost: true });
            tl.link = Some((w.after, ghost_start));
            tl.ghost = Some((ghost_start, w.merge_within + w.after, "next moment".into()));
            tl.bracket = Some((0.0, w.merge_within, ["moments up to ".into(), format!("{} s", secs(w.merge_within)), " apart → one clip".into()]));
            tl.extent = (-w.before - CLIP_TIMELINE_MARGINS_S[0], w.merge_within + w.after + CLIP_TIMELINE_MARGINS_S[1]);
            if let Some((i, at)) = timeline::show(ui, t, "capture-timing", &tl, "Clip") {
                let (b, a, s) = move_handle(kinds[i], at, &input);
                for (k, old, new) in [("before", input.before, b), ("after", input.after, a), ("victim_pre_s", input.switch_delay, s)] {
                    if old != new {
                        cx.link.set(cx.now, k, json!(new as i64));
                    }
                }
            }
            ui.label(egui::RichText::new("Handles snap to whole seconds · ← → on a focused handle · the scale re-fits when you let go").font(regular(FONT_TOTAL - 2.0)).color(t.faint));
            ui.add_space(ROW_GAP);
            ui.horizontal_wrapped(|ui| {
                if perspective != "killer" {
                    lab(ui, t, "Mate POV");
                    if named_chip(ui, cx, "kill_mod_mate_pov", "Enable", "Mate POV: Enable", mate, TIPS_MATE) {
                        cx.link.set(cx.now, "kill_mod_mate_pov", json!(!mate));
                        if mate {
                            cx.link.set(cx.now, "kill_mod_mate_pov_req", json!(false));
                        }
                    }
                    if named_chip(ui, cx, "kill_mod_mate_pov_req", "★ Must", "Mate POV: ★ Must", mate_req, TIPS_MATE_REQ) {
                        cx.link.set(cx.now, "kill_mod_mate_pov_req", json!(!mate_req));
                        if !mate_req {
                            cx.link.set(cx.now, "kill_mod_mate_pov", json!(true));
                        }
                    }
                    ui.add_space(ROW_GAP);
                }
                lab(ui, t, "Feed name");
                text_field(ui, cx, "player_name_override", "Feed name", "name from the demo", FEED_W, TIPS_FEED);
            });
        }
        CardStyle::Sentence => {
            for k in ["event_actor", "event_target", "event_ally", "event_enemy", "event_lethal", "event_non_lethal", "event_other", "events"] {
                mark(ui, k);
            }
            let role_words = match (actor, target) {
                (true, true) => "my & incoming",
                (true, false) => "my",
                (false, true) => "incoming",
                (false, false) => "no role",
            };
            let mut m_list = Vec::new();
            if lethal { m_list.push("kills & deaths"); }
            if non_lethal { m_list.push("damage"); }
            if other { m_list.push("shots & swings"); }
            if rounds { m_list.push("full rounds"); }
            let moment_words = if m_list.is_empty() { "nothing".to_string() } else { m_list.join(", ") };
            let team_words = match (ally, enemy) {
                (true, true) => "allies & enemies",
                (false, true) => "enemies",
                (true, false) => "allies",
                (false, false) => "nobody",
            };
            let cam_opts = [("killer", "killer's", ""), ("victim", "victim's", ""), ("both", "killer then victim's", "")];
            prose_line(ui, |ui| {
                prose_word(ui, t, "Capture");
                choice_token(ui, t, "ct-role", role_words, "Role", false, TIPS_ACTOR, true, |ui, _| {
                    ui.horizontal(|ui| {
                        for (k, lbl, on, tip) in [("event_actor", "Actor", actor, TIPS_ACTOR), ("event_target", "Target", target, TIPS_TARGET)] {
                            if chip(ui, t, lbl, Some(on), Some(lbl), true).on_hover_text(tip).clicked() {
                                cx.link.set(cx.now, k, json!(!on));
                            }
                        }
                    });
                });
                choice_token(ui, t, "ct-moments", &moment_words, "Moments", false, TIPS_LETHAL, true, |ui, _| {
                    ui.horizontal_wrapped(|ui| {
                        for (k, lbl, on, en, tip) in [
                            ("event_lethal", "Lethal", lethal, actor || target, TIPS_LETHAL),
                            ("event_non_lethal", "Non-lethal", non_lethal, true, TIPS_NON_LETHAL),
                            ("event_other", "Other", other, actor, TIPS_OTHER),
                        ] {
                            if chip(ui, t, lbl, Some(on), Some(lbl), en).on_hover_text(tip).clicked() && en {
                                cx.link.set(cx.now, k, json!(!on));
                            }
                        }
                        if chip(ui, t, "Full rounds", Some(rounds), Some("Full rounds"), true).on_hover_text(TIPS_ROUNDS).clicked() {
                            let next: Vec<String> = if rounds { events.iter().filter(|e| *e != ROUNDS).cloned().collect() } else { events.iter().cloned().chain([ROUNDS.to_string()]).collect() };
                            set_list(cx, "events", &next);
                        }
                    });
                });
                prose_word(ui, t, "against");
                choice_token(ui, t, "ct-team", team_words, "Team", false, TIPS_ENEMY, true, |ui, _| {
                    ui.horizontal(|ui| {
                        for (k, lbl, on, tip) in [("event_ally", "Ally", ally, TIPS_ALLY), ("event_enemy", "Enemy", enemy, TIPS_ENEMY)] {
                            if chip(ui, t, lbl, Some(on), Some(lbl), true).on_hover_text(tip).clicked() {
                                cx.link.set(cx.now, k, json!(!on));
                            }
                        }
                    });
                });
                prose_word(ui, t, ".");
            });
            prose_line(ui, |ui| {
                prose_word(ui, t, "Film through the");
                choice_word(ui, cx, "perspective", "Camera", &cam_opts, PERSPECTIVES[0], false, TIPS_PERSPECTIVE);
                prose_word(ui, t, "eyes:");
                number_token(ui, cx, "before", "Seconds before", "s", [CLIP_RANGE_BEFORE[0] as f64, CLIP_RANGE_BEFORE[1] as f64], STEP_ONE, 0, CLIP_RANGE_BEFORE[0] as f64, false, TIPS_BEFORE, &[]);
                prose_word(ui, t, "before");
                if both {
                    prose_word(ui, t, "(switch");
                    number_token(ui, cx, "victim_pre_s", "Victim view", "s", [CLIP_RANGE_SWITCH[0] as f64, CLIP_RANGE_SWITCH[1] as f64], STEP_ONE, 0, CLIP_RANGE_SWITCH[0] as f64, true, TIPS_VICTIM, &[]);
                    prose_word(ui, t, "early)");
                } else {
                    mark(ui, "victim_pre_s");
                }
                prose_word(ui, t, "and");
                number_token(ui, cx, "after", "Seconds after", "s", [CLIP_RANGE_AFTER[0] as f64, CLIP_RANGE_AFTER[1] as f64], STEP_ONE, 0, CLIP_RANGE_AFTER[0] as f64, false, TIPS_AFTER, &[]);
                prose_word(ui, t, "after.");
            });
            let start_cap = format!("−{}s", secs(w.before));
            let moment_cap = format!("KILL (merge ≤{}s)", secs(w.merge_within));
            let end_cap = format!("+{}s", secs(w.after));
            clip_bar(ui, t, &bar_parts(&w), Some((&start_cap, &moment_cap, &end_cap)));
            prose_line(ui, |ui| {
                if perspective != "killer" {
                    prose_word(ui, t, "Mate POV:");
                    if named_chip(ui, cx, "kill_mod_mate_pov", "Enable", "Mate POV: Enable", mate, TIPS_MATE) {
                        cx.link.set(cx.now, "kill_mod_mate_pov", json!(!mate));
                        if mate {
                            cx.link.set(cx.now, "kill_mod_mate_pov_req", json!(false));
                        }
                    }
                    if named_chip(ui, cx, "kill_mod_mate_pov_req", "★ Must", "Mate POV: ★ Must", mate_req, TIPS_MATE_REQ) {
                        cx.link.set(cx.now, "kill_mod_mate_pov_req", json!(!mate_req));
                        if !mate_req {
                            cx.link.set(cx.now, "kill_mod_mate_pov", json!(true));
                        }
                    }
                    prose_word(ui, t, "·");
                }
                prose_word(ui, t, "Feed name");
                text_word(ui, cx, "player_name_override", "Feed name", "name from the demo", false, false, false, TIPS_FEED);
                prose_word(ui, t, ".");
            });
        }
        CardStyle::Tiles => {
            tile_grid(ui, TILE_MIN_W, 4, |ui, idx, tw| match idx { // allow-hardcode: four moment tiles
                0 => {
                    mark(ui, "event_lethal");
                    let en = actor || target;
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, "Kills & deaths", "Lethal moments", None, lethal, !en, false, TIPS_LETHAL, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Kill, c)).clicked() && en {
                        cx.link.set(cx.now, "event_lethal", json!(!lethal));
                    }
                }
                1 => {
                    mark(ui, "event_non_lethal");
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, "Damage", "Non-lethal hits", None, non_lethal, false, false, TIPS_NON_LETHAL, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Damage, c)).clicked() {
                        cx.link.set(cx.now, "event_non_lethal", json!(!non_lethal));
                    }
                }
                2 => {
                    mark(ui, "event_other");
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, "Shots & swings", "Other actions", None, other, !actor, false, TIPS_OTHER, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Shot, c)).clicked() && actor {
                        cx.link.set(cx.now, "event_other", json!(!other));
                    }
                }
                _ => {
                    mark(ui, "events");
                    if icon_tile(ui, t, tw, crate::cardstyle::ICON_TILE_H, "Full rounds", "Keep whole rounds", None, rounds, false, false, TIPS_ROUNDS, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Round, c)).clicked() {
                        let next: Vec<String> = if rounds { events.iter().filter(|e| *e != ROUNDS).cloned().collect() } else { events.iter().cloned().chain([ROUNDS.to_string()]).collect() };
                        set_list(cx, "events", &next);
                    }
                }
            });
            ui.horizontal_wrapped(|ui| {
                lab(ui, t, "Role");
                let role = [Toggle { key: "event_actor", label: "Actor", on: actor, disabled: false, tip: TIPS_ACTOR }, Toggle { key: "event_target", label: "Target", on: target, disabled: false, tip: TIPS_TARGET }];
                if let Some(i) = mseg(ui, t, &role) {
                    cx.link.set(cx.now, role[i].key, json!(!role[i].on));
                }
                lab(ui, t, "Against");
                let team = [Toggle { key: "event_ally", label: "Ally", on: ally, disabled: false, tip: TIPS_ALLY }, Toggle { key: "event_enemy", label: "Enemy", on: enemy, disabled: false, tip: TIPS_ENEMY }];
                if let Some(i) = mseg(ui, t, &team) {
                    cx.link.set(cx.now, team[i].key, json!(!team[i].on));
                }
            });
            let cam_opts = [
                PictureOpt { value: "killer", title: "Killer", subtitle: "Attacker POV", tip: TIPS_PERSPECTIVE },
                PictureOpt { value: "victim", title: "Victim", subtitle: "Target POV", tip: TIPS_PERSPECTIVE },
                PictureOpt { value: "both", title: "Both", subtitle: "Killer then victim", tip: TIPS_PERSPECTIVE },
            ];
            if let Some(next_p) = picture_choice(ui, t, CAM_TILE_MIN_W, "Camera", &cam_opts, perspective, |p, r, val, _| {
                let bar = Rect::from_center_size(r.center(), vec2(r.width() - CAM_BAR_PAD * 2.0, CAM_BAR_H));
                match val {
                    "killer" => { p.rect_filled(bar, CAM_BAR_H / 2.0, t.accent); }
                    "victim" => { p.rect_filled(bar, CAM_BAR_H / 2.0, t.emerald); }
                    _ => {
                        let (l, rr) = bar.split_left_right_at_fraction(0.6); // allow-hardcode: both camera split preview
                        p.rect_filled(l, CAM_BAR_H / 2.0, t.accent);
                        p.rect_filled(rr, CAM_BAR_H / 2.0, t.emerald);
                    }
                }
            }) {
                cx.link.set(cx.now, "perspective", json!(next_p));
            }
            mark(ui, "perspective");
            clip_bar(ui, t, &bar_parts(&w), None);
            tile_grid(ui, TILE_MIN_W, if both { 3 } else { 2 }, |ui, idx, tw| match idx { // allow-hardcode: two or three timing tiles
                0 => count_tile(ui, cx, "before", "Seconds before", "s", [CLIP_RANGE_BEFORE[0] as f64, CLIP_RANGE_BEFORE[1] as f64], STEP_ONE, 0, None, "Before event", TIPS_BEFORE, tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Wait, c)),
                1 => count_tile(ui, cx, "after", "Seconds after", "s", [CLIP_RANGE_AFTER[0] as f64, CLIP_RANGE_AFTER[1] as f64], STEP_ONE, 0, None, "After event", TIPS_AFTER, tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Play, c)),
                _ => count_tile(ui, cx, "victim_pre_s", "Victim view", "s", [CLIP_RANGE_SWITCH[0] as f64, CLIP_RANGE_SWITCH[1] as f64], STEP_ONE, 0, None, "Switch early", TIPS_VICTIM, tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Retry, c)),
            });
            if !both {
                mark(ui, "victim_pre_s");
            }
            ui.horizontal_wrapped(|ui| {
                if perspective != "killer" {
                    lab(ui, t, "Mate POV");
                    if named_chip(ui, cx, "kill_mod_mate_pov", "Enable", "Mate POV: Enable", mate, TIPS_MATE) {
                        cx.link.set(cx.now, "kill_mod_mate_pov", json!(!mate));
                        if mate {
                            cx.link.set(cx.now, "kill_mod_mate_pov_req", json!(false));
                        }
                    }
                    if named_chip(ui, cx, "kill_mod_mate_pov_req", "★ Must", "Mate POV: ★ Must", mate_req, TIPS_MATE_REQ) {
                        cx.link.set(cx.now, "kill_mod_mate_pov_req", json!(!mate_req));
                        if !mate_req {
                            cx.link.set(cx.now, "kill_mod_mate_pov", json!(true));
                        }
                    }
                }
                lab(ui, t, "Feed name");
                text_field(ui, cx, "player_name_override", "Feed name", "name from the demo", FEED_W, TIPS_FEED);
            });
        }
    }
    ui.add_space(ROW_GAP);
    ui.horizontal_wrapped(|ui| {
        let g = ui.painter().layout_no_wrap(format!("{} s", secs(w.total)), semibold(FONT_TOTAL), t.on_accent);
        let (r, _) = ui.allocate_exact_size(g.size() + vec2(TOTAL_PAD[0], TOTAL_PAD[1]) * 2.0, Sense::hover());
        ui.painter().rect_filled(r, TOTAL_PAD[0], t.accent);
        ui.painter().galley(r.min + vec2(TOTAL_PAD[0], TOTAL_PAD[1]), g, t.on_accent);
        let s = clip_summary(&input);
        let resp = ui.add(egui::Label::new(egui::RichText::new(&s).font(regular(FONT_TOTAL - 1.0)).color(t.muted)).wrap());
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, &s));
    });
    Some(format!("{} s clip", secs(w.total)))
}

/// A number you drag sideways; a click opens its slider and an exact box (3.5 `NumberToken`).
#[allow(clippy::too_many_arguments)]
fn count_word(ui: &mut egui::Ui, cx: &mut CardCx, key: &str, label: &str, unit: &str, drag_max: i64, tip: &str, alt: bool, small: bool) {
    mark(ui, key);
    let t = cx.theme;
    let value = as_count(cx.link.get(key), 0);
    let max = drag_max.max(value);
    let cam = if alt { t.emerald } else { t.accent };
    let i = usize::from(small);
    let text = format!("{value}{unit}");
    let g = ui.painter().layout_no_wrap(text.clone(), mono(FONT_TOKEN[i]), cam);
    let (rect, resp) = ui.allocate_exact_size(vec2(g.size().x + TOKEN_PAD * 2.0, TOKEN_H[i]), Sense::click_and_drag());
    let name = label.to_string();
    resp.widget_info(|| {
        let mut info = egui::WidgetInfo::labeled(egui::Role::SpinButton, true, &name);
        info.value = Some(value as f64);
        info
    });
    let id = ui.scope_id().with(("tok", key));
    let p = ui.painter();
    let lit = resp.hovered() || resp.dragged();
    if lit {
        p.rect_filled(rect.expand(RING), TOKEN_PAD + RING, t.accent_soft);
        crate::cursor::snap_here(ui.ctx(), rect);
    }
    crate::paint::vgradient(p, rect, t.solid, t.solid.lerp_to_gamma(cam, TOKEN_TINT));
    p.rect_stroke(rect, TOKEN_PAD, Stroke::new(1.0, t.hair), StrokeKind::Inside);
    p.galley(pos2(rect.left() + TOKEN_PAD, rect.center().y - g.size().y / 2.0), g, cam);
    let resp = resp.on_hover_text(tip);
    let mut next = None;
    if resp.dragged() {
        let acc: f32 = ui.data(|d| d.get_temp(id.with("acc")).unwrap_or(0.0)) + resp.drag_delta().x;
        let steps = (acc / DRAG_PX_PER_STEP).trunc();
        ui.data_mut(|d| d.insert_temp(id.with("acc"), acc - steps * DRAG_PX_PER_STEP));
        if steps != 0.0 {
            next = Some((value + steps as i64).clamp(0, max));
        }
    }
    if resp.drag_stopped() {
        ui.data_mut(|d| d.remove::<f32>(id.with("acc")));
    }
    let open_id = id.with("open");
    let mut open: bool = ui.data(|d| d.get_temp(open_id).unwrap_or(false));
    if resp.clicked() {
        open = !open;
    }
    if open {
        let area = egui::Area::new(id.with("pop")).order(egui::Order::Foreground).fixed_pos(rect.left_bottom() + vec2(0.0, POP_GAP)).show(ui.ctx(), |ui| {
            egui::Frame::popup(ui.style()).fill(t.solid).stroke(Stroke::new(1.0, t.hair)).show(ui, |ui| {
                ui.set_width(POP_W);
                ui.label(egui::RichText::new(label).font(semibold(FONT_TOKEN[1])).color(t.txt));
                let mut v = value;
                // The exact box below shows the number; the slider carries the token's name.
                let s = ui.add(egui::Slider::new(&mut v, 0..=max).show_value(false));
                s.widget_info(|| egui::WidgetInfo::slider(true, v as f64, format!("{label} slider")));
                if s.changed() {
                    next = Some(v);
                }
                ui.horizontal(|ui| {
                    lab(ui, t, "Exact");
                    let eid = id.with("exact");
                    let mut txt: String = ui.data(|d| d.get_temp(eid)).unwrap_or_else(|| value.to_string());
                    let r = ui.add(egui::TextEdit::singleline(&mut txt).desired_width(super::kit::FIELD_W));
                    let n = format!("{label} exact");
                    r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, &n));
                    if r.changed() {
                        if !txt.trim().is_empty() {
                            next = Some(as_count(Some(&json!(txt)), value));
                        }
                        ui.data_mut(|d| d.insert_temp(eid, txt));
                    }
                    lab(ui, t, unit.trim());
                });
            });
        });
        let outside = ui.input(|i| i.pointer.any_click() && i.pointer.interact_pos().is_some_and(|p| !area.response.rect.contains(p) && !rect.contains(p)));
        if outside {
            open = false;
        }
    }
    ui.data_mut(|d| d.insert_temp(open_id, open));
    if let Some(v) = next.filter(|v| *v != value) {
        cx.link.set(cx.now, key, json!(v));
    }
}

fn block(p: &egui::Painter, r: Rect, fill: Color32, edge: Option<Color32>, ghost: bool) {
    if ghost {
        p.rect_stroke(r, BLOCK_RADIUS, Stroke::new(1.0, edge.unwrap_or(Color32::GRAY)), StrokeKind::Inside);
    } else {
        p.rect(r, BLOCK_RADIUS, fill, edge.map_or(Stroke::NONE, |e| Stroke::new(1.0, e)), StrokeKind::Inside);
    }
}

/// Glyphs of `timingRetries/shared.tsx::GLYPHS`, drawn.
fn glyph(p: &egui::Painter, r: Rect, kind: &str, ink: Color32) {
    let c = r.center();
    let s = r.width() / QUARTER;
    let st = Stroke::new(2.0, ink);
    match kind {
        "fail" => {
            p.line_segment([c + vec2(-s, -s) * CROSS, c + vec2(s, s) * CROSS], st);
            p.line_segment([c + vec2(s, -s) * CROSS, c + vec2(-s, s) * CROSS], st);
        }
        "retry" => {
            let pts: Vec<_> = (0..=ARC_STEPS).map(|k| {
                let a = std::f32::consts::PI * (ARC[0] + ARC[1] * k as f32 / ARC_STEPS as f32);
                c + vec2(a.cos(), a.sin()) * s
            }).collect();
            p.add(egui::Shape::line(pts, st));
            p.line_segment([c + vec2(s, -s * ARROW[0]), c + vec2(s, -s * ARROW[1])], st);
        }
        "demo" => {
            let tri = vec![c + vec2(-s * PLAY[0], -s * PLAY[1]), c + vec2(s * PLAY[2], 0.0), c + vec2(-s * PLAY[0], s * PLAY[1])];
            p.add(egui::Shape::convex_polygon(tri, ink, Stroke::NONE));
        }
        _ => {}
    }
}

/// Timing & Retries: the batch drawn as it runs.
pub fn retries(ui: &mut egui::Ui, cx: &mut CardCx) -> Option<String> {
    let t = cx.theme;
    let retries = as_count(cx.link.get("retry_count"), 0);
    let delay = as_count(cx.link.get("retry_delay"), 0);
    let timeout = as_count(cx.link.get("recording_timeout"), 0);
    let pause = as_count(cx.link.get("delay_between_demos"), 0);
    let order = if super::kit::text(cx, "clip_order") == ORDERS[1] { ORDERS[1] } else { ORDERS[0] };
    let [max_retries, max_delay, max_timeout, max_pause] = TIMING_DRAG_MAX;
    match style_of(cx, "timing-retries") {
        CardStyle::Timeline => {
            framed(ui, t, |ui| {
                ui.horizontal(|ui| {
                    kick(ui, t, "If a recording fails");
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        count_word(ui, cx, "retry_count", "Retries", if retries == 1 { " retry" } else { " retries" }, max_retries, TIPS_RETRIES, false, false);
                    });
                });
                let shown = retries.min(TIMING_SHOWN_RETRIES);
                let folded = retries - shown;
                track(ui, t, |ui| {
                    let more = if folded > 0 { format!("+{folded}") } else { String::new() };
                    let more_w = ui.painter().layout_no_wrap(more.clone(), regular(super::kit::FONT_SEG), t.muted).size().x;
                    let steps = shown.max(1) as usize;
                    let w = gap_width(ui.available_width() - BLOCK * (steps + 1) as f32 - more_w, steps);
                    let (r, _) = ui.allocate_exact_size(vec2(BLOCK, BLOCK), Sense::hover());
                    block(ui.painter(), r, t.solid.lerp_to_gamma(t.amber, FAIL_TINT), None, false);
                    glyph(ui.painter(), r, "fail", t.amber);
                    for k in 0..steps {
                        gap(ui, t, t.accent, w, |ui| {
                            if k == 0 {
                                count_word(ui, cx, "retry_delay", "Wait between", "s", max_delay, TIPS_RETRY_DELAY, false, true);
                            } else {
                                lab(ui, t, &format!("{delay}s"));
                            }
                        });
                        let (r, _) = ui.allocate_exact_size(vec2(BLOCK, BLOCK), Sense::hover());
                        if shown > 0 {
                            block(ui.painter(), r, t.accent, None, false);
                            glyph(ui.painter(), r, "retry", Color32::WHITE);
                        } else {
                            block(ui.painter(), r, Color32::TRANSPARENT, Some(t.hair), true);
                            glyph(ui.painter(), r, "retry", t.faint);
                        }
                    }
                    if folded > 0 {
                        lab(ui, t, &more);
                    }
                });
                ui.horizontal(|ui| {
                    lab(ui, t, "Stop if stuck after");
                    count_word(ui, cx, "recording_timeout", "Stop if stuck", " min", max_timeout, TIPS_TIMEOUT, false, false);
                    if timeout == 0 {
                        lab(ui, t, "= automatic");
                    }
                });
            });
            ui.add_space(ROW_GAP);
            framed(ui, t, |ui| {
                ui.allocate_ui_with_layout(vec2(ui.available_width(), 0.0), egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    mark(ui, "clip_order");
                    if let Some(o) = seg(ui, t, "Demo order", &ORDERS, order, false, TIPS_ORDER, None) {
                        cx.link.set(cx.now, "clip_order", json!(o));
                    }
                    ui.allocate_ui_with_layout(vec2(ui.available_width(), 0.0), egui::Layout::top_down(egui::Align::Min), |ui| kick(ui, t, "Between demos"));
                });
                let seq = TIMING_DEMO_SEQUENCE[usize::from(order == ORDERS[1])];
                track(ui, t, |ui| {
                    let w = gap_width(ui.available_width() - (BLOCK + PIN_ROOM) * seq.len() as f32, seq.len() - 1);
                    for (i, n) in seq.iter().enumerate() {
                        if i > 0 {
                            gap(ui, t, t.emerald, w, |ui| {
                                if i == 1 {
                                    count_word(ui, cx, "delay_between_demos", "Pause", "s", max_pause, TIPS_PAUSE, true, true);
                                } else {
                                    lab(ui, t, &format!("{pause}s"));
                                }
                            });
                        }
                        let (r, _) = ui.allocate_exact_size(vec2(BLOCK + PIN_ROOM, BLOCK), Sense::hover());
                        let b = Rect::from_min_size(r.min, vec2(BLOCK, BLOCK));
                        block(ui.painter(), b, t.solid, Some(t.emerald.gamma_multiply(DEMO_EDGE_ALPHA)), false);
                        glyph(ui.painter(), b, "demo", t.emerald);
                        let badge = Rect::from_min_size(pos2(r.right() - BADGE, r.bottom() - BADGE + BADGE_DROP), vec2(BADGE, BADGE));
                        ui.painter().rect_filled(badge, BADGE / 2.0, t.emerald);
                        ui.painter().text(badge.center(), egui::Align2::CENTER_CENTER, n.to_string(), semibold(FONT_TOKEN[1] - 2.0), Color32::WHITE);
                    }
                });
            });
        }
        CardStyle::Sentence => {
            let order_opts = [("chrono", "chronological", "oldest demo first"), ("random", "shuffled", "random demo order")];
            prose_line(ui, |ui| {
                prose_word(ui, t, "If a recording fails, retry");
                number_token(ui, cx, "retry_count", "Retries", if retries == 1 { " time" } else { " times" }, [0.0, max_retries as f64], STEP_ONE, 0, 0.0, false, TIPS_RETRIES, &[]);
                prose_word(ui, t, "waiting");
                number_token(ui, cx, "retry_delay", "Wait between", "s", [0.0, max_delay as f64], STEP_ONE, 0, 0.0, false, TIPS_RETRY_DELAY, &[]);
                prose_word(ui, t, "between tries; stop if stuck after");
                number_token(ui, cx, "recording_timeout", "Stop if stuck", " min", [0.0, max_timeout as f64], STEP_ONE, 0, 0.0, false, TIPS_TIMEOUT, &[]);
                if timeout == 0 {
                    prose_muted(ui, t, "(= auto)");
                }
                prose_word(ui, t, ". Pause");
                number_token(ui, cx, "delay_between_demos", "Pause", "s", [0.0, max_pause as f64], STEP_ONE, 0, 0.0, true, TIPS_PAUSE, &[]);
                prose_word(ui, t, "between demos in");
                choice_word(ui, cx, "clip_order", "Demo order", &order_opts, ORDERS[0], false, TIPS_ORDER);
                prose_word(ui, t, "order.");
            });
        }
        CardStyle::Tiles => {
            tile_grid(ui, TILE_MIN_W, 4, |ui, idx, tw| match idx { // allow-hardcode: four timing tiles
                0 => count_tile(ui, cx, "retry_count", "Retries", "", [0.0, max_retries as f64], STEP_ONE, 0, Some((0.0, "Off")), "On failed run", TIPS_RETRIES, tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Retry, c)),
                1 => count_tile(ui, cx, "retry_delay", "Retry delay", "s", [0.0, max_delay as f64], STEP_ONE, 0, None, "Wait before retry", TIPS_RETRY_DELAY, tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Wait, c)),
                2 => count_tile(ui, cx, "recording_timeout", "Stop if stuck", " min", [0.0, max_timeout as f64], STEP_ONE, 0, Some((0.0, "Auto")), "Timeout limit", TIPS_TIMEOUT, tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Stuck, c)),
                _ => count_tile(ui, cx, "delay_between_demos", "Pause", "s", [0.0, max_pause as f64], STEP_ONE, 0, None, "Between demos", TIPS_PAUSE, tw, |p, r, c| crate::cardstyle::paint_glyph(p, r, TileGlyph::Wait, c)),
            });
            ui.add_space(ROW_GAP);
            let order_opts = [
                PictureOpt { value: "chrono", title: "Chronological", subtitle: "1 -> 2 -> 3", tip: TIPS_ORDER },
                PictureOpt { value: "random", title: "Random", subtitle: "Shuffled order", tip: TIPS_ORDER },
            ];
            if let Some(next_o) = picture_choice(ui, t, SEQ_TILE_MIN_W, "Demo order", &order_opts, order, |p, r, val, on| {
                let seq = TIMING_DEMO_SEQUENCE[usize::from(val == ORDERS[1])];
                let total_w = seq.len() as f32 * DEMO_CHIP_W + (seq.len() - 1) as f32 * DEMO_CHIP_GAP;
                let mut x = r.center().x - total_w / 2.0;
                let ink = if on { t.accent } else { t.muted };
                for n in seq {
                    let b = Rect::from_min_size(pos2(x, r.center().y - DEMO_CHIP_W / 2.0), vec2(DEMO_CHIP_W, DEMO_CHIP_W));
                    p.rect(b, BLOCK_RADIUS / 2.0, t.surface2, Stroke::new(1.0, ink), StrokeKind::Inside);
                    p.text(b.center(), Align2::CENTER_CENTER, n.to_string(), semibold(FONT_TOKEN[1]), ink);
                    x += DEMO_CHIP_W + DEMO_CHIP_GAP;
                }
            }) {
                cx.link.set(cx.now, "clip_order", json!(next_o));
            }
            mark(ui, "clip_order");
        }
    }
    ui.add_space(ROW_GAP);
    let s = pacing_summary(retries, delay, pause, timeout, order == ORDERS[1]);
    super::kit::hint(ui, t, &s);
    let _ = as_text;
    None
}

/// `.tr-track`: a padded hairline box laid out left to right.
fn track(ui: &mut egui::Ui, t: &Theme, add: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new().fill(t.surface2).stroke(Stroke::new(1.0, t.hair)).corner_radius(egui::CornerRadius::same(TRACK_RADIUS)).inner_margin(egui::Margin::same(TRACK_PAD as i8)).show(ui, |ui| {
        ui.set_width(ui.available_width());
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 0.0;
            add(ui);
        });
    });
}

/// 3.5 `.tr-gap` is `flex: 1` (min 34 px) and every step of a track grows alike: the waits share
/// the room the blocks leave, so the track never runs past its card.
fn gap_width(room: f32, gaps: usize) -> f32 {
    (room / gaps.max(1) as f32).max(MIN_GAP_W)
}

/// `.tr-gap`: a dashed wait, the number on top.
fn gap(ui: &mut egui::Ui, _t: &Theme, color: Color32, w: f32, add: impl FnOnce(&mut egui::Ui)) {
    let (r, _) = ui.allocate_exact_size(vec2(w, BLOCK), Sense::hover());
    ui.painter().add(egui::Shape::dashed_line(&[pos2(r.left(), r.center().y), pos2(r.right(), r.center().y)], Stroke::new(2.0, color.gamma_multiply(GAP_EDGE_ALPHA)), DASH, DASH));
    let mut child = ui.new_child(egui::UiBuilder::new().max_rect(r).layout(egui::Layout::centered_and_justified(egui::Direction::LeftToRight)));
    child.horizontal_centered(|ui| {
        ui.add_space(((w - TOKEN_H[1] * 2.0) / 2.0).max(0.0));
        add(ui);
    });
}
