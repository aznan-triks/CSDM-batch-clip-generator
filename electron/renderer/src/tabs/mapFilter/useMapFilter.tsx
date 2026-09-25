/**
 * The Map Filter card's ONE data model.
 *
 * `map_filter` is ONE list key holding display keys -- the stripped-prefix,
 * lowercased map name `connect_db`'s `maps` carries as the first element of
 * each `[displayKey, rawValues[]]` pair (`csdm/engine/core.py`,
 * `discover_database`) -- never one boolean per map, so the whole list wears
 * one setting wrapper (the same rule `weapons` follows).
 *
 * `map_filter_enabled` is the card's master switch: the engine only SKIPS the
 * map filter when it is off, so the list stays drawn, greyed.
 */
import type { ReactNode } from "react";

import DatabasePending from "../../settings/DatabasePending";
import { useSetting } from "../../settings/store";
import { useDatabase } from "../../settings/useDatabase";
import type { SetFilterModel } from "../setFilter/model";

export const ENABLE_TIP =
  "Turns map filtering on; when off, all maps are included regardless of selections below";

/** Every map pick carries the one registry action (H2). */
function Mark({ children }: { children: ReactNode }) {
  return (
    <div data-action="H2" style={{ display: "contents" }}>
      {children}
    </div>
  );
}

/** "dust2" -> "Dust2": the display key is lowercase. */
function mapName(display: string): string {
  return display.charAt(0).toUpperCase() + display.slice(1);
}

/** The same map always gets the same of four pattern angles. */
export function mapShade(display: string): number {
  let h = 0;
  for (const ch of display) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
}

export function useMapFilter(): SetFilterModel {
  const { database } = useDatabase();
  const [enabledRaw, setEnabled] = useSetting<boolean>("map_filter_enabled");
  const [listRaw, setList] = useSetting<string[]>("map_filter");
  const enabled = !!enabledRaw;
  const picked = Array.isArray(listRaw) ? listRaw : [];

  return {
    noun: { one: "map", many: "maps" },
    enabled: { key: "map_filter_enabled", on: enabled, tip: ENABLE_TIP, toggle: () => setEnabled(!enabled) },
    emptyMeans: "no map yet",
    listKey: "map_filter",
    options: (database?.maps ?? []).map(([display, raw]) => {
      const on = picked.includes(display);
      return {
        id: display,
        settingKey: "map_filter",
        name: mapName(display),
        badge: (
          <span className={`mf-mono s${mapShade(display)}`} aria-hidden="true">
            {display.slice(0, 1).toUpperCase()}
          </span>
        ),
        detail: raw.join(", "),
        tip: `${mapName(display)} (${raw.join(", ")}): record only demos on the picked maps while the filter is on`,
        on,
        toggle: () => setList(on ? picked.filter((m) => m !== display) : [...picked, display]),
      };
    }),
    locked: !database || !enabled,
    pending: database ? null : <DatabasePending />,
    Mark,
  };
}
