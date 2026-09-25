/**
 * The ONE model of a registry filter row, shared by Kill / Damage / Shot
 * Filters in every card style.
 *
 * `tables.filters` (KILL_FILTER_REGISTRY via `describe_filters`) decides which
 * rows exist; this module turns each entry into Enable / ★ Must / Exclude
 * toggles plus its extras, with the window's `_wire_enable_must` rule applied
 * once. A style only decides where a toggle sits: it can never lose the
 * Exclude box (the v207 FERRARI PEEK bug) or forget the Must rule.
 */
import type { FilterDef } from "../../settings/useTables";

/** One on/off key of a filter row. */
export interface FilterToggle {
  key: string;
  on: boolean;
  tip: string;
  toggle: () => void;
}

/** A setting a filter carries beyond its three toggles. */
export type FilterExtraModel =
  | { kind: "number"; key: string; label: string; unit: string; tip: string; value: string; set: (v: string) => void }
  | {
      kind: "choice";
      key: string;
      label: string;
      unit: string;
      tip: string;
      options: readonly string[];
      value: string;
      set: (v: string) => void;
    }
  | { kind: "toggle"; key: string; label: string; tip: string; on: boolean; toggle: () => void };

export interface FilterRowModel {
  key: string;
  /** The label without its emoji and trailing colon: "SMOKE". */
  name: string;
  /** The label's leading emoji, drawn as the row's icon ("" when none). */
  glyph: string;
  tip: string;
  /** What is not yet checked in game; "" = validated. */
  untested: string;
  /** Other event kinds this filter also judges, as words ("shots"). */
  also: string[];
  enable: FilterToggle;
  must: FilterToggle;
  /** Null only when `${key}_exclude` is not a real config key. */
  exclude: FilterToggle | null;
  extras: FilterExtraModel[];
}

/** "💨 SMOKE:" -> glyph "💨", name "SMOKE". A label with no emoji keeps it all. */
export function splitLabel(label: string): { glyph: string; name: string } {
  const text = label.trim().replace(/:\s*$/, "");
  const space = text.indexOf(" ");
  const head = space > 0 ? text.slice(0, space) : "";
  if (head && !/[\p{L}\p{N}]/u.test(head)) return { glyph: head, name: text.slice(space + 1).trim() };
  return { glyph: "", name: text };
}

/** Read a setting shown in a text box: an empty value shows its default. */
export function asText(value: unknown, fallback: unknown): string {
  const shown = value === undefined || value === null || value === "" ? fallback : value;
  return shown === undefined || shown === null ? "" : String(shown);
}

interface BuildOptions {
  settings: Record<string, unknown>;
  write: (changes: Record<string, unknown>) => void;
  /** Keys whose `_exclude` companion does not exist (`_NO_AUTO_EXCLUDE`). */
  noExclude?: ReadonlySet<string>;
  also?: (def: FilterDef) => string[];
  extras?: (def: FilterDef) => FilterExtraModel[];
}

/** One row model per registry entry, in the registry's own order. */
export function buildFilterRows(defs: readonly FilterDef[], options: BuildOptions): FilterRowModel[] {
  const { settings, write, noExclude, also, extras } = options;
  return defs.map((def) => {
    const { glyph, name } = splitLabel(def.label);
    const reqKey = `${def.key}_req`;
    const exKey = `${def.key}_exclude`;
    const enabled = !!settings[def.key];
    const required = !!settings[reqKey];
    const excluded = !!settings[exKey];
    return {
      key: def.key,
      name,
      glyph,
      tip: def.tip,
      untested: def.untested ?? "",
      also: also ? also(def) : [],
      // `_wire_enable_must`: switching Enable off drops Must (a Must left
      // armed under a disabled filter silently skips clips); arming Must
      // switches Enable on by itself.
      enable: {
        key: def.key,
        on: enabled,
        tip: def.tip || `Enable ${name} filter`,
        toggle: () => write(enabled ? { [def.key]: false, [reqKey]: false } : { [def.key]: true }),
      },
      must: {
        key: reqKey,
        on: required,
        tip: `Require ${name}: every captured clip must match this filter`,
        toggle: () => write(required ? { [reqKey]: false } : { [reqKey]: true, [def.key]: true }),
      },
      exclude: noExclude?.has(def.key)
        ? null
        : {
            key: exKey,
            on: excluded,
            tip: `Exclude ${name}: remove clips matching this filter from results`,
            toggle: () => write({ [exKey]: !excluded }),
          },
      extras: extras ? extras(def) : [],
    };
  });
}

/** Extras straight from the registry (`FilterDef.extra_ui`): labelled number boxes. */
export function registryExtras(
  def: FilterDef,
  settings: Record<string, unknown>,
  write: (changes: Record<string, unknown>) => void,
): FilterExtraModel[] {
  return (def.extras ?? []).map((extra) => ({
    kind: "number" as const,
    key: extra.key,
    label: extra.label,
    unit: extra.unit,
    tip: `${extra.label} (default ${String(extra.default)})`,
    value: asText(settings[extra.key], extra.default),
    set: (v: string) => write({ [extra.key]: v }),
  }));
}

/** The rows' state in words, for a card's header count. */
export function filterCount(rows: readonly FilterRowModel[]): string {
  const on = rows.filter((r) => r.enable.on || r.exclude?.on).length;
  return on ? `${on} active` : "none";
}

/**
 * The parity markers (`data-action`) of a row's Enable and Exclude: one home
 * for the three styles that draw them, as the parity guard requires.
 */
const dataAction = { enable: "G1", exclude: "G2" } as const;
export const FILTER_ACTION = dataAction;
