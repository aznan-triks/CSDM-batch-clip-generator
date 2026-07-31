/**
 * A chosen accent must reach the holographic ground.
 *
 * Measured before this: `--gold` set to #ff0000 left `--holo`, `--tile-fill`,
 * `--glow-in` and `--glow-out` untouched at their cyan literals. The two sets
 * of token names had an empty intersection, so no accent could ever get there
 * -- and `rgba(34, 211, 238, ...)` IS #22d3ee written out in decimal, a second
 * copy of the hue that could not follow the first even if it had.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyAccent } from "../accent";

const TOKENS = readFileSync(path.join(__dirname, "..", "tokens.css"), "utf-8");
const BACKDROP = readFileSync(path.join(__dirname, "..", "..", "shell", "Backdrop.tsx"), "utf-8");

describe("applyAccent writes the ground's own hue", () => {
  it("sets --holo alongside --gold", () => {
    applyAccent("#ff0000");
    expect(document.documentElement.style.getPropertyValue("--holo").trim()).toBe("#ff0000");
  });
});

describe("the ground's glows follow --holo instead of repeating it", () => {
  it.each(["--glow-in", "--glow-out", "--tile-border"])(
    "%s is derived from var(--holo), never a literal",
    (token) => {
      const declarations = [...TOKENS.matchAll(new RegExp(`${token}:\\s*([^;]+);`, "g"))].map(
        (match) => match[1],
      );
      expect(declarations.length).toBeGreaterThan(0);
      for (const value of declarations) {
        expect(value).toContain("var(--holo)");
      }
    },
  );
});

describe("the backdrop re-reads its palette when the accent changes", () => {
  it("watches the style attribute, which is where applyAccent writes", () => {
    // applyAccent writes inline custom properties on <html>, so an accent
    // change surfaces as a style-attribute mutation and nothing else. An
    // observer that only watched `data-mode` never woke for one.
    const filter = BACKDROP.match(/attributeFilter:\s*\[([^\]]*)\]/);
    expect(filter).not.toBeNull();
    expect(filter![1]).toContain('"style"');
  });
});
