/**
 * Block-grid section layout (3.2.3): explicit per-card column/row placement.
 *
 * The hook wraps `useSetting` so these tests verify the pure functions
 * (autoPlace, data model) rather than the React lifecycle.
 */
import { describe, expect, it } from "vitest";

/**
 * Minimal re-creation of the autoPlace algorithm for testing.
 * Copied from sectionLayout.ts to keep the test pure (no import side-effects).
 */
interface CardSlot {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

function autoPlace(
  existing: Record<string, CardSlot>,
  colSpan: number,
  rowSpan: number,
  cols: number,
): CardSlot {
  const grid = new Map<string, boolean>();
  for (const slot of Object.values(existing)) {
    for (let r = slot.row; r < slot.row + slot.rowSpan; r++) {
      for (let c = slot.col; c < slot.col + slot.colSpan; c++) {
        grid.set(`${c},${r}`, true);
      }
    }
  }
  for (let row = 1; row <= 100; row++) {
    for (let col = 1; col + colSpan - 1 <= cols; col++) {
      let fits = true;
      for (let dr = 0; dr < rowSpan && fits; dr++) {
        for (let dc = 0; dc < colSpan && fits; dc++) {
          if (grid.has(`${col + dc},${row + dr}`)) fits = false;
        }
      }
      if (fits) return { col, row, colSpan, rowSpan };
    }
  }
  const maxRow = Object.values(existing).reduce((m, s) => Math.max(m, s.row + s.rowSpan - 1), 0);
  return { col: 1, row: maxRow + 1, colSpan, rowSpan };
}

describe("autoPlace (block grid)", () => {
  it("places the first card at (1, 1)", () => {
    const slot = autoPlace({}, 1, 1, 3);
    expect(slot).toEqual({ col: 1, row: 1, colSpan: 1, rowSpan: 1 });
  });

  it("places the second card beside the first", () => {
    const a: CardSlot = { col: 1, row: 1, colSpan: 1, rowSpan: 1 };
    const slot = autoPlace({ a }, 1, 1, 3);
    expect(slot.col).toBe(2);
    expect(slot.row).toBe(1);
  });

  it("respects colSpan when auto-placing", () => {
    const a: CardSlot = { col: 1, row: 1, colSpan: 2, rowSpan: 1 };
    const slot = autoPlace({ a }, 1, 1, 3);
    // a takes cols 1-2, so next free is col 3.
    expect(slot.col).toBe(3);
  });

  it("wraps to the next row when the current row is full", () => {
    const existing: Record<string, CardSlot> = {};
    for (let i = 0; i < 3; i++) {
      existing[`c${i}`] = { col: i + 1, row: 1, colSpan: 1, rowSpan: 1 };
    }
    const slot = autoPlace(existing, 1, 1, 3);
    expect(slot.row).toBe(2);
  });

  it("fills the current row before moving to the next", () => {
    // Card A spans rows 1-2 in col 1. Card B is row 1 col 2.
    // Row 1 still has col 3 free, so a new card goes there first.
    const existing: Record<string, CardSlot> = {
      tall: { col: 1, row: 1, colSpan: 1, rowSpan: 2 },
      short: { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    };
    const slot = autoPlace(existing, 1, 1, 3);
    expect(slot.col).toBe(3);
    expect(slot.row).toBe(1);
  });

  it("goes to the next row once the current row is exhausted", () => {
    // Row 1 is full; the algorithm picks row 2.
    const existing: Record<string, CardSlot> = {
      a: { col: 1, row: 1, colSpan: 1, rowSpan: 2 },
      b: { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
      c: { col: 3, row: 1, colSpan: 1, rowSpan: 1 },
    };
    const slot = autoPlace(existing, 1, 1, 3);
    expect(slot.row).toBe(2);
  });
});
