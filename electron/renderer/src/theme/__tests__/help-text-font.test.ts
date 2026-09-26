/**
 * Help text wears one face: the body font.
 *
 * The persistent tip under a text field was mono while the help line of a
 * slider was sans, so the same kind of sentence read in two fonts depending on
 * the control above it. The V12 mock keeps mono for values and machine text
 * only (console, buttons, hex inputs); prose -- and help is prose -- is the
 * body face. Every stylesheet rule that styles a help line is checked here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "..", "..");
/** Selectors that style a help line (tips, hints), never a value. */
const HELP_SELECTOR = /(persistent-tip|filter-row-tip|cf-pop-tip|-hint)\b/;
const MONO = /font(-family)?\s*:[^;]*mono/;

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

describe("help text font", () => {
  it("no help-line rule sets a monospace face", () => {
    const offenders: string[] = [];
    for (const file of cssFiles(SRC)) {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1].trim();
        // `kbd` inside a hint is a key name, a value: mono is right there.
        const helpParts = selector
          .split(",")
          .filter((part) => HELP_SELECTOR.test(part) && !/\bkbd\b/.test(part));
        if (helpParts.length && MONO.test(match[2])) {
          offenders.push(`${path.relative(SRC, file)}: ${selector}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
