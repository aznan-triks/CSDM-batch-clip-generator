/**
 * The console's ruled lines and its text share ONE period.
 *
 * They were two independent numbers once (14px rules under ~21px lines), so
 * the text could never sit on the rules -- a mismatch no amount of nudging
 * fixes, because the two values had no reason to ever be equal. The fix was to
 * feed both from one token.
 *
 * That single source now lives in the approved mock itself (`.console .body`
 * and its `::after` ruling, theme/mock-v12.css, drift-locked by
 * theme/__tests__/mock-v12.test.ts). So this file guards two things: that the
 * mock's three numbers still agree with each other, and that LogConsole.css
 * does not quietly set a fourth.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const THEME_DIR = path.join(__dirname, "..", "..", "theme");
const MOCK = readFileSync(path.join(THEME_DIR, "mock-v12.css"), "utf-8");
const CONSOLE_CSS = readFileSync(path.join(__dirname, "..", "LogConsole.css"), "utf-8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The body rule and the ruling rule, as raw declaration text. */
const bodyRule = MOCK.match(/\.console \.body\{([^}]*)\}/)?.[1] ?? "";
const rulingRule = MOCK.match(/\.console \.body::after\{([^}]*)\}/)?.[1] ?? "";

function px(source: string, pattern: RegExp): number {
  const match = source.match(pattern);
  if (!match) throw new Error(`not found: ${pattern}`);
  return Number(match[1]);
}

describe("the mock's console rhythm is internally consistent", () => {
  it("found both rules to compare", () => {
    // Without this the two assertions below would compare 0 with 0 and pass
    // over nothing -- the vacuous-guard failure this suite exists to avoid.
    expect(bodyRule, "the mock's .console .body rule is gone").not.toBe("");
    expect(rulingRule, "the mock's .console .body::after ruling is gone").not.toBe("");
  });

  it("repeats the rules exactly one text line apart", () => {
    const lineHeight = px(bodyRule, /line-height:\s*(\d+)px/);
    // The gradient's last colour stop closes the repeat: `... 21px 22px)`.
    // Its second number IS the period.
    const period = px(rulingRule, /\d+px\s+(\d+)px\)/);
    expect(period, "the ruling period drifted from the line height").toBe(lineHeight);
  });

  it("starts the rules where the first line of text starts", () => {
    const topPadding = px(bodyRule, /padding:\s*(\d+)px/);
    const rulesTop = px(rulingRule, /top:\s*(\d+)px/);
    expect(rulesTop, "the rules no longer start at the body's top padding").toBe(topPadding);
  });
});

describe("LogConsole.css adds no fourth number to that rhythm", () => {
  it("sets neither a line height nor a padding on the body", () => {
    const body = CONSOLE_CSS.match(/\.console \.body\s*\{[^}]*\}/)?.[0] ?? "";
    expect(body).not.toMatch(/line-height/);
    expect(body).not.toMatch(/padding/);
  });

  it("draws no ruling of its own", () => {
    expect(CONSOLE_CSS).not.toMatch(/repeating-linear-gradient/);
    expect(CONSOLE_CSS).not.toMatch(/--log-line|--log-pad/);
  });
});
