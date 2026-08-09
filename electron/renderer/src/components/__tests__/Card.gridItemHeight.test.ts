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
  // own), with .fold > .fold-inner > .sb.sb-scroll nested inside exactly as
  // Card.tsx renders them (the `.sb sb-scroll` div wrapping `children`,
  // Card.tsx line ~140). `.sb-scroll` is the element the spill bug actually
  // manifested in -- it's the one `overflow-y: auto` is declared on -- so
  // stopping the constructed host at `.fold-inner` (as an earlier version of
  // this test did) would pass even if a future change broke `.sb-scroll`'s
  // own rule or its nesting under `.fold-inner`, while reintroducing the
  // spill.
  host = document.createElement("section");
  host.className = "react-grid-item sec";
  host.innerHTML = '<div class="fold"><div class="fold-inner"><div class="sb sb-scroll"></div></div></div>';
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

  // The innermost element -- `.sb.sb-scroll`, the one `overflow-y: auto` is
  // actually declared on and where the spill bug visibly manifested (card
  // bodies bleeding into the card below with no scrollbar at all). Its own
  // rule (`.sb-scroll` in Card.css) is a plain class selector, untouched by
  // this fix and unconditionally present in the cascade regardless of the
  // `.react-grid-item`/`.sec` selector bug -- what this fix actually buys it
  // is a bounded ANCESTOR: `flex: 1 1 auto` only shrinks/grows an element
  // inside a flex *container* with a resolvable height, which is exactly the
  // `.fold-inner` flex-column context the two tests above confirm now
  // exists. jsdom performs no real layout, so it cannot echo a resolved
  // pixel height here (there IS no `height` declaration on `.sb-scroll` for
  // it to echo -- the bound comes from flex distribution, which is a layout
  // computation, not a cascade one); that resolved-pixel proof was done
  // separately in a real browser (grid-v3-proof.mjs's re-run, see
  // task-6-report.md: `.sb-scroll`'s own rect stayed bounded to the card
  // while its scrollHeight exceeded its clientHeight). What IS a real,
  // checkable cascade fact -- and what a future regression breaking either
  // `.sb-scroll`'s own rule or its position under `.fold-inner` would flip --
  // is that `overflow-y: auto`, `flex: 1 1 auto` and `min-height: 0` all
  // still apply to the exact `.fold-inner > .sb.sb-scroll` element Card.tsx
  // renders.
  it("engages overflow-y:auto and a shrinkable flex-basis on the actual .sb.sb-scroll element", () => {
    const foldInner = host.querySelector(".fold-inner") as HTMLElement;
    const sbScroll = foldInner.querySelector(".sb.sb-scroll") as HTMLElement;
    expect(sbScroll).not.toBeNull();
    expect(sbScroll.parentElement).toBe(foldInner);
    const style = getComputedStyle(sbScroll);
    expect(style.overflowY).toBe("auto");
    expect(style.flexGrow).toBe("1");
    expect(style.minHeight).toBe("0px");
  });
});
