/**
 * Filter rows as illustrated tiles ("tiles" style): the filter's emoji drawn
 * large, its name and what it does; the tile's face is Enable, its foot holds
 * ★ Must and Exclude, and its extras sit under them.
 */
import SettingControl from "../../settings/SettingControl";
import { FilterExtras, UntestedMark, filterTip } from "./FilterExtra";
import { FILTER_ACTION, type FilterRowModel, type FilterToggle } from "./filterRows";
import "./filterstyle.css";

function FootToggle({ toggle, label, kind, action }: { toggle: FilterToggle; label: string; kind: string; action?: string }) {
  return (
    <SettingControl settingKey={toggle.key}>
      <button
        type="button"
        className={`cf-foot ${kind}${toggle.on ? " on" : ""}`}
        aria-pressed={toggle.on}
        aria-label={label}
        title={toggle.tip}
        data-action={action}
        onClick={toggle.toggle}
      >
        {label}
      </button>
    </SettingControl>
  );
}

export function FilterTile({ row }: { row: FilterRowModel }) {
  const state = row.enable.on ? " on" : row.exclude?.on ? " drop" : "";
  return (
    <div className={`filter-row cf-tile${state}`}>
      <SettingControl settingKey={row.enable.key}>
        <button
          type="button"
          className="cf-tile-face"
          aria-pressed={row.enable.on}
          aria-label="Enable"
          title={filterTip(row.enable.tip, row.untested)}
          data-action={FILTER_ACTION.enable}
          onClick={row.enable.toggle}
        >
          <span className="cf-tile-ck" aria-hidden="true">
            ✓
          </span>
          <span className="cf-tile-glyph" aria-hidden="true">
            {row.glyph || "•"}
          </span>
          <b>
            {row.name} <UntestedMark detail={row.untested} />
          </b>
          <small>{row.tip}</small>
          {row.also.length > 0 && <small className="cf-also">also {row.also.join(" + ")}</small>}
        </button>
      </SettingControl>
      <div className="cf-tile-feet">
        <FootToggle toggle={row.must} label="★ Must" kind="must" />
        {row.exclude && <FootToggle toggle={row.exclude} label="Exclude" kind="exclude" action={FILTER_ACTION.exclude} />}
      </div>
      <FilterExtras extras={row.extras} />
    </div>
  );
}

export function FilterTiles({ heading, rows }: { heading?: string; rows: readonly FilterRowModel[] }) {
  if (!rows.length) return null;
  return (
    <section className="cf-tiles" aria-label={heading ?? "Filters"}>
      {heading && <h4 className="cf-heading">{heading}</h4>}
      <div className="cf-tile-grid">
        {rows.map((row) => (
          <FilterTile key={row.key} row={row} />
        ))}
      </div>
    </section>
  );
}
