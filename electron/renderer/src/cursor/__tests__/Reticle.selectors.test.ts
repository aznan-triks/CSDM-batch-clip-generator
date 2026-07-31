/**
 * Every class the reticle names must still exist.
 *
 * This is the guard that was missing. Restyle 5 renamed the card to `.sec` and
 * the segmented control to `.seg`; the reticle's list still said `.panel-box`
 * and `.segment`, both with zero usages anywhere. Nothing failed -- and because
 * that list was a DENYLIST of widgets, two dead names meant the reticle showed
 * over every card and every segmented control. Something already on screen
 * above every card cannot be seen to arrive on a button, which is why the
 * accroche stopped reading as one even though its code was correct.
 *
 * The list is an allowlist of BACKGROUNDS now, as the approved mock has it, so
 * a stale name makes the reticle disappear from somewhere rather than appear
 * everywhere. This test makes either failure loud.
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

/** The class names inside the reticle's background allowlist. */
function namedClasses(constant: string): string[] {
  const match = RETICLE.match(new RegExp(`${constant}\\s*(?::[^=]*)?=\\s*([^;]+);`));
  if (!match) throw new Error(`constant not found in Reticle.tsx: ${constant}`);
  return [...match[1].matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
}

describe("the reticle names only classes the window really renders", () => {
  const classes = namedClasses("BACKGROUND_SELECTOR");

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

describe("the background list is an allowlist, matched on the target itself", () => {
  it("uses matches, not closest, for the background test", () => {
    // `closest` would find `.scrollwrap` from inside a card and show the
    // reticle over the whole workspace.
    expect(RETICLE).toMatch(/matches\(BACKGROUND_SELECTOR\)/);
  });

  it("still uses closest for the button, which has layers inside it", () => {
    // `.btn` renders `.bx` / `.fl` / `.brs` children, so the target under the
    // pointer is often one of those and never the button itself.
    expect(RETICLE).toMatch(/closest\("\.btn"\)/);
  });
});
