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

  it("is a positioning context for the sliding indicator", () => {
    expect(rule).toMatch(/position:\s*relative;/);
  });
});

describe(".tab overlaps its neighbour in a two-sided parallelogram", () => {
  const rule = block(".tab");

  it("cuts both sides on the --sp-7 token, matching the overlapping mock geometry", () => {
    expect(rule).toMatch(
      /clip-path:\s*polygon\(var\(--sp-7\) 0, 100% 0, calc\(100% - var\(--sp-7\)\) 100%, 0 100%\);/,
    );
  });

  it("overlaps the previous tab by --sp-6, except the first", () => {
    expect(rule).toMatch(/margin-left:\s*calc\(var\(--sp-6\) \* -1\);/);
    expect(block(".tab:first-child")).toMatch(/margin-left:\s*0;/);
  });
});

describe(".tab-active is the opaque front of the stack, keeps its bevel", () => {
  const rule = block(".tab-active");

  // The mock's open tab is solid white, not another sheet of glass: a
  // translucent one let the moving backdrop plates crawl through the tab the
  // user is standing on.
  it("is opaque --solid, not a translucent surface", () => {
    expect(rule).toMatch(/background:\s*var\(--solid\);/);
    expect(rule).not.toMatch(/var\(--raise-hi\)/);
    expect(rule).not.toMatch(/var\(--surface\)/);
  });

  it("pops on translateY -- a selected-state change, never a :hover one", () => {
    expect(rule).toMatch(/transform:\s*translateY\(-2px\);/);
    expect(block(".tab:hover")).not.toMatch(/transform/);
  });
});
