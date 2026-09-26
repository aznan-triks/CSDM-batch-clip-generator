/**
 * Every Tags-tab control that carries an inventory marker (`data-action`),
 * written once. The three styles place them differently -- a chip, a word, a
 * tile -- but the marker, the tooltip and the handler stay here, so an id has
 * one home in the source and a style can never drift a tooltip.
 */
import type { ReactNode } from "react";

import CloseButton, { ChipPair } from "../../components/CloseButton";
import type { TagRow } from "../../settings/useDatabase";
import { TAG_COLOR_PRESETS as TAG_SWATCHES, TIPS as GRID_TIPS, type TagGridModel } from "./useTagGrid";
import { TIPS as RANGE_TIPS, type RangeApply, type TagRangeModel } from "./useTagRange";
import { TIPS as OPS_TIPS, type TagOpsModel } from "./useTagOps";

interface Look {
  /** Replaces the default `chip` look, e.g. a tile or a sentence word. */
  className?: string;
  /** Replaces the default words. */
  children?: ReactNode;
}

/* ---------------- Tags card ---------------- */

/** A tag as a chip with its delete pill. */
export function TagChip({ m, tag }: { m: TagGridModel; tag: TagRow }) {
  const [id, name, color] = tag;
  const on = m.isActive(id);
  return (
    <ChipPair>
      <button
        type="button"
        className={on ? "chip on" : "chip"}
        aria-pressed={on}
        aria-label={`tag-${name}`}
        title={GRID_TIPS.tag}
        data-action="I3"
        onClick={() => m.toggle(id)}
      >
        <span className="d" style={{ background: color }} aria-hidden="true" />
        {name}
      </button>
      <CloseButton label={`delete-tag-${name}`} title={GRID_TIPS.delete} dataAction="I2" onClick={() => m.askDelete(id, name)} />
    </ChipPair>
  );
}

/** A tag as a big tile: its colour as a band, a tick when active. */
export function TagTile({ m, tag }: { m: TagGridModel; tag: TagRow }) {
  const [id, name, color] = tag;
  const on = m.isActive(id);
  return (
    <div className={on ? "tg-tile on" : "tg-tile"} style={{ ["--tag" as string]: color }}>
      <button
        type="button"
        className="tg-tile-main"
        aria-pressed={on}
        aria-label={`tag-${name}`}
        title={GRID_TIPS.tag}
        data-action="I3"
        onClick={() => m.toggle(id)}
      >
        <span className="tg-tile-band" aria-hidden="true">
          <span className="tg-tile-ck">✓</span>
        </span>
        <b>{name}</b>
        <small>{on ? "active" : "click to use"}</small>
      </button>
      <span className="tg-tile-x">
        <CloseButton label={`delete-tag-${name}`} title={GRID_TIPS.delete} dataAction="I2" onClick={() => m.askDelete(id, name)} />
      </span>
    </div>
  );
}

export function NewTagButton({ m, className, children }: { m: TagGridModel } & Look) {
  return (
    <button
      type="button"
      className={className ?? (m.form.open ? "chip on" : "chip")}
      aria-expanded={m.form.open}
      data-action="I1"
      title={GRID_TIPS.create}
      onClick={() => m.form.setOpen(!m.form.open)}
    >
      {children ?? "+ New tag"}
    </button>
  );
}

export function ReloadTagsButton({ m, className, children }: { m: TagGridModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="I17" title={GRID_TIPS.reload} onClick={m.reload}>
      {children ?? "Reload"}
    </button>
  );
}

export function DeselectAllButton({ m, className, children }: { m: TagGridModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="I4" title={GRID_TIPS.deselect} onClick={m.deselectAll}>
      {children ?? "Deselect all"}
    </button>
  );
}

/** The new-tag form: a name, twenty swatches and a free colour. */
export function NewTagForm({ m }: { m: TagGridModel }) {
  const f = m.form;
  return (
    <div className="tg-create" role="group" aria-label="New tag">
      <input
        id="new-tag-name"
        className="tg-create-name"
        value={f.name}
        placeholder="Tag name"
        aria-label="Tag name"
        onChange={(event) => f.setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") f.submit();
        }}
      />
      <div className="tag-swatches" role="radiogroup" aria-label="Tag colour">
        {TAG_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={f.color === hex}
            aria-label={`colour-${hex}`}
            className={f.color === hex ? "tag-swatch tag-swatch-selected" : "tag-swatch"}
            style={{ backgroundColor: hex }}
            title={GRID_TIPS.color}
            onClick={() => f.setColor(hex)}
          />
        ))}
        <label className="tag-swatch-custom" title="Pick any colour">
          <span>Custom…</span>
          <input type="color" value={f.color} onChange={(event) => f.setColor(event.target.value)} />
        </label>
      </div>
      <button type="button" className="chip on" data-action="I1" onClick={f.submit}>
        Create
      </button>
    </div>
  );
}

/* ---------------- Tag Range card ---------------- */

export function CalcRangeButton({ m, className, children }: { m: TagRangeModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="I7" title={RANGE_TIPS.calc} disabled={m.busy} onClick={m.calc}>
      {children ?? "Calculate range"}
    </button>
  );
}

function applyButton(a: RangeApply, action: string, className: string | undefined, children: ReactNode) {
  return (
    <button type="button" className={className ?? "chip"} disabled={!a.run} data-action={action} title={a.tip} onClick={() => a.run?.()}>
      {children ?? a.title}
    </button>
  );
}

export function ApplyStartButton({ m, className, children }: { m: TagRangeModel } & Look) {
  return applyButton(m.start, "I8", className, children);
}

export function ApplyEndButton({ m, className, children }: { m: TagRangeModel } & Look) {
  return applyButton(m.end, "I9", className, children);
}

export function ApplyFullButton({ m, className, children }: { m: TagRangeModel } & Look) {
  return applyButton(m.full, "I10", className, children);
}

export function ApplyAfterButton({ m, className, children }: { m: TagRangeModel } & Look) {
  return applyButton(m.after, "I11", className, children);
}

/* ---------------- Operations card ---------------- */

export function SearchByTagButton({ m, className, children }: { m: TagOpsModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="I5" title={OPS_TIPS.byTag} onClick={m.searchByTag}>
      {children ?? "By tag"}
    </button>
  );
}

export function SearchByConfigButton({ m, className, children }: { m: TagOpsModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="I6" title={OPS_TIPS.byConfig} onClick={m.searchByConfig}>
      {children ?? "By config"}
    </button>
  );
}

export function TagSelectedButton({ m, className, children }: { m: TagOpsModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="I12" title={OPS_TIPS.tagSel} onClick={m.tagSelected}>
      {children ?? "Tag sel."}
    </button>
  );
}

export function TagAllButton({ m, className, children }: { m: TagOpsModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="I13" title={OPS_TIPS.tagAll} onClick={m.tagAll}>
      {children ?? "Tag ALL"}
    </button>
  );
}

export function RemoveSelectedButton({ m, className, children }: { m: TagOpsModel } & Look) {
  return (
    <button type="button" className={className ?? "chip danger"} data-action="I14" title={OPS_TIPS.removeSel} onClick={m.askRemove}>
      {children ?? "Remove sel."}
    </button>
  );
}

export function ExportTagsButton({ m, className, children }: { m: TagOpsModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="I15" title={OPS_TIPS.exportTags} onClick={m.exportTags}>
      {children ?? "Export"}
    </button>
  );
}

export function ImportTagsButton({ m, className, children }: { m: TagOpsModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="I16" title={OPS_TIPS.importTags} onClick={m.importTags}>
      {children ?? "Import"}
    </button>
  );
}

/** The found demos, each with its tick, and one tick for all of them. */
export function FoundList({ m }: { m: TagOpsModel }) {
  if (m.found.length === 0) {
    return <p className="tg-empty">{m.foundBy ? "No demo found." : "Search to list demos here."}</p>;
  }
  const all = m.picked === m.found.length;
  return (
    <div className="tg-found">
      <label className="tg-found-all">
        <input type="checkbox" className="tags-found-check" checked={all} onChange={() => m.pickAll(!all)} />
        <span>
          {m.picked} of {m.found.length} picked
        </span>
      </label>
      <ul className="tags-found-list">
        {m.found.map((demo) => (
          <li key={demo.path} className="tags-found-row">
            <input
              type="checkbox"
              className="tags-found-check"
              aria-label={demo.name}
              checked={m.isPicked(demo.path)}
              onChange={() => m.pick(demo.path)}
            />
            <span>{demo.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
