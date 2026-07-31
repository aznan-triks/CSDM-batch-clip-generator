/**
 * Every tab panel is a two-column bento grid with a full-width escape hatch.
 *
 * The Capture tab no longer says so itself: it wears the approved mock's own
 * `.bento` and `.wide` (theme/mock-v12.css), which is the whole point of the
 * restyle -- one copy of the rule, in the design. The other three tabs still
 * carry their own copy and are checked as before until they are ported too.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TABS_DIR = path.join(__dirname, "..");

/** Tabs still holding their own grid rule. Each one that gets ported leaves. */
const NOT_YET_ON_THE_MOCKS_BENTO = [
  { css: "TagsTab.css", root: ".tags-tab" },
  { css: "VideoTab.css", root: ".video-tab" },
  { css: "SettingsTab.css", root: ".settings-tab" },
];

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found: ${selector}`);
  return match[1];
}

describe("the Capture tab takes its grid from the mock", () => {
  const MOCK = readFileSync(path.join(TABS_DIR, "..", "theme", "mock-v12.css"), "utf-8");
  const MARKUP = readFileSync(path.join(TABS_DIR, "CaptureTab.tsx"), "utf-8");

  it("wears `.bento` rather than declaring a grid of its own", () => {
    expect(MARKUP).toMatch(/className="bento[^"]*"/);
    expect(block(MOCK, ".bento")).toMatch(/grid-template-columns:\s*1fr 1fr/);
  });

  it("has the mock's full-width escape hatch available to it", () => {
    expect(block(MOCK, ".wide")).toMatch(/grid-column:\s*1 \/ -1/);
    expect(MARKUP).toMatch(/className="wide"/);
  });

  it("declares no competing grid in its own stylesheet", () => {
    const own = readFileSync(path.join(TABS_DIR, "CaptureTab.css"), "utf-8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(own).not.toMatch(/grid-template-columns/);
  });
});

describe("the tabs not yet ported keep their own bento grid", () => {
  for (const panel of NOT_YET_ON_THE_MOCKS_BENTO) {
    const css = readFileSync(path.join(TABS_DIR, panel.css), "utf-8");

    it(`${panel.css}'s ${panel.root} is a 2-column grid, not a flex column`, () => {
      const rule = block(css, panel.root);
      expect(rule).toMatch(/display:\s*grid;/);
      expect(rule).toMatch(/grid-template-columns:\s*1fr 1fr;/);
      expect(rule).not.toMatch(/display:\s*flex;/);
    });

    it(`${panel.css} declares a .wide escape hatch that spans both columns`, () => {
      expect(css).toMatch(/\.wide\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*\}/);
    });
  }
});
