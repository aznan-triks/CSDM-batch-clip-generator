/**
 * The reference layout a card returns to. Derived from what a tab declares
 * -- reading order, plus the `wide` flag -- rather than a hand-written table
 * per card, which would need maintaining every time a card is added.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_CARD_COLS, DEFAULT_CARD_ROWS, defaultSlots } from "../defaultLayout";

/**
 * Grid widths expressed in CARDS, not pixels-worth-of-columns.
 *
 * These were the literals 9 and 6 -- three and two cards wide, back when a
 * card was 3 columns. The column halved in 3.3.0 and a card became 6, so the
 * literals silently became "one and a half cards" and "one card" and the
 * layout assertions stopped testing what they described.
 */
const THREE_CARDS_WIDE = DEFAULT_CARD_COLS * 3;
const TWO_CARDS_WIDE = DEFAULT_CARD_COLS * 2;

const SECTIONS = [
  { id: "player", wide: true },
  { id: "demo", wide: false },
  { id: "weapon", wide: false },
  { id: "timing", wide: false },
];

describe("defaultSlots", () => {
  it("gives a wide card the full width", () => {
    const slots = defaultSlots(SECTIONS, THREE_CARDS_WIDE);
    expect(slots.player.w).toBe(THREE_CARDS_WIDE);
    expect(slots.player.x).toBe(0);
  });

  it("gives a normal card the default span", () => {
    const slots = defaultSlots(SECTIONS, THREE_CARDS_WIDE);
    expect(slots.demo.w).toBe(DEFAULT_CARD_COLS);
    expect(slots.demo.h).toBe(DEFAULT_CARD_ROWS);
  });

  it("lays cards out in declaration order, left to right then down", () => {
    const slots = defaultSlots(SECTIONS, THREE_CARDS_WIDE);
    // Three 3-column cards fit on one row after the full-width one.
    expect(slots.demo.x).toBe(0);
    expect(slots.weapon.x).toBe(DEFAULT_CARD_COLS);
    expect(slots.timing.x).toBe(DEFAULT_CARD_COLS * 2);
    expect(slots.demo.y).toBe(slots.weapon.y);
    expect(slots.weapon.y).toBe(slots.timing.y);
    expect(slots.demo.y).toBeGreaterThanOrEqual(slots.player.h);
  });

  it("wraps to a new row when the next card does not fit", () => {
    const slots = defaultSlots(SECTIONS, TWO_CARDS_WIDE);
    expect(slots.timing.x).toBe(0);
    expect(slots.timing.y).toBeGreaterThan(slots.weapon.y);
  });

  it("never places a card outside a narrow grid", () => {
    const slots = defaultSlots(SECTIONS, 2);
    for (const slot of Object.values(slots)) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.x + slot.w).toBeLessThanOrEqual(2);
    }
  });

  it("honours an explicit defaultSlot override", () => {
    const slots = defaultSlots([{ id: "pinned", wide: false, defaultSlot: { x: 2, y: 5, w: 4, h: 8 } }], THREE_CARDS_WIDE);
    expect(slots.pinned).toEqual({ x: 2, y: 5, w: 4, h: 8 });
  });

  it("uses a measured height when the caller supplies one", () => {
    const slots = defaultSlots(
      [
        { id: "a", wide: false, rows: 8 },
        { id: "b", wide: false },
      ],
      6,
    );
    expect(slots.a.h).toBe(8);
    expect(slots.b.h).toBe(DEFAULT_CARD_ROWS);
  });

  it("wraps on the tallest card of the row, not on the default", () => {
    // Two cards fill the row; the third drops below the TALLER of the two,
    // or it would overlap the one that grew.
    const slots = defaultSlots(
      [
        { id: "a", wide: false, rows: 8 },
        { id: "b", wide: false, rows: 20 },
        { id: "c", wide: false, rows: 5 },
      ],
      TWO_CARDS_WIDE,
    );
    expect(slots.c.y).toBe(20);
  });
});
