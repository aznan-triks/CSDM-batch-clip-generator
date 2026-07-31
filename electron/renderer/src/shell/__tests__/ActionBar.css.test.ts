/**
 * What is LEFT in ActionBar.css.
 *
 * The band's whole look -- the frosted ground, the top hairline, the upward
 * lift, the accent line -- is the approved mock's `.actbar`, held in
 * theme/mock-v12.css and drift-locked by theme/__tests__/mock-v12.test.ts.
 * This file used to restate all four, which is how a component sheet and the
 * design start disagreeing. The guard now checks the opposite: that it says
 * none of it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "ActionBar.css"), "utf-8");

describe("ActionBar.css re-states nothing the mock already says", () => {
  it("leaves the band's ground, hairline and lift to the mock", () => {
    for (const property of ["background", "backdrop-filter", "border-top", "box-shadow", "padding"]) {
      expect(CSS, `ActionBar.css sets ${property}; the mock's .actbar owns it`).not.toMatch(
        new RegExp(`^\\s*${property}\\s*:`, "m"),
      );
    }
  });

  it("no longer claims a grid area -- the band IS the shell's third row", () => {
    expect(CSS).not.toMatch(/grid-area/);
  });
});

describe("no :hover rule in ActionBar.css moves anything", () => {
  it("has no :hover selector at all in this file", () => {
    // The buttons themselves (ActionButton.css) carry the one allowed sweep;
    // the band around them never should.
    expect(CSS).not.toMatch(/:hover/);
  });
});
