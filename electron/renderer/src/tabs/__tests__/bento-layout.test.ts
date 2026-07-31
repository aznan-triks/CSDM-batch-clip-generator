/**
 * Every tab panel is a two-column bento grid with a full-width escape hatch.
 *
 * None of the four says so itself any more: they all wear the approved mock's
 * `.bento` and `.wide` (theme/mock-v12.css), which is the whole point of the
 * restyle -- one copy of the rule, in the design. A tab that grows a grid of
 * its own again is drifting, and that is what this catches.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TABS_DIR = path.join(__dirname, "..");
const MOCK = readFileSync(path.join(TABS_DIR, "..", "theme", "mock-v12.css"), "utf-8");

const TABS = ["CaptureTab", "VideoTab", "TagsTab", "SettingsTab"];

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found: ${selector}`);
  return match[1];
}

describe("the mock owns the bento grid", () => {
  it("declares the two columns and the full-width escape hatch", () => {
    expect(block(MOCK, ".bento")).toMatch(/grid-template-columns:\s*1fr 1fr/);
    expect(block(MOCK, ".wide")).toMatch(/grid-column:\s*1 \/ -1/);
  });
});

describe("every tab wears it", () => {
  for (const tab of TABS) {
    const markup = readFileSync(path.join(TABS_DIR, `${tab}.tsx`), "utf-8");

    it(`${tab} mounts on .bento`, () => {
      expect(markup).toMatch(/className="bento[^"]*"/);
    });

    it(`${tab}.css declares no grid of its own`, () => {
      const own = readFileSync(path.join(TABS_DIR, `${tab}.css`), "utf-8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      expect(own).not.toMatch(/grid-template-columns/);
      expect(own, "a second .wide would shadow the mock's").not.toMatch(/^\.wide\s*\{/m);
    });
  }
});

describe("no tab stylesheet re-states the mock's row, label or chip", () => {
  /** Every stylesheet under tabs/, which is where the drift used to collect. */
  const SHEETS = readdirSync(TABS_DIR).filter((name) => name.endsWith(".css"));

  it("found the stylesheets", () => {
    expect(SHEETS.length).toBeGreaterThan(5);
  });

  for (const sheet of SHEETS) {
    it(`${sheet} defines no .row / .lab / .chip / .chips of its own`, () => {
      const css = readFileSync(path.join(TABS_DIR, sheet), "utf-8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      // A scoped refinement (`.player-section #player-search`) is fine; a bare
      // redefinition of the mock's own class is a second copy of the design.
      for (const owned of ["row", "lab", "chip", "chips", "fld", "seg", "sec", "sb"]) {
        expect(css, `${sheet} redefines .${owned}`).not.toMatch(
          new RegExp(`(^|[,}])\\s*\\.${owned}\\s*[,{]`, "m"),
        );
      }
    });
  }
});
