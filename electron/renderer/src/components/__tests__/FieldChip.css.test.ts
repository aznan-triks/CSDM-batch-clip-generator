/**
 * What is LEFT in Field.css and Chip.css.
 *
 * `.fld`, `.lab`, `.chip`, its `.d` dot and its `.on` state are the approved
 * mock's, held once in theme/mock-v12.css. These two stylesheets used to carry
 * their own copy of the face, the pill and the lime selection; the guard now
 * checks that they do not, and that what remains is what the mock could not
 * know -- that both are real, focusable, disableable controls.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const FIELD = strip(readFileSync(path.join(__dirname, "..", "Field.css"), "utf-8"));
const CHIP = strip(readFileSync(path.join(__dirname, "..", "Chip.css"), "utf-8"));

describe("Field.css", () => {
  it("re-states neither the face, nor the rim, nor the radius", () => {
    for (const property of ["background", "border", "border-radius", "padding"]) {
      expect(FIELD, `Field.css sets ${property}`).not.toMatch(
        new RegExp(`^[ \\t]*${property}\\s*:`, "m"),
      );
    }
  });

  it("keeps the mono face for numeric fields, which the mock never had", () => {
    expect(FIELD).toMatch(/\.fld-mono\s*\{[^}]*var\(--font-mono\)/);
  });

  it("keeps a focus ring", () => {
    expect(FIELD).toMatch(/\.fld:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
  });
});

describe("Chip.css", () => {
  it("re-states neither the pill, the face, nor the lime selection", () => {
    for (const property of ["border-radius", "padding"]) {
      expect(CHIP, `Chip.css sets ${property}`).not.toMatch(
        new RegExp(`^[ \\t]*${property}\\s*:`, "m"),
      );
    }
    expect(CHIP).not.toMatch(/--lime/);
  });

  it("paints only the destructive variant, and only from tokens", () => {
    // The mock has no destructive chip: its chips pick filters, and the one
    // red face it draws is on a full action button. Deleting a preset is not a
    // filter and must not look like one. Everything else the chip wears is the
    // mock's -- so any colour here belongs to `.danger` and comes from a token.
    const painted = [...CHIP.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, , body]) =>
      /^[ \t]*(background|color|border-color)\s*:/m.test(body),
    );
    for (const [, selector, body] of painted) {
      expect(selector.trim(), "a painted rule that is not the danger variant").toBe(".chip.danger");
      expect(body, "a literal colour is a copy of the design, not a variant").not.toMatch(
        /#[0-9a-f]{3,8}|rgba?\(/i,
      );
    }
  });

  it("draws no dot of its own -- the mock's `.d` is a real element now", () => {
    expect(CHIP).not.toMatch(/::before|::after/);
  });

  it("keeps the button reset, the focus ring and the disabled state", () => {
    expect(CHIP).toMatch(/appearance:\s*none;/);
    expect(CHIP).toMatch(/\.chip:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
    expect(CHIP).toMatch(/\[aria-disabled="true"\]/);
  });
});
