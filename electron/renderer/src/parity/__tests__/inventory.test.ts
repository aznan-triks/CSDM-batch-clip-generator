/**
 * The action inventory is read from the document, never copied: ids are
 * unique and family-numbered, removed actions stay marked instead of dropped.
 */
import { describe, expect, it } from "vitest";

import { readActionInventory } from "../inventory";

describe("the action inventory is read, never copied", () => {
  const entries = readActionInventory();

  it("finds a substantial list", () => {
    // A parser that silently matches nothing would make every parity check
    // pass over an empty set -- the failure mode this whole plan exists to
    // prevent. No exact count: HC.1 forbids copying a number that moves.
    expect(entries.length).toBeGreaterThan(100);
  });

  it("gives every entry a unique id", () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads ids in the family-then-number shape the document uses", () => {
    expect(entries.every((entry) => /^[A-Q]\d+$/.test(entry.id))).toBe(true);
  });

  it("carries the origin, so a gap can be traced back to Tkinter code", () => {
    expect(entries.every((entry) => entry.origin.length > 0)).toBe(true);
  });

  it("marks removed actions instead of dropping them", () => {
    // Ids are cited elsewhere; a removed action keeps its line so no citation
    // ever points at a different action than it did.
    const removed = entries.filter((entry) => entry.removed);
    expect(removed.every((entry) => /supprim/i.test(entry.label))).toBe(true);
  });
});
