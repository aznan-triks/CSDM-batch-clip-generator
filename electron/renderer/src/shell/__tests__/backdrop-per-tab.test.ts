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
import { BACKDROP, BACKDROP_BY_TAB, cellIntensity, drawMotif, fieldForTab } from "../backdropField";

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
      return `${field.cell}/${field.gap}/${field.reach}/${field.threshold}/${field.motif}`;
    });
    expect(new Set(fingerprints).size).toBe(TABS.length);
  });

  it("gives each tab its own mark on the ground", () => {
    // "pas d'icônes ni de motif dessus" -- the ground carried plates and
    // scanlines and nothing else.
    const motifs = TABS.map((tab) => fieldForTab(tab.id).motif);
    expect(motifs.every((motif) => motif !== "none")).toBe(true);
    expect(new Set(motifs).size).toBe(TABS.length);
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

describe("the mark is drawn, and only from the field", () => {
  /** A canvas context that records which primitives were asked for. */
  function spy() {
    const calls: string[] = [];
    const record = (name: string) => (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => Math.round(Number(a) * 100) / 100).join(",")})`);
    };
    return {
      calls,
      ctx: {
        beginPath: record("beginPath"),
        moveTo: record("moveTo"),
        lineTo: record("lineTo"),
        stroke: record("stroke"),
        arc: record("arc"),
        fill: record("fill"),
      } as unknown as CanvasRenderingContext2D,
    };
  }

  it.each(["crosshair", "hatch", "dots", "bracket"] as const)("%s draws something", (motif) => {
    const { calls, ctx } = spy();
    drawMotif(ctx, motif, 0, 0, 34);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("draws nothing for `none`", () => {
    const { calls, ctx } = spy();
    drawMotif(ctx, "none", 0, 0, 34);
    expect(calls).toEqual([]);
  });

  it("scales with the plate, so a tab can pick any cell size", () => {
    const small = spy();
    const large = spy();
    drawMotif(small.ctx, "crosshair", 0, 0, 20);
    drawMotif(large.ctx, "crosshair", 0, 0, 60);
    expect(small.calls).not.toEqual(large.calls);
    expect(small.calls.length).toBe(large.calls.length);
  });

  it("stays inside its plate", () => {
    const { calls, ctx } = spy();
    const size = 40;
    drawMotif(ctx, "bracket", 0, 0, size);
    const numbers = calls.flatMap((call) => (call.match(/-?\d+\.?\d*/g) ?? []).map(Number));
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(size);
  });
});
