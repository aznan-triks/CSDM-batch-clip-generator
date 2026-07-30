import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = path.join(__dirname, "..", "AppShell.css");
const CSS = readFileSync(CSS_PATH, "utf-8");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in AppShell.css: ${selector}`);
  return match[1];
}

describe("the page body's base font is the sans face, like the mock", () => {
  const rule = block("body");

  it("uses the sans display stack, not monospace", () => {
    // The mock's `body { font-family: var(--font) }` is the Inter sans stack;
    // mono is the exception (console, buttons, numeric values), never the base.
    // A monospace body makes every un-overridden label render like a terminal,
    // which is exactly the "nothing like the mock" regression this guards.
    expect(rule).toMatch(/font-family:\s*var\(--font-display\);/);
    expect(rule).not.toMatch(/font-family:\s*var\(--font-mono\);/);
  });
});
