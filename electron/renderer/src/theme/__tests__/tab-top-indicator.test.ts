/**
 * `.top-ind` (the tab strip's top accent bar) actually renders and animates,
 * resolved through the real cascade -- not read out of the stylesheet text.
 *
 * This exact block was lost once already: a large, unrelated block-grid
 * rewrite of mock-bridge.css (3.2.3) deleted it as collateral damage while
 * `Tab.tsx`'s JS half (which moves `.top-ind` via `translateX()`) survived
 * untouched -- so the element kept existing in the DOM, doing nothing
 * visible, and no test caught it because nothing asserted on its style. A
 * text-search for `.top-ind` would have caught THAT specific loss (the whole
 * block vanished), but proves nothing about whether the rule actually wins
 * the cascade against mock-v12.css -- which is the point of loading both
 * sheets here, in their real bundle order (mock-bridge.css after
 * mock-v12.css, same reason recorded in mock-bridge.css's own history).
 *
 * `.tab.active::after`'s `display: none` cannot be checked this way: jsdom
 * throws "Not implemented" on `getComputedStyle(el, '::after')`
 * (see __tests__/no-hover-motion.test.ts for the same limitation, probed the
 * same way) -- that half is asserted as a text scan instead, the documented
 * exception, not the default.
 *
 * jsdom's `getComputedStyle` also does not decompose the `transition`
 * shorthand into its longhands: `transitionProperty`/`transitionDuration`
 * come back as the CSS-wide initial values ("all"/"0s") even when the
 * shorthand itself parsed correctly -- confirmed by an isolated probe
 * (`.x { transition: transform .4s cubic-bezier(...) }` reproduces it with
 * no var() involved at all). `style.transition`, the shorthand's own
 * serialization, is read back correctly, so this asserts on that string
 * instead of the longhands.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MOCK_CSS = readFileSync(path.join(__dirname, "..", "mock-v12.css"), "utf-8");
const BRIDGE_CSS = readFileSync(path.join(__dirname, "..", "mock-bridge.css"), "utf-8").replace(
  /var\(--ease\)/g,
  "cubic-bezier(.22,1,.36,1)",
);

let sheet: HTMLStyleElement;
let bar: HTMLElement;

beforeAll(() => {
  sheet = document.createElement("style");
  sheet.textContent = `${MOCK_CSS}\n${BRIDGE_CSS}`;
  document.head.appendChild(sheet);

  // The exact shape TabBar renders (components/Tab.tsx): the active tab,
  // then the two sliding indicators as its own siblings.
  bar = document.createElement("div");
  bar.className = "tabs";
  bar.innerHTML =
    '<button class="tab active">Capture</button><span class="ind"></span><span class="top-ind"></span>';
  document.body.appendChild(bar);
});

afterAll(() => {
  sheet.remove();
  bar.remove();
});

describe(".top-ind renders and animates like .ind", () => {
  it("is positioned as an absolute bar, not inline flow", () => {
    const topInd = bar.querySelector(".top-ind") as HTMLElement;
    const style = getComputedStyle(topInd);
    expect(style.position).toBe("absolute");
    expect(style.top).toBe("0px");
    expect(style.height).toBe("2px");
  });

  it("carries the same sliding transition the bottom indicator uses", () => {
    const topInd = bar.querySelector(".top-ind") as HTMLElement;
    const style = getComputedStyle(topInd);
    expect(style.transition).toContain("transform");
    expect(style.transition).toContain("0.4s");
  });

  it("sits above the lifted active tab instead of being painted over", () => {
    // `.tab.active` (mock-v12.css) carries `z-index: 6` and lifts on its own
    // Y axis -- without a higher z-index the bar would render underneath it.
    const topInd = bar.querySelector(".top-ind") as HTMLElement;
    expect(Number(getComputedStyle(topInd).zIndex)).toBeGreaterThan(6);
  });

  it("never swallows a click meant for the tab beneath it", () => {
    const topInd = bar.querySelector(".top-ind") as HTMLElement;
    expect(getComputedStyle(topInd).pointerEvents).toBe("none");
  });

  it("hides the mock's own per-tab accent bar (documented text-scan exception -- jsdom cannot compute ::after)", () => {
    expect(BRIDGE_CSS).toMatch(/\.tab\.active::after\s*\{\s*display:\s*none;?\s*\}/);
  });
});
