/**
 * The reticle's SHAPE, resolved through a real cascade -- not read out of the
 * stylesheet text.
 *
 * Reticle.css has said `border-right: none` on `.rc-tl` since it was written,
 * and the reticle still drew four solid squares: `.cursor-reticle span`
 * (specificity 0,1,1) sets the `border` shorthand and beats `.rc-tl` (0,1,0).
 * A test that greps the file passes on the broken build -- the existing
 * Reticle.css.test.ts is proof. So this one loads the sheet into the document
 * and asks the browser engine what actually applies.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "Reticle.css"), "utf-8");

/** top / right / bottom / left, as the cascade resolves them. */
function borderStyles(className: string): string[] {
  const host = document.querySelector(".cursor-reticle")!;
  const piece = host.querySelector(`.${className}`)!;
  const style = getComputedStyle(piece);
  return [
    style.borderTopStyle,
    style.borderRightStyle,
    style.borderBottomStyle,
    style.borderLeftStyle,
  ];
}

/**
 * jsdom drops a shorthand that contains `var()` -- `border: var(--bw-accent)
 * solid var(--gold)` resolves to nothing at all, which makes every side read
 * `none` and the probe measure air. Substituting the four custom properties
 * for their real values from theme/tokens.css keeps the CASCADE intact (the
 * selectors, their specificity and their order are untouched) while giving
 * jsdom declarations it can actually parse.
 */
const RESOLVED = CSS.replace(/var\(--bw-accent\)/g, "2px")
  .replace(/var\(--gold\)/g, "#2563eb")
  .replace(/var\(--dur-fast\)/g, "0s")
  .replace(/var\(--ease\)/g, "linear");

let sheet: HTMLStyleElement;

beforeAll(() => {
  sheet = document.createElement("style");
  sheet.textContent = RESOLVED;
  document.head.appendChild(sheet);

  const host = document.createElement("div");
  host.className = "cursor-reticle";
  host.innerHTML =
    '<span class="rc-tl"></span><span class="rc-tr"></span>' +
    '<span class="rc-bl"></span><span class="rc-br"></span><span class="rc-dot"></span>';
  document.body.appendChild(host);
});

afterAll(() => {
  sheet.remove();
  document.querySelector(".cursor-reticle")?.remove();
});

describe("each corner draws an angle, not a square", () => {
  // Same shape as the card bracket the user pointed at: `.cbr.tl` resolves to
  // solid/none/none/solid.
  it.each([
    ["rc-tl", ["solid", "none", "none", "solid"]],
    ["rc-tr", ["solid", "solid", "none", "none"]],
    ["rc-bl", ["none", "none", "solid", "solid"]],
    ["rc-br", ["none", "solid", "solid", "none"]],
  ])("%s keeps exactly two of its four borders", (className, expected) => {
    expect(borderStyles(className as string)).toEqual(expected);
  });
});

describe("the centre dot is a dot", () => {
  it("carries no border at all", () => {
    expect(borderStyles("rc-dot")).toEqual(["none", "none", "none", "none"]);
  });
});
