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

describe(".field is glass, rounded", () => {
  it("base uses --surface-2 and --r-mid", () => {
    const rule = readBlock("Field.css", ".field");
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).not.toMatch(/var\(--raise\);/);
    expect(rule).toMatch(/border-radius:\s*var\(--r-mid\);/);
  });

  it("hover/focus brighten to --surface", () => {
    expect(readBlock("Field.css", ".field:hover")).toMatch(/background:\s*var\(--surface\);/);
    expect(readBlock("Field.css", ".field:focus")).toMatch(/background:\s*var\(--surface\);/);
  });
});

describe(".chip is glass, pill-shaped", () => {
  const rule = readBlock("Chip.css", ".chip");

  it("has no notch clip-path", () => {
    expect(rule).not.toMatch(/clip-path/);
  });

  it("uses --surface-2 and --r-pill", () => {
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).toMatch(/border-radius:\s*var\(--r-pill\);/);
  });

  it("hover brightens to --surface", () => {
    expect(readBlock("Chip.css", ".chip:hover")).toMatch(/background:\s*var\(--surface\);/);
  });

  it("keeps the existing accent look for the selected state untouched", () => {
    const selected = readBlock("Chip.css", ".chip-selected");
    expect(selected).toMatch(/color-mix\(in srgb, var\(--gold\) 13%, transparent\)/);
  });
});
