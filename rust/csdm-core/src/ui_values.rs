//! Fixed values of the window (HC.1): sizes, timings and file names the egui shell
//! draws with. Measured in the 3.5 window, each with its source; colours are the
//! generated `theme_v12`. User-tunable values stay settings.

// ---- window (electron/main.js, settings/windowDefaults.ts) ----
pub const WINDOW_MIN: [f32; 2] = [900.0, 640.0];
pub const APP_TITLE: &str = "CSDM Batch Clips";
/// `shell/splitPane.ts`: the content pane's share of the shell width, in percent.
pub const SPLIT_PCT_MIN: f64 = 38.0;
pub const SPLIT_PCT_MAX: f64 = 80.0;
pub const SPLIT_PCT_DEFAULT: f64 = 60.0;
/// `AppShell.css` floors: content pane and console never narrower than this.
pub const PANE_LEFT_MIN: f32 = 380.0;
pub const PANE_RIGHT_MIN: f32 = 200.0;
/// `settings/store.tsx::SAVE_DEBOUNCE_MS`.
pub const SAVE_DEBOUNCE_S: f64 = 0.4;

// ---- card grid (shell/SectionList.tsx, defaultLayout.ts, sectionLayout.ts) ----
pub const GRID_GAP: f32 = 10.0;
pub const DEFAULT_CARD_COLS: i32 = 6;
pub const DEFAULT_CARD_ROWS: i32 = 24;
/// A re-expanded card that never had a remembered height (`sectionLayout.ts::DEFAULT_H`).
pub const REEXPAND_DEFAULT_ROWS: i32 = 24;
/// Unstamped layouts are v2; before v4 columns were 96 px (doubled on read).
pub const LEGACY_LAYOUT_VERSION: i64 = 2;
pub const LAYOUT_HALF_STEP_VERSION: i64 = 4;
pub const COLS_SCALE_V3_TO_V4: i32 = 2;

// ---- metrics of the mock (mock-v12.css), in points ----
pub const NAV_HEIGHT: f32 = 54.0;
pub const NAV_PAD_X: f32 = 18.0;
pub const NAV_GAP: f32 = 16.0;
pub const BRAND_MARK: f32 = 30.0;
pub const BRAND_CUT: f32 = 7.0;
pub const TAB_PAD_LEFT: f32 = 26.0;
pub const TAB_PAD_RIGHT: f32 = 22.0;
pub const TAB_OVERLAP: f32 = 14.0;
pub const TAB_SLANT: f32 = 18.0;
pub const TAB_ICON_GAP: f32 = 9.0;
pub const TAB_LIFT: f32 = 2.0;
pub const PILL_PAD: [f32; 2] = [11.0, 6.0];
pub const SHELL_PAD: [f32; 2] = [14.0, 12.0];
pub const SHELL_GAP: f32 = 12.0;
pub const CARD_RADIUS: f32 = 18.0;
pub const CARD_HEADER_PAD: [f32; 2] = [15.0, 12.0];
pub const CARD_GLYPH: f32 = 30.0;
/// `.sh .gl{font-size:16px}`.
pub const CARD_GLYPH_ICON: f32 = 16.0;
pub const CARD_BODY_PAD: [f32; 2] = [15.0, 14.0];
pub const CARD_BRACKET: f32 = 8.0;
pub const CARD_BRACKET_INSET: f32 = 7.0;
pub const CARD_HANDLE: f32 = 16.0;
pub const CARD_SPOT_RADIUS: f32 = 150.0;
pub const CONSOLE_HEADER_PAD: [f32; 2] = [15.0, 11.0];
pub const CONSOLE_BODY_PAD: [f32; 2] = [15.0, 12.0];
pub const CONSOLE_LINE_HEIGHT: f32 = 22.0;
pub const CONSOLE_TOOL_GAP: f32 = 5.0;
pub const ACTBAR_PAD: [f32; 2] = [16.0, 11.0];
pub const ACTBAR_GAP: f32 = 10.0;
pub const BTN_PAD: [f32; 2] = [20.0, 11.0];
pub const BTN_CUT: f32 = 8.0;
pub const BTN_ICON_GAP: f32 = 8.0;
pub const CHIP_PAD: [f32; 2] = [13.0, 7.0];
/// 3.5 `.console .ch .chip`: `padding: var(--sp-1) var(--sp-3)`.
pub const TOOL_CHIP_PAD: [f32; 2] = [7.0, 3.0];
pub const SHADOW_OFFSET: [i8; 2] = [0, 8];
pub const SHADOW_BLUR: u8 = 22;
pub const SHADOW_ALPHA: u8 = 41;
pub const SCROLLBAR_WIDTH: f32 = 7.0;
pub const DIALOG_WIDTH: f32 = 420.0;

// ---- type (mock-v12.css font sizes, points) ----
pub const FONT_BRAND: f32 = 12.5;
pub const FONT_BRAND_SUB: f32 = 9.0;
pub const FONT_TAB: f32 = 11.5;
/// `.tab .ic{font-size:15px;opacity:.6}`.
pub const TAB_ICON: f32 = 15.0;
pub const TAB_ICON_REST_ALPHA: f32 = 0.6;
pub const FONT_PILL: f32 = 11.0;
pub const FONT_CARD_TITLE: f32 = 13.5;
pub const FONT_CARD_COUNT: f32 = 10.5;
pub const FONT_BODY: f32 = 12.5;
pub const FONT_SMALL: f32 = 11.0;
pub const FONT_CONSOLE: f32 = 11.0;
pub const FONT_CONSOLE_TITLE: f32 = 10.5;
pub const FONT_BUTTON: f32 = 11.5;
/// `.btn .ic{font-size:15px}` (gap: `BTN_ICON_GAP`).
pub const BTN_ICON: f32 = 15.0;
pub const FONT_CHIP: f32 = 12.0;
/// `--fs-xs`.
pub const FONT_TOOL_CHIP: f32 = 10.5;
pub const FONT_BAND: f32 = 11.5;
/// Letter spacing in em (mock `letter-spacing`).
pub const SPACING_TAB: f32 = 0.16;
pub const SPACING_BRAND: f32 = 0.12;
pub const SPACING_BRAND_SUB: f32 = 0.18;
pub const SPACING_COUNT: f32 = 0.07;
pub const SPACING_BUTTON: f32 = 0.06;
pub const SPACING_CONSOLE_TITLE: f32 = 0.16;
/// `--tr-snug`.
pub const SPACING_TOOL_CHIP: f32 = 0.12;

/// Fonts, by preference: Inter (the mock's first choice, not on every Windows), then Segoe UI.
pub const FONT_DIR: &str = "C:/Windows/Fonts";
pub const FONT_REGULAR: [&str; 2] = ["Inter-Regular.ttf", "segoeui.ttf"];
pub const FONT_SEMIBOLD: [&str; 2] = ["Inter-SemiBold.ttf", "seguisb.ttf"];
pub const FONT_MONO: [&str; 2] = ["CascadiaMono.ttf", "consola.ttf"];
/// Symbols the text fonts lack (arrows, geometric shapes), below every family.
pub const FONT_SYMBOLS: [&str; 2] = ["seguisym.ttf", "seguiemj.ttf"];
/// Other scripts of players' names (3.5 drew them through Chromium's system fallback): Arabic,
/// Hebrew and Persian digits (Segoe UI), Chinese and kana (YaHei), Hangul, Thai, Indic. After the
/// symbol fonts, so text they already drew keeps its look.
pub const FONT_SCRIPTS: [&str; 5] = ["segoeui.ttf", "msyh.ttc", "malgun.ttf", "LeelawUI.ttf", "Nirmala.ttf"];

// ---- console (shell/LogConsole.tsx, motion/tokens.ts consoleType) ----
pub const CONSOLE_MAX_RENDERED: usize = 1500;
pub const CONSOLE_FLASH_S: f64 = 3.0;
pub const TYPE_CHAR_S: f64 = 0.026;
pub const TYPE_LINE_GAP_S: f64 = 0.110;
pub const TYPE_MAX_TYPED: usize = 12;
pub const CONSOLE_LOG_FILE: &str = "csdm-console-log.txt";
pub const CONSOLE_HTML_FILE: &str = "csdm-console-export.html";
pub const TRACE_FILE: &str = "csdm-trace.txt";
/// Where exported files land, like the 3.5 window's downloads: `%USERPROFILE%\Downloads`.
pub const EXPORT_DIR_ENV: &str = "USERPROFILE";
pub const EXPORT_SUBDIR: &str = "Downloads";

// ---- motion (motion/tokens.ts, mock keyframes) ----
pub const RING_PERIOD_S: f64 = 2.6;
/// Conic stops of the StarBorder: transparent to 66 %, lime glow 80 %, white 86 %, accent 92 %, out at 100 %.
pub const RING_STOPS: [f32; 5] = [0.66, 0.80, 0.86, 0.92, 1.0];
pub const RING_WIDTH: f32 = 2.0;
pub const RING_SEGMENTS: u32 = 160;
pub const PILL_SEGMENTS: u32 = 96;
pub const BUTTON_HIT_S: f64 = 0.4;
pub const CARET_PERIOD_S: f64 = 1.0;
/// Variable of the bench and tests: `full` keeps motion on in an inactive window, `none` stops it.
pub const MOTION_ENV: &str = "CSDM_MOTION";

// ---- backdrop (shell/backdropField.ts) ----
pub const BACKDROP_CELL: f32 = 38.0;
pub const BACKDROP_GAP: f32 = 4.0;
pub const BACKDROP_EASE: f32 = 0.18;
pub const BACKDROP_RAMP: f32 = 0.33;
pub const BACKDROP_DRIFT: [f64; 2] = [0.000_18, 0.000_11];
pub const BACKDROP_CLUSTER: [f32; 2] = [0.5, 0.6];
/// scale x, scale y, drift factor, weight.
pub const BACKDROP_BAND: [f32; 4] = [0.18, 1.3, 0.3, 0.4];
pub const BACKDROP_SHEEN: [f32; 4] = [0.16, 0.22, 0.30, 3.0];
pub const BACKDROP_TOP_BAR: f32 = 2.0;
pub const BACKDROP_VISIBLE_FLOOR: f32 = 0.02;
pub const BACKDROP_IDLE_FPS: f64 = 12.0;
pub const BACKDROP_SETTLE_S: f64 = 1.0;
/// Per tab: (tab id, reach in cells, threshold, falloff floor, motif).
pub const BACKDROP_BY_TAB: [(&str, f32, f32, f32, &str); 5] = [
    ("capture", 8.0, 0.62, 0.45, "crosshair"),
    ("editing", 8.0, 0.62, 0.45, "bracket"),
    ("tags", 6.0, 0.68, 0.45, "dots"),
    ("video", 8.0, 0.70, 0.35, "bracket"),
    ("settings", 10.0, 0.56, 0.45, "hatch"),
];

// ---- cursor (cursor/Reticle.tsx, effects/ClickSpark) ----
pub const RETICLE_SIZE: f32 = 26.0;
pub const RETICLE_SNAP_PAD: f32 = 10.0;
pub const RETICLE_CORNER: f32 = 8.0;
pub const SPARK_COUNT: usize = 6;
pub const SPARK_S: f64 = 0.42;
pub const SPARK_RING_S: f64 = 0.4;
pub const SPARK_RING: [f32; 2] = [8.0, 44.0];
pub const SPARK_TRAVEL: [f32; 2] = [3.0, 18.0];
pub const SPARK_SIZE: [f32; 2] = [2.0, 9.0];

// ---- weapon band (weapon/*, motion/tokens.ts) ----
pub const WEAPON_SIZE: [f32; 2] = [64.0, 22.0];
pub const WEAPON_SVG_SCALE: f32 = 3.0;
pub const SHOT_S: f64 = 0.35;
pub const WEAK_SHOT_FACTOR: f32 = 0.35;
pub const RETICLE_IN_S: f64 = 1.15;
pub const RETICLE_IN_SIZE: f32 = 130.0;
pub const C4_BEAT_S: f64 = 0.62;
pub const C4_SIZE: [f32; 2] = [40.0, 22.0];
pub const DETONATION_S: f64 = 0.8;
pub const KILL_RETRACT_S: f64 = 0.95;
pub const KILL_RETRACT_PX: f32 = 160.0;
pub const RECOIL_PX: f32 = 9.0;
pub const PROGRESS_BAR: [f32; 2] = [120.0, 4.0];

// ---- TAGS tab (tabs/tagCards/*, TagCards.css, TagsTab.css) ----
/// `TAG_PRESET_COLORS` (`csdm/static_data.py`, `useTagGrid.ts::TAG_COLOR_PRESETS`): the new-tag swatches.
pub const TAG_PRESET_COLORS: [&str; 20] = [
    "#f97316", "#ef4444", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e", "#6366f1",
    "#0ea5e9", "#84cc16", "#d946ef", "#f59e0b", "#10b981", "#6b7280", "#a855f7", "#e11d48", "#0891b2", "#65a30d",
];
/// `useTagOps.ts`: the export file's suggested name.
pub const TAG_EXPORT_FILE: &str = "tags-export.json";
/// `.tg-tray`: min height, padding, corner; dash of its border.
pub const TAG_TRAY_MIN_H: f32 = 44.0;
pub const TAG_TRAY_PAD: [f32; 2] = [9.0, 7.0];
pub const TAG_TRAY_RADIUS: f32 = 14.0;
pub const TAG_TRAY_DASH: [f32; 2] = [4.0, 3.0];
/// `.tg-pill`: height, padding left/right, dot, font.
pub const TAG_PILL_H: f32 = 28.0;
pub const TAG_PILL_PAD: [f32; 2] = [6.0, 8.0];
pub const TAG_PILL_DOT: f32 = 14.0;
pub const FONT_TAG_PILL: f32 = 12.5;
/// `.tag-swatch`: diameter.
pub const TAG_SWATCH: f32 = 22.0;
/// `.chip .d`: the tag colour dot of a palette chip.
pub const TAG_CHIP_DOT: f32 = 8.0;
/// `.chip-pair > .close-btn` padding left/right.
pub const TAG_CLOSE_PAD: [f32; 2] = [8.0, 10.0];
/// Mixes of the tag colour / accent (`color-mix` percentages in TagCards.css).
pub const TAG_TRAY_TINT_PCT: f32 = 5.0;
pub const TAG_TRAY_EDGE_PCT: f32 = 35.0;
pub const TAG_PILL_TINT_PCT: f32 = 16.0;
pub const TAG_PILL_EDGE_PCT: f32 = 55.0;
/// `.tgr-line`: column weights of the span and the tail, end marker size, bar height.
pub const TAG_RANGE_SPAN_TAIL: [f32; 2] = [1.0, 0.55];
pub const TAG_RANGE_MARK: [f32; 2] = [14.0, 22.0];
pub const TAG_RANGE_BAR_H: f32 = 10.0;
pub const TAG_RANGE_DASH: [f32; 2] = [6.0, 5.0];
pub const FONT_TAG_RANGE: f32 = 10.5;
pub const FONT_TAG_RANGE_SMALL: f32 = 10.0;
/// `.tgo-steps`: column weights, gap, step padding and corner, number badge.
pub const TAG_OPS_STEPS: [f32; 3] = [0.8, 1.5, 0.9];
pub const TAG_OPS_GAP: f32 = 8.0;
pub const TAG_OPS_PAD: f32 = 10.0;
pub const TAG_OPS_RADIUS: f32 = 14.0;
pub const TAG_OPS_BADGE: f32 = 20.0;
/// `.cs-switch` (`ToggleSwitch`): track, knob, gap to the label, label size.
pub const SWITCH_TRACK: [f32; 2] = [26.0, 15.0];
pub const SWITCH_KNOB: f32 = 11.0;
pub const SWITCH_GAP: f32 = 7.0;
pub const FONT_SWITCH: f32 = 11.5;
/// `.sx-kick`: the small upper-case kicker.
pub const FONT_KICK: f32 = 9.5;
pub const SPACING_KICK: f32 = 0.13;
/// Space between the rows of a card body.
pub const TAG_ROW_GAP: f32 = 10.0;
pub const TAG_ITEM_GAP: f32 = 6.0;
// ---- SETTINGS tab (T11: tabs/settingsCards/*, PresetSection.tsx) ----
pub const SETTINGS_LABEL_WIDTH: f32 = 96.0;
/// Path labels are longer ("Concatenated clips folder").
pub const SETTINGS_PATH_LABEL_WIDTH: f32 = 172.0;
pub const SETTINGS_FIELD_WIDTH: f32 = 220.0;
pub const SETTINGS_SWITCH: [f32; 2] = [32.0, 18.0];
pub const SETTINGS_ROW_GAP: f32 = 8.0;
/// `UiLayoutCard.tsx::clampLayout` (`_clamp_layout_values`): window width and height bounds.
pub const LAYOUT_WIDTH_RANGE: [f64; 2] = [1000.0, 3840.0];
pub const LAYOUT_HEIGHT_RANGE: [f64; 2] = [600.0, 2160.0];
/// Auto: share of the screen's width and height (`UiLayoutCard.tsx::auto`).
pub const LAYOUT_AUTO_SCREEN: [f64; 2] = [0.86, 0.84];
/// Screen assumed when the system does not say (`UiLayoutCard.tsx::auto`).
pub const LAYOUT_AUTO_FALLBACK_SCREEN: [f64; 2] = [1920.0, 1080.0];
/// The window drawing of UI Layout (`.ul-win`), its height in points.
pub const LAYOUT_DRAWING_HEIGHT: f32 = 120.0;
/// Card grid column slider (`UiLayoutCard.tsx::BLOCK`): min, max, step, fallback.
pub const BLOCK_SLIDER: [i64; 4] = [24, 96, 4, 48];
/// `PerformanceCard.tsx::THREADS`: min, max, fallback.
pub const DP2_THREADS_CHOICES: [i64; 3] = [1, 8, 4];
pub const PERF_CORE_TILE: [f32; 2] = [34.0, 40.0];
/// UI Theme: swatch size and the mini-window preview (`.settings-swatch`, `.ut-preview` 120 x 70).
pub const ACCENT_SWATCH: f32 = 22.0;
pub const FONT_SWATCH: f32 = 9.5;
pub const THEME_PREVIEW: [f32; 2] = [168.0, 98.0];
/// Mini-window drawing colours per ground (page, card, ink), `UiThemeCard.tsx::GROUND_LOOK`.
pub const GROUND_LOOK: [(&str, [&str; 3]); 5] = [
    ("white", ["#eef2f8", "#ffffff", "#1e293b"]),
    ("dark", ["#15171c", "#22252c", "#e5e7eb"]),
    ("amoled", ["#000000", "#0d0d0d", "#e5e7eb"]),
    ("deepblue", ["#0b1426", "#13213b", "#dbe7ff"]),
    ("terminal", ["#030a04", "#0a160c", "#4ade80"]),
];
/// The three card styles (`components/cardstyle/cardStyle.ts::CARD_STYLES`), the first is the default.
pub const CARD_STYLES: [&str; 3] = ["timeline", "sentence", "tiles"];
/// Cards drawn in a card style, (id, title), in tab order (`components/cardstyle/styledCards.ts`).
pub const STYLED_CARDS: [(&str, &str); 28] = [
    ("player", "Player"),
    ("demo-selection", "Demo Selection"),
    ("weapon-filter", "Weapon Filter"),
    ("capture-timing", "Capture & Timing"),
    ("timing-retries", "Timing & Retries"),
    ("kill-filters", "Kill Filters"),
    ("damage-filters", "Damage Filters"),
    ("shot-filters", "Shot Filters"),
    ("match-types", "Match Types"),
    ("map-filter", "Map Filter"),
    ("final-assembly", "Final Assembly"),
    ("resolution", "Resolution, Framerate & Window"),
    ("recording-system", "Recording System"),
    ("hlae-options", "HLAE Options"),
    ("in-game-options", "In-Game Options"),
    ("cs2-effects", "CS2 Effects"),
    ("encoding", "Encoding"),
    ("tag-grid", "Tags"),
    ("tag-range", "Tag Range"),
    ("operations", "Operations"),
    ("postgresql", "PostgreSQL Connection"),
    ("paths", "Paths"),
    ("config-folder", "Configuration Folder"),
    ("presets", "Presets"),
    ("ui-theme", "UI Theme"),
    ("ui-layout", "UI Layout"),
    ("performance", "Performance"),
    ("injection-preview", "Injection Preview"),
];

// ---- CAPTURE tab (tabs/player, demoSelection, captureTiming, timingRetries, filterCards, weaponFilter, matchTypes, mapFilter) ----
/// `usePlayerCard.ts::PLAYER_LIST.pageSize`: players drawn per page.
pub const PLAYER_PAGE_SIZE: usize = 60;
/// `clipWindow.ts::CLIP_RANGES`: the `tk.Scale` ranges of before / after / switch delay (s).
pub const CLIP_RANGE_BEFORE: [i64; 2] = [1, 15];
pub const CLIP_RANGE_AFTER: [i64; 2] = [1, 15];
pub const CLIP_RANGE_SWITCH: [i64; 2] = [0, 10];
/// `captureTiming/TimelineView.tsx`: seconds drawn before the clip and after the ghost moment.
pub const CLIP_TIMELINE_MARGINS_S: [f64; 2] = [2.0, 1.5];
/// `ClipTimeline.tsx`: inner margin (px) and a labelled tick every N seconds.
pub const CLIP_TIMELINE_EDGE: f32 = 18.0;
pub const CLIP_TIMELINE_MAJOR_EVERY: i64 = 5;
/// `useTimingRetries.ts::DRAG_RANGES`: where a drag stops (retries, retry delay s, timeout min, pause s).
pub const TIMING_DRAG_MAX: [i64; 4] = [10, 120, 60, 60];
/// `timingRetries/TimelineView.tsx`: retry blocks drawn before "+N", demo order drawn per order.
pub const TIMING_SHOWN_RETRIES: i64 = 2;
pub const TIMING_DEMO_SEQUENCE: [[u8; 3]; 2] = [[1, 2, 3], [3, 1, 2]];
/// `RangeStrip.tsx`: least span, span without a From date, label room (px), Monday ticks under N days, handle inset (px).
pub const DEMO_STRIP_LEAST_SPAN_DAYS: i64 = 60;
pub const DEMO_STRIP_OPEN_SPAN_DAYS: i64 = 365;
pub const DEMO_STRIP_LABEL_GAP: f32 = 42.0;
pub const DEMO_STRIP_MONTHLY_OVER_DAYS: i64 = 100;
pub const DEMO_STRIP_INSET: f32 = 7.0;
/// `fitStart`: at least this many days before the From date, else half the range.
pub const DEMO_STRIP_MIN_LEAD_DAYS: i64 = 7;
/// Arrow keys on a strip handle: one day; Page Up/Down: this many.
pub const DEMO_STRIP_PAGE_DAYS: i64 = 30;
/// The config's date format (`dd-mm-yyyy`, `_qe_epoch_bounds`).
pub const DATE_FORMAT: &str = "%d-%m-%Y";
/// `useDemoSelection.ts::DATE_SHORTCUTS` (label, kind, days, title, sentence words), in order.
pub const DATE_SHORTCUTS: [(&str, &str, i64, &str, &str); 8] = [
    ("Yesterday", "yesterday", 0, "Set the date range to yesterday", "yesterday"),
    ("7d", "days", 7, "Set the date range to the last 7 days", "in the last 7 days"),
    ("30d", "days", 30, "Set the date range to the last 30 days", "in the last 30 days"),
    ("This month", "month", 0, "Set the date range to the current month", "this month"),
    ("3m", "days", 90, "Set the date range to the last 3 months", "in the last 3 months"),
    ("6m", "days", 180, "Set the date range to the last 6 months", "in the last 6 months"),
    ("Year", "year", 0, "Set the date range to the current year", "this year"),
    ("All", "all", 0, "Clear the date range and reset the demo list and picker selection", "at any time"),
];
/// `useKillFilters.ts::KILL_COUNT_OPTIONS`: the "N kills" pickers.
pub const KILL_COUNT_OPTIONS: [&str; 4] = ["2", "3", "4", "5"];
/// `useKillFilters.ts::CLUTCH_SIZES` and the ladder's bar height (`28 + n * 9` px).
pub const CLUTCH_SIZES: [u8; 5] = [1, 2, 3, 4, 5];
pub const CLUTCH_RUNG_HEIGHT: [f32; 2] = [28.0, 9.0];
/// `useKillFilters.ts::NO_EXCLUDE_BOX` (`_NO_AUTO_EXCLUDE`): filters without an Exclude box.
pub const NO_EXCLUDE_BOX: [&str; 1] = ["kill_mod_trois_tap"];
/// `useWeaponFilter.ts`: silhouette height of reference, width bounds at that height; rack height.
pub const GUN_HEIGHT: f32 = 44.0;
pub const GUN_WIDTH_RANGE: [f32; 2] = [28.0, 150.0];
pub const GUN_RACK_HEIGHT: f32 = 30.0;
/// Words shown in a list before "& N more" (`pickedWords`, `weaponSummary`).
pub const LIST_WORDS_MAX: usize = 3;
/// `mapShade`: pattern angles a map monogram may wear.
pub const MAP_SHADES: u32 = 4;
/// `player/parts.tsx::AVATAR_HUES`, and the Steam ID digits shown after "…".
pub const AVATAR_HUES: u32 = 5;
pub const SHORT_ID_DIGITS: usize = 6;

// ---- EDITING tab (tabs/EditingTab.tsx, tabs/editing/EditingTimeline.tsx, ClipInspector.tsx) ----
/// `EDITING_LIST.pageSize`: clips drawn per page of the list.
pub const EDITING_LIST_PAGE_SIZE: usize = 100;
/// `EDITING_TIMELINE.lanesPerPage`: demo lanes drawn per page of the timeline.
pub const EDITING_LANES_PER_PAGE: usize = 10;
/// `minPps` / `maxPps`: zoom bounds, pixels per second of demo; `zoomStep`: one step multiplies by this.
pub const EDITING_PPS: [f64; 2] = [0.05, 40.0];
pub const EDITING_ZOOM_STEP: f64 = 1.5;
/// `labelWidth`, `overscanPx`, `marksMinPx`, `blockMinPx`, `rulerMinGapPx` (px).
pub const EDITING_LABEL_WIDTH: f32 = 188.0;
pub const EDITING_OVERSCAN: f32 = 400.0;
pub const EDITING_MARKS_MIN: f32 = 18.0;
pub const EDITING_BLOCK_MIN: f32 = 4.0;
pub const EDITING_RULER_MIN_GAP: f64 = 72.0;
/// `tailS`: seconds of empty axis after the latest clip of the page.
pub const EDITING_TAIL_S: f64 = 10.0;
/// `RULER_STEPS_S`: the labelled ruler steps, smallest readable one wins.
pub const EDITING_RULER_STEPS_S: [f64; 11] = [1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0, 900.0];
/// `ClipInspector.tsx::AXIS_MARGIN_S`: seconds of axis past each end of the clip.
pub const EDITING_AXIS_MARGIN_S: f64 = 2.0;
/// `.edtl-ruler` / `.edtl-lane` heights, `.edtl-clip` top and height (px).
pub const EDITING_RULER_HEIGHT: f32 = 24.0;
pub const EDITING_LANE_HEIGHT: f32 = 44.0;
pub const EDITING_BLOCK: [f32; 2] = [9.0, 26.0];
