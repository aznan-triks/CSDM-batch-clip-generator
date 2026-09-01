/**
 * Every mock token that only exists in DAY must be pointed at an app token.
 *
 * `mock-v12.css` is one designer's page with one dark ground; it declares most
 * of its palette in its light `:root` and its night block revisits only the
 * handful that mattered to that page. This window has FIVE grounds. Any name
 * the mock declares once and this app never redeclares therefore keeps a DAY
 * value on every night ground -- silently, since nothing reads as broken until
 * you look at the contrast.
 *
 * Found 2026-09-02 with exactly the sweep below: twelve such tokens, `--muted`
 * (12 selectors: every field label, typed value, unselected chip and segment)
 * and `--hair` (14: every field and chip rim) among them.
 *
 * This test IS that sweep, run every time. A new token in a regenerated
 * `mock-v12.css` cannot slip in unbridged.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(__dirname, "..");
const MOCK = readFileSync(path.join(DIR, "mock-v12.css"), "utf-8");
const TOKENS = readFileSync(path.join(DIR, "tokens.css"), "utf-8");
const GROUNDS = readFileSync(path.join(DIR, "grounds.css"), "utf-8");

const NIGHT_MARKER = "/* ===== NIGHT mode";
const MOCK_LIGHT = MOCK.slice(MOCK.indexOf(":root{"), MOCK.indexOf(NIGHT_MARKER));
const MOCK_NIGHT = MOCK.slice(MOCK.indexOf(NIGHT_MARKER));

function declared(css: string): Set<string> {
  return new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/**
 * Tokens the app deliberately leaves the mock's, with the reason.
 *
 * A registry, not a silence: adding a name here is a decision someone has to
 * write down, which is the difference between this list and the twelve that
 * went unnoticed.
 */
const LEFT_TO_THE_MOCK: Record<string, string> = {
  spring:
    "an overshooting easing. tokens.css refuses it on purpose (the C4 plant read as a toy in v214); " +
    "reviving it under any name is how that comes back.",
};

describe("no mock token keeps a day value on a night ground", () => {
  const used = new Set([...MOCK.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]));
  const lightOnly = [...declared(MOCK_LIGHT)]
    .filter((name) => used.has(name))
    .filter((name) => !declared(MOCK_NIGHT).has(name))
    .sort();

  it("the sweep still finds tokens to check (the file parsed)", () => {
    expect(lightOnly.length).toBeGreaterThan(5);
  });

  it.each(lightOnly)("--%s is redeclared by the app, or registered as deliberate", (name) => {
    if (name in LEFT_TO_THE_MOCK) return;
    const bridged = new RegExp(`--${name}\s*:`).test(TOKENS) || new RegExp(`--${name}\s*:`).test(GROUNDS);
    expect(
      bridged,
      `--${name} is used by mock-v12.css, declared only in its LIGHT :root, and nothing in ` +
        `tokens.css or grounds.css redeclares it -- it will keep its day value on all four night grounds. ` +
        `Point it at an app token in tokens.css, or add it to LEFT_TO_THE_MOCK with the reason.`,
    ).toBe(true);
  });
});

describe("the bridges point at a token, never at a literal", () => {
  // A literal on the right-hand side is a second copy of a colour, and a copy
  // is what freezes on the next ground. Every bridge must be `var(--x)`.
  const BLOCK_START = TOKENS.indexOf("===== THE MOCK'S OWN NAMES");
  const block = TOKENS.slice(BLOCK_START, TOKENS.indexOf("}", BLOCK_START));

  it("the bridge block exists", () => {
    expect(BLOCK_START).toBeGreaterThan(-1);
  });

  it.each([...block.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]))(
    "--%s is declared as %s",
    (_name, value) => {
      expect(value).toMatch(/^var\(--[a-z0-9-]+\)$/);
    },
  );
});

describe("a bridge declared at `html` would never apply", () => {
  // `html` is (0,0,1); the mock declares its tokens at `:root`, which is
  // (0,1,0). Specificity settles it before load order is consulted -- which is
  // how `--faint` and `--font` sat dead in mock-bridge.css from the day they
  // were written, with a test passing on the text of the rule.
  const BRIDGE = readFileSync(path.join(DIR, "mock-bridge.css"), "utf-8");
  const htmlBlock = BRIDGE.slice(BRIDGE.indexOf("html {"), BRIDGE.indexOf("}", BRIDGE.indexOf("html {")));
  const mockNames = declared(MOCK_LIGHT);

  it.each([...htmlBlock.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]))(
    "--%s in mock-bridge.css's html block is a name the mock never declares",
    (name) => {
      expect(
        mockNames.has(name),
        `--${name} is declared by mock-v12.css at :root (0,1,0); an html block (0,0,1) cannot win. ` +
          `Move it to :root in tokens.css.`,
      ).toBe(false);
    },
  );
});
