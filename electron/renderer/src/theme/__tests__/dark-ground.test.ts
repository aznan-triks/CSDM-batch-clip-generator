/**
 * Every light colour the approved mock writes as a LITERAL, accounted for.
 *
 * WHAT WENT WRONG: the mock draws almost every surface through a token, which
 * follows the day/night ground for free. A handful it writes literally --
 * `.tab.active { background: #fff }`, `.seg { background: rgba(226,232,240,.7) }`
 * -- because its own picture is light and the question never came up. Those
 * surfaces stayed light on the dark ground while the text on them followed the
 * mode: white ground, near-white label. The mock's dark mode was never walked
 * through the tab strip.
 *
 * A hand-written list of the offenders would rot the day the mock changes. So
 * this reads the LITERALS OUT OF THE MOCK and demands a verdict for each one:
 * either the window corrects it with a token, or it is a flash of light that is
 * correct on any ground, or the window never mounts that element. A literal
 * with no verdict fails, which is the point -- the next one has to be decided,
 * not discovered on screen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const THEME = path.join(__dirname, "..");
const COMPONENTS = path.join(THEME, "..", "components");
const MOCK = readFileSync(path.join(THEME, "mock-v12.css"), "utf8");

/** A colour written out rather than taken from a token. */
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i;

/** Light enough that dark text on it, or it on a dark ground, is a problem. */
function isLight(colour: string): boolean {
  const hex = colour.match(/^#([0-9a-f]{3,6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    return (r + g + b) / 3 > 200;
  }
  const rgb = colour.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!rgb) return false;
  const [r, g, b] = rgb.slice(1, 4).map(Number);
  return (r + g + b) / 3 > 200;
}

/**
 * The verdict for each literal light surface the mock paints, by selector.
 *
 *  - `corrected`: the window re-declares it through a token. The stylesheet
 *    named here must actually contain that override -- checked below.
 *  - `flash`: a burst of light (muzzle, spark, glitch veil, spinning ring).
 *    White is correct on any ground; that IS the effect.
 *  - `unused`: the mock draws it, this window never mounts it.
 */
const VERDICTS: Record<string, { verdict: "corrected" | "flash" | "unused"; sheet?: string }> = {
  ".tab:hover": { verdict: "corrected", sheet: "Tab.css" },
  ".tab.active": { verdict: "corrected", sheet: "Tab.css" },
  ".seg": { verdict: "corrected", sheet: "Segmented.css" },
  ".seg span.on": { verdict: "corrected", sheet: "Segmented.css" },
  ".box": { verdict: "unused" },
  ".slider": { verdict: "unused" },
  ".slider::after": { verdict: "unused" },
  ".btn .bx": { verdict: "flash" },
  ".btn .fl": { verdict: "flash" },
  ".btn.primary .sb": { verdict: "flash" },
  ".sec .spot": { verdict: "flash" },
  ".muzzle": { verdict: "flash" },
  ".tracer": { verdict: "flash" },
  ".boomfx": { verdict: "flash" },
  ".pl .av": { verdict: "unused" },
};

/** Selector -> the background value the mock writes, when it is a light literal. */
function literalLightBackgrounds(): Map<string, string> {
  const found = new Map<string, string>();
  // Rule bodies only: `:root` declares the tokens themselves, and keyframes
  // are flashes by construction.
  const withoutRoot = MOCK.replace(/@keyframes[^{]*\{(?:[^{}]|\{[^}]*\})*\}/g, "");
  for (const match of withoutRoot.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = match[1].trim();
    if (selector.startsWith("@") || selector.includes(":root")) continue;
    const background = match[2].match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/)?.[1];
    if (!background) continue;
    // A gradient of light stops is a flash, not a surface: it is caught by the
    // selector's own verdict, not by its first colour.
    const first = background.match(LITERAL)?.[0];
    if (!first || !isLight(first)) continue;
    found.set(selector, background.trim());
  }
  return found;
}

const LIGHT_LITERALS = literalLightBackgrounds();

describe("the mock's literal light surfaces", () => {
  it("found some to check", () => {
    // Without this the loop below would pass over an empty map.
    expect(LIGHT_LITERALS.size).toBeGreaterThan(4);
  });

  it("every one of them has a verdict", () => {
    const undecided = [...LIGHT_LITERALS].filter(([selector]) => !VERDICTS[selector]);
    expect(
      undecided.map(([selector, value]) => `${selector} -> ${value}`),
      "the mock paints these light and nothing says what the dark ground does with them",
    ).toEqual([]);
  });

  it("every `corrected` verdict is backed by a real override", () => {
    const missing: string[] = [];
    for (const [selector, { verdict, sheet }] of Object.entries(VERDICTS)) {
      if (verdict !== "corrected") continue;
      const css = readFileSync(path.join(COMPONENTS, sheet!), "utf8");
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
      if (!rule || !/background:\s*var\(--/.test(rule)) {
        missing.push(`${sheet}: ${selector} claims a correction it does not make`);
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("a correction uses the token that MATCHES the mock in light mode", () => {
    // The whole point: nothing changes on the light ground. `--solid` is
    // #ffffff and `--recess` is rgba(226,232,240,0.7) -- the app's tokens were
    // read off these very literals. A correction that picks another token
    // would be a redesign wearing a bug fix's clothes.
    const tokens = readFileSync(path.join(THEME, "tokens.css"), "utf8");
    const lightBlock = tokens.split(/:root\[data-mode="dark"\]/)[0];
    expect(lightBlock).toMatch(/--solid:\s*#ffffff;/i);
    expect(lightBlock).toMatch(/--recess:\s*rgba\(226,\s*232,\s*240,\s*0?\.7\d*\)/i);
  });
});
