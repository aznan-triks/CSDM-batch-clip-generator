/**
 * The shared filter-row model: the rules every style inherits.
 *
 * Ported from the old FilterRow tests: the Exclude box is never lost to a
 * hand-built row (v207, FERRARI PEEK), and `_wire_enable_must` holds.
 */
import { describe, expect, it } from "vitest";

import type { FilterDef } from "../../../settings/useTables";
import { buildFilterRows, registryExtras, splitLabel } from "../filterRows";

const DEF: FilterDef = { key: "kill_mod_wall_bang", label: "🧱 WALLBANG:", tip: "Kill through a wall.", category: "mods", hidden: false };

function rowWith(settings: Record<string, unknown>, extra: Partial<Parameters<typeof buildFilterRows>[1]> = {}) {
  const writes: Record<string, unknown>[] = [];
  const [row] = buildFilterRows([DEF], { settings, write: (c) => writes.push(c), ...extra });
  return { row, writes };
}

describe("filterRows", () => {
  it("splits the emoji off the label and drops the colon", () => {
    expect(splitLabel("🧱 WALLBANG:")).toEqual({ glyph: "🧱", name: "WALLBANG" });
    expect(splitLabel("🎯🎲 TROIS TAP:")).toEqual({ glyph: "🎯🎲", name: "TROIS TAP" });
    expect(splitLabel("RUN & GUN:")).toEqual({ glyph: "", name: "RUN & GUN" });
  });

  it("carries Enable, Must and Exclude on their own keys", () => {
    const { row } = rowWith({});
    expect([row.enable.key, row.must.key, row.exclude?.key]).toEqual([
      "kill_mod_wall_bang",
      "kill_mod_wall_bang_req",
      "kill_mod_wall_bang_exclude",
    ]);
  });

  it("drops Must when Enable is switched off", () => {
    const { row, writes } = rowWith({ kill_mod_wall_bang: true, kill_mod_wall_bang_req: true });
    row.enable.toggle();
    expect(writes).toEqual([{ kill_mod_wall_bang: false, kill_mod_wall_bang_req: false }]);
  });

  it("arms Must on its own and auto-enables the filter", () => {
    const { row, writes } = rowWith({});
    row.must.toggle();
    expect(writes).toEqual([{ kill_mod_wall_bang_req: true, kill_mod_wall_bang: true }]);
  });

  it("omits the Exclude box only where the key does not exist", () => {
    expect(rowWith({}, { noExclude: new Set(["kill_mod_wall_bang"]) }).row.exclude).toBeNull();
    expect(rowWith({}).row.exclude).not.toBeNull();
  });

  it("flags a rule not yet checked in game", () => {
    const [row] = buildFilterRows([{ ...DEF, untested: "never seen in game" }], { settings: {}, write: () => {} });
    expect(row.untested).toBe("never seen in game");
    expect(rowWith({}).row.untested).toBe("");
  });

  it("shows a registry extra's default while its key is empty", () => {
    const def: FilterDef = { ...DEF, extras: [{ key: "x_min", label: "Min", unit: "HP", default: 90 }] };
    const [extra] = registryExtras(def, {}, () => {});
    expect(extra).toMatchObject({ kind: "number", key: "x_min", value: "90", unit: "HP" });
  });
});
