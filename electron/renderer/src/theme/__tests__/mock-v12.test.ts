import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  MOCK_CSS_PATH,
  MOCK_HTML_PATH,
  extractMockCss,
} from "../../../../scripts/extract-mock-css.mjs";

describe("the shipped mock stylesheet", () => {
  it("is byte-identical to a fresh extraction of the approved mock", () => {
    const expected = extractMockCss(readFileSync(MOCK_HTML_PATH, "utf8"));
    const actual = readFileSync(MOCK_CSS_PATH, "utf8");
    expect(
      actual,
      "mock-v12.css no longer matches the approved mock. It is GENERATED: " +
        "run `npm run --prefix electron build:mock-css` instead of editing it.",
    ).toBe(expected);
  });

  it("carries the rules the window actually needs", () => {
    const css = readFileSync(MOCK_CSS_PATH, "utf8");
    // A truncated extraction would still be "identical to a fresh extraction"
    // if the regex broke on both sides. These are load-bearing selectors from
    // the top, middle and bottom of the mock's <style> block.
    for (const selector of [".hud-nav", ".sec", ".chip", ".console", ".actbar", ".tcursor"]) {
      expect(css, `missing ${selector}`).toContain(selector);
    }
  });
});

/** Every `--name: value` declaration in a stylesheet, first wins. */
function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    if (!found.has(match[1])) found.set(match[1], match[2].trim());
  }
  return found;
}

/** A shadow is a list of lengths; a colour is not. They are not interchangeable. */
const isShadow = (value: string) => /-?\d+px/.test(value);

// `__dirname`, not `new URL(path, import.meta.url)`: the latter throws "The
// URL must be of scheme file" under this project's Vitest/jsdom setup on
// Windows. `contrast.test.ts` reads tokens.css the same relative way.
const THEME_DIR = path.join(__dirname, "..");

describe("token vocabularies", () => {
  it("never gives one name two different TYPES across the two stylesheets", () => {
    const mock = declarations(readFileSync(MOCK_CSS_PATH, "utf8"));
    const app = declarations(readFileSync(path.join(THEME_DIR, "tokens.css"), "utf8"));
    const clashes = [...mock.keys()]
      .filter((name) => app.has(name))
      .filter((name) => isShadow(mock.get(name)!) !== isShadow(app.get(name)!));
    expect(
      clashes,
      "same token name, different type: the mock's rules would receive a value " +
        "they cannot use and the declaration would be silently dropped",
    ).toEqual([]);
  });

  it("defines every token the mock's rules read but never declare", () => {
    const bridge = declarations(readFileSync(path.join(THEME_DIR, "mock-bridge.css"), "utf8"));
    const app = declarations(readFileSync(path.join(THEME_DIR, "tokens.css"), "utf8"));
    // Runtime-only: painted by JS per element, never declared in a stylesheet.
    const runtime = new Set(["--mx", "--my", "--ang", "--sc", "--r", "--fill"]);
    const css = readFileSync(MOCK_CSS_PATH, "utf8");
    const declared = declarations(css);
    const read = new Set(
      [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]),
    );
    const missing = [...read].filter(
      (name) =>
        !runtime.has(name) && !declared.has(name) && !bridge.has(name) && !app.has(name),
    );
    expect(missing, "the mock reads these and nothing declares them").toEqual([]);
  });
});
