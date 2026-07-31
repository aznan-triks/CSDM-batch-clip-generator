import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = path.join(__dirname, "..", "Card.css");
const CSS = readFileSync(CSS_PATH, "utf-8");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in Card.css: ${selector}`);
  return match[1];
}

describe(".panel-box is glass, rounded", () => {
  const rule = block(".panel-box");

  it("uses the surface glass token for its background", () => {
    expect(rule).toMatch(/background:\s*var\(--surface\);/);
    expect(rule).not.toMatch(/var\(--panel\)/);
  });

  // The mock's rim is the LIT edge of a glass plate, not a dark hairline: a
  // dark border draws the card as an outline ON the ground instead of a pane
  // floating above it.
  it("uses the lit glass rim, not a dark hairline", () => {
    expect(rule).toMatch(/border:\s*var\(--bw\)\s*solid\s*var\(--edge-hi\);/);
    expect(rule).not.toMatch(/var\(--line-hi\)/);
  });

  it("is rounded, not the cut family", () => {
    expect(rule).toMatch(/border-radius:\s*var\(--r-card\);/);
  });

  it("blurs what is behind it", () => {
    expect(rule).toMatch(/backdrop-filter:\s*var\(--blur\);/);
  });

  it("clips its own content so the rounded corner has no square overflow", () => {
    expect(rule).toMatch(/overflow:\s*hidden;/);
  });
});

describe("the corner brackets sit inside the rounded curve, not outside it", () => {
  // `.panel-box::before` and `.panel-box::after` each appear twice: once in the
  // shared combined selector (size/pointer-events only), once as their own rule
  // (position). `block()` returns the FIRST match, which is the shared one for
  // `::after` (it's the second name in that combined selector, immediately
  // before the `{`) -- so the individual rule is matched positionally instead.
  function lastBlock(selector: string): string {
    const marker = `${selector} {`;
    const start = CSS.lastIndexOf(marker);
    if (start === -1) throw new Error(`selector not found in Card.css: ${selector}`);
    const bodyStart = start + marker.length;
    return CSS.slice(bodyStart, CSS.indexOf("}", bodyStart));
  }

  const individualBefore = lastBlock(".panel-box::before");
  const individualAfter = lastBlock(".panel-box::after");

  // The mock puts the pair on a DIAGONAL (top-left, bottom-right) at a 7px
  // inset -- not two brackets crowding the same top edge.
  it("is inset far enough to clear --r-card, not still at the old square-corner -1px", () => {
    expect(individualBefore).not.toMatch(/top:\s*-1px;/);
    expect(individualBefore).not.toMatch(/left:\s*-1px;/);
    expect(individualBefore).toMatch(/top:\s*7px;/);
    expect(individualBefore).toMatch(/left:\s*7px;/);

    expect(individualAfter).not.toMatch(/top:\s*-1px;/);
    expect(individualAfter).not.toMatch(/right:\s*-1px;/);
    expect(individualAfter).toMatch(/bottom:\s*7px;/);
    expect(individualAfter).toMatch(/right:\s*7px;/);
  });
});

describe(".spot is the cursor-follow spotlight border, masked to a ring", () => {
  const rule = block(".panel-box .spot");

  it("tracks the custom properties Card.tsx paints, never a hardcoded position", () => {
    expect(rule).toMatch(/var\(--mx/);
    expect(rule).toMatch(/var\(--my/);
  });

  it("is invisible until hovered", () => {
    expect(rule).toMatch(/opacity:\s*0;/);
  });

  it("is masked to a ring, not a filled halo", () => {
    expect(rule).toMatch(/mask-composite:\s*exclude;/);
  });
});

describe(".panel-box:hover .spot reveals it without moving anything", () => {
  function lastBlock(selector: string): string {
    const marker = `${selector} {`;
    const start = CSS.lastIndexOf(marker);
    if (start === -1) throw new Error(`selector not found in Card.css: ${selector}`);
    const bodyStart = start + marker.length;
    return CSS.slice(bodyStart, CSS.indexOf("}", bodyStart));
  }
  const rule = lastBlock(".panel-box:hover .spot");

  it("only changes opacity", () => {
    expect(rule.trim()).toBe("opacity: 1;");
  });
});
