/**
 * The ground is configurable per tab.
 *
 * Before this, `BACKDROP` was one global table with no notion of a tab, and
 * `shell/tabs.ts` -- which holds the tabs as data -- carried nothing visual.
 * The two halves existed and had never been joined.
 *
 * What is tested here is the JOIN, not the taste: that a tab's entry really
 * overrides the reference field, that an unknown tab still gets a usable one,
 * and that the drawing maths honours the field it is handed rather than
 * reaching for the global.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TABS } from "../tabs";
import { BACKDROP, BACKDROP_BY_TAB, cellIntensity, fieldForTab } from "../backdropField";

const BACKDROP_TSX = readFileSync(path.join(__dirname, "..", "Backdrop.tsx"), "utf-8");
const APPSHELL_TSX = readFileSync(path.join(__dirname, "..", "AppShell.tsx"), "utf-8");

describe("every tab can name its own ground", () => {
  it("has an entry for each tab the window offers", () => {
    for (const tab of TABS) {
      expect(Object.keys(BACKDROP_BY_TAB)).toContain(tab.id);
    }
  });

  it("fills the gaps from the reference field, so an entry states only what it changes", () => {
    const tags = fieldForTab("tags");
    expect(tags.cell).toBe(BACKDROP_BY_TAB.tags.cell);
    // Never overridden by that tab -- it has to come from the reference.
    expect(tags.plateRadius).toBe(BACKDROP.plateRadius);
    expect(tags.sheen).toBe(BACKDROP.sheen);
  });

  it("gives an unknown or absent tab the reference field rather than nothing", () => {
    expect(fieldForTab(undefined)).toEqual({ ...BACKDROP });
    expect(fieldForTab("no-such-tab")).toEqual({ ...BACKDROP });
  });

  it("really produces different grounds, not four copies", () => {
    const fingerprints = TABS.map((tab) => {
      const field = fieldForTab(tab.id);
      return `${field.cell}/${field.gap}/${field.reach}/${field.threshold}`;
    });
    expect(new Set(fingerprints).size).toBe(TABS.length);
  });
});

describe("the maths honours the field it is handed", () => {
  it("takes the reach from the field, not from the global table", () => {
    // 7 cells away: inside the reference reach (8), outside the tags one (6).
    const args = [7, 0, 0, 0, 0] as const;
    expect(cellIntensity(...args, fieldForTab("capture"))).toBeGreaterThanOrEqual(0);
    expect(cellIntensity(...args, fieldForTab("tags"))).toBe(0);
  });

  it("still works with no field passed, so nothing else had to change", () => {
    expect(cellIntensity(0, 0, 0, 0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("the two ends of the wire are connected", () => {
  it("the shell stamps the open tab on the document", () => {
    expect(APPSHELL_TSX).toMatch(/setAttribute\("data-tab", active\)/);
  });

  it("the backdrop watches for it and re-reads its field", () => {
    expect(BACKDROP_TSX).toMatch(/attributeFilter:[^\]]*"data-tab"/);
    expect(BACKDROP_TSX).toContain("fieldForTab(document.documentElement.dataset.tab)");
  });

  it("the backdrop reaches for no global number any more", () => {
    // A `BACKDROP.` left in the drawing code would silently ignore the tab.
    expect(BACKDROP_TSX).not.toMatch(/\bBACKDROP\./);
  });
});
