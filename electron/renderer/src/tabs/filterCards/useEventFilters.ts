/**
 * The Damage Filters / Shot Filters cards' ONE data model (C5bis).
 *
 * Nothing here names a filter: `tables.filters` decides which rows exist
 * (`category: "event"`), which card they belong to (`applies_to`) and which
 * numeric settings they carry (`extras`).
 */
import {
  buildFilterRows,
  filterCount,
  registryExtras,
  type FilterRowModel,
} from "../../components/cardstyle/filterRows";
import { appliesTo } from "../../settings/appliesTo";
import { useAllSettings, useSettingsBatch } from "../../settings/store";
import { useTables } from "../../settings/useTables";

export type EventFilterCategory = "damage" | "shot";

/** What each card needs before it has anything to judge, and its nouns. */
export const EVENT_CARD: Record<EventFilterCategory, { hint: string; noun: string }> = {
  damage: { hint: "Judges non-lethal damage — tick Non-lethal in Event Type.", noun: "hits" },
  shot: { hint: "Judges shots and knife swings — tick Other in Event Type.", noun: "shots" },
};

export interface EventFiltersModel {
  ready: boolean;
  category: EventFilterCategory;
  hint: string;
  noun: string;
  rows: FilterRowModel[];
  count: string;
}

export function useEventFilters(category: EventFilterCategory): EventFiltersModel {
  const { tables } = useTables();
  const settings = useAllSettings();
  const write = useSettingsBatch();
  const defs = (tables?.filters ?? []).filter(
    (f) => f.category === "event" && !f.hidden && appliesTo(f).includes(category),
  );
  const rows = buildFilterRows(defs, {
    settings,
    write,
    extras: (def) => registryExtras(def, settings, write),
  });
  return {
    ready: tables != null,
    category,
    hint: EVENT_CARD[category].hint,
    noun: EVENT_CARD[category].noun,
    rows,
    count: filterCount(rows),
  };
}
