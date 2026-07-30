import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = path.join(__dirname, "..", "Card.css");
const CSS = readFileSync(CSS_PATH, "utf-8");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in Card.css: ${selector}`);
  return match[1];
}

describe(".panel-box is glass, rounded", () => {
  const rule = block(".panel-box");

  it("uses the surface glass token for its background", () => {
    expect(rule).toMatch(/background:\s*var\(--surface\);/);
    expect(rule).not.toMatch(/var\(--panel\)/);
  });

  it("uses the mode-aware bright border, not the flat hairline", () => {
    expect(rule).toMatch(/border:\s*var\(--bw\)\s*solid\s*var\(--line-hi\);/);
  });

  it("is rounded, not the cut family", () => {
    expect(rule).toMatch(/border-radius:\s*var\(--r-card\);/);
  });

  it("blurs what is behind it", () => {
    expect(rule).toMatch(/backdrop-filter:\s*var\(--blur\);/);
  });
});
