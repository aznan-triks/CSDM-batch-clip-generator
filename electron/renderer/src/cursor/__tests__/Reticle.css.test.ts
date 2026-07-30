import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = path.join(__dirname, "..", "Reticle.css");
const CSS = readFileSync(CSS_PATH, "utf-8");

function mediaBlock(query: string): string {
  const marker = `@media ${query} {`;
  const start = CSS.indexOf(marker);
  if (start === -1) throw new Error(`media query not found in Reticle.css: ${query}`);
  // Balance braces from the opening one, since the block contains nested rules.
  let depth = 0;
  let i = start + marker.length - 1; // at the opening "{"
  for (; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    if (CSS[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return CSS.slice(start + marker.length, i);
}

describe("@media (hover: none) hides the reticle AND restores the native cursor", () => {
  const block = mediaBlock("(hover: none)");

  it("still hides the reticle element", () => {
    expect(block).toMatch(/\.reticle\s*\{[^}]*display:\s*none;/);
  });

  it("restores the native cursor instead of leaving cursor:none active", () => {
    expect(block).toMatch(/body\.customcursor\s*\{[^}]*cursor:\s*auto;/);
  });
});
