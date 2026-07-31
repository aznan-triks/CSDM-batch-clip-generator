/**
 * What is LEFT in Card.css.
 *
 * The glass, the rim, the radius, the lift, the glitch veil, the corner
 * brackets, the header row and the spotlight are the approved mock's `.sec`
 * family, held once in theme/mock-v12.css and drift-locked there. This file
 * used to restate all of them; the guard now checks that it does not.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "Card.css"), "utf-8");
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `property: value` declaration, in source order. */
function declarations(css: string): [string, string][] {
  return [...css.matchAll(/^[ \t]*([a-z-]+)[ \t]*:[ \t]*([^;]+);/gm)].map((m) => [
    m[1],
    m[2].trim(),
  ]);
}

/** Values that paint nothing -- a reset, not a restatement of the design. */
const PAINTS_NOTHING = ["none", "transparent", "0", "inherit", "contents"];

describe("Card.css re-states nothing the mock already says", () => {
  it("leaves the card's face, rim, radius and lift to the mock", () => {
    const owned = ["background", "border", "border-radius", "box-shadow", "backdrop-filter"];
    for (const [property, value] of declarations(BARE)) {
      if (!owned.includes(property)) continue;
      expect(
        PAINTS_NOTHING,
        `Card.css paints ${property}: ${value}; the mock's .sec owns it`,
      ).toContain(value);
    }
  });

  it("draws the corner brackets and the veil as the mock's own elements", () => {
    // They were pseudo-elements here, which could carry the corners but not
    // the flicker the mock gives them. Card.tsx renders `.cbr` and `.glx` now.
    expect(BARE).not.toMatch(/::before|::after/);
  });
});

describe("Card.css keeps what the mock cannot know", () => {
  it("strips the heading's box while keeping the heading", () => {
    // The mock's header is one element. Here a real <h5> wraps a real
    // <button>, so the heading gives up its box and the button becomes the
    // row: a flex row laid out inside a block heading is not a flex row.
    expect(BARE).toMatch(/\.panel-heading\s*\{[^}]*display:\s*contents;/);
  });

  it("resets the header button and gives it a focus ring", () => {
    expect(BARE).toMatch(/\.sh\s*\{[^}]*appearance:\s*none;/);
    expect(BARE).toMatch(/\.sh:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
  });

  it("stacks a card body's rows, which the mock spells out card by card", () => {
    expect(BARE).toMatch(/\.sb\s*\{[^}]*flex-direction:\s*column;/);
  });
});
