/**
 * What is LEFT in ActionButton.css.
 *
 * The faces (`.btn`, `.ghost`, `.danger`, `.primary`) and the four effect
 * layers (`.bx`, `.fl`, `.brs`, `.sb`) are the approved mock's, held once in
 * theme/mock-v12.css and drift-locked there. This file used to restate the
 * face, the bevel and the pill, and to add a reflection sweep the mock never
 * had. The guard now checks the opposite: that it says none of it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "ActionButton.css"), "utf-8");
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

describe("ActionButton.css re-states nothing the mock already says", () => {
  it("leaves the face, the bevel and the pill to the mock", () => {
    for (const property of [
      "background",
      "clip-path",
      "border-radius",
      "padding",
      "font-family",
      "font-size",
      "letter-spacing",
      "text-transform",
    ]) {
      expect(BARE, `ActionButton.css sets ${property}; the mock's .btn owns it`).not.toMatch(
        new RegExp(`^\\s*${property}\\s*:`, "m"),
      );
    }
  });

  it("no longer carries its own hover effect", () => {
    // The mock answers a hover with the `.bx` glitch grid. The old reflection
    // sweep was a second answer to the same gesture -- and the one entry in
    // no-hover-motion.test.ts's allowlist, now empty.
    expect(BARE).not.toMatch(/sweep/);
    expect(BARE).not.toMatch(/:hover/);
  });
});

describe("ActionButton.css keeps what the mock cannot know", () => {
  it("silences every effect layer on a disabled button", () => {
    expect(BARE).toMatch(/\.btn:disabled \.bx/);
    expect(BARE).toMatch(/\.btn:disabled \.brs/);
  });

  it("keeps a visible keyboard focus ring", () => {
    expect(BARE).toMatch(/\.btn:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
  });

  it("pulses the armed state on a shadow, never on a size", () => {
    const keyframes = BARE.match(/@keyframes armedPulse\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(keyframes, "the armed pulse is gone").not.toBe("");
    expect(keyframes).toMatch(/box-shadow/);
    expect(keyframes).not.toMatch(/transform|width|height|padding/);
  });
});
