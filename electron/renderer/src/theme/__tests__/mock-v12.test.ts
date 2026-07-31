import { readFileSync } from "node:fs";
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
