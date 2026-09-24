/**
 * The motion gate (motion/engine.ts) mirrors `effectiveIntensity()` onto
 * `<html data-motion>`. CSS animations must obey that gate too, or a
 * minimised/unfocused window keeps repainting infinite `animation:` loops
 * that JS never started and cannot stop -- exactly what
 * docs/audits/AUDIT_perf_ressources.md measured before this fix (starspin,
 * caret and pulses still running while hidden).
 *
 * The guard below is deliberately loose: it fails if the pause rule is
 * removed, not if a future stylesheet adds another `infinite` animation --
 * the rule in mock-bridge.css is universal (`html[data-motion="none"] *`),
 * so it already covers whatever gets added later.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const THEME_DIR = path.join(__dirname, "..");
const SRC_DIR = path.join(THEME_DIR, "..");
const BRIDGE_CSS = readFileSync(path.join(THEME_DIR, "mock-bridge.css"), "utf-8");

describe("mock-bridge.css pauses every CSS animation under the motion gate", () => {
  it("holds every animation still when <html data-motion='none'>", () => {
    expect(BRIDGE_CSS).toMatch(
      /html\[data-motion=["']none["']\]\s*\*[^{]*\{[^}]*animation-play-state:\s*paused\s*!important/,
    );
  });

  it("guards against a real gap: at least one infinite CSS animation exists in src/", () => {
    // If this ever comes back empty, the rule above has nothing to pause and
    // the test is vacuous -- that is the failure this assertion catches.
    const cssFiles = globSync("**/*.css", { cwd: SRC_DIR }).map((f) => path.join(SRC_DIR, f));
    const infiniteAnimationNames = new Set<string>();

    for (const file of cssFiles) {
      const css = readFileSync(file, "utf-8");
      for (const match of css.matchAll(/animation:\s*([^;{}]+);/g)) {
        const declaration = match[1];
        if (!/infinite/.test(declaration)) continue;
        const name = declaration.trim().split(/\s+/)[0];
        if (name) infiniteAnimationNames.add(name);
      }
    }

    expect(infiniteAnimationNames.size).toBeGreaterThan(0);
  });
});

describe("the pause does not freeze an entrance at its hidden first frame", () => {
  // `animation-play-state: paused` holds a one-shot `forwards` entrance at
  // 0 %: an element whose base style is hidden (`.casc-g{opacity:0}`, the
  // weapon silhouettes) would stay invisible for as long as the gate is shut
  // -- for good under OS reduced motion. Each such entrance must be let
  // through to its end state (duration 0) instead.
  const allCss = globSync("**/*.css", { cwd: SRC_DIR })
    .map((f) => readFileSync(path.join(SRC_DIR, f), "utf-8"))
    .join("\n");

  function keyframesEndVisible(name: string): boolean {
    const start = allCss.search(new RegExp(`@keyframes\\s+${name}\\s*\\{`));
    if (start < 0) return false;
    const body = allCss.slice(start, start + 400);
    const end = body.match(/(?:\bto|100%)\s*\{([^}]*)\}/);
    const opacity = end?.[1].match(/opacity:\s*([\d.]+)/);
    return opacity != null && Number(opacity[1]) > 0;
  }

  const entrances: string[] = [];
  for (const rule of allCss.matchAll(/([^{}]+)\{[^{}]*animation:\s*([\w-]+)[^;{}]*forwards[^{}]*\}/g)) {
    if (keyframesEndVisible(rule[2])) entrances.push(rule[1].trim());
  }

  it("finds the forwards entrances it guards (not vacuous)", () => {
    expect(entrances).toContain(".casc-g.in");
  });

  it.each(entrances)("lets %s reach its end state when data-motion is none", (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(BRIDGE_CSS).toMatch(
      new RegExp(
        `html\\[data-motion=["']none["']\\]\\s+${escaped}\\s*[,{][^}]*animation-duration:\\s*0s\\s*!important`,
      ),
    );
  });
});
