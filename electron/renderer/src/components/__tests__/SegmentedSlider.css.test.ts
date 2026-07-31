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

  // The mock's tray is a SLATE recess, not white glass: a white well on a
  // white card reads as a raised pill, the opposite of what a track says.
  it("uses the slate recess, not a white wash", () => {
    expect(rule).toMatch(/background:\s*var\(--recess\);/);
    expect(rule).not.toMatch(/var\(--raise\);/);
    expect(rule).not.toMatch(/var\(--surface-2\)/);
  });

  it("is rounded 10px, not the cut family", () => {
    expect(rule).toMatch(/border-radius:\s*10px;/);
  });
});

// The mock's rail is an OPAQUE recess (`rgba(210,222,238,.9)`, the --void
// ground) with no border: a translucent rail over the backdrop plates picked
// up the moving grid through itself and read as a rendering fault.
describe(".slider-input track is the mock's 6px opaque rail", () => {
  // The rail is the --void ground with the lime-to-accent FILL painted over
  // it up to `--fill`, the percentage Slider.tsx sets. A rail with no fill was
  // the giveaway that these were not the mock's sliders.
  it("webkit track is 6px, filled lime-to-accent over the slate recess, pill, borderless", () => {
    const rule = readBlock("Slider.css", ".slider-input::-webkit-slider-runnable-track");
    expect(rule).toMatch(/height:\s*6px;/);
    expect(rule).toMatch(/var\(--lime-glow\), var\(--gold\)/);
    expect(rule).toMatch(/var\(--fill, 0%\)/);
    expect(rule).toMatch(/var\(--recess-deep\);/);
    expect(rule).toMatch(/border:\s*0;/);
    expect(rule).toMatch(/border-radius:\s*var\(--r-pill\);/);
  });

  it("moz track matches the webkit one exactly", () => {
    const rule = readBlock("Slider.css", ".slider-input::-moz-range-track");
    expect(rule).toMatch(/height:\s*6px;/);
    expect(rule).toMatch(/var\(--lime-glow\), var\(--gold\)/);
    expect(rule).toMatch(/var\(--fill, 0%\)/);
    expect(rule).toMatch(/var\(--recess-deep\);/);
    expect(rule).toMatch(/border-radius:\s*var\(--r-pill\);/);
  });
});
