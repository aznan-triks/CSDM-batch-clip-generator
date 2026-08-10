/**
 * `.player-section` and `.ps-list` join Card.css's own flex chain, resolved
 * through a real cascade -- not read out of the stylesheet text.
 *
 * `.sb.sb-scroll` (Card.css) is `flex-grow:1; min-height:0`, but a single
 * flex child does not stretch on its own (flex-grow:0 by default) -- without
 * `.player-section` itself carrying `flex-grow:1; min-height:0`, the whole
 * chain dead-ends one level too early and `.ps-list` never sees the card's
 * real height. Same approach as Card.gridItemHeight.test.ts, and for the
 * same reason recorded in §10: a sheet that merely CONTAINS a property
 * proves nothing about what applies through a real parent/child pair.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CARD_CSS = readFileSync(path.join(__dirname, "..", "..", "components", "Card.css"), "utf-8");
const PLAYER_CSS = readFileSync(path.join(__dirname, "..", "PlayerSection.css"), "utf-8");

let sheet: HTMLStyleElement;
let wrapper: HTMLElement;

beforeAll(() => {
  sheet = document.createElement("style");
  sheet.textContent = `${CARD_CSS}\n${PLAYER_CSS}`;
  document.head.appendChild(sheet);

  // The exact shape Card.tsx + PlayerSection.tsx produce: the grid wrapper,
  // Card's own scroll body, and PlayerSection's root div with a `.ps-list`
  // child inside it.
  wrapper = document.createElement("div");
  wrapper.className = "react-grid-item";
  wrapper.innerHTML =
    '<section class="sec"><div class="fold"><div class="fold-inner">' +
    '<div class="sb sb-scroll"><div class="player-section"><div class="ps-list"></div></div></div>' +
    "</div></div></section>";
  document.body.appendChild(wrapper);
});

afterAll(() => {
  sheet.remove();
  wrapper.remove();
});

describe("PlayerSection joins Card's own flex chain", () => {
  it("stretches .player-section to fill .sb-scroll instead of its natural content size", () => {
    const section = wrapper.querySelector(".player-section") as HTMLElement;
    const style = getComputedStyle(section);
    expect(style.flexGrow).toBe("1");
    expect(style.minHeight).toBe("0px");
  });

  it("stretches .ps-list to take the remaining space, not a fixed cap", () => {
    const list = wrapper.querySelector(".ps-list") as HTMLElement;
    const style = getComputedStyle(list);
    expect(style.flexGrow).toBe("1");
    expect(style.minHeight).toBe("0px");
    expect(style.maxHeight).toBe("none");
    expect(style.overflowY).toBe("auto");
  });
});
