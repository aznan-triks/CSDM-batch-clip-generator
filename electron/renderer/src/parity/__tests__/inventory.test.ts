/**
 * The action inventory is read from the document, never copied: ids are
 * unique and family-numbered, removed actions stay marked instead of dropped.
 *
 * docs/INVENTAIRE_ACTIONS.md is git-ignored private working material (see
 * .gitignore section 8) and is absent from a fresh public clone. This suite
 * compares shipped code against that private document, so it skips outright
 * when the document is not there instead of failing on a missing file.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { INVENTORY_PATH, readActionInventory } from "../inventory";

const hasInventory = existsSync(INVENTORY_PATH);

describe.skipIf(!hasInventory)(
  hasInventory
    ? "the action inventory is read, never copied"
    : `the action inventory is read, never copied (skipped: ${INVENTORY_PATH} not present in this checkout)`,
  () => {
    // Guarded by hasInventory above: describe.skipIf still runs this factory
    // to register the (skipped) tests, so this must not throw when absent.
    const entries = hasInventory ? readActionInventory() : [];

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
  },
);
