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
  /**
   * The multi-column flow moved inside a container query on 2026-09-01:
   * `column-width` is a FLOOR, so declaring it unconditionally made every
   * consumer insist on 419px no matter how narrow its card was, and the
   * difference was cut off (AUDIT_retours_ui_8_points.md, ecart E5).
   *
   * jsdom does not evaluate container queries, so this one rule cannot be
   * proved through a cascade here the way the others are. It is proved on the
   * real page instead, by measurement: `node electron/e2e/surface-audit.mjs`
   * reports zero cut-off content across the width sweep. What IS checked here
   * is the part a cascade cannot catch either way -- that the query exists,
   * that it governs this class, and that its threshold has not drifted from
   * the custom property it is supposed to mirror.
   */
  it("asks for columns only once the container can hold one", () => {
    const query = CSS.match(/@container\s*\(min-width:\s*(\d+)px\)\s*\{([\s\S]*?)\}\s*\}/);
    expect(query).not.toBeNull();
    expect(query![2]).toContain(".reflow-columns");
    expect(query![2]).toContain("column-width: var(--reflow-col-min)");

    // HC.1 cannot reach inside a container query -- its condition takes a
    // length, never a custom property. So the number is written twice, and
    // this is what keeps the two copies equal.
    //
    // Matched on a real declaration (start of line), not anywhere in the file:
    // the comment above the property shows an override as an example, and a
    // looser pattern reads THAT and compares against a number nothing uses.
    const declarations = [...CSS.matchAll(/^\s*--reflow-col-min:\s*(\d+)px/gm)];
    expect(declarations).toHaveLength(1);
    expect(query![1]).toBe(declarations[0][1]);
  });

  it("makes the card the container the query asks about", () => {
    expect(CSS).toContain("container-type: inline-size");
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
