/**
 * `--accent` itself must follow the chosen colour, not just `--accent-soft`.
 *
 * Found live (2026-08-10): `--accent-soft` was correctly derived from `--gold`
 * here, but the raw `--accent` token was never given the same treatment --
 * it fell through to mock-v12.css's own `--accent: #2563EB` literal. Every
 * app-owned stylesheet reading `var(--accent)` directly (AppShell.css's
 * split-handle, Card.css's hover corner brackets and header separator,
 * StatStrip.css's coloured figure) stayed the mock's electric blue no matter
 * what the user picked, while everything reading `--gold` correctly changed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TOKENS = readFileSync(path.join(__dirname, "..", "tokens.css"), "utf-8");

describe("--accent is derived from --gold, not left to the mock's literal", () => {
  it("declares --accent in tokens.css, referencing var(--gold)", () => {
    const declarations = [...TOKENS.matchAll(/--accent:\s*([^;]+);/g)].map((match) => match[1]);
    expect(declarations.length).toBeGreaterThan(0);
    for (const value of declarations) {
      expect(value).toContain("var(--gold)");
    }
  });

  it("is declared after mock-v12.css and mock-bridge.css load (main.tsx import order)", () => {
    // tokens.css must win the cascade over mock-v12.css's own `--accent`
    // literal, which only holds if it imports LAST among the three -- see
    // context_guide.md's own gotcha on import order deciding cascade order,
    // not source position relative to `import App`.
    const main = readFileSync(path.join(__dirname, "..", "..", "main.tsx"), "utf-8");
    const mockIndex = main.indexOf('"./theme/mock-v12.css"');
    const bridgeIndex = main.indexOf('"./theme/mock-bridge.css"');
    const tokensIndex = main.indexOf('"./theme/tokens.css"');
    expect(mockIndex).toBeGreaterThan(-1);
    expect(bridgeIndex).toBeGreaterThan(-1);
    expect(tokensIndex).toBeGreaterThan(mockIndex);
    expect(tokensIndex).toBeGreaterThan(bridgeIndex);
  });
});
