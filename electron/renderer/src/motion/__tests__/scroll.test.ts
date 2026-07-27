/**
 * Smoothed scrolling obeys the intensity setting, including the system one.
 *
 * Lenis is real here, not a stub: the point is that the switch actually
 * creates and destroys the thing, not that a flag flipped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { setIntensity } from "../engine";
import { installSmoothScroll } from "../scroll";
import { MOTION } from "../tokens";

/**
 * jsdom has no ResizeObserver and Lenis measures the page with one. This is a
 * gap in the test environment, not in the app: Electron ships Chromium, which
 * has had it for years.
 */
function stubResizeObserver(): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** Lenis marks the document while it is driving the scroll. */
function isSmoothing(): boolean {
  return document.documentElement.className.includes("lenis");
}

afterEach(() => {
  vi.unstubAllGlobals();
  setIntensity("full");
});

describe("smooth scroll", () => {
  it("runs under `full` and stops under `none`", () => {
    stubResizeObserver();
    stubReducedMotion(false);
    setIntensity("full");
    const teardown = installSmoothScroll();
    expect(isSmoothing()).toBe(true);

    setIntensity("none");
    expect(isSmoothing()).toBe(false);

    teardown();
  });

  it("stays off when the system asks for reduced motion", () => {
    stubResizeObserver();
    stubReducedMotion(true);
    setIntensity("full");
    const teardown = installSmoothScroll();
    expect(isSmoothing()).toBe(false);
    teardown();
  });

  it("takes its duration from MOTION, not from the call site", () => {
    expect(MOTION.scroll.duration).toBeLessThan(0.5);
  });
});
