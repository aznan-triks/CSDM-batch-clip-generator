/**
 * Card class prefixes are global CSS namespaces. The Configuration Folder card
 * used `cf-`, which the filter cards already own (components/cardstyle/
 * filterstyle.css): its `.cf-tiles { grid-template-columns: repeat(3, ...) }`
 * squeezed every filter tile grid into one narrow column, and Kill Filters'
 * tiles style grew past 3000px (fix/cards-fit-style). It is `cfg-` now.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(path.join(__dirname, "..", ...parts), "utf-8");

describe("settings card class prefixes", () => {
  it("no settings card rule lands on the filter cards' cf- classes", () => {
    expect(read("SettingsCards.css")).not.toMatch(/\.cf-[a-z]/);
  });

  it("the Configuration Folder card uses its own cfg- prefix", () => {
    const source = read("ConfigFolderCard.tsx");
    expect(source).toContain('prefix="cfg"');
    expect(source).not.toMatch(/className="cf-/);
  });
});
