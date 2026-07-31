/**
 * What is LEFT in Segmented.css and Slider.css.
 *
 * The segmented control is the approved mock's `.seg` and `.seg span.on`, held
 * once in theme/mock-v12.css. The slider is the one control the mock CANNOT
 * hand over: its `.slider` is a picture of a rail -- a 6px div with two
 * pseudo-elements -- and this one is a real `<input type="range">`, which
 * paints its own track and thumb in the platform's blue unless every part is
 * taken over by hand. So Slider.css keeps its rail, and wears the mock's
 * `.row` and `.lab` around it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const SEGMENTED = strip(readFileSync(path.join(__dirname, "..", "Segmented.css"), "utf-8"));
const SLIDER = strip(readFileSync(path.join(__dirname, "..", "Slider.css"), "utf-8"));

/** Every `property: value` declaration, in source order. */
function declarations(css: string): [string, string][] {
  return [...css.matchAll(/^[ \t]*([a-z-]+)[ \t]*:[ \t]*([^;]+);/gm)].map((m) => [
    m[1],
    m[2].trim(),
  ]);
}

describe("Segmented.css", () => {
  it("re-states neither the tray nor the selected segment", () => {
    // `background: none` is the shell reset: it paints nothing. The 8px radius
    // is the focus ring's, matching the segment it outlines.
    const owned = ["background", "font-size", "font-weight"];
    for (const [property, value] of declarations(SEGMENTED)) {
      if (!owned.includes(property)) continue;
      expect(["none", "transparent"], `Segmented.css paints ${property}: ${value}`).toContain(
        value,
      );
    }
    expect(SEGMENTED).not.toMatch(/--recess|--solid/);
  });

  it("reduces the radio button to a transparent shell around the mock's span", () => {
    expect(SEGMENTED).toMatch(/\.seg button\s*\{[^}]*appearance:\s*none;/);
    expect(SEGMENTED).toMatch(/\.seg button\s*\{[^}]*padding:\s*0;/);
    expect(SEGMENTED).toMatch(/\.seg button:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
  });
});

describe("Slider.css", () => {
  it("wears the mock's row and label instead of restating them", () => {
    expect(SLIDER).not.toMatch(/^\.slider\s*\{/m);
    expect(SLIDER).not.toMatch(/\.slider-label/);
  });

  it("still takes over every native part, or the platform paints its own blue", () => {
    for (const part of [
      "::-webkit-slider-runnable-track",
      "::-moz-range-track",
      "::-webkit-slider-thumb",
      "::-moz-range-thumb",
    ]) {
      expect(SLIDER, `the native ${part} is left to the platform`).toContain(part);
    }
    expect(SLIDER).toMatch(/appearance:\s*none;/);
  });

  it("moves nothing on hover -- the thumb changes colour only (D13/D16)", () => {
    const hovers = SLIDER.match(/[^}]*:hover[^{]*\{[^}]*\}/g) ?? [];
    for (const rule of hovers) {
      expect(rule, rule).not.toMatch(/transform|width|height|padding|margin/);
    }
  });
});
