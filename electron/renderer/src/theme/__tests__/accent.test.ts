import { describe, expect, it } from "vitest";

import { ACCENT_PRESETS, resolveAccent } from "../accent";

describe("resolveAccent", () => {
  it("resolves a legacy Tkinter preset name (lowercase) to its Electron hex", () => {
    expect(resolveAccent("green")).toBe("#22C55E");
  });

  it("resolves every preset name Tkinter's config.py can write, case-insensitively", () => {
    // csdm/config.py:39 -- "accent preset or custom hex: green | blue | orange |
    // purple | red | cyan | pink | yellow | #rrggbb"
    const tkinterNames = ["green", "blue", "orange", "purple", "red", "cyan", "pink", "yellow"];
    for (const name of tkinterNames) {
      const preset = ACCENT_PRESETS.find((candidate) => candidate.name.toLowerCase() === name);
      expect(preset, `no Electron preset matches Tkinter name "${name}"`).toBeDefined();
      expect(resolveAccent(name)).toBe(preset!.hex);
      expect(resolveAccent(name.toUpperCase())).toBe(preset!.hex);
    }
  });

  it("passes a hex value through unchanged", () => {
    expect(resolveAccent("#3B82F6")).toBe("#3B82F6");
  });

  it("passes an unrecognised value through unchanged -- hexToRgb still validates it downstream", () => {
    expect(resolveAccent("not-a-colour")).toBe("not-a-colour");
  });
});
