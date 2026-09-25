import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { asNumber } from "../asNumber";

const TABS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tabs");

describe("asNumber", () => {
  it("reads numbers and the strings a text field leaves behind", () => {
    expect(asNumber(42, 0)).toBe(42);
    expect(asNumber("1920", 0)).toBe(1920);
    expect(asNumber("2.5", 0)).toBe(2.5);
  });

  it("falls back on anything that is not a finite number", () => {
    for (const bad of ["abc", undefined, {}, NaN, Infinity]) {
      expect(asNumber(bad, 7)).toBe(7);
    }
  });

  it("is the only copy: no tab defines its own", () => {
    for (const tab of ["CaptureTab.tsx", "VideoTab.tsx", "SettingsTab.tsx"]) {
      const source = readFileSync(path.join(TABS, tab), "utf8");
      expect(source, tab).not.toMatch(/function asNumber\(/);
    }
  });
});
