import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readBlock(file: string, selector: string): string {
  const css = readFileSync(path.join(__dirname, "..", file), "utf-8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in ${file}: ${selector}`);
  return match[1];
}

describe(".segmented container is glass, rounded", () => {
  const rule = readBlock("Segmented.css", ".segmented");

  it("uses --surface-2", () => {
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).not.toMatch(/var\(--raise\);/);
  });

  it("is rounded 10px, not the cut family", () => {
    expect(rule).toMatch(/border-radius:\s*10px;/);
  });
});

describe(".slider-input track is glass, pill-shaped", () => {
  it("webkit track uses --surface-2 and --r-pill", () => {
    const rule = readBlock("Slider.css", ".slider-input::-webkit-slider-runnable-track");
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).not.toMatch(/var\(--void\);/);
    expect(rule).toMatch(/border-radius:\s*var\(--r-pill\);/);
  });

  it("moz track uses --surface-2 and --r-pill", () => {
    const rule = readBlock("Slider.css", ".slider-input::-moz-range-track");
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).toMatch(/border-radius:\s*var\(--r-pill\);/);
  });
});
