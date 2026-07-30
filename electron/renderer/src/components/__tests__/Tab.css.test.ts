import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "Tab.css"), "utf-8");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in Tab.css: ${selector}`);
  return match[1];
}

describe(".tab-bar is a light frosted band", () => {
  const rule = block(".tab-bar");

  it("uses --band and blurs behind it", () => {
    expect(rule).toMatch(/background:\s*var\(--band\);/);
    expect(rule).not.toMatch(/var\(--void\);/);
    expect(rule).toMatch(/backdrop-filter:\s*var\(--blur\);/);
  });
});

describe(".tab-active is glass, keeps its bevel", () => {
  const rule = block(".tab-active");

  it("uses --surface instead of the flat gradient", () => {
    expect(rule).toMatch(/background:\s*var\(--surface\);/);
    expect(rule).not.toMatch(/var\(--raise-hi\)/);
  });

  it("the bevel clip-path is untouched on .tab", () => {
    expect(block(".tab")).toMatch(/clip-path:\s*polygon\(0 0, 100% 0, calc\(100% - 12px\) 100%, 0 100%\);/);
  });
});
