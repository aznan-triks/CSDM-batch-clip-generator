/**
 * The placement backdrop must be the same faint ink on every night ground.
 *
 * 3.2.3 painted it with `--line`, which each ground redefines for its own
 * 1px separators -- the terminal ground's greenish ink turned a whole pane
 * into a neon lattice. A dedicated token keeps the backdrop's job separate
 * from the separator's.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const THEME = path.resolve(__dirname, "..");
const GROUNDS = readFileSync(path.join(THEME, "grounds.css"), "utf8");
const BRIDGE = readFileSync(path.join(THEME, "mock-bridge.css"), "utf8");

describe("grid backdrop token", () => {
  it("the backdrop is not painted with the per-ground separator ink", () => {
    const backdropRule = BRIDGE.match(/--grid-ink\s*:[^;]+;/);
    expect(backdropRule).not.toBeNull();
    // The gradients must reference the dedicated token, never `--line`.
    const gradients = BRIDGE.match(/repeating-linear-gradient\([^)]*\)/g) ?? [];
    for (const g of gradients) {
      expect(g).not.toContain("var(--line)");
    }
  });

  it("no ground overrides the backdrop token with its own hue", () => {
    // If a ground ever needs its own backdrop ink, this test is the place to
    // decide that deliberately -- not a silent inheritance.
    expect(GROUNDS).not.toContain("--grid-ink");
  });
});
