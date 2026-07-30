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

describe(".band is glass like the top bar and console, not the old flat --void gradient", () => {
  const rule = block(".band");

  it("uses the band glass token for its background", () => {
    expect(rule).toMatch(/background:\s*var\(--band\);/);
    expect(rule).not.toMatch(/#0c1116/);
    expect(rule).not.toMatch(/var\(--void\)/);
  });

  it("blurs what is behind it, like every other glass surface", () => {
    expect(rule).toMatch(/backdrop-filter:\s*var\(--blur\);/);
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
