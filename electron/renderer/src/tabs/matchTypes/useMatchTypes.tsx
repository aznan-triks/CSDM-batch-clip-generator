/**
 * The Match Types card's ONE data model.
 *
 * One boolean key per `tables.matchTypes` entry (`describe_filters`, never a
 * hardcoded list -- D20/R1), gated by `match_type_filter_enabled`. The boxes
 * are inert until `connect_db` answers and while the switch is off, but they
 * stay drawn: the engine only SKIPS the filter, it never removes the choice.
 */
import type { ReactNode } from "react";

import DatabasePending from "../../settings/DatabasePending";
import { useAllSettings, useSetting, useSettingsBatch } from "../../settings/store";
import { useDatabase } from "../../settings/useDatabase";
import { useTables } from "../../settings/useTables";
import type { SetFilterModel } from "../setFilter/model";

export const ENABLE_TIP = "When off, all match types are included; the boxes below only apply while this is on";

/** "🏆 Premier" -> ["🏆", "Premier"]: the table's label carries its own picture. */
export function splitLabel(label: string): [string, string] {
  const match = /^(\S+)\s+(.+)$/u.exec(label);
  if (match && !/\p{L}/u.test(match[1])) return [match[1], match[2]];
  return ["", label];
}

/** Every match-type box carries the one registry action (H1), never one per type. */
function Mark({ children }: { children: ReactNode }) {
  return (
    <div data-action="H1" style={{ display: "contents" }}>
      {children}
    </div>
  );
}

export function useMatchTypes(): SetFilterModel {
  const { tables } = useTables();
  const { database } = useDatabase();
  const settings = useAllSettings();
  const batch = useSettingsBatch();
  const [enabledRaw, setEnabled] = useSetting<boolean>("match_type_filter_enabled");
  const enabled = !!enabledRaw;

  return {
    noun: { one: "match type", many: "matches" },
    enabled: { key: "match_type_filter_enabled", on: enabled, tip: ENABLE_TIP, toggle: () => setEnabled(!enabled) },
    emptyMeans: "no type yet",
    listKey: null,
    options: (tables?.matchTypes ?? []).map((t) => {
      const [badge, name] = splitLabel(t.label);
      const on = !!settings[t.key];
      return {
        id: t.key,
        settingKey: t.key,
        name,
        badge: <span className="mt-emoji">{badge || name.slice(0, 1)}</span>,
        // The name says it; the full description stays in the tooltip.
        detail: "",
        tip: t.tip,
        on,
        toggle: () => batch({ [t.key]: !on }),
      };
    }),
    locked: !database || !enabled,
    pending: !tables ? <p className="capture-hint">Loading match types…</p> : !database ? <DatabasePending /> : null,
    Mark,
  };
}
