/**
 * Window activity gate: an inactive window asks for no frame and fires no
 * intensity notification, whatever intensity the user chose.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  effectiveIntensity,
  isWindowActive,
  onIntensityChange,
  setIntensity,
  setWindowActive,
} from "../engine";

afterEach(() => {
  setWindowActive(true);
  setIntensity("full");
  vi.restoreAllMocks();
});

describe("an inactive window asks for no frame", () => {
  it("reports none while inactive, whatever the chosen intensity", () => {
    setIntensity("full");
    setWindowActive(false);
    expect(effectiveIntensity()).toBe("none");
  });

  it("restores the chosen intensity when the window comes back", () => {
    setIntensity("sober");
    setWindowActive(false);
    setWindowActive(true);
    // The chosen intensity is untouched: the gate is separate from the choice.
    expect(effectiveIntensity()).toBe("sober");
  });

  it("notifies subscribers, which is how the backdrop stops its loop", () => {
    const seen: string[] = [];
    const stop = onIntensityChange((value) => seen.push(value));
    setWindowActive(false);
    setWindowActive(true);
    stop();
    expect(seen).toEqual(["none", "full"]);
  });

  it("does not notify twice for the same state", () => {
    const seen: string[] = [];
    const stop = onIntensityChange((value) => seen.push(value));
    setWindowActive(false);
    setWindowActive(false);
    stop();
    expect(seen).toEqual(["none"]);
  });

  it("keeps the system preference winning over an active window", () => {
    vi.stubGlobal("matchMedia", (_query: string) => ({ matches: true }));
    setIntensity("full");
    setWindowActive(true);
    expect(effectiveIntensity()).toBe("none");
  });

  it("exposes the gate for tests and for the settings screen", () => {
    setWindowActive(false);
    expect(isWindowActive()).toBe(false);
  });
});
