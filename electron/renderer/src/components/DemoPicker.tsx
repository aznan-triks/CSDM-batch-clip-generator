import { useState } from "react";

import "./DemoPicker.css";

/**
 * HC.1: the two marks this picker draws, named once.
 *
 * Deliberately NOT `CloseButton`'s glyph. These are the two halves of one
 * state -- a row is checked or it is not -- and they have to read as a pair;
 * a heavier remove cross next to the tick would say "delete this demo", which
 * is not what unchecking does. The audit of 2026-09-01 (ecart E4) asked for
 * ONE remove control, not one glyph for every purpose.
 */
const MARK = { on: "✓", off: "✕" } as const;

export interface DemoCompat {
  status: "ok" | "warn" | "missing";
  break: string | null;
  tip: string | null;
}

/** One row of the picker, the shape `list_demos` (csdm/bridge/host.py) sends. */
export interface DemoRow {
  path: string;
  name: string;
  date: string;
  map: string;
  compat: DemoCompat;
}

interface DemoPickerProps {
  /** `null` before anything has populated the picker (no Preview yet, Manual mode off). */
  demos: DemoRow[] | null;
  checked: Record<string, boolean>;
  onToggle: (path: string) => void;
  onSetAll: (value: boolean) => void;
  /** Sets the checkbox state of exactly `paths`, leaving every other row untouched. */
  onSetSelected: (paths: string[], value: boolean) => void;
}

/**
 * The ✓ / Date / Map / Demo table (`_demo_tree`, `_tab_capturer`).
 *
 * A row's compat status never hides it -- the window greys an incompatible
 * demo and explains why on hover (`_tree_motion`'s tooltip), it never drops
 * the row outright, because dropping it would look like the demo was never
 * found at all. `title` carries the same explanation here; a screen reader or
 * a mouse hover both reach it the same way.
 */
export default function DemoPicker({ demos, checked, onToggle, onSetAll, onSetSelected }: DemoPickerProps) {
  const rows = demos ?? [];
  const total = rows.length;
  const onCount = rows.filter((row) => checked[row.path]).length;

  // Highlighted (native-selected) rows, `_demo_tree.selection()`'s equivalent
  // -- a separate concept from the checkbox state above. Session-only, like
  // `checked` itself, so a plain useState is enough; it resets whenever the
  // row list changes since paths from the old list would be meaningless.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);

  function handleRowClick(event: React.MouseEvent, index: number, path: string) {
    if (event.shiftKey && anchor !== null) {
      const [start, end] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected(new Set(rows.slice(start, end + 1).map((row) => row.path)));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setAnchor(index);
      return;
    }
    setSelected(new Set([path]));
    setAnchor(index);
  }

  return (
    <div className="demo-picker">
      <div className="dp-toolbar">
        <span className="dp-count">
          {total === 0 ? "no demos loaded" : `${onCount}/${total} selected`}
        </span>
        <div className="dp-buttons">
          <button type="button" className="chip" data-action="D1" onClick={() => onSetAll(true)}>
            {MARK.on} Check all
          </button>
          <button type="button" className="chip" data-action="D2" onClick={() => onSetAll(false)}>
            {MARK.off} Uncheck all
          </button>
          <button
            type="button"
            className="chip"
            title="Checks the rows highlighted by click, Ctrl+click or Shift+click"
            data-action="D3" onClick={() => onSetSelected(Array.from(selected), true)}
          >
            {MARK.on} Check selected
          </button>
          <button
            type="button"
            className="chip"
            title="Unchecks only the rows currently highlighted (click, Ctrl+click, Shift+click)"
            data-action="D4" onClick={() => onSetSelected(Array.from(selected), false)}
          >
            {MARK.off} Uncheck selected
          </button>
        </div>
      </div>

      <div className="dp-table">
        <div className="dp-row dp-head">
          <span className="dp-col-check" />
          <span className="dp-col-date">Date</span>
          <span className="dp-col-map">Map</span>
          <span className="dp-col-name">Demo</span>
        </div>
        <div className="dp-body">
          {rows.length === 0 && (
            <p className="capture-hint">
              No demos loaded -- run a Preview, or turn on Manual mode.
            </p>
          )}
          {rows.map((row, index) => {
            const isOn = !!checked[row.path];
            const isSelected = selected.has(row.path);
            const warn = row.compat.status === "warn";
            const missing = row.compat.status === "missing";
            const title = warn
              ? `Recorded before a CS2 breaking update (${row.compat.break}) -- ${row.compat.tip}`
              : missing
                ? "Demo file not found on disk"
                : undefined;
            const rowClasses = [
              "dp-row",
              !isOn && "dp-row-off",
              warn && "dp-row-warn",
              missing && "dp-row-missing",
              isSelected && "dp-row-selected",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={row.path}
                className={rowClasses}
                title={title}
                data-action="D5" onClick={(event) => handleRowClick(event, index, row.path)}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isOn}
                  className="dp-check"
                  data-action="D7" onClick={(event) => {
                    event.stopPropagation();
                    onToggle(row.path);
                  }}
                >
                  {isOn ? MARK.on : MARK.off}
                </button>
                <span className="dp-col-date">{row.date}</span>
                <span className="dp-col-map">{row.map}</span>
                <span className="dp-col-name">{row.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
