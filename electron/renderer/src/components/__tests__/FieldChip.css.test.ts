import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readBlock(file: string, selector: string): string {
  const css = readFileSync(path.join(__dirname, "..", file), "utf-8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in ${file}: ${selector}`);
  return match[1];
}

// The mock's controls sit ON the glass, they are not made OF it: `.fld` and
// `.chip` both take the opaque `--solid` face. A translucent control on a
// translucent card washed out to nothing, which is what this guard now pins.
describe(".field wears the mock's opaque face", () => {
  it("base uses --solid and the mock's 10px corner", () => {
    const rule = readBlock("Field.css", ".field");
    expect(rule).toMatch(/background:\s*var\(--solid\);/);
    expect(rule).not.toMatch(/var\(--raise\);/);
    expect(rule).toMatch(/border-radius:\s*10px;/);
  });

  it("hover/focus move the BORDER, never the fill", () => {
    expect(readBlock("Field.css", ".field:hover")).toMatch(/border-color:/);
    expect(readBlock("Field.css", ".field:hover")).not.toMatch(/background:/);
    expect(readBlock("Field.css", ".field:focus")).toMatch(/border-color:/);
    expect(readBlock("Field.css", ".field:focus")).not.toMatch(/background:/);
  });
});

describe(".chip is glass, pill-shaped", () => {
  const rule = readBlock("Chip.css", ".chip");

  it("has no notch clip-path", () => {
    expect(rule).not.toMatch(/clip-path/);
  });

  it("uses --solid and --r-pill", () => {
    expect(rule).toMatch(/background:\s*var\(--solid\);/);
    expect(rule).toMatch(/border-radius:\s*var\(--r-pill\);/);
  });

  it("hover tints the border towards the accent, never the fill", () => {
    const hover = readBlock("Chip.css", ".chip:hover");
    expect(hover).toMatch(/border-color:\s*color-mix\(in srgb, var\(--gold\)/);
    expect(hover).not.toMatch(/background:/);
  });

  // The mock reserves the ACCENT for what the app is doing and the LIME for
  // what the user has picked. A blue selected chip competed with the run bar.
  it("selects in lime, not in the accent", () => {
    const selected = readBlock("Chip.css", ".chip-selected");
    expect(selected).toMatch(/background:\s*var\(--lime\);/);
    expect(selected).toMatch(/color:\s*var\(--lime-ink\);/);
    expect(selected).not.toMatch(/var\(--gold\)/);
  });
});
