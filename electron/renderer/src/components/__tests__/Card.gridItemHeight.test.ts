/**
 * The grid-item height clip, resolved through a real cascade -- not read out
 * of the stylesheet text.
 *
 * `.react-grid-item` is the wrapper `<div>` SectionList renders around each
 * card (added 2026-08-10 so react-resizable's handle lands as a DOM sibling
 * of Card instead of inside Card's own `children` -- cloning a component
 * overwrites its `children` prop, which is how the handle used to end up
 * inside `.sb-scroll`). `.sec` is the Card underneath it. Card.css therefore
 * uses a real child combinator, `.react-grid-item > .sec`. A test that greps
 * the file for the selector text would pass on a build where the wrapper was
 * removed and the selector silently stopped matching, so this one loads the
 * sheet into the document and asks the browser engine what actually applies,
 * same approach as cursor/__tests__/Reticle.shape.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "Card.css"), "utf-8");

let sheet: HTMLStyleElement;
let wrapper: HTMLElement;

beforeAll(() => {
  sheet = document.createElement("style");
  sheet.textContent = CSS;
  document.head.appendChild(sheet);

  // The exact shape SectionList + Card produce since 2026-08-10: a wrapper
  // <div class="react-grid-item"> (react-grid-layout's own clone target)
  // containing a <section class="sec"> (Card's own element), with
  // .fold > .fold-inner > .sb.sb-scroll nested inside exactly as Card.tsx
  // renders them.
  wrapper = document.createElement("div");
  wrapper.className = "react-grid-item";
  wrapper.innerHTML =
    '<section class="sec"><div class="fold"><div class="fold-inner"><div class="sb sb-scroll"></div></div></div></section>';
  document.body.appendChild(wrapper);
});

afterAll(() => {
  sheet.remove();
  wrapper.remove();
});

describe("the grid-item height clip applies through a real parent/child pair", () => {
  it("gives .sec (inside .react-grid-item) a full-height column flex box", () => {
    const sec = wrapper.querySelector(".sec") as HTMLElement;
    const style = getComputedStyle(sec);
    expect(style.height).toBe("100%");
    expect(style.display).toBe("flex");
    expect(style.flexDirection).toBe("column");
    expect(style.minHeight).toBe("0px");
  });

  it("flexes .fold to take the remaining space", () => {
    const fold = wrapper.querySelector(".fold") as HTMLElement;
    const style = getComputedStyle(fold);
    expect(style.flexGrow).toBe("1");
    expect(style.minHeight).toBe("0px");
  });

  it("gives .fold-inner a bounded, scrollable-column height", () => {
    const foldInner = wrapper.querySelector(".fold-inner") as HTMLElement;
    const style = getComputedStyle(foldInner);
    expect(style.height).toBe("100%");
    expect(style.display).toBe("flex");
    expect(style.flexDirection).toBe("column");
  });

  it("engages overflow-y:auto and a shrinkable flex-basis on the actual .sb.sb-scroll element", () => {
    const foldInner = wrapper.querySelector(".fold-inner") as HTMLElement;
    const sbScroll = foldInner.querySelector(".sb.sb-scroll") as HTMLElement;
    expect(sbScroll).not.toBeNull();
    expect(sbScroll.parentElement).toBe(foldInner);
    const style = getComputedStyle(sbScroll);
    expect(style.overflowY).toBe("auto");
    expect(style.flexGrow).toBe("1");
    expect(style.minHeight).toBe("0px");
  });

  it("the height chain targets the card inside the grid item, not the item itself", () => {
    // The compound form (`.react-grid-item.sec`) matched when the two were
    // one element. They are parent and child since the resize handle moved
    // onto the frame; a stale compound selector matches nothing and the
    // card silently renders at natural height again.
    expect(CSS).toMatch(/\.react-grid-item\s*>\s*\.sec\s*\{/);
    expect(CSS).not.toMatch(/\.react-grid-item\.sec\s*\{/);
  });
});
