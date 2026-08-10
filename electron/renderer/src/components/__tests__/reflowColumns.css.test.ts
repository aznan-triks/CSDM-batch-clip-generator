/**
 * The shared reflow rule, resolved through a real cascade -- not read out of
 * the stylesheet text.
 *
 * Three of these assertions guard a failure mode that a text search would
 * pass straight through:
 *   - `columns` has NO effect on a flex container, and `.kf-group` (the
 *     first consumer) is `display: flex` today, so the container must stop
 *     being one;
 *   - `column-span` does not apply to an inline element, and the group
 *     heading is a `<span>`, so it must be blockified or the heading ends up
 *     trapped in the first column;
 *   - without `break-inside: avoid`, a row can be split in half across a
 *     column boundary (label at the bottom of one, checkboxes at the top of
 *     the next).
 * Same approach as Card.gridItemHeight.test.ts, and for the same reason
 * recorded in §10: a sheet that merely CONTAINS a property proves nothing
 * about what applies.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "reflowColumns.css"), "utf-8");

let sheet: HTMLStyleElement;
let group: HTMLElement;

beforeAll(() => {
  sheet = document.createElement("style");
  sheet.textContent = CSS;
  document.head.appendChild(sheet);

  // The exact shape KillFiltersSection renders: a group carrying both the
  // consumer's own class and the shared one, a heading, then rows.
  group = document.createElement("div");
  group.className = "kf-group reflow-columns";
  group.innerHTML =
    '<span class="lab reflow-columns-header">Mods</span>' +
    '<div class="filter-row">a</div><div class="filter-row">b</div>';
  document.body.appendChild(group);
});

afterAll(() => {
  sheet.remove();
  group.remove();
});

describe("the shared reflow-columns rule", () => {
  it("puts the container in multi-column flow", () => {
    const style = getComputedStyle(group);
    expect(style.columnWidth).not.toBe("auto");
    expect(style.columnWidth).not.toBe("");
  });

  it("does not leave the container a flex box, where columns would be ignored", () => {
    expect(getComputedStyle(group).display).not.toBe("flex");
  });

  it("makes the heading span every column", () => {
    const heading = group.querySelector(".reflow-columns-header") as HTMLElement;
    const style = getComputedStyle(heading);
    expect(style.columnSpan).toBe("all");
    // `column-span` is ignored on an inline box -- the heading is a <span>.
    expect(style.display).toBe("block");
  });

  it("keeps a row from being split across a column boundary", () => {
    const row = group.querySelector(".filter-row") as HTMLElement;
    expect(getComputedStyle(row).breakInside).toBe("avoid");
  });
});
