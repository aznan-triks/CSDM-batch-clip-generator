import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The console's ruled lines and its text share ONE period. They were two
 * independent numbers on the mock (14px rules under ~21px lines), so the text
 * could never sit on the rules -- a mismatch no amount of nudging fixes,
 * because the two values had no reason to ever be equal.
 *
 * This reads the real stylesheet: the point is to fail when someone edits one
 * of the two numbers without the other.
 */
const CSS_PATH = path.join(__dirname, "..", "LogConsole.css");
const CSS = readFileSync(CSS_PATH, "utf-8");

function declaration(name: string): string {
  const match = CSS.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`declaration not found in LogConsole.css: ${name}`);
  return match[1].trim();
}

describe("the console's ruled lines match its text line height", () => {
  it("declares the line height as a token, not a bare number", () => {
    // A unitless line-height cannot be compared with a px gradient period,
    // and that mismatch is the whole bug. One token feeds both.
    expect(CSS).toMatch(/--log-line:\s*\d+px;/);
  });

  it("uses the same token for the text and for the rules", () => {
    expect(declaration("line-height")).toBe("var(--log-line)");
    // The gradient's period is the token; the transparent stop is the token
    // minus the 1px rule itself.
    const gradient = declaration("background-image");
    expect(gradient).toContain("var(--log-line)");
  });

  it("anchors the rules on the same padding the text starts at", () => {
    // Matching periods with mismatched origins still floats the text: the
    // rules must start where the first line starts.
    expect(CSS).toMatch(/--log-pad:\s*\d+px;/);
    expect(declaration("background-position")).toContain("var(--log-pad)");
  });

  it("carries no hardcoded pixel padding on the log body", () => {
    // HC.1: `padding: 8px` was in here twice.
    const logBlock = CSS.match(/#log\s*\{[^}]*\}/)?.[0] ?? "";
    expect(logBlock).not.toMatch(/padding:\s*\d+px/);
  });
});
