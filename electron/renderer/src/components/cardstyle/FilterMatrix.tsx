/**
 * Filter rows as a switchboard ("timeline" style): one line per filter, its
 * three keys as big cells lined up in columns (Keep / ★ Must / Exclude), so
 * the whole card's state reads down the columns at a glance and one click on
 * a cell flips that key.
 */
import type { ReactNode } from "react";

import SettingControl from "../../settings/SettingControl";
import { useAlwaysTooltips } from "../../settings/useAlwaysTooltips";
import { FilterExtras, UntestedMark, filterTip } from "./FilterExtra";
import type { FilterRowModel, FilterToggle } from "./filterRows";
import "./filterstyle.css";

type CellKind = "keep" | "must" | "exclude";

const CELL: Record<CellKind, { label: string; mark: string; action?: string }> = {
  keep: { label: "Enable", mark: "✓", action: "G1" },
  must: { label: "★ Must", mark: "★" },
  exclude: { label: "Exclude", mark: "✕", action: "G2" },
};

function Cell({ kind, toggle }: { kind: CellKind; toggle: FilterToggle | null }) {
  if (!toggle) return <span className="cf-cell none" aria-hidden="true" />;
  const cell = CELL[kind];
  return (
    <SettingControl settingKey={toggle.key}>
      <button
        type="button"
        className={`cf-cell ${kind}${toggle.on ? " on" : ""}`}
        aria-label={cell.label}
        aria-pressed={toggle.on}
        title={toggle.tip}
        data-action={cell.action}
        onClick={toggle.toggle}
      >
        {cell.mark}
      </button>
    </SettingControl>
  );
}

export function FilterMatrixRow({ row, children }: { row: FilterRowModel; children?: ReactNode }) {
  const alwaysShow = useAlwaysTooltips();
  const lit = row.enable.on ? " keep" : row.exclude?.on ? " drop" : "";
  return (
    <div className={`filter-row cf-mrow${lit}`} title={filterTip(row.tip, row.untested)}>
      <span className="cf-glyph" aria-hidden="true">
        {row.glyph}
      </span>
      <span className="cf-name">
        {row.name}
        <UntestedMark detail={row.untested} />
        {row.also.length > 0 && (
          <span className="cf-also" title="This filter also keeps or drops those events when they are captured (Event Type)">
            also {row.also.join(" + ")}
          </span>
        )}
      </span>
      <Cell kind="keep" toggle={row.enable} />
      <Cell kind="must" toggle={row.must} />
      <Cell kind="exclude" toggle={row.exclude} />
      {(row.extras.length > 0 || children) && (
        <div className="cf-mrow-sub">
          <FilterExtras extras={row.extras} />
          {children}
        </div>
      )}
      {alwaysShow && row.tip && <div className="persistent-tip cf-mrow-sub">{filterTip(row.tip, row.untested)}</div>}
    </div>
  );
}

/** One group of rows under a heading, with the column names over the cells. */
export function FilterMatrix({ heading, rows }: { heading?: string; rows: readonly FilterRowModel[] }) {
  if (!rows.length) return null;
  return (
    <div className="cf-matrix" role="group" aria-label={heading ?? "Filters"}>
      <div className="cf-mhead" aria-hidden="true">
        <span className="cf-mhead-title">{heading}</span>
        <span>Keep</span>
        <span>Must</span>
        <span>Drop</span>
      </div>
      {rows.map((row) => (
        <FilterMatrixRow key={row.key} row={row} />
      ))}
    </div>
  );
}
