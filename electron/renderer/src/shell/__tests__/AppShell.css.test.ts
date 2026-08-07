/**
 * The page's base face, guarded across the two files that decide it.
 *
 * The regression this exists for: a monospace base made every un-overridden
 * label render like a terminal, the opposite of the soft-HUD look. The face is
 * no longer set in AppShell.css -- the approved mock sets it (`body {
 * font-family: var(--font) }`) and the bridge points `--font` at the sans
 * display stack. So the guard follows that chain instead of one declaration,
 * and then checks that the window does not quietly override it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const THEME = path.join(__dirname, "..", "..", "theme");
const APP_SHELL_CSS = readFileSync(path.join(__dirname, "..", "AppShell.css"), "utf-8");
const MOCK_CSS = readFileSync(path.join(THEME, "mock-v12.css"), "utf-8");
const BRIDGE_CSS = readFileSync(path.join(THEME, "mock-bridge.css"), "utf-8");

/** Comments out -- a comment quoting a rule is prose, and prose styles nothing. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The rules that apply at every width: `@media` blocks removed. */
const baseLayer = (css: string) => stripComments(css).replace(/@media[^{]*\{[\s\S]*?\n\}/g, "");

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stripComments(css).match(
    new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"),
  );
  if (!match) throw new Error(`selector not found: ${selector}`);
  return match[1];
}

describe("the page body's base font is the sans face, like the mock", () => {
  it("takes its face from the mock's own body rule", () => {
    expect(block(MOCK_CSS, "body")).toMatch(/font-family:\s*var\(--font\)/);
  });

  it("bridges the mock's --font to the sans display stack, never to mono", () => {
    expect(BRIDGE_CSS).toMatch(/--font:\s*var\(--font-display\);/);
    expect(BRIDGE_CSS).not.toMatch(/--font:\s*var\(--font-mono\);/);
  });

  it("is never overridden back to monospace by the window's own sheet", () => {
    expect(stripComments(APP_SHELL_CSS)).not.toMatch(/font-family/);
  });
});

describe("AppShell.css states only what the mock cannot know", () => {
  it("keeps the base SIZE, which the mock never sets at all", () => {
    // The mock leaves unstyled text at the browser's 16px; this window is
    // denser on purpose. That is a decision, not a copy.
    expect(block(APP_SHELL_CSS, "body")).toMatch(/font-size:\s*var\(--fs-base\);/);
  });

  it("re-states none of the mock's frame at full width", () => {
    // The narrow-window `@media` block is exempt on purpose: collapsing the
    // two columns to one is a case the mock, a fixed-width picture, never had
    // to answer.
    const base = baseLayer(APP_SHELL_CSS);
    for (const selector of [".app {", ".shell {", ".scrollwrap {", ".amb {"]) {
      expect(base, `AppShell.css re-declares ${selector}`).not.toContain(selector);
    }
  });
});

describe("the narrow window keeps the console reachable (regression 2026-08-07)", () => {
  // Below 1000px the console must STACK below the workspace, never vanish:
  // `display: none` on `.console` left the only record of a run unreachable
  // between the 900px minimum and the 1000px breakpoint. The split handle
  // still hides (nothing to drag when the columns are stacked).
  const media = stripComments(APP_SHELL_CSS).match(/@media \(max-width: 1000px\) \{\s*([\s\S]*?)\n\}/)?.[1] ?? "";

  it("stacks the console as a second row under the workspace", () => {
    expect(media).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)\s*minmax\(160px,\s*38%\)/);
  });

  it("never hides the console itself", () => {
    expect(media).not.toMatch(/\.console\s*\{[^}]*display:\s*none/);
    expect(media).not.toMatch(/\.console,/);
  });

  it("hides only the split handle, which has nothing to drag stacked", () => {
    expect(media).toMatch(/\.split-handle\s*\{[^}]*display:\s*none/);
  });
});
