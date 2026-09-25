/**
 * The Demo Selection card's ONE data model.
 *
 * Ported from the "DEMO SELECTION" `Sec` in csdm_batch_clips_generator.py:
 * the From/To dates with their shortcuts, plus the demo picker (Range mode vs.
 * Manual mode). Manual mode ("load ALL demos from DB") calls `list_demos`,
 * the headless port of `_on_picker_mode_change`.
 *
 * Neither Manual mode nor the picker's checked set is a DEFAULT_CONFIG key:
 * the window never persisted them either (session-only Tk variables), so they
 * stay local state here. Only `date_from` / `date_to` are written.
 *
 * Every card style draws this model and nothing else.
 */
import { useEffect, useState } from "react";

import { runCommand } from "../../bridge";
import type { DemoRow } from "../../components/DemoPicker";
import { useSetting } from "../../settings/store";

/** The window's own shortcuts (`_tab_capturer`'s `qr` row), in order. */
export const DATE_SHORTCUTS = [
  { label: "Yesterday", kind: "yesterday", title: "Set the date range to yesterday" },
  { label: "7d", kind: "days", days: 7, title: "Set the date range to the last 7 days" },
  { label: "30d", kind: "days", days: 30, title: "Set the date range to the last 30 days" },
  { label: "This month", kind: "month", title: "Set the date range to the current month" },
  { label: "3m", kind: "days", days: 90, title: "Set the date range to the last 3 months" },
  { label: "6m", kind: "days", days: 180, title: "Set the date range to the last 6 months" },
  { label: "Year", kind: "year", title: "Set the date range to the current year" },
  { label: "All", kind: "all", title: "Clear the date range and reset the demo list and picker selection" },
] as const;

export type Shortcut = (typeof DATE_SHORTCUTS)[number];

/** How each shortcut reads in a sentence ("Use the demos played ___"). */
export const SHORTCUT_WORDS: Record<Shortcut["label"], string> = {
  Yesterday: "yesterday",
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  "This month": "this month",
  "3m": "in the last 3 months",
  "6m": "in the last 6 months",
  Year: "this year",
  All: "at any time",
};

/** The tooltips, shared by every style. */
export const DEMO_TIPS = {
  from: "Filter demos played on or after this date (dd-mm-yyyy)",
  to: "Filter demos played on or before this date (dd-mm-yyyy)",
  today: "Set end date to today",
  clearAll: "Clear date range and reset demo selection",
  manual: "Toggle between automated date range demo query and loading all demos from database",
} as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A Date as the config's `dd-mm-yyyy`. */
export function fmt(d: Date): string {
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** `dd-mm-yyyy` (optionally followed by a time) as a local midnight Date, or null. */
export function parseDay(value: string | null | undefined): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(value ?? "");
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A shortcut's `{ from, to }` pair, ported from `_set_date_range`. `now` is
 * injectable so a test never depends on the wall clock.
 */
export function rangeForShortcut(shortcut: Shortcut, now: Date = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (shortcut.kind) {
    case "all":
      return { from: "", to: "" };
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(y) };
    }
    case "days": {
      const start = new Date(today);
      start.setDate(start.getDate() - shortcut.days);
      return { from: fmt(start), to: fmt(today) };
    }
    case "month":
      return { from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmt(today) };
    case "year":
      return { from: fmt(new Date(today.getFullYear(), 0, 1)), to: fmt(today) };
    default:
      return { from: "", to: "" };
  }
}

export interface DemoSelectionModel {
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  /** Both bounds at once (a drag on the range strip). */
  setRange: (from: string, to: string) => void;
  /** The shortcut whose range IS the dates on screen today, if any. */
  activeShortcut: Shortcut | null;
  applyShortcut: (shortcut: Shortcut) => void;
  clearAll: () => void;
  setToday: () => void;
  manualMode: boolean;
  toggleManualMode: () => void;
  demos: DemoRow[] | null;
  checked: Record<string, boolean>;
  error: string | null;
  toggleDemo: (path: string) => void;
  setAllDemos: (value: boolean) => void;
  setSelectedDemos: (paths: string[], value: boolean) => void;
}

export function useDemoSelection(): DemoSelectionModel {
  const [dateFrom, setDateFrom] = useSetting<string>("date_from");
  const [dateTo, setDateTo] = useSetting<string>("date_to");
  const [manualMode, setManualMode] = useState(false);
  const [demos, setDemos] = useState<DemoRow[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // `_on_picker_mode_change`: switching Manual mode ON loads every demo.
  // Switching it off leaves the list showing -- the window does the same.
  useEffect(() => {
    if (!manualMode) return;
    let cancelled = false;
    setError(null);
    runCommand("list_demos")
      .then((result) => {
        if (cancelled) return;
        const rows = (result.data as { demos?: DemoRow[] } | undefined)?.demos ?? [];
        setDemos(rows);
        // Every row starts checked (`_demo_picker_populate`: `prev_state.get(dp, True)`).
        setChecked(Object.fromEntries(rows.map((row) => [row.path, true])));
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [manualMode]);

  const from = dateFrom ?? "";
  const to = dateTo ?? "";

  function resetPicker() {
    setManualMode(false);
    setDemos(null);
    setChecked({});
  }

  return {
    from,
    to,
    setFrom: setDateFrom,
    setTo: setDateTo,
    setRange: (nextFrom, nextTo) => {
      if (nextFrom !== from) setDateFrom(nextFrom);
      if (nextTo !== to) setDateTo(nextTo);
    },
    activeShortcut:
      DATE_SHORTCUTS.find((s) => {
        const range = rangeForShortcut(s);
        return range.from === from && range.to === to;
      }) ?? null,
    applyShortcut: (shortcut) => {
      const range = rangeForShortcut(shortcut);
      setDateFrom(range.from);
      setDateTo(range.to);
      // "All" means no range at all: the picker's range-mode result goes too.
      if (shortcut.kind === "all") resetPicker();
    },
    // `Clear all`'s own command list: both dates, then the picker.
    clearAll: () => {
      setDateFrom("");
      setDateTo("");
      resetPicker();
    },
    setToday: () => setDateTo(fmt(new Date())),
    manualMode,
    toggleManualMode: () => setManualMode(!manualMode),
    demos,
    checked,
    error,
    toggleDemo: (path) => setChecked((previous) => ({ ...previous, [path]: !previous[path] })),
    setAllDemos: (value) => {
      if (!demos) return;
      setChecked(Object.fromEntries(demos.map((row) => [row.path, value])));
    },
    // `_demo_picker_set_selected`: only the highlighted rows change.
    setSelectedDemos: (paths, value) => {
      if (paths.length === 0) return;
      setChecked((previous) => {
        const next = { ...previous };
        for (const path of paths) next[path] = value;
        return next;
      });
    },
  };
}
