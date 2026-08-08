/**
 * Block-grid bridge rules (3.2.3): adaptive tracks, drag hologram, card fold.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(__dirname, "..", "mock-bridge.css"), "utf-8");

describe("block grid", () => {
  it("uses auto-fill with the configurable --block variable, not hardcoded px", () => {
    expect(CSS).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(100%,\s*var\(--block\)\),\s*1fr\)\)/);
  });

  it("sets grid-auto-rows to auto so cards size to their content", () => {
    expect(CSS).toMatch(/grid-auto-rows:\s*auto/);
  });

  it("starts content at the top, not stretching rows", () => {
    expect(CSS).toMatch(/align-content:\s*start/);
  });
});

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

describe("card fold", () => {
  it("hides the body with display:none when open=false", () => {
    expect(CSS).toMatch(/sec\[open="false"\] .sec-body/);
    expect(CSS).toMatch(/display:\s*none/);
  });
});
