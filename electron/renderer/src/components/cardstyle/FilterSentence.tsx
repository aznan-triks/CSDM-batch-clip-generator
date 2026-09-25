/**
 * Filter rows as plain English ("sentence" style).
 *
 * A clause names the filters in one state -- kept, required, dropped -- as
 * clickable words; each word opens the filter's own three toggles and extras,
 * and the "+" word at the end of a clause lists every filter to add to it.
 */
import { Fragment } from "react";

import Chip from "../Chip";
import SettingControl from "../../settings/SettingControl";
import { FilterExtras, UntestedMark, filterTip } from "./FilterExtra";
import type { FilterRowModel, FilterToggle } from "./filterRows";
import { ChoiceToken } from "./SentenceToken";
import "./filterstyle.css";

export type FilterMode = "enable" | "must" | "exclude";

const JOIN: Record<FilterMode, string> = { enable: "or", must: "and", exclude: "or" };

function toggleOf(row: FilterRowModel, mode: FilterMode): FilterToggle | null {
  return mode === "enable" ? row.enable : mode === "must" ? row.must : row.exclude;
}

/** Enable / ★ Must / Exclude of one filter, each on its own key. */
export function FilterToggles({ row }: { row: FilterRowModel }) {
  return (
    <div className="chips">
      <SettingControl settingKey={row.enable.key}>
        <span data-action="G1" style={{ display: "contents" }}>
          <Chip label="Enable" tip={row.enable.tip} selected={row.enable.on} onToggle={row.enable.toggle} />
        </span>
      </SettingControl>
      <SettingControl settingKey={row.must.key}>
        <Chip label="★ Must" tip={row.must.tip} selected={row.must.on} onToggle={row.must.toggle} />
      </SettingControl>
      {row.exclude && (
        <SettingControl settingKey={row.exclude.key}>
          <span data-action="G2" style={{ display: "contents" }}>
            <Chip label="Exclude" tip={row.exclude.tip} selected={row.exclude.on} onToggle={row.exclude.toggle} />
          </span>
        </SettingControl>
      )}
    </div>
  );
}

/** One filter as a word; its popover holds everything the filter owns. */
export function FilterToken({ row, tone = "primary" }: { row: FilterRowModel; tone?: "primary" | "alt" }) {
  return (
    <ChoiceToken
      label={row.name}
      tone={tone}
      tip={filterTip(row.tip, row.untested)}
      popover={
        <div className="cf-pop">
          <h5>
            {row.glyph} {row.name} <UntestedMark detail={row.untested} />
          </h5>
          <p className="cf-pop-tip">{row.tip}</p>
          {row.untested && <p className="cf-pop-tip cf-untested-line">Untested: {row.untested}</p>}
          <FilterToggles row={row} />
          <FilterExtras extras={row.extras} />
        </div>
      }
    >
      {row.glyph && <span aria-hidden="true">{row.glyph}</span>}
      {row.name}
      {row.untested && (
        <sup className="cf-untested" aria-label="untested">
          UNTESTED
        </sup>
      )}
    </ChoiceToken>
  );
}

/**
 * The filters not yet checked in game, named under the sentence so the mark
 * stays on screen even while those filters sit unused in a "+" list.
 */
export function UntestedNote({ rows }: { rows: readonly FilterRowModel[] }) {
  const untested = rows.filter((r) => r.untested);
  if (!untested.length) return null;
  return (
    <p className="capture-hint cf-untested-note">
      <span className="cf-untested">UNTESTED</span> in game yet:{" "}
      {untested.map((r, i) => (
        <Fragment key={r.key}>
          {i > 0 && ", "}
          <span title={r.untested}>{r.name}</span>
        </Fragment>
      ))}
    </p>
  );
}

interface ClauseProps {
  rows: readonly FilterRowModel[];
  mode: FilterMode;
  /** Words before the filters: "Keep kills that are". */
  lead: string;
  /** What the clause says when no filter is in this state: "every kill". */
  empty: string;
  /** Name of the add word, e.g. "Add a kept filter". */
  addLabel: string;
}

export function FilterClause({ rows, mode, lead, empty, addLabel }: ClauseProps) {
  const picked = rows.filter((r) => toggleOf(r, mode)?.on);
  const offered = rows.filter((r) => toggleOf(r, mode));
  return (
    <div className={`cf-clause ${mode}`}>
      {lead}{" "}
      {picked.length === 0 && <em className="cf-empty">{empty}</em>}
      {picked.map((row, i) => (
        <Fragment key={row.key}>
          {i > 0 && ` ${JOIN[mode]} `}
          <FilterToken row={row} tone={mode === "exclude" ? "alt" : "primary"} />
        </Fragment>
      ))}{" "}
      <ChoiceToken
        label={addLabel}
        tone={mode === "exclude" ? "alt" : "primary"}
        tip={addLabel}
        popover={
          <div className="cf-pop cf-pop-list">
            <h5>{addLabel}</h5>
            <div className="chips">
              {offered.map((row) => {
                const t = toggleOf(row, mode) as FilterToggle;
                return (
                  <SettingControl key={row.key} settingKey={t.key}>
                    <span
                      data-action={mode === "enable" ? "G1" : mode === "exclude" ? "G2" : undefined}
                      style={{ display: "contents" }}
                    >
                      <Chip
                        label={`${row.glyph} ${row.name}${row.untested ? " (untested)" : ""}`.trim()}
                        tip={t.tip}
                        selected={t.on}
                        onToggle={t.toggle}
                      />
                    </span>
                  </SettingControl>
                );
              })}
            </div>
          </div>
        }
      >
        +
      </ChoiceToken>
      .
    </div>
  );
}
