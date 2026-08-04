/**
 * The measured disagreements in mock-bridge.css that are full rules, not
 * token remaps (2026-08-02, AUDIT_restyle6_polish_regressions.md).
 *
 * jsdom has no layout engine (no real CSS Grid sizing), so this cannot
 * measure an actual rendered height the way a browser would -- it checks the
 * cascade text itself, same style as Card.css.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "mock-bridge.css"), "utf-8");

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in mock-bridge.css: ${selector}`);
  return match[1];
}

describe("bento rows do not stretch every card to the tallest one", () => {
  it("overrides CSS Grid's default stretch with align-items: start", () => {
    expect(block(CSS, ".bento")).toMatch(/align-items:\s*start;/);
  });

  it("does not touch grid-template-columns or .wide -- those stay the mock's", () => {
    expect(CSS).not.toMatch(/grid-template-columns/);
    expect(CSS).not.toMatch(/^\.wide\s*\{/m);
  });
});

describe("the card fold animates instead of the mock's display:none snap (2026-08-04)", () => {
  it("folds the body through a 1fr->0fr grid row transition", () => {
    expect(block(CSS, ".sec .fold")).toMatch(/display:\s*grid;/);
    expect(block(CSS, ".sec .fold")).toMatch(/grid-template-rows:\s*1fr;/);
    expect(block(CSS, ".sec .fold")).toMatch(/transition:\s*grid-template-rows/);
    expect(block(CSS, ".sec.closed .fold")).toMatch(/grid-template-rows:\s*0fr;/);
  });

  it("clips the shrinking row and cancels the mock's display:none on .sb", () => {
    expect(block(CSS, ".sec .fold-inner")).toMatch(/overflow:\s*hidden;/);
    expect(block(CSS, ".sec.closed .fold-inner .sb")).toMatch(/display:\s*block;/);
  });

  it("reuses the mock's own motion vocabulary -- no new duration number", () => {
    expect(CSS).toMatch(/grid-template-rows 0\.25s var\(--ease\)/);
    expect(CSS).not.toMatch(/grid-template-rows\s[^;]*\d+ms/);
  });
});
