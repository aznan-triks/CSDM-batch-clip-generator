/**
 * Block-grid bridge rules: drag hologram, drag handle, gesture guard.
 * Track layout itself (columns, rows) moved to react-grid-layout in 3.2.4 and
 * is no longer described here -- `.bento` is now just the pane it renders in.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "mock-bridge.css"), "utf-8");

describe("drag hologram", () => {
  it("renders a dashed gold ghost card", () => {
    expect(CSS).toMatch(/\.card-ghost\s*\{/);
    expect(CSS).toMatch(/border:\s*2px dashed var\(--gold\)/);
  });

  it("ghost is non-interactive", () => {
    expect(CSS).toMatch(/pointer-events:\s*none/);
  });
});

describe("drag handle", () => {
  it("shows a grab cursor by default and gold on hover", () => {
    expect(CSS).toMatch(/\.drag-handle\s*\{[^}]*cursor:\s*grab/);
    expect(CSS).toMatch(/\.drag-handle:hover\s*\{[^}]*color:\s*var\(--gold\)/);
  });
});

describe("gesture guard", () => {
  it("covers the workspace during a move/resize gesture", () => {
    expect(CSS).toMatch(/\.grid-gesture-guard\s*\{/);
    expect(CSS).toMatch(/position:\s*fixed/);
  });
});
