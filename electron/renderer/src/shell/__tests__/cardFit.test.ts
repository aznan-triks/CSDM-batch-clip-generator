import { describe, expect, it } from "vitest";

import { rowsFor } from "../cardFit";

describe("rowsFor", () => {
  it("maps a height the grid produced back to the same row count", () => {
    // 10 rows of 24px with 9 gaps of 10px = 330px, give or take subpixel noise.
    expect(rowsFor(330, 24, 10)).toBe(10);
    expect(rowsFor(330.4, 24, 10)).toBe(10);
  });

  it("adds a row as soon as the content needs a real pixel more", () => {
    expect(rowsFor(331, 24, 10)).toBe(11);
  });

  it("never returns less than one row", () => {
    expect(rowsFor(0, 24, 10)).toBe(1);
  });
});
