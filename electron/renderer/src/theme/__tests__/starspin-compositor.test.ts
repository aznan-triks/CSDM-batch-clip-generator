/**
 * starspin used to animate the registered custom property `--ang`
 * (mock-v12.css: `@property --ang`), which forces a style recalc every
 * frame even at rest -- measured before this fix: normal 7.16 % GPU /
 * 99.9 recalc/s -> noStarspin 1.05 % / 15.1 recalc/s (attribution.json,
 * fix 2/2, task 1). A conic gradient rotated around its own centre is
 * visually identical to shifting its `from` angle, so the ring now spins
 * a `::before` pseudo-element on the compositor (`rotate`, no recalc)
 * instead of animating the custom property.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "mock-bridge.css"), "utf-8");

describe("primary button ring (.sb) spins on the compositor", () => {
  it("turns off the custom-property animation on .btn.primary .sb", () => {
    expect(CSS).toMatch(/\.btn\.primary\s+\.sb\s*\{[^}]*animation:\s*none/);
  });

  it("rotates a ::before pseudo-element with starspin-rotate instead", () => {
    expect(CSS).toMatch(/\.btn\.primary\s+\.sb::before\s*\{[^}]*animation:\s*starspin-rotate\s+2\.6s\s+linear\s+infinite/);
  });

  it("keeps the rotation an infinite CSS animation, still covered by the motion gate", () => {
    expect(CSS).toMatch(/@keyframes\s+starspin-rotate\s*\{[^}]*rotate:\s*360deg/);
  });
});
