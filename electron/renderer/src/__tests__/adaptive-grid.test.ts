/**
 * Adaptive bento grid (workspace-vivant §A1). jsdom does not evaluate
 * `repeat(auto-fit, ...)`, so this locks the layout by reading the raw CSS
 * text -- the same guard style as the responsive AppShell.css tests.
 *
 * The mock keeps its own `grid-template-columns: 1fr 1fr` (it is the frozen
 * design, never edited); the bridge is the ONE place allowed to override it
 * with the adaptive track. It also asserts `grid-auto-flow: dense` is gone
 * from the two tabs that used it: cards must never move without an explicit
 * gesture.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BRIDGE = readFileSync(
  path.join(__dirname, "..", "theme", "mock-bridge.css"),
  "utf-8",
);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function blocks(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (m) => m[1],
  );
}

describe("the bento grid is adaptive (mock-bridge.css)", () => {
  it("overrides the mock's fixed 1fr 1fr with auto-fit + minmax", () => {
    const bento = stripComments(BRIDGE);
    // mock-bridge.css has two `.bento` blocks (align-items + the adaptive
    // track); the adaptive track is present in at least one of them.
    expect(
      blocks(bento, ".bento").some((b) =>
        b.match(
          /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*400px\),\s*1fr\)\)/,
        ),
      ),
    ).toBe(true);
  });

  it("keeps .wide spanning every track (full width unchanged)", () => {
    // .wide lives in the mock; the adaptive grid must not remove its meaning.
    const mock = readFileSync(
      path.join(__dirname, "..", "theme", "mock-v12.css"),
      "utf-8",
    );
    expect(mock).toMatch(/\.wide\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });
});

describe("cards never auto-fill holes (workspace-vivant §A1)", () => {
  it("no grid-auto-flow: dense in CaptureTab.css or TagsTab.css", () => {
    for (const sheet of ["CaptureTab.css", "TagsTab.css"]) {
      const css = stripComments(
        readFileSync(path.join(__dirname, "..", "tabs", sheet), "utf-8"),
      );
      expect(css, `${sheet} still carries grid-auto-flow: dense`).not.toMatch(
        /grid-auto-flow:\s*dense/,
      );
    }
  });
});
