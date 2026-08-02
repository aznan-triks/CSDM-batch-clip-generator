/**
 * The DEMO SELECTION section.
 *
 * Ported from the "DEMO SELECTION" `Sec` in csdm_batch_clips_generator.py:
 * the From/To date fields with their calendar buttons and shortcut row, plus
 * the demo picker (Range mode vs. Manual mode).
 *
 * Range mode (the default) populates the picker from a PREVIEW's own result
 * -- `_query_events`, already engine-side (core.py) -- which chantier 4c does
 * not yet pipe into a state event this component can read; see the task
 * report's Écarts. Manual mode ("load ALL demos from DB") calls `list_demos`
 * (tâche 5, csdm/bridge/host.py), the headless port of `_on_picker_mode_change`.
 *
 * Neither the Manual-mode toggle nor the picker's checked set is a
 * DEFAULT_CONFIG key: the window itself never persisted `_picker_manual_var`
 * or `_demo_picker_state` to csdm_config.json (both are `tk.BooleanVar`/plain
 * dict, session-only), so they stay local component state here too, not
 * `useSetting`.
 */
import { useEffect, useState } from "react";

import { runCommand } from "../bridge";
import Chip from "../components/Chip";
import DateField from "../components/DateField";
import DemoPicker from "../components/DemoPicker";
import type { DemoRow } from "../components/DemoPicker";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import "./DemoSelectionSection.css";

/** The window's own shortcuts (`_tab_capturer`'s `qr` row), in order. */
const DATE_SHORTCUTS = [
  { label: "Yesterday", kind: "yesterday" },
  { label: "7d", kind: "days", days: 7 },
  { label: "30d", kind: "days", days: 30 },
  { label: "This month", kind: "month" },
  { label: "3m", kind: "days", days: 90 },
  { label: "6m", kind: "days", days: 180 },
  { label: "Year", kind: "year" },
  { label: "All", kind: "all" },
] as const;

type Shortcut = (typeof DATE_SHORTCUTS)[number];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmt(d: Date): string {
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/**
 * A shortcut's `{ from, to }` pair, ported from `_set_date_range` (`key`
 * folded into `kind`/`days` instead of a raw int/string union). `now` is
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

export default function DemoSelectionSection() {
  const [dateFrom, setDateFrom] = useSetting<string>("date_from");
  const [dateTo, setDateTo] = useSetting<string>("date_to");
  const [manualMode, setManualMode] = useState(false);
  const [demos, setDemos] = useState<DemoRow[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Ported from `_on_picker_mode_change`: switching Manual mode ON is what
  // triggers the "load ALL demos from DB" query. Switching it off leaves
  // whatever list is already showing -- the window does the same.
  useEffect(() => {
    if (!manualMode) return;
    let cancelled = false;
    setError(null);
    runCommand("list_demos")
      .then((result) => {
        if (cancelled) return;
        const rows = (result.data as { demos?: DemoRow[] } | undefined)?.demos ?? [];
        setDemos(rows);
        // The window defaults every row to checked (`_demo_picker_populate`:
        // `prev_state.get(dp, True)`).
        setChecked(Object.fromEntries(rows.map((row) => [row.path, true])));
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [manualMode]);

  function applyShortcut(shortcut: Shortcut) {
    const { from, to } = rangeForShortcut(shortcut);
    setDateFrom(from);
    setDateTo(to);
    // "All" means no range at all: the window also clears the picker here
    // (`_set_date_range(0)` clears the dates; the picker itself only ever
    // held a range-mode result, which no longer means anything once the
    // range is gone).
    if (shortcut.kind === "all") {
      setManualMode(false);
      setDemos(null);
      setChecked({});
    }
  }

  function clearAll() {
    // `Clear all`'s own command list (line 1457): both dates, then the picker.
    setDateFrom("");
    setDateTo("");
    setManualMode(false);
    setDemos(null);
    setChecked({});
  }

  function setToday() {
    setDateTo(fmt(new Date()));
  }

  function toggleDemo(path: string) {
    setChecked((previous) => ({ ...previous, [path]: !previous[path] }));
  }

  function setAllDemos(value: boolean) {
    if (!demos) return;
    setChecked(Object.fromEntries(demos.map((row) => [row.path, value])));
  }

  // Ported from `_demo_picker_set_selected`: only the currently highlighted
  // rows change, every other row's checkbox state is left exactly as it was.
  function setSelectedDemos(paths: string[], value: boolean) {
    if (paths.length === 0) return;
    setChecked((previous) => {
      const next = { ...previous };
      for (const path of paths) next[path] = value;
      return next;
    });
  }

  return (
    <div className="demo-selection">
      <div className="row">
        <SettingControl settingKey="date_from">
          <DateField id="date-from" label="From" value={dateFrom ?? ""} onChange={setDateFrom} />
        </SettingControl>
        <SettingControl settingKey="date_to">
          <div className="ds-date-to">
            <DateField id="date-to" label="To" value={dateTo ?? ""} onChange={setDateTo} />
            <button type="button" className="chip" data-action="F5" onClick={setToday}>
              Today
            </button>
          </div>
        </SettingControl>
      </div>

      <div className="row">
        <span className="lab">Shortcuts:</span>
        {DATE_SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.label}
            type="button"
            className="chip"
            data-action="F3" onClick={() => applyShortcut(shortcut)}
          >
            {shortcut.label}
          </button>
        ))}
        <button type="button" className="chip" data-action="F4" onClick={clearAll}>
          Clear all
        </button>
      </div>

      <div className="row">
        <span className="lab">Demo selection:</span>
        <Chip
          label="Manual mode (load ALL demos from DB)"
          selected={manualMode}
          onToggle={() => setManualMode(!manualMode)}
        />
        {error && <span className="ds-error">{error}</span>}
      </div>

      <DemoPicker
        demos={demos}
        checked={checked}
        onToggle={toggleDemo}
        onSetAll={setAllDemos}
        onSetSelected={setSelectedDemos}
      />
    </div>
  );
}
