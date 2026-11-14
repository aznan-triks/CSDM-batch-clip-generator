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
