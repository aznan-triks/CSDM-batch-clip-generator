/**
 * Guards the persisted card layout: a schema bump must never cost the user
 * their placements, and a stored card that no longer exists must never keep
 * a slot. Imports the REAL exported migration -- a hand-copied re-creation
 * here would test itself, not the app (review 2026-08-09).
 */
import { describe, expect, it } from "vitest";

import { LAYOUT_VERSION, ROWS_PER_BLOCK, migrateLayout } from "../sectionLayout";

const IDS = ["player", "demo", "timing"] as const;

describe("migrateLayout", () => {
  it("converts a v2 block slot into fine rows", () => {
    const v2 = {
      v: 2,
      cards: { player: { col: 2, row: 3, colSpan: 4, rowSpan: 2 } },
      collapsed: [],
    };
    const { cards } = migrateLayout(v2, IDS, 10);
    // v2 was 1-indexed, RGL is 0-indexed; rows scale by ROWS_PER_BLOCK.
    expect(cards.player).toEqual({
      x: 1,
      y: 2 * ROWS_PER_BLOCK,
      w: 4,
      h: 2 * ROWS_PER_BLOCK,
    });
  });

  it("keeps a v3 layout untouched", () => {
    const v3 = {
      v: LAYOUT_VERSION,
      cards: { player: { x: 0, y: 0, w: 6, h: 12 } },
      collapsed: ["demo"],
    };
    const { cards, collapsed } = migrateLayout(v3, IDS, 10);
    expect(cards.player).toEqual({ x: 0, y: 0, w: 6, h: 12 });
    expect(collapsed).toEqual(["demo"]);
  });

  it("drops a stored card that is no longer declared", () => {
    const stored = {
      v: LAYOUT_VERSION,
      cards: { player: { x: 0, y: 0, w: 6, h: 12 }, ghost: { x: 0, y: 20, w: 3, h: 4 } },
      collapsed: [],
    };
    const { cards } = migrateLayout(stored, IDS, 10);
    // The undeclared "ghost" card is dropped, but the migration never resets:
    // every declared card (player, demo, timing) still gets an entry, even
    // the ones with no stored slot (see the next test).
    expect(Object.keys(cards).sort()).toEqual(["demo", "player", "timing"]);
  });

  it("gives a declared card with no stored slot a placement instead of dropping it", () => {
    const stored = { v: LAYOUT_VERSION, cards: { player: { x: 0, y: 0, w: 6, h: 12 } }, collapsed: [] };
    const { cards } = migrateLayout(stored, IDS, 10);
    expect(cards.demo).toBeDefined();
    expect(cards.timing).toBeDefined();
  });

  it("survives a corrupted stored value without throwing", () => {
    const { cards } = migrateLayout("not an object", IDS, 10);
    expect(Object.keys(cards).sort()).toEqual([...IDS].sort());
  });

  it("clamps a card wider than the grid", () => {
    const stored = { v: LAYOUT_VERSION, cards: { player: { x: 8, y: 0, w: 40, h: 12 } }, collapsed: [] };
    const { cards } = migrateLayout(stored, IDS, 10);
    expect(cards.player.x + cards.player.w).toBeLessThanOrEqual(10);
  });
});
