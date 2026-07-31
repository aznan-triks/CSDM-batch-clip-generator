/**
 * Proves the scoping property that makes postcss-strip-mock-hover-motion.mjs
 * safe to exist at all: it must strip motion from `:hover` rules in
 * mock-v12.css, and ONLY mock-v12.css. If this ever stripped motion from an
 * arbitrary stylesheet, it would silence no-hover-motion.test.ts for real app
 * code -- exactly the session-2 bug that guard exists to catch. See the
 * plugin's own header for the full reasoning.
 */
import path from "node:path";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

import stripMockHoverMotion from "../../../postcss-strip-mock-hover-motion.mjs";

/** Shaped like the mock's own rules: one motion declaration, one that isn't. */
const HOVER_RULE_CSS = ".chip:hover{transform:translateY(-1px);border-color:red}";

async function strip(css: string, from: string): Promise<string> {
  const result = await postcss([stripMockHoverMotion()]).process(css, { from });
  return result.css;
}

describe("strip-mock-hover-motion (build-time, mock-only)", () => {
  it("leaves a non-mock stylesheet's hover motion untouched", async () => {
    const from = path.resolve("electron/renderer/src/components/Card.css");
    const output = await strip(HOVER_RULE_CSS, from);
    expect(output).toBe(HOVER_RULE_CSS);
  });

  it("strips motion from mock-v12.css's hover rules but keeps the hover colour", async () => {
    const from = path.resolve("electron/renderer/src/theme/mock-v12.css");
    const output = await strip(HOVER_RULE_CSS, from);
    expect(output).not.toContain("transform");
    // PostCSS preserves the original formatting of declarations it did not
    // touch, so this checks for the input's exact spacing, not a reformat.
    expect(output).toContain("border-color:red");
  });

  it("removes a rule left with no declarations after stripping", async () => {
    const from = path.resolve("electron/renderer/src/theme/mock-v12.css");
    const output = await strip(".big-sw:hover{transform:scale(1.08)}", from);
    expect(output.trim()).toBe("");
  });

  it("does not confuse a same-named file in a different directory for the mock", async () => {
    const from = path.resolve("electron/renderer/src/mock-v12.css");
    const output = await strip(HOVER_RULE_CSS, from);
    expect(output).toBe(HOVER_RULE_CSS);
  });
});
