/**
 * A night ground preset must never land the window in light mode.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { applyMode, DEFAULT_GROUND, GROUND_MODES } from "../mode";

describe("applyMode maps the theme_bg setting onto the document", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-mode");
  });

  it("puts the window in light mode for the white ground", () => {
    expect(applyMode("white")).toBe("light");
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
  });

  it("puts the window in dark mode for the dark ground", () => {
    expect(applyMode("dark")).toBe("dark");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });

  it("treats every night preset as dark", () => {
    // The window offers five grounds; four of them are night variants
    // (`terminal` is a dark green terminal look, BG #0a0c10). They share one
    // mode until someone asks for separate palettes -- but they must never
    // land in light mode by accident.
    for (const ground of ["dark", "amoled", "deepblue", "terminal"]) {
      expect(applyMode(ground)).toBe("dark");
    }
  });

  it("defaults to light mode, like the V12 mock (which boots apply('Light'))", () => {
    // The mock is the reference and it opens in light mode. A fresh install
    // must match it, not the legacy Tkinter dark default.
    expect(GROUND_MODES[DEFAULT_GROUND]).toBe("light");
  });

  it("falls back to the default ground on an unknown value, without throwing", () => {
    // A hand-edited config file must not leave the window unthemed.
    expect(applyMode("chartreuse")).toBe(GROUND_MODES[DEFAULT_GROUND]);
    expect(document.documentElement.getAttribute("data-mode")).toBe(GROUND_MODES[DEFAULT_GROUND]);
  });

  it("covers every ground the Python theme presets declare", () => {
    // The real source of truth is `_BG_PRESETS` in csdm/theme.py (the themes
    // the Tkinter UI actually offers), NOT the config.py comment -- which lists
    // only four and omits `terminal`, the very value a real saved config used.
    // A theme added there without a mapping here would silently fall back.
    expect(Object.keys(GROUND_MODES).sort()).toEqual(["amoled", "dark", "deepblue", "terminal", "white"]);
  });
});
