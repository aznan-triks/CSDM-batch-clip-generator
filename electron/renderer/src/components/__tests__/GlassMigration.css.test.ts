import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Restyle 2's completion gate (the plan's Task 6) grepped for leftover flat
 * tokens by hand and caught one real miss: `.segment:hover` was still on
 * `var(--raise-hi)` after the container around it went glass. The per-file
 * negative guards added during the migration (`not.toMatch(/var\(--raise\);/)`)
 * anchor on a trailing semicolon, so by construction none of them could ever
 * have caught `--raise-hi` -- a different token with the same prefix. This is
 * the guard that closes that hole: one assertion across all 7 files, with no
 * semicolon anchor, so any resemblance to the flat family fails it.
 *
 * The three `color-mix(in srgb, var(--steel|blood) N%, var(--void))` border
 * tints in ActionButton.css are a deliberate exception (see its own test
 * file): they blend toward `--void` for a border colour, not a background
 * fill, and were explicitly left untouched by the plan's Task 5.
 */
const COMPONENTS_DIR = path.join(__dirname, "..");
const MIGRATED_FILES = ["Card.css", "Tab.css", "ActionButton.css", "Field.css", "Chip.css", "Segmented.css", "Slider.css"];

const FLAT_TOKEN = /var\(--(panel|raise-hi|raise|void)\)/g;

describe("none of the 7 migrated files reference the old flat-token family", () => {
  for (const file of MIGRATED_FILES) {
    it(`${file} has no lingering var(--panel|raise|raise-hi|void) outside a color-mix border tint`, () => {
      const css = readFileSync(path.join(COMPONENTS_DIR, file), "utf-8");
      // Blank out color-mix(...) calls first: the ActionButton border tints
      // are an authorized exception, not a migration miss.
      // One level of nesting only (color-mix(... var(--x) ...)) -- matches
      // every color-mix() actually used in these files.
      const withoutColorMix = css.replace(/color-mix\((?:[^()]|\([^()]*\))*\)/g, "");
      const offenders = withoutColorMix.match(FLAT_TOKEN) ?? [];
      expect(offenders, `${file}: ${offenders.join(", ")}`).toEqual([]);
    });
  }
});
