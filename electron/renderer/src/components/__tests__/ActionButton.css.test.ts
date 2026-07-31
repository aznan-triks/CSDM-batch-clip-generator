import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "ActionButton.css"), "utf-8");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in ActionButton.css: ${selector}`);
  return match[1];
}

describe(".btn base wears the mock's opaque face and two-corner bevel", () => {
  const rule = block(".btn");

  it("uses the opaque --solid face, not a glass wash", () => {
    expect(rule).toMatch(/background:\s*var\(--solid\);/);
    expect(rule).not.toMatch(/var\(--raise\);/);
    expect(rule).not.toMatch(/var\(--surface-2\);/);
  });

  // The mock cuts the top-left AND bottom-right corners. The old single-sided
  // cut sheared one edge only and read as a rectangle drawn wrong.
  it("cuts both diagonal corners, not just one edge", () => {
    expect(rule).toMatch(
      /clip-path:\s*polygon\(8px 0, 100% 0, 100% calc\(100% - 8px\), calc\(100% - 8px\) 100%, 0 100%, 0 8px\);/,
    );
  });
});

describe(".btn-run breaks from the bevel family into a pill", () => {
  const rule = block(".btn-run");

  it("cancels the base clip-path", () => {
    expect(rule).toMatch(/clip-path:\s*none;/);
  });

  it("is rounded pill, not the cut family", () => {
    expect(rule).toMatch(/border-radius:\s*var\(--r-pill\);/);
  });

  it("keeps its existing accent gradient untouched", () => {
    expect(rule).toMatch(/linear-gradient\(180deg, var\(--gold-hi\), var\(--gold\)\)/);
  });
});
