/**
 * What is LEFT in Tab.css, and why nothing else may join it.
 *
 * This file used to assert the tab's bevel, its overlap, its band and its
 * opaque active state -- all of them restatements of the approved mock, and
 * all of them now deleted from Tab.css because theme/mock-v12.css says them
 * once (drift-locked by theme/__tests__/mock-v12.test.ts). Re-asserting them
 * here would only prove the copy, which is the habit that cost four restyle
 * passes.
 *
 * So the guard changed shape: the component sheet may only hold what the mock
 * cannot know -- that the tab is a <button>, that a window is tabbed through,
 * that a 2px bar can eat a click.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "Tab.css"), "utf-8");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in Tab.css: ${selector}`);
  return match[1];
}

describe("Tab.css states only what the mock does not", () => {
  it("gives the <button> back the page's font -- a button inherits none", () => {
    expect(block(".tab")).toMatch(/font-family:\s*inherit;/);
    expect(block(".tab")).toMatch(/appearance:\s*none;/);
  });

  it("keeps a visible keyboard focus ring, which the mock has nowhere", () => {
    expect(block(".tab:focus-visible")).toMatch(/outline:.*var\(--focus-ring\)/);
  });

  it("stops the sliding indicator from swallowing clicks", () => {
    expect(block(".ind")).toMatch(/pointer-events:\s*none;/);
  });

  it("re-states none of the mock's geometry, colour or type", () => {
    // The mock owns these. A component sheet that names one of them again is
    // a second copy of the design, which is exactly what drifted before.
    for (const property of [
      "clip-path",
      "background",
      "border",
      "letter-spacing",
      "text-transform",
      "font-size",
      "font-weight",
      "margin-left",
      "transform",
    ]) {
      expect(CSS, `Tab.css re-states ${property}; the mock already says it`).not.toMatch(
        new RegExp(`^\\s*${property}\\s*:`, "m"),
      );
    }
  });
});
