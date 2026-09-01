/**
 * Every class the reticle names must still exist.
 *
 * This is the guard that was missing. Restyle 5 renamed the card to `.sec` and
 * the segmented control to `.seg`; the reticle's list still said `.panel-box`
 * and `.segment`, both with zero usages anywhere. Nothing failed.
 *
 * The list names the surfaces that KEEP the system cursor now, and most of it
 * is HTML tag names, which no restyle can rename. The handful of classes left
 * in it still need this guard: a stale one there would silently steal a
 * caret or a grab handle. `Reticle.coverage.test.tsx` holds the other end --
 * that the crosshair survives a walk across a card.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "..", "..");
const RETICLE = readFileSync(path.join(__dirname, "..", "Reticle.tsx"), "utf-8");

/** Every .tsx and .css under src/, minus tests. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__" && entry !== "assets") sources(full, out);
    } else if (/\.(tsx|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ALL = sources(SRC)
  .filter((file) => !file.includes("Reticle"))
  .map((file) => readFileSync(file, "utf-8"))
  .join("\n");

/** The class names inside one of the reticle's two selector constants. */
function namedClasses(constant: string): string[] {
  const match = RETICLE.match(new RegExp(`${constant}\\s*(?::[^=]*)?=\\s*([^;]+);`));
  if (!match) throw new Error(`constant not found in Reticle.tsx: ${constant}`);
  return [...match[1].matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
}

describe("the reticle names only classes the window really renders", () => {
  const classes = [...namedClasses("NATIVE_CURSOR_SELECTOR"), ...namedClasses("SNAP_SELECTOR")];

  it("names some", () => {
    expect(classes.length).toBeGreaterThan(3);
  });

  it.each(classes)(".%s exists somewhere else in the source", (name) => {
    // Either applied in markup, or declared in a stylesheet the shell renders.
    const applied = new RegExp(`["\`\\s.]${name}[\`"\\s{,:.]`).test(ALL);
    expect(applied, `.${name} is named by the reticle but appears nowhere else`).toBe(true);
  });

  it("does not name the two classes restyle 5 renamed away", () => {
    expect(RETICLE).not.toContain("panel-box");
    expect(RETICLE).not.toContain(".segment");
  });
});

describe("the system cursor is a short list, and it is checked with closest", () => {
  it("names no background surface at all -- the crosshair is the default", () => {
    // The old allowlist of backgrounds is what made the crosshair blink out
    // on every label, glyph and span inside a card. Re-introducing any
    // "only show it here" test brings the reported symptom straight back.
    expect(RETICLE).not.toContain("BACKGROUND_SELECTOR");
    expect(RETICLE).not.toMatch(/matches\(/);
  });

  it("checks the native-cursor list with closest, so a caret wins from inside a field", () => {
    expect(RETICLE).toMatch(/closest\(NATIVE_CURSOR_SELECTOR\)/);
  });

  it("keeps text entry on the system cursor", () => {
    for (const tag of ["input", "textarea", "select", "[contenteditable]"]) {
      expect(RETICLE).toContain(tag);
    }
  });

  it("still uses closest for snap targets, which have layers inside them", () => {
    // `.btn` renders `.bx` / `.fl` / `.brs` children, a `.chip`'s label is a
    // text node beside its `.d` dot, and a segmented option's target is the
    // `<span>` the mock styles, not always the button itself.
    expect(RETICLE).toMatch(/closest\(SNAP_SELECTOR\)/);
  });

  it("snaps on more than the run/preview/stop/kill buttons", () => {
    // User feedback 2026-08-01: the crosshair is meant to lock onto anything
    // that reads as a button, not literally only ActionButton.
    // User feedback 2026-08-02: .tab is deliberately excluded -- nav tabs
    // are not action buttons, and locking the reticle onto them fought the
    // indicator animation.
    const selector = namedClasses("SNAP_SELECTOR");
    for (const target of ["btn", "chip"]) {
      expect(selector, `SNAP_SELECTOR no longer names .${target}`).toContain(target);
    }
    expect(selector, "SNAP_SELECTOR must not name .tab (nav strip, not an action button)").not.toContain("tab");
  });
});
