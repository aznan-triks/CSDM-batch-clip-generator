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

describe(".btn base is glass, keeps its bevel", () => {
  const rule = block(".btn");

  it("uses --surface-2 instead of --raise", () => {
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).not.toMatch(/var\(--raise\);/);
  });

  it("the bevel clip-path is untouched", () => {
    expect(rule).toMatch(/clip-path:\s*polygon\(0 0, 100% 0, calc\(100% - 10px\) 100%, 0 100%\);/);
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
