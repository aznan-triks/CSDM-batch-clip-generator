import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TABS_DIR = path.join(__dirname, "..");

const PANELS = [
  { css: "CaptureTab.css", root: ".capture-tab" },
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

describe("every tab panel is a densified bento grid", () => {
  for (const panel of PANELS) {
    const css = readFileSync(path.join(TABS_DIR, panel.css), "utf-8");

    it(`${panel.css}'s ${panel.root} is a 2-column grid, not a flex column`, () => {
      const rule = block(css, panel.root);
      expect(rule).toMatch(/display:\s*grid;/);
      expect(rule).toMatch(/grid-template-columns:\s*1fr 1fr;/);
      expect(rule).not.toMatch(/display:\s*flex;/);
    });
  }

  // CaptureTab's sections are Cards now, like every other tab's, so it uses
  // the same `.wide` escape hatch instead of naming each section by hand.
  for (const panel of PANELS) {
    it(`${panel.css} declares a .wide escape hatch that spans both columns`, () => {
      const css = readFileSync(path.join(TABS_DIR, panel.css), "utf-8");
      expect(css).toMatch(/\.wide\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*\}/);
    });
  }
});
