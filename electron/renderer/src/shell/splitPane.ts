/**
 * The console/content split, shared between the live drag handle (AppShell)
 * and the typed field (SettingsTab's UI Layout card) so the two paths can
 * never disagree on what a valid `ui_split_pct` is.
 *
 * Mirrors the old Tkinter window's own pane minimums (`UI_PANE_LEFT_MIN` /
 * `UI_PANE_RIGHT_MIN`, `context_guide.md` §3) as hard pixel floors in the
 * grid itself (AppShell.css), independent of the percentage.
 */
export const SPLIT_PCT_RANGE = { min: 38, max: 80 } as const;
export const SPLIT_PCT_DEFAULT = 60;

export function clampSplitPct(value: number): number {
  return Math.max(SPLIT_PCT_RANGE.min, Math.min(SPLIT_PCT_RANGE.max, Math.round(value) || SPLIT_PCT_DEFAULT));
}
