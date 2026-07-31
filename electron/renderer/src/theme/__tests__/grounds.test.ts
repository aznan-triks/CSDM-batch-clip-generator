/**
 * The night grounds must be DISTINCT, and each must be legible.
 *
 * Measured before this file existed: applying the five grounds one after the
 * other produced 2 distinct palettes, not 5 -- `dark`, `amoled`, `deepblue`
 * and `terminal` came back byte-identical, because theme/mode.ts mapped all
 * four onto the same `data-mode="dark"` and nothing else.
 *
 * Two rules, the same two contrast.test.ts holds the light and dark blocks to:
 * the ground ladder climbs (D9), and text clears WCAG AA on the ground it
 * actually sits on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { contrastRatio, relativeLuminance } from "../accent";
import { GROUND_MODES, applyMode } from "../mode";

const THEME = path.join(__dirname, "..");
const GROUNDS_CSS = readFileSync(path.join(THEME, "grounds.css"), "utf-8");
const TOKENS_CSS = readFileSync(path.join(THEME, "tokens.css"), "utf-8");

/** The grounds that get their own block, i.e. every night ground but `dark`. */
const OWN_BLOCK = ["amoled", "deepblue", "terminal"] as const;

/** A ground's own block, or "" for `dark`, which has none and needs none. */
function block(ground: string): string {
  const marker = `:root[data-ground="${ground}"]`;
  const start = GROUNDS_CSS.indexOf(marker);
  if (start === -1) return "";
  const end = GROUNDS_CSS.indexOf("}", start);
  return GROUNDS_CSS.slice(start, end);
}

function readToken(name: string, ground: string): string {
  const pattern = new RegExp(`${name}:\\s*([^;]+);`);
  const own = block(ground).match(pattern);
  if (own) return own[1].trim();
  // Not overridden by the ground: the dark block still applies, because
  // `data-mode` stays "dark" for every night ground.
  const darkAt = TOKENS_CSS.indexOf(':root[data-mode="dark"]');
  const dark = TOKENS_CSS.slice(darkAt).match(pattern);
  if (!dark) throw new Error(`token not found for ground ${ground}: ${name}`);
  return dark[1].trim();
}

describe("every ground Settings offers really has its own palette", () => {
  it("declares a block for each night ground beyond the default dark", () => {
    for (const ground of OWN_BLOCK) {
      expect(GROUNDS_CSS).toContain(`:root[data-ground="${ground}"]`);
    }
  });

  it("gives no two grounds the same app background", () => {
    const grounds = ["dark", ...OWN_BLOCK];
    const bases = grounds.map((ground) => readToken("--base", ground));
    expect(new Set(bases).size).toBe(grounds.length);
  });

  it("sets the page gradient itself, which the bridge's mapping cannot reach", () => {
    // `mock-bridge.css` points --page-0/-1 at --base/--void, but the mock
    // writes them as literals inside `:root[data-mode="dark"]` (0,2,0) against
    // the bridge's `:root` (0,1,0), so the mapping loses. Measured before this:
    // all four night grounds drew the same rgb(11,18,32) page.
    for (const ground of OWN_BLOCK) {
      expect(block(ground)).toContain("--page-0:");
      expect(block(ground)).toContain("--page-1:");
    }
    const pages = OWN_BLOCK.map((ground) => readToken("--page-0", ground));
    expect(new Set(pages).size).toBe(OWN_BLOCK.length);
  });

  it("stamps the ground on the document, not only the mode", () => {
    for (const ground of Object.keys(GROUND_MODES)) {
      applyMode(ground);
      expect(document.documentElement.getAttribute("data-ground")).toBe(ground);
    }
  });
});

describe.each(OWN_BLOCK)("ground hierarchy (D9) in %s: strictly increasing luminance", (ground) => {
  const rung = (name: string) => relativeLuminance(readToken(name, ground));

  it("--void < --base", () => {
    expect(rung("--void")).toBeLessThan(rung("--base"));
  });

  it("--base < --panel", () => {
    expect(rung("--base")).toBeLessThan(rung("--panel"));
  });

  it("--panel < --raise", () => {
    expect(rung("--panel")).toBeLessThan(rung("--raise"));
  });

  it("--raise < --raise-hi", () => {
    expect(rung("--raise")).toBeLessThan(rung("--raise-hi"));
  });
});

describe.each(OWN_BLOCK)("text passes WCAG AA on its real ground in %s", (ground) => {
  const pairs: Array<[string, string]> = [
    ["--txt", "--panel"],
    ["--txt-lo", "--panel"],
    ["--txt-hi", "--panel"],
    // Chips and fields sit on the raised layer; --dim is the quietest ink and
    // therefore the pair that fails first.
    ["--dim", "--panel"],
    ["--dim", "--raise"],
    ["--dim", "--raise-hi"],
  ];

  it.each(pairs)("%s on %s clears 4.5:1", (ink, on) => {
    expect(contrastRatio(readToken(ink, ground), readToken(on, ground))).toBeGreaterThanOrEqual(4.5);
  });
});
