/**
 * The grid-item height clip, resolved through a real cascade -- not read out
 * of the stylesheet text.
 *
 * `.react-grid-item` and `.sec` land on the SAME <section> (react-grid-layout
 * clones the <Card> element SectionList gives it, adding "react-grid-item" to
 * the className Card already turned into "sec" -- there is no separate
 * wrapper div). Card.css used a child combinator, `.react-grid-item > .sec`,
 * which assumes two elements and so never matched anything: the flex-height
 * chain that clips a card's body to its grid cell never activated, and tall
 * cards spilled past their rectangle (block-grid v3, Task 5 finding: 6/8
 * cards spilling). A test that greps the file for the selector text would
 * pass on that broken build, so this one loads the sheet into the document
 * and asks the browser engine what actually applies, same approach as
 * cursor/__tests__/Reticle.shape.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "Card.css"), "utf-8");

let sheet: HTMLStyleElement;
let host: HTMLElement;

beforeAll(() => {
  sheet = document.createElement("style");
  sheet.textContent = CSS;
  document.head.appendChild(sheet);

  // The exact shape react-grid-layout + Card produce: ONE <section> carrying
  // both "react-grid-item" (added by GridItem's clone) and "sec" (Card's
  // own), with .fold > .fold-inner nested inside as Card.tsx renders them.
  host = document.createElement("section");
  host.className = "react-grid-item sec";
  host.innerHTML = '<div class="fold"><div class="fold-inner"></div></div>';
  document.body.appendChild(host);
});

afterAll(() => {
  sheet.remove();
  host.remove();
});

describe("the grid-item height clip applies to the same element, not a parent/child pair", () => {
  it("gives .react-grid-item.sec a full-height column flex box", () => {
    const style = getComputedStyle(host);
    expect(style.height).toBe("100%");
    expect(style.display).toBe("flex");
    expect(style.flexDirection).toBe("column");
    expect(style.minHeight).toBe("0px");
  });

  it("flexes .fold to take the remaining space", () => {
    const fold = host.querySelector(".fold") as HTMLElement;
    const style = getComputedStyle(fold);
    expect(style.flexGrow).toBe("1");
    expect(style.minHeight).toBe("0px");
  });

  it("gives .fold-inner a bounded, scrollable-column height", () => {
    const foldInner = host.querySelector(".fold-inner") as HTMLElement;
    const style = getComputedStyle(foldInner);
    expect(style.height).toBe("100%");
    expect(style.display).toBe("flex");
    expect(style.flexDirection).toBe("column");
  });
});
