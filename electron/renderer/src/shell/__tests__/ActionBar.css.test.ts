import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "ActionBar.css"), "utf-8");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in ActionBar.css: ${selector}`);
  return match[1];
}

describe(".action-bar is its own full-width grid row", () => {
  const rule = block(".action-bar");

  it("claims the actionbar grid area", () => {
    expect(rule).toMatch(/grid-area:\s*actionbar;/);
  });

  it("is glass, like the top nav and the console", () => {
    expect(rule).toMatch(/background:\s*var\(--band\);/);
    expect(rule).toMatch(/backdrop-filter:\s*var\(--blur\);/);
    expect(rule).not.toMatch(/var\(--panel\);/);
  });
});

describe("no :hover rule in ActionBar.css moves anything", () => {
  it("has no :hover selector at all in this file", () => {
    // The buttons themselves (ActionButton.css) carry the one allowed sweep;
    // the band around them never should.
    expect(CSS).not.toMatch(/:hover/);
  });
});
