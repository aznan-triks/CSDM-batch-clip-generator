/**
 * autoPlace (block grid): the real exported algorithm -- free-placement of a
 * card into the first grid cell its span fits, row-major left-to-right.
 */
import { describe, expect, it } from "vitest";

import type { CardSlot } from "../sectionLayout";
import { autoPlace } from "../sectionLayout";

describe("autoPlace (block grid)", () => {
  it("places the first card at (1, 1)", () => {
    const slot = autoPlace({}, 3, 1, 10);
    expect(slot).toEqual({ col: 1, row: 1, colSpan: 3, rowSpan: 1 });
  });

  it("places the second card beside the first", () => {
    const a: CardSlot = { col: 1, row: 1, colSpan: 3, rowSpan: 1 };
    const slot = autoPlace({ a }, 3, 1, 10);
    expect(slot.col).toBe(4);
    expect(slot.row).toBe(1);
  });

  it("respects colSpan when auto-placing", () => {
    const a: CardSlot = { col: 1, row: 1, colSpan: 3, rowSpan: 1 };
    const b: CardSlot = { col: 4, row: 1, colSpan: 3, rowSpan: 1 };
    const slot = autoPlace({ a, b }, 3, 1, 10);
    // a takes 1-3, b takes 4-6 -> next 3-wide slot starts at 7.
    expect(slot.col).toBe(7);
  });

  it("wraps to the next row when the current row is full", () => {
    const existing: Record<string, CardSlot> = {};
    for (let i = 0; i < 3; i++) {
      existing[`c${i}`] = { col: 1 + i * 3, row: 1, colSpan: 3, rowSpan: 1 };
    }
    const slot = autoPlace(existing, 3, 1, 10);
    expect(slot.row).toBe(2);
  });

  it("fills a gap left beside a short card before moving down", () => {
    // A tall card spans rows 1-2 in col 1; a short card sits row 1 col 2.
    // Row 1 still has free space right of the short card.
    const existing: Record<string, CardSlot> = {
      tall: { col: 1, row: 1, colSpan: 1, rowSpan: 2 },
      short: { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    };
    const slot = autoPlace(existing, 1, 1, 3);
    expect(slot.col).toBe(3);
    expect(slot.row).toBe(1);
  });

  it("keeps a card spanning past the row inside the column budget", () => {
    // 3-wide card on a 3-column grid fits exactly in column 1.
    const slot = autoPlace({}, 3, 1, 3);
    expect(slot.col).toBe(1);
    // A 4-wide card cannot fit on a 3-column grid: falls back to stacking.
    const slot4 = autoPlace({}, 4, 1, 3);
    expect(slot4.col).toBe(1);
    expect(slot4.colSpan).toBe(4);
  });
});
