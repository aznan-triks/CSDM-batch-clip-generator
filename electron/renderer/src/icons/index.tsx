/**
 * The glyph set (D14): one per menu, one per button.
 *
 * Register: solid, thick, geometric, chamfered -- never a thin outline. Every
 * shape is drawn by hand in the CS2 idiom; no Valve asset file is extracted or
 * redistributed, which is the same position D4 takes on the weapon shapes.
 *
 * `currentColor` throughout: the accent is user-chosen (D9), so a glyph that
 * named its own colour would break the moment the user picked another one.
 *
 * Every path is a filled polygon. Where a glyph needs a hole, it is punched
 * with a second path in the background colour of the surface it sits on --
 * never with a stroke, and never with a hairline.
 */
import type { JSX } from "react";

/**
 * Shared frame, so every glyph agrees on box, fill and accessibility.
 *
 * `className="ic"` is the mock's own glyph class, on the element the mock puts
 * it on -- its markup is `<svg class="ic">` everywhere, and its rules address
 * that svg directly (`.tab .ic{font-size:15px;opacity:.6}`, `.btn .ic`). A
 * wrapper span carrying the class instead would need a `display` rule the mock
 * never wrote, which is how a stylesheet starts restating the design.
 */
function Glyph({ children }: { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg
      className="ic"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

/** Capture: a chamfered aperture -- the act of taking the shot. */
function IconCapture() {
  return (
    <Glyph>
      <path d="M4 7h4l2-3h4l2 3h4v13H4z" />
      <path d="M9 13h6v6H9z" />
    </Glyph>
  );
}

/** Tags: a chamfered label with its punched hole. */
function IconTags() {
  return (
    <Glyph>
      <path d="M3 11 11 3h10v10l-8 8z" />
      <path d="M16 6h3v3h-3z" />
    </Glyph>
  );
}

/** Video: a film block with its sprocket teeth cut out. */
function IconVideo() {
  return (
    <Glyph>
      <path d="M2 5h20v14H2z" />
      <path d="M5 7h3v3H5zm0 7h3v3H5zm11-7h3v3h-3zm0 7h3v3h-3z" />
    </Glyph>
  );
}

/** Settings: a chamfered gear, cut square rather than toothed. */
function IconSettings() {
  return (
    <Glyph>
      <path d="M9 2h6l1 3 3 1 3-1v6l-3 1-1 3 1 3h-6l-1-3-3-1-3 1V9l3-1 1-3z" />
      <path d="M10 10h4v4h-4z" />
    </Glyph>
  );
}

// ── Action buttons ──────────────────────────────────────────────────────────

/** Run: the launch wedge, cut flat at the back. */
function IconRun() {
  return (
    <Glyph>
      <path d="M5 3 21 12 5 21z" />
    </Glyph>
  );
}

/** Preview: the reticle -- four bars around an empty centre. */
function IconPreview() {
  return (
    <Glyph>
      <path d="M11 2h2v6h-2zm0 14h2v6h-2zM2 11h6v2H2zm14 0h6v2h-6z" />
      <path d="M10 10h4v4h-4z" />
    </Glyph>
  );
}

/** Stop: the charge -- a squat block with its chamfered top. */
function IconStop() {
  return (
    <Glyph>
      <path d="M6 4h12v16H6z" />
    </Glyph>
  );
}

/** Kill: the cross-cut, two heavy chamfered bars. */
function IconKill() {
  return (
    <Glyph>
      <path d="M5 3 12 10 19 3l2 2-7 7 7 7-2 2-7-7-7 7-2-2 7-7-7-7z" />
    </Glyph>
  );
}

// ── Screen sections ─────────────────────────────────────────────────────────

/** Player: a chamfered head and shoulders. */
function IconPlayer() {
  return (
    <Glyph>
      <path d="M9 3h6v6H9z" />
      <path d="M5 21v-5l3-3h8l3 3v5z" />
    </Glyph>
  );
}

/** Demo selection: stacked records with the top one picked out. */
function IconDemoSelection() {
  return (
    <Glyph>
      <path d="M3 4h18v5H3z" />
      <path d="M3 11h11v3H3zm0 5h11v3H3z" />
      <path d="M17 15h5v5h-5z" />
    </Glyph>
  );
}

/** Weapon filter: a blunt barrel over a funnel. */
function IconWeaponFilter() {
  return (
    <Glyph>
      <path d="M2 5h14v4h-4l-2 3H7l-2-3H2z" />
      <path d="M6 14h12l-4 4v4l-4-2v-2z" />
    </Glyph>
  );
}

/** Capture timing: a squared clock with its hand. */
function IconCaptureTiming() {
  return (
    <Glyph>
      <path d="M6 2h12v3H6zM4 6h16v16H4z" />
      <path d="M11 9h2v5h4v2h-6z" />
    </Glyph>
  );
}

/** Kill filters: a funnel with a notch cut through it. */
function IconKillFilters() {
  return (
    <Glyph>
      <path d="M2 3h20l-8 9v10l-4-3V12z" />
      <path d="M9 6h6v2H9z" />
    </Glyph>
  );
}

/** Match types: three chamfered brackets stacked. */
function IconMatchTypes() {
  return (
    <Glyph>
      <path d="M3 4h18l-2 3H5zM5 10h14l-2 3H7zM7 16h10l-2 3H9z" />
    </Glyph>
  );
}

/** Map filter: a folded plan with its marker block. */
function IconMapFilter() {
  return (
    <Glyph>
      <path d="M2 5 9 3v16l-7 2zm8-2 5 2v16l-5-2z" />
      <path d="M16 5l6-2v16l-6 2z" />
      <path d="M18 8h2v3h-2z" />
    </Glyph>
  );
}

/** Final assembly: three blocks merging into one bar. */
function IconFinalAssembly() {
  return (
    <Glyph>
      <path d="M2 4h6v5H2zm8 0h6v5h-6zm8 0h4v5h-4z" />
      <path d="M2 13h20v7H2z" />
    </Glyph>
  );
}

/** Resolution: a frame with its corner scaled out. */
function IconResolution() {
  return (
    <Glyph>
      <path d="M2 4h20v3H2zM2 7h3v13H2z" />
      <path d="M9 11h13v9H9z" />
    </Glyph>
  );
}

/** Encoding: stacked bit-blocks, dense to sparse. */
function IconEncoding() {
  return (
    <Glyph>
      <path d="M3 4h4v4H3zm6 0h4v4H9zm6 0h6v4h-6z" />
      <path d="M3 10h10v4H3zm12 0h6v4h-6z" />
      <path d="M3 16h18v4H3z" />
    </Glyph>
  );
}

/** In-game options: a squared console screen with a bar. */
function IconInGameOptions() {
  return (
    <Glyph>
      <path d="M2 4h20v13H2z" />
      <path d="M8 19h8v2H8z" />
      <path d="M5 7h9v2H5zm0 4h6v2H5z" />
    </Glyph>
  );
}

/** Recording system: a solid disc in a chamfered housing. */
function IconRecordingSystem() {
  return (
    <Glyph>
      <path d="M4 3h16l2 2v14l-2 2H4l-2-2V5z" />
      <path d="M9 9h6v6H9z" />
    </Glyph>
  );
}

/** HLAE options: an angled slider bank. */
function IconHlaeOptions() {
  return (
    <Glyph>
      <path d="M2 5h20v3H2zm0 6h20v3H2zm0 6h20v3H2z" />
      <path d="M6 3h3v7H6zm9 6h3v7h-3zm-6 6h3v7H9z" />
    </Glyph>
  );
}

/** CS2 effects: a burst of chamfered shards. */
function IconCs2Effects() {
  return (
    <Glyph>
      <path d="M12 2 15 9l7 3-7 3-3 7-3-7-7-3 7-3z" />
    </Glyph>
  );
}

/** Tag range: a bracketed span with its centre block. */
function IconTagRange() {
  return (
    <Glyph>
      <path d="M2 6h4v12H2zm16 0h4v12h-4z" />
      <path d="M7 10h10v4H7z" />
    </Glyph>
  );
}

/** Operations: a wrench head over a bar. */
function IconOperations() {
  return (
    <Glyph>
      <path d="M14 2h7v7l-4-1-3-2z" />
      <path d="M3 17 13 7l4 4L7 21H3z" />
    </Glyph>
  );
}

/** Paths: a folder cut square. */
function IconPaths() {
  return (
    <Glyph>
      <path d="M2 4h8l2 3h10v13H2z" />
    </Glyph>
  );
}

/** UI theme: a square split light and dark. */
function IconUiTheme() {
  return (
    <Glyph>
      <path d="M2 3h20v18H2z" />
      <path d="M12 6h7v12h-7z" />
    </Glyph>
  );
}

/** UI layout: two columns and a band, the shell itself. */
function IconUiLayout() {
  return (
    <Glyph>
      <path d="M2 3h11v13H2zm13 0h7v13h-7z" />
      <path d="M2 18h20v3H2z" />
    </Glyph>
  );
}

/** PostgreSQL: a stacked store, three drums. */
function IconPostgresql() {
  return (
    <Glyph>
      <path d="M3 3h18v5H3zm0 7h18v5H3zm0 7h18v4H3z" />
    </Glyph>
  );
}

/** Performance: a rising bar chart, chamfered. */
function IconPerformance() {
  return (
    <Glyph>
      <path d="M3 15h4v6H3zm7-5h4v11h-4zm7-7h4v18h-4z" />
    </Glyph>
  );
}

/** Injection preview: a chamfered needle over a plate. */
function IconInjectionPreview() {
  return (
    <Glyph>
      <path d="M14 2h8v8l-3-1-5-5z" />
      <path d="M2 16 13 5l4 4L6 20H2z" />
    </Glyph>
  );
}

/** Presets: three chamfered slots, one filled. */
function IconPresets() {
  return (
    <Glyph>
      <path d="M2 4h20v4H2zm0 6h20v4H2zm0 6h20v4H2z" />
      <path d="M17 11h3v2h-3z" />
    </Glyph>
  );
}

/** Editing: a checklist block — three rows, one checked. */
function IconEditing() {
  return (
    <Glyph>
      <path d="M2 4h20v3H2zm0 7h20v3H2zm0 7h20v3H2z" />
      <path d="M4 6h3v-1H4zm0 7h3v-1H4zm0 7h3v-1H4z" />
      <path d="M5 5l2 2 1-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </Glyph>
  );
}

export type IconName =
  | "capture" | "tags" | "video" | "settings"
  | "run" | "preview" | "stop" | "kill"
  | "player" | "demoSelection" | "weaponFilter" | "captureTiming"
  | "killFilters" | "matchTypes" | "mapFilter" | "finalAssembly"
  | "resolution" | "encoding" | "inGameOptions" | "recordingSystem"
  | "hlaeOptions" | "cs2Effects" | "tagRange" | "operations"
  | "paths" | "uiTheme" | "uiLayout" | "postgresql"
  | "performance" | "injectionPreview" | "presets"
  | "editing";

export const ICONS: Record<IconName, () => JSX.Element> = {
  capture: IconCapture,
  tags: IconTags,
  video: IconVideo,
  settings: IconSettings,
  run: IconRun,
  preview: IconPreview,
  stop: IconStop,
  kill: IconKill,
  player: IconPlayer,
  demoSelection: IconDemoSelection,
  weaponFilter: IconWeaponFilter,
  captureTiming: IconCaptureTiming,
  killFilters: IconKillFilters,
  matchTypes: IconMatchTypes,
  mapFilter: IconMapFilter,
  finalAssembly: IconFinalAssembly,
  resolution: IconResolution,
  encoding: IconEncoding,
  inGameOptions: IconInGameOptions,
  recordingSystem: IconRecordingSystem,
  hlaeOptions: IconHlaeOptions,
  cs2Effects: IconCs2Effects,
  tagRange: IconTagRange,
  operations: IconOperations,
  paths: IconPaths,
  uiTheme: IconUiTheme,
  uiLayout: IconUiLayout,
  postgresql: IconPostgresql,
  performance: IconPerformance,
  injectionPreview: IconInjectionPreview,
  presets: IconPresets,
  editing: IconEditing,
};
