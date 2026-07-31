/**
 * One vocabulary for small buttons.
 *
 * Restyle 5 pass 2 collapsed fourteen tab-local button styles into the mock's
 * single `.chip`. Four families living in COMPONENTS escaped it, because the
 * pass walked the tabs: `date-field-btn`, `dp-btn`, `log-toggle`, and the
 * console's unclassed `Export` button. Measured on the rendered page, the
 * window drew 14 button variants against the mock's 6.
 *
 * This forbids their return by name: a new bespoke family has to be argued
 * for, not typed in.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "..");

const BANNED = ["date-field-btn", "dp-btn", "log-toggle"];

const FILES = [
  "components/DateField.tsx",
  "components/DateField.css",
  "components/DemoPicker.tsx",
  "components/DemoPicker.css",
  "shell/LogConsole.tsx",
  "shell/LogConsole.css",
];

describe("no component keeps a button family the mock does not have", () => {
  it.each(BANNED)("%s appears nowhere", (name) => {
    for (const file of FILES) {
      const text = readFileSync(path.join(SRC, file), "utf-8");
      expect(text.includes(name), `${file} still uses ${name}`).toBe(false);
    }
  });

  it("the console's export button is a chip like every other small button", () => {
    const text = readFileSync(path.join(SRC, "shell/LogConsole.tsx"), "utf-8");
    // It was the one <button> in the window with no class at all.
    expect(text).toMatch(/className="chip"[\s\S]{0,200}Export/);
  });

  it("the picker's on/off buttons use the mock's own selected class", () => {
    const text = readFileSync(path.join(SRC, "components/DemoPicker.tsx"), "utf-8");
    expect(text).toContain('className="chip"');
  });
});
