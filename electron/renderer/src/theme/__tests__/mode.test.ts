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
    // The window offered four grounds; three of them are night variants. They
    // share one mode until someone asks for separate palettes -- but they must
    // never land in light mode by accident.
    for (const ground of ["dark", "amoled", "deepblue"]) {
      expect(applyMode(ground)).toBe("dark");
    }
  });

  it("falls back to the default ground on an unknown value, without throwing", () => {
    // A hand-edited config file must not leave the window unthemed.
    expect(applyMode("chartreuse")).toBe(GROUND_MODES[DEFAULT_GROUND]);
    expect(document.documentElement.getAttribute("data-mode")).toBe(GROUND_MODES[DEFAULT_GROUND]);
  });

  it("covers every ground the Python config declares", () => {
    // The four documented values of theme_bg in csdm/config.py. A fifth value
    // added there without a mapping here would silently fall back.
    expect(Object.keys(GROUND_MODES).sort()).toEqual(["amoled", "dark", "deepblue", "white"]);
  });
});
