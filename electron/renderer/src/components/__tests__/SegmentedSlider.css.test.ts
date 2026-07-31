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
  it("re-states neither the segment's type nor its geometry", () => {
    for (const [property, value] of declarations(SEGMENTED)) {
      if (!["font-size", "font-weight"].includes(property)) continue;
      expect.fail(`Segmented.css sets ${property}: ${value}; the mock's .seg span owns it`);
    }
  });

  it("re-points the two literal light surfaces at a token, and nothing else", () => {
    // The mock writes the tray as `rgba(226,232,240,.7)` and the chosen
    // segment as `#fff` -- the only two surfaces here it does not take from a
    // token, which is why both stayed light on the dark ground. `background:
    // none` is the shell reset and paints nothing. Anything else must be a
    // token: re-pointing a value is a correction, re-typing it is a copy.
    // theme/__tests__/dark-ground.test.ts holds the ledger.
    for (const [property, value] of declarations(SEGMENTED)) {
      if (property !== "background") continue;
      expect(value, "a literal here is a copy of the design, not a correction").toMatch(
        /^(none|var\(--[a-z-]+\))$/,
      );
    }
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
