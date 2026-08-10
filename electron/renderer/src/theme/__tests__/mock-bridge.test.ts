/**
 * Block-grid bridge rules: drag handle.
 * Track layout itself (columns, rows) moved to react-grid-layout in 3.2.4 and
 * is no longer described here -- `.bento` is now just the pane it renders in.
 * The drag ghost and gesture guard were the hand-rolled engine's own drop
 * preview and pointer shield; react-grid-layout's `.react-grid-placeholder`
 * replaces both (covered by `shell/__tests__/SectionList.test.tsx`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "mock-bridge.css"), "utf-8");

describe("drag handle", () => {
  it("shows a grab cursor by default and gold on hover", () => {
    expect(CSS).toMatch(/\.drag-handle\s*\{[^}]*cursor:\s*grab/);
    expect(CSS).toMatch(/\.drag-handle:hover\s*\{[^}]*color:\s*var\(--gold\)/);
  });
});
