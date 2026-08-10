/**
 * A card's body scrolls its own content first, then hands the wheel back to
 * the pane behind it.
 *
 * `overscroll-behavior: contain` is precisely the property that forbids that
 * hand-off. It shipped with the internal scroll (block-grid v3, plan A) as a
 * containment reflex, and trapped the wheel: measured 2026-08-10, a card's
 * body reached its end and 20 further wheel notches left the pane at 823.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CARD_CSS = readFileSync(path.resolve(__dirname, "..", "Card.css"), "utf8");

describe("card body scroll chaining", () => {
  it("the scrolling body does not contain its overscroll", () => {
    // Any `overscroll-behavior` other than the default blocks the hand-off.
    expect(CARD_CSS).not.toMatch(/overscroll-behavior\s*:\s*(contain|none)/);
  });

  it("the body still scrolls its own overflow", () => {
    expect(CARD_CSS).toMatch(/\.sb-scroll\s*\{[^}]*overflow-y\s*:\s*auto/);
  });
});
