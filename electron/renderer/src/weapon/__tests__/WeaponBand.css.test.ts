import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = path.join(__dirname, "..", "WeaponBand.css");
const CSS = readFileSync(CSS_PATH, "utf-8");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in WeaponBand.css: ${selector}`);
  return match[1];
}

// The band is the mock's `.wband`: a ROW INSIDE the action bar, not a slab of
// its own. It must carry no ground and no blur -- the action bar around it
// already does, and a second frosted layer stacked on the first is exactly
// what made the old 94px band read as a separate strip glued to the window.
describe(".band rides inside the action bar and carries no ground of its own", () => {
  const rule = block(".band");

  it("declares no background at all", () => {
    expect(rule).not.toMatch(/background:/);
    expect(rule).not.toMatch(/#0c1116/);
  });

  it("declares no blur -- the action bar owns the glass", () => {
    expect(rule).not.toMatch(/backdrop-filter:/);
  });

  it("is a flex row that grows to fill the bar", () => {
    expect(rule).toMatch(/display:\s*flex;/);
    expect(rule).toMatch(/flex:\s*1;/);
  });
});

describe(".band-progress rail reuses the Slider's rail token, not a hardcoded hex", () => {
  const rule = block(".band-progress");

  it("uses --surface-2 for the track", () => {
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).not.toMatch(/#11171e/);
  });
});

describe("pyrotechnic FX colours are untouched -- real-world invariants, not theme surfaces", () => {
  it("still has the muzzle-flash and explosion colours", () => {
    expect(CSS).toMatch(/#d2431f/);
    expect(CSS).toMatch(/#3c4a3a/);
  });
});
