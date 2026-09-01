/**
 * What is LEFT in Field.css and Chip.css.
 *
 * `.fld`, `.lab`, `.chip`, its `.d` dot and its `.on` state are the approved
 * mock's, held once in theme/mock-v12.css. These two stylesheets used to carry
 * their own copy of the face, the pill and the lime selection; the guard now
 * checks that they do not, and that what remains is what the mock could not
 * know -- that both are real, focusable, disableable controls.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const FIELD = strip(readFileSync(path.join(__dirname, "..", "Field.css"), "utf-8"));
const CHIP = strip(readFileSync(path.join(__dirname, "..", "Chip.css"), "utf-8"));

/** The `.fld { ... }` REST rule, without its state siblings. */
function restRule(css: string): string {
  const match = css.match(/^\.fld\s*\{([^}]*)\}/m);
  return match ? match[1] : "";
}

describe("Field.css", () => {
  it("re-states neither the face, nor the rim, nor the radius AT REST", () => {
    // Scoped to the rest rule since 2026-09-02. A field hover, focus and
    // disabled face is exactly what a still picture cannot say, and the mock
    // IS a still picture -- banning `background` inside a `:hover` rule was
    // banning the one thing this file exists for. What must still never be
    // restated is the SHAPE: the mock owns the radius and the padding, at
    // rest and in every state.
    for (const property of ["background", "border", "border-radius", "padding"]) {
      expect(restRule(FIELD), `Field.css sets ${property} on the rest rule`).not.toMatch(
        new RegExp(`^[ \\t]*${property}\\s*:`, "m"),
      );
    }
    for (const property of ["border-radius", "padding"]) {
      expect(FIELD, `Field.css sets ${property} somewhere`).not.toMatch(
        new RegExp(`^[ \\t]*${property}\\s*:`, "m"),
      );
    }
  });

  it("says what a still picture cannot: hover, focus, disabled, placeholder", () => {
    for (const state of [":hover", ":focus", ":disabled", "::placeholder"]) {
      expect(FIELD, `Field.css has no ${state} rule`).toContain(`.fld${state}`);
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

describe("the field vocabulary has one spelling, and it is the mock's", () => {
  // `PathField.tsx` and `DateField.tsx` emitted `field`, `field-label` and
  // `field-mono` -- names with NO RULE anywhere in the project. Their inputs
  // and labels therefore rendered as bare browser controls (a 16px label
  // above a default-chrome box) on every tab that shows a path or a date,
  // while every other field wore the mock's `.fld` / `.lab`. Same failure as
  // `chip-selected` (context_guide section 10): a synonym of a styled class
  // is invisible, and nothing fails.
  const SRC = path.join(__dirname, "..", "..");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "__tests__" && entry !== "assets") walk(full, out);
      } else if (entry.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  const MARKUP = walk(SRC).map((file) => readFileSync(file, "utf-8")).join("\n");

  it.each(["field", "field-label", "field-mono"])(
    "no component emits the dead synonym %s",
    (dead) => {
      expect(MARKUP).not.toMatch(new RegExp(`className=["\`][^"\`]*\b${dead}\b`));
    },
  );
});
