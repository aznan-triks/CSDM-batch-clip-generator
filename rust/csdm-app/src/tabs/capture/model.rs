//! The CAPTURE cards' rules, without any drawing (3.5 `clipWindow.ts`, `useCaptureTiming.ts`,
//! `useTimingRetries.ts`, `useDemoSelection.ts`, `RangeStrip.tsx`, `usePlayerCard.ts`,
//! `filterRows.ts`, `useKillFilters.ts`, `setFilter/model.ts`, `useMapFilter.tsx`,
//! `useWeaponFilter.ts`). Every card style draws these; the tests pin them to 3.5.

use chrono::{Datelike, Duration, NaiveDate};
use csdm_core::ui_values::{
    AVATAR_HUES, CLIP_RANGE_AFTER, CLIP_RANGE_BEFORE, CLIP_RANGE_SWITCH, DATE_FORMAT, DATE_SHORTCUTS, DEMO_STRIP_LEAST_SPAN_DAYS, DEMO_STRIP_MIN_LEAD_DAYS,
    DEMO_STRIP_MONTHLY_OVER_DAYS, DEMO_STRIP_OPEN_SPAN_DAYS, GUN_HEIGHT, GUN_WIDTH_RANGE, LIST_WORDS_MAX, MAP_SHADES, NO_EXCLUDE_BOX, SHORT_ID_DIGITS,
    TIMING_GAP_GROW,
};
use serde_json::Value;

/// `h = h * 31 + c` of 3.5's `hueOf` / `mapShade`.
const HASH_MUL: u32 = 31;
const DAYS_PER_WEEK: i64 = 7;
/// Where the dashes of `dd-mm-yyyy` sit.
const DATE_DASHES: [usize; 2] = [2, 5];
const DATE_TEXT: &str = "dd-mm-yyyy";
/// `connect_db` player row: `[label, steam_id, name, last_seen]`.
const LAST_SEEN: usize = 3;
const ISO_DATE_TIME: &str = "%Y-%m-%dT%H:%M:%S%.f";
const ISO_DATE: &str = "%Y-%m-%d";
const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ------------------------------------------------------------------ lists in words

/// "A", "A & B", "A, B & C", "A, B & 2 more" (`pickedWords`, `weaponSummary`); `empty` for none.
pub fn list_words(items: &[String], empty: &str) -> String {
    let max = LIST_WORDS_MAX;
    match items.len() {
        0 => empty.to_string(),
        1 => items[0].clone(),
        n if n > max => format!("{} & {} more", items[..max - 1].join(", "), n - max + 1),
        n => format!("{} & {}", items[..n - 1].join(", "), items[n - 1]),
    }
}

// ------------------------------------------------------------------ Capture & Timing

pub const PERSPECTIVES: [&str; 3] = ["killer", "victim", "both"];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClipInput<'a> {
    pub before: f64,
    pub after: f64,
    pub perspective: &'a str,
    pub switch_delay: f64,
    pub mate_pov: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClipWindow {
    /// Seconds before the moment filmed from the killer's (or the only) camera.
    pub lead: f64,
    /// Seconds before the moment filmed from the victim, `both` only.
    pub victim_view: f64,
    /// Seconds recorded before each event, switch delay included.
    pub before: f64,
    pub after: f64,
    pub total: f64,
    /// Events at most this many seconds apart share one clip.
    pub merge_within: f64,
}

/// `_effective_before` + `_build_sequences`: in `both` the switch delay is added before;
/// two moments t1 < t2 merge when t2 - t1 <= after + 2 * before.
pub fn clip_window(i: &ClipInput) -> ClipWindow {
    let victim_view = if i.perspective == "both" { i.switch_delay.max(0.0) } else { 0.0 };
    let before = i.before + victim_view;
    ClipWindow { lead: i.before, victim_view, before, after: i.after, total: before + i.after, merge_within: i.after + 2.0 * before }
}

fn secs(v: f64) -> String {
    // JS prints whole numbers without a decimal point.
    if v.fract() == 0.0 { format!("{}", v as i64) } else { format!("{v}") }
}

/// `clipWindowSummary`.
pub fn clip_summary(i: &ClipInput) -> String {
    let w = clip_window(i);
    let mate = "the best-placed teammate";
    let parts = if w.victim_view > 0.0 {
        format!("{}s on the killer, {}s on {}, {}s after", secs(w.lead), secs(w.victim_view), if i.mate_pov { mate } else { "the victim" }, secs(w.after))
    } else {
        let lead = if i.perspective == "victim" { if i.mate_pov { mate } else { "the victim" } } else { "the killer" };
        format!("{}s on {} before, {}s after", secs(w.before), lead, secs(w.after))
    };
    let total = secs(w.total);
    // "an 8s", "an 11s", "an 18s": the article follows how the number is said (`/^(8|11$|18$)/`).
    let article = if total.starts_with('8') || total == "11" || total == "18" { "an" } else { "a" };
    format!("Each moment becomes {article} {total}s clip ({parts}). A second moment within {}s joins the same clip.", secs(w.merge_within))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipHandle { Start, Switch, End }

fn clamp_to(v: f64, r: [i64; 2]) -> f64 {
    v.round().clamp(r[0] as f64, r[1] as f64)
}

/// `moveClipHandle`: (before, after, switch delay) once handle is dragged to second `at`.
/// Start sets the seconds before, End the seconds after; Switch trades killer seconds for victim
/// seconds with the clip's start held still.
pub fn move_handle(handle: ClipHandle, at: f64, i: &ClipInput) -> (f64, f64, f64) {
    let w = clip_window(i);
    let (mut before, mut after, mut switch) = (i.before, i.after, i.switch_delay);
    match handle {
        ClipHandle::End => after = clamp_to(at, CLIP_RANGE_AFTER),
        ClipHandle::Start => before = clamp_to(-at - w.victim_view, CLIP_RANGE_BEFORE),
        ClipHandle::Switch => {
            let lead = i.before + w.victim_view;
            let max_switch = (CLIP_RANGE_SWITCH[1] as f64).min(lead - CLIP_RANGE_BEFORE[0] as f64);
            switch = clamp_to(-at, [CLIP_RANGE_SWITCH[0], max_switch.max(0.0) as i64]);
            before = clamp_to(lead - switch, CLIP_RANGE_BEFORE);
        }
    }
    (before, after, switch)
}

/// What the role × action choice captures (`momentWords`).
pub fn moment_words(actor: bool, target: bool, lethal: bool, non_lethal: bool, other: bool) -> String {
    let mut out: Vec<String> = Vec::new();
    if lethal {
        if actor { out.push("kills".into()); }
        if target { out.push("deaths".into()); }
    }
    if non_lethal {
        match (actor, target) {
            (true, true) => out.push("hits dealt & taken".into()),
            (true, false) => out.push("hits dealt".into()),
            (false, true) => out.push("hits taken".into()),
            _ => {}
        }
    }
    if other && actor { out.push("shots".into()); }
    match out.len() {
        0 => "nothing yet".into(),
        1 => out.remove(0),
        n => format!("{} & {}", out[..n - 1].join(", "), out[n - 1]),
    }
}

// ------------------------------------------------------------------ Timing & Retries

/// `asCount`: a whole, non-negative number; an empty or unreadable value keeps `fallback`.
pub fn as_count(v: Option<&Value>, fallback: i64) -> i64 {
    let n = match v {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) if !s.trim().is_empty() => s.trim().parse::<f64>().ok(),
        Some(Value::Bool(b)) => Some(f64::from(u8::from(*b))),
        _ => None,
    };
    n.filter(|x| x.is_finite()).map_or(fallback, |x| x.round().max(0.0) as i64)
}

/// `pacingSummary`.
pub fn pacing_summary(retries: i64, retry_delay: i64, demo_pause: i64, timeout_min: i64, random: bool) -> String {
    let retry = if retries > 0 {
        format!("A failed recording is tried again up to {retries} {}, {retry_delay}s apart", if retries == 1 { "time" } else { "times" })
    } else {
        "A failed recording is not tried again".to_string()
    };
    let timeout = if timeout_min > 0 {
        format!("one that hangs is stopped after at least {timeout_min} min")
    } else {
        "one that hangs is stopped after a wait worked out from the clip length".to_string()
    };
    let order = if random { "in random order" } else { "in match-date order" };
    let pause = if demo_pause > 0 { format!("a {demo_pause}s pause") } else { "no pause".into() };
    format!("{retry}; {timeout}. Demos are recorded {order}, with {pause} between two.")
}

/// `gapGrow`: a wait's width weight.
pub fn gap_grow(seconds: i64) -> f32 {
    (1.0 + (seconds as f64).min(TIMING_GAP_GROW[0]) / TIMING_GAP_GROW[1]) as f32
}

// ------------------------------------------------------------------ Demo Selection

pub fn fmt_day(d: NaiveDate) -> String {
    d.format(DATE_FORMAT).to_string()
}

/// `parseDay`: `dd-mm-yyyy` (anything after is ignored), or `None`.
pub fn parse_day(value: &str) -> Option<NaiveDate> {
    let head: String = value.chars().take(DATE_TEXT.len()).collect();
    let b = head.as_bytes();
    let ok = b.len() == DATE_TEXT.len() && b.iter().enumerate().all(|(i, c)| if DATE_DASHES.contains(&i) { *c == b'-' } else { c.is_ascii_digit() });
    ok.then(|| NaiveDate::parse_from_str(&head, DATE_FORMAT).ok()).flatten()
}

pub struct Shortcut {
    pub label: &'static str,
    pub kind: &'static str,
    pub days: i64,
    pub title: &'static str,
    pub words: &'static str,
}

pub fn shortcuts() -> impl Iterator<Item = Shortcut> {
    DATE_SHORTCUTS.iter().map(|&(label, kind, days, title, words)| Shortcut { label, kind, days, title, words })
}

/// `rangeForShortcut` (`_set_date_range`): the shortcut's (from, to) for `today`.
pub fn shortcut_range(s: &Shortcut, today: NaiveDate) -> (String, String) {
    match s.kind {
        "yesterday" => {
            let y = fmt_day(today - Duration::days(1));
            (y.clone(), y)
        }
        "days" => (fmt_day(today - Duration::days(s.days)), fmt_day(today)),
        "month" => (fmt_day(today.with_day(1).expect("day 1 exists")), fmt_day(today)),
        "year" => (fmt_day(NaiveDate::from_ymd_opt(today.year(), 1, 1).expect("1 January exists")), fmt_day(today)),
        _ => (String::new(), String::new()),
    }
}

/// The shortcut whose range IS the dates on screen today.
pub fn active_shortcut(from: &str, to: &str, today: NaiveDate) -> Option<&'static str> {
    shortcuts().find(|s| shortcut_range(s, today) == (from.to_string(), to.to_string())).map(|s| s.label)
}

/// `fitStart`: the strip's first day.
pub fn strip_start(from: Option<NaiveDate>, to: Option<NaiveDate>, today: NaiveDate) -> NaiveDate {
    let Some(f) = from else { return today - Duration::days(DEMO_STRIP_OPEN_SPAN_DAYS) };
    let length = (to.unwrap_or(today) - f).num_days();
    let start = f - Duration::days(DEMO_STRIP_MIN_LEAD_DAYS.max((length as f64 / 2.0).round() as i64));
    start.min(today - Duration::days(DEMO_STRIP_LEAST_SPAN_DAYS))
}

/// Tick candidates: first of each month (year on January) on a long strip, Mondays on a short one.
pub fn strip_ticks(start: NaiveDate, today: NaiveDate) -> Vec<(NaiveDate, String, bool)> {
    let mut out = Vec::new();
    if (today - start).num_days() > DEMO_STRIP_MONTHLY_OVER_DAYS {
        let mut d = first_of_next_month(start);
        while d <= today {
            let jan = d.month() == 1;
            out.push((d, if jan { d.year().to_string() } else { MONTHS[d.month0() as usize].to_string() }, jan));
            d = first_of_next_month(d);
        }
        return out;
    }
    // JS getDay(): Sunday 0 … Saturday 6; first = start + (8 - day) % 7.
    let js_day = i64::from(start.weekday().num_days_from_sunday());
    let mut d = start + Duration::days((DAYS_PER_WEEK + 1 - js_day) % DAYS_PER_WEEK);
    while d <= today {
        out.push((d, format!("{} {}", d.day(), MONTHS[d.month0() as usize]), d.day() <= DAYS_PER_WEEK as u32));
        d += Duration::days(DAYS_PER_WEEK);
    }
    out
}

fn first_of_next_month(d: NaiveDate) -> NaiveDate {
    let (y, m) = if d.month() as usize == MONTHS.len() { (d.year() + 1, 1) } else { (d.year(), d.month() + 1) };
    NaiveDate::from_ymd_opt(y, m, 1).expect("first of a month exists")
}

// ------------------------------------------------------------------ Player

/// One row of `connect_db`'s `players`: `[label, steam_id, name, last_seen]`.
#[derive(Clone, Debug, PartialEq)]
pub struct PlayerRow {
    pub label: String,
    pub steam_id: String,
    pub name: String,
    pub last_seen: Option<f64>,
}

pub fn player_rows(players: Option<&Value>) -> Vec<PlayerRow> {
    let text = |v: &Value| match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    };
    players.and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_array).map(|r| {
        let at = |i: usize| r.get(i).map(text).unwrap_or_default();
        let last_seen = match r.get(LAST_SEEN) {
            Some(Value::Number(n)) => n.as_f64(),
            Some(Value::String(s)) => chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis() as f64)
                .or_else(|| chrono::NaiveDateTime::parse_from_str(s, ISO_DATE_TIME).ok().map(|d| d.and_utc().timestamp_millis() as f64))
                .or_else(|| NaiveDate::parse_from_str(s, ISO_DATE).ok().map(|d| d.and_hms_opt(0, 0, 0).expect("midnight").and_utc().timestamp_millis() as f64)),
            _ => None,
        };
        PlayerRow { label: at(0), steam_id: at(1), name: at(2), last_seen }
    }).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Order { #[default] Name, Recent }

/// Search over the whole list, then order (`matches` + `order`).
pub fn find_players<'a>(rows: &'a [PlayerRow], query: &str, order: Order) -> Vec<&'a PlayerRow> {
    let q = query.trim().to_lowercase();
    let mut out: Vec<&PlayerRow> = rows.iter().filter(|r| q.is_empty() || r.name.to_lowercase().contains(&q) || r.steam_id.contains(&q)).collect();
    match order {
        Order::Recent => out.sort_by(|a, b| b.last_seen.unwrap_or(f64::NEG_INFINITY).total_cmp(&a.last_seen.unwrap_or(f64::NEG_INFINITY))),
        // `localeCompare`: case-insensitive first, then the exact text.
        Order::Name => out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.name.cmp(&b.name))),
    }
    out
}

/// Move the element at `from` to `to` (drag reorder).
pub fn reorder<T: Clone>(list: &[T], from: usize, to: usize) -> Vec<T> {
    let mut next = list.to_vec();
    if from < next.len() && to < next.len() {
        let moved = next.remove(from);
        next.insert(to, moved);
    }
    next
}

fn hash31(s: &str) -> u32 {
    // JS charCodeAt walks UTF-16 code units.
    s.encode_utf16().fold(0u32, |h, c| h.wrapping_mul(HASH_MUL).wrapping_add(u32::from(c)))
}

pub fn avatar_hue(steam_id: &str) -> u32 {
    hash31(steam_id) % AVATAR_HUES
}

/// `shortId`: "…123456".
pub fn short_id(steam_id: &str) -> String {
    let n = steam_id.chars().count();
    if n > SHORT_ID_DIGITS { format!("…{}", steam_id.chars().skip(n - SHORT_ID_DIGITS).collect::<String>()) } else { steam_id.to_string() }
}

// ------------------------------------------------------------------ registry filter rows

/// One registry filter, as `describe_filters` sends it (3.5 `FilterDef`).
#[derive(Clone, Debug, PartialEq)]
pub struct FilterRow {
    pub key: String,
    pub name: String,
    pub glyph: String,
    pub tip: String,
    pub untested: String,
    pub category: String,
    pub applies_to: Vec<String>,
    /// `_exclude` companion exists.
    pub exclude: bool,
    /// Registry extras: (key, label, unit, default).
    pub extras: Vec<(String, String, String, Value)>,
}

/// "💨 SMOKE:" → ("💨", "SMOKE"); a label with no emoji keeps it all (`splitLabel`).
pub fn split_label(label: &str) -> (String, String) {
    let text = label.trim();
    let text = text.strip_suffix(':').map(str::trim_end).unwrap_or(text);
    if let Some(space) = text.find(' ') {
        let head = &text[..space];
        if space > 0 && !head.chars().any(char::is_alphanumeric) {
            return (head.to_string(), text[space + 1..].trim().to_string());
        }
    }
    (String::new(), text.to_string())
}

/// The visible rows of `describe_filters`' `filters`, in registry order.
pub fn filter_rows(tables: &Value) -> Vec<FilterRow> {
    let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    tables.get("filters").and_then(Value::as_array).into_iter().flatten().filter(|f| f.get("hidden") != Some(&Value::Bool(true))).map(|f| {
        let key = s(f, "key");
        let (glyph, name) = split_label(&s(f, "label"));
        // Python's default when absent: ("kill",).
        let applies_to = f.get("applies_to").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_else(|| vec!["kill".to_string()]);
        let extras = f.get("extras").and_then(Value::as_array).into_iter().flatten().map(|e| (s(e, "key"), s(e, "label"), s(e, "unit"), e.get("default").cloned().unwrap_or(Value::Null))).collect();
        FilterRow { exclude: !NO_EXCLUDE_BOX.contains(&key.as_str()), key, name, glyph, tip: s(f, "tip"), untested: s(f, "untested"), category: s(f, "category"), applies_to, extras }
    }).collect()
}

impl FilterRow {
    pub fn judges(&self, what: &str) -> bool {
        self.applies_to.iter().any(|a| a == what)
    }
    pub fn must_key(&self) -> String {
        format!("{}_req", self.key)
    }
    pub fn exclude_key(&self) -> String {
        format!("{}_exclude", self.key)
    }
    /// A filter's tooltip, with what is not yet checked in game after it (`filterTip`).
    pub fn full_tip(&self) -> String {
        if self.untested.is_empty() { self.tip.clone() } else { format!("{}\nUNTESTED: {}", self.tip, self.untested) }
    }
}

/// `_wire_enable_must` as the changes one click writes. Enable off drops Must; Must on arms Enable.
pub fn toggle_changes(row: &FilterRow, cell: Cell, enabled: bool, required: bool, excluded: bool) -> Vec<(String, bool)> {
    match cell {
        Cell::Keep if enabled => vec![(row.key.clone(), false), (row.must_key(), false)],
        Cell::Keep => vec![(row.key.clone(), true)],
        Cell::Must if required => vec![(row.must_key(), false)],
        Cell::Must => vec![(row.must_key(), true), (row.key.clone(), true)],
        Cell::Drop => vec![(row.exclude_key(), !excluded)],
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cell { Keep, Must, Drop }

// ------------------------------------------------------------------ set filters, maps, weapons

/// "🏆 Premier" → ("🏆", "Premier"): a match type's label carries its own picture.
pub fn split_badge(label: &str) -> (String, String) {
    if let Some((head, rest)) = label.split_once(char::is_whitespace) {
        if !head.is_empty() && !head.chars().any(char::is_alphabetic) && !rest.trim().is_empty() {
            return (head.to_string(), rest.trim().to_string());
        }
    }
    (String::new(), label.to_string())
}

/// "dust2" → "Dust2".
pub fn map_name(display: &str) -> String {
    let mut c = display.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

pub fn map_shade(display: &str) -> u32 {
    hash31(display) % MAP_SHADES
}

/// "3 of 13" / "all" / "none" for a set filter's header (`keptWords`).
pub fn kept_words(enabled: bool, picked: usize, total: usize) -> String {
    if !enabled { "all".into() } else if picked > 0 { format!("{picked} of {total}") } else { "none".into() }
}

/// `gunWidth`: a silhouette's width at `height` from its own viewBox ratio.
pub fn gun_width(ratio: Option<f32>, height: f32) -> f32 {
    let scale = height / GUN_HEIGHT;
    const NO_ART_WIDTH: f32 = 96.0;
    match ratio {
        None => (NO_ART_WIDTH * height / GUN_HEIGHT).round(),
        Some(r) => (GUN_WIDTH_RANGE[1] * scale).min((GUN_WIDTH_RANGE[0] * scale).max(height * r)).round(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(before: f64, after: f64, p: &str, sw: f64) -> ClipInput<'_> {
        ClipInput { before, after, perspective: p, switch_delay: sw, mate_pov: false }
    }

    #[test]
    fn clip_window_follows_the_engine() {
        // 3.5 clipWindow.test: killer 3/5 → 8 s, merge 11; both 3/5/2 → before 5, merge 15.
        let w = clip_window(&input(3.0, 5.0, "killer", 2.0));
        assert_eq!((w.before, w.total, w.merge_within, w.victim_view), (3.0, 8.0, 11.0, 0.0));
        let w = clip_window(&input(3.0, 5.0, "both", 2.0));
        assert_eq!((w.lead, w.victim_view, w.before, w.total, w.merge_within), (3.0, 2.0, 5.0, 10.0, 15.0));
    }

    #[test]
    fn summary_words_and_article() {
        assert_eq!(clip_summary(&input(3.0, 5.0, "killer", 0.0)), "Each moment becomes an 8s clip (3s on the killer before, 5s after). A second moment within 11s joins the same clip.");
        assert_eq!(clip_summary(&input(3.0, 5.0, "both", 2.0)), "Each moment becomes a 10s clip (3s on the killer, 2s on the victim, 5s after). A second moment within 15s joins the same clip.");
        let mut v = input(6.0, 5.0, "victim", 0.0);
        v.mate_pov = true;
        assert_eq!(clip_summary(&v), "Each moment becomes an 11s clip (6s on the best-placed teammate before, 5s after). A second moment within 17s joins the same clip.");
        assert!(clip_summary(&input(13.0, 5.0, "killer", 0.0)).contains("an 18s"));
        assert!(clip_summary(&input(1.0, 1.0, "killer", 0.0)).starts_with("Each moment becomes a 2s"));
    }

    #[test]
    fn handles_move_their_own_seconds_within_the_ranges() {
        let i = input(3.0, 5.0, "both", 2.0);
        assert_eq!(move_handle(ClipHandle::End, 9.0, &i), (3.0, 9.0, 2.0));
        assert_eq!(move_handle(ClipHandle::End, 40.0, &i), (3.0, 15.0, 2.0));
        // Start at -9 with 2 s of victim view: 7 s before.
        assert_eq!(move_handle(ClipHandle::Start, -9.0, &i), (7.0, 5.0, 2.0));
        // Switch keeps the start (5 s) still: 4 s victim → 1 s killer.
        assert_eq!(move_handle(ClipHandle::Switch, -4.0, &i), (1.0, 5.0, 4.0));
        // Never past one second of killer view.
        assert_eq!(move_handle(ClipHandle::Switch, -9.0, &i), (1.0, 5.0, 4.0));
        assert_eq!(move_handle(ClipHandle::Switch, 3.0, &i), (5.0, 5.0, 0.0));
    }

    #[test]
    fn moments_and_pacing_in_words() {
        assert_eq!(moment_words(true, false, true, false, false), "kills");
        assert_eq!(moment_words(true, true, true, true, true), "kills, deaths, hits dealt & taken & shots");
        assert_eq!(moment_words(false, false, true, false, true), "nothing yet");
        assert_eq!(pacing_summary(0, 5, 0, 0, false), "A failed recording is not tried again; one that hangs is stopped after a wait worked out from the clip length. Demos are recorded in match-date order, with no pause between two.");
        assert_eq!(pacing_summary(1, 5, 10, 3, true), "A failed recording is tried again up to 1 time, 5s apart; one that hangs is stopped after at least 3 min. Demos are recorded in random order, with a 10s pause between two.");
        assert_eq!(as_count(Some(&json!("4")), 0), 4);
        assert_eq!(as_count(Some(&json!(" ")), 7), 7);
        assert_eq!(as_count(Some(&json!(-3.6)), 0), 0);
    }

    #[test]
    fn dates_and_shortcuts() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 14).unwrap();
        assert_eq!(parse_day("05-03-2026 12:00"), NaiveDate::from_ymd_opt(2026, 3, 5));
        assert_eq!(parse_day("5-3-2026"), None);
        assert_eq!(parse_day("31-02-2026"), None);
        let r: Vec<(String, String)> = shortcuts().map(|s| shortcut_range(&s, today)).collect();
        assert_eq!(r[0], ("13-11-2026".into(), "13-11-2026".into()));
        assert_eq!(r[1], ("07-11-2026".into(), "14-11-2026".into()));
        assert_eq!(r[3], ("01-11-2026".into(), "14-11-2026".into()));
        assert_eq!(r[6], ("01-01-2026".into(), "14-11-2026".into()));
        assert_eq!(r[7], (String::new(), String::new()));
        assert_eq!(active_shortcut("07-11-2026", "14-11-2026", today), Some("7d"));
        assert_eq!(active_shortcut("", "", today), Some("All"));
        assert_eq!(active_shortcut("01-01-2020", "", today), None);
    }

    #[test]
    fn strip_fits_the_range() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 14).unwrap();
        assert_eq!(strip_start(None, None, today), today - Duration::days(365));
        // A one-week range: at least 60 days of strip.
        let f = NaiveDate::from_ymd_opt(2026, 11, 7).unwrap();
        assert_eq!(strip_start(Some(f), None, today), today - Duration::days(60));
        let f = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let t = NaiveDate::from_ymd_opt(2025, 3, 2).unwrap();
        assert_eq!(strip_start(Some(f), Some(t), today), f - Duration::days(30));
        let long = strip_ticks(today - Duration::days(365), today);
        assert_eq!(long.first().unwrap().1, "Dec");
        assert!(long.iter().any(|t| t.1 == "2026" && t.2));
        let short = strip_ticks(today - Duration::days(60), today);
        assert!(short.iter().all(|t| t.0.weekday() == chrono::Weekday::Mon));
    }

    #[test]
    fn players_search_order_and_ids() {
        let rows = player_rows(Some(&json!([
            ["bob  (765)", "76561198000000002", "bob", "2026-01-02T10:00:00"],
            ["Alice  (765)", "76561198000000001", "Alice", "2026-03-01T10:00:00"],
            ["zed", "76561198000000003", "zed", null],
        ])));
        let names = |v: Vec<&PlayerRow>| v.iter().map(|r| r.name.clone()).collect::<Vec<_>>();
        assert_eq!(names(find_players(&rows, "", Order::Name)), ["Alice", "bob", "zed"]);
        assert_eq!(names(find_players(&rows, "", Order::Recent)), ["Alice", "bob", "zed"]);
        assert_eq!(names(find_players(&rows, "0003", Order::Name)), ["zed"]);
        assert_eq!(names(find_players(&rows, "ALI", Order::Name)), ["Alice"]);
        assert_eq!(reorder(&[1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);
        assert_eq!(short_id("76561198000000002"), "…000002");
        assert!(avatar_hue("76561198000000002") < AVATAR_HUES);
    }

    #[test]
    fn registry_rows_and_the_must_rule() {
        let t = json!({"filters": [
            {"key": "kill_mod_through_smoke", "label": "💨 SMOKE:", "tip": "t", "category": "dp2", "hidden": false, "applies_to": ["kill"], "untested": null, "extras": []},
            {"key": "kill_mod_trois_tap", "label": "🎯🎲 TROIS TAP", "tip": "", "category": "dp2", "hidden": false, "extras": []},
            {"key": "x_hidden", "label": "X", "category": "db", "hidden": true},
            {"key": "dmg_mod_big_hit", "label": "💥 BIG HIT", "category": "event", "applies_to": ["damage"], "extras": [{"key": "dmg_mod_big_hit_min", "label": "min", "unit": "hp", "default": 90}]}
        ]});
        let rows = filter_rows(&t);
        assert_eq!(rows.len(), 3);
        assert_eq!((rows[0].glyph.as_str(), rows[0].name.as_str()), ("💨", "SMOKE"));
        assert!(!rows[1].exclude && rows[1].judges("kill"));
        assert_eq!(rows[2].extras[0].0, "dmg_mod_big_hit_min");
        assert_eq!(toggle_changes(&rows[0], Cell::Keep, true, true, false), [("kill_mod_through_smoke".to_string(), false), ("kill_mod_through_smoke_req".to_string(), false)]);
        assert_eq!(toggle_changes(&rows[0], Cell::Must, false, false, false), [("kill_mod_through_smoke_req".to_string(), true), ("kill_mod_through_smoke".to_string(), true)]);
        assert_eq!(split_label("NOSCOPE"), (String::new(), "NOSCOPE".into()));
    }

    #[test]
    fn small_words() {
        let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(list_words(&v(&[]), "any weapon"), "any weapon");
        assert_eq!(list_words(&v(&["A", "B"]), ""), "A & B");
        assert_eq!(list_words(&v(&["A", "B", "C"]), ""), "A, B & C");
        assert_eq!(list_words(&v(&["A", "B", "C", "D"]), ""), "A, B & 2 more");
        assert_eq!(split_badge("🏆 Premier"), ("🏆".into(), "Premier".into()));
        assert_eq!(split_badge("Wingman"), (String::new(), "Wingman".into()));
        assert_eq!(map_name("dust2"), "Dust2");
        assert_eq!(kept_words(true, 3, 13), "3 of 13");
        assert_eq!(kept_words(false, 3, 13), "all");
        assert_eq!(gun_width(Some(4.0), 30.0), 102.0);
        assert_eq!(gun_width(Some(0.5), 44.0), 28.0);
    }
}
