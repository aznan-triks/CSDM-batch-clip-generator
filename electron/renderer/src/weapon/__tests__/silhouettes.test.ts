/**
 * Every weapon the database can return must have something to draw.
 *
 * Measured on the user's own database: 42 weapons, against 2 entries in the
 * firing table. Picking any of the other forty drew nothing in the filter
 * card's cascade -- indistinguishable from a click that did not register.
 *
 * The 42 names below are the real ones, captured from `connect_db`. They are
 * pinned here on purpose: if the database grows a weapon this file cannot
 * class, that is exactly what should fail.
 */
import { describe, expect, it } from "vitest";

import { PACK_NAMES, classOf, silhouetteFor } from "../silhouettes";

/** `connect_db`'s `weapons` field, verbatim. */
const FROM_DATABASE = [
  "AK-47", "AUG", "AWP", "C4", "CZ75 Auto", "Desert Eagle", "Dual Berettas", "FAMAS",
  "Five-SeveN", "Flashbang", "G3SG1", "Galil AR", "Glock-18", "HE Grenade",
  "Incendiary Grenade", "Knife", "M249", "M4A1", "M4A4", "MAC-10", "MAG-7", "Molotov",
  "MP5-SD", "MP7", "MP9", "Negev", "Nova", "P2000", "P250", "P90", "PP-Bizon",
  "R8 Revolver", "Sawed-Off", "SCAR-20", "SG 553", "SSG 08", "Tec-9", "UMP-45", "USP-S",
  "World", "XM1014", "Zeus x27",
];

/**
 * `weapon_categories` as `describe_filters` sends it, trimmed to the names
 * this test uses. The real table carries every spelling of each weapon; these
 * are the database's own.
 */
const CATEGORIES: Record<string, string[]> = {
  Pistols: [
    "USP-S", "P2000", "Glock-18", "P250", "Five-SeveN", "CZ75-Auto", "CZ75 Auto", "Tec-9",
    "Dual Berettas", "Desert Eagle", "R8 Revolver",
  ],
  SMGs: ["MAC-10", "MP9", "MP7", "MP5-SD", "UMP-45", "P90", "PP-Bizon"],
  Rifles: ["AK-47", "M4A4", "M4A1-S", "M4A1", "Galil AR", "FAMAS", "SG 553", "AUG"],
  Snipers: ["AWP", "SSG 08", "SCAR-20", "G3SG1"],
  Heavy: ["Nova", "XM1014", "MAG-7", "Sawed-Off", "M249", "Negev"],
  Knives: ["Knife"],
  "Grenades & Utility": [
    "HE Grenade", "Incendiary Grenade", "Molotov", "Flashbang", "Smoke Grenade",
    "Decoy Grenade",
  ],
  "C4 / World": ["C4", "World"],
  Misc: ["Zeus x27"],
};

describe("coverage: no weapon in the database draws a blank", () => {
  it.each(FROM_DATABASE)("%s has a silhouette", (name) => {
    expect(silhouetteFor(name)).not.toBeNull();
  });

  it("covers all 42, not a handful", () => {
    const drawn = FROM_DATABASE.filter((name) => silhouetteFor(name) !== null);
    expect(drawn).toHaveLength(FROM_DATABASE.length);
  });

  it("covers every one of the database's names from the pack alone", () => {
    // No hand-drawn fallback exists any more, on purpose: the table above is
    // the only thing standing between a weapon and a blank.
    const missing = FROM_DATABASE.filter((name) => !PACK_NAMES.includes(name));
    expect(missing).toEqual([]);
  });
});

describe("the game's own icon wins over a class silhouette", () => {
  it("gives World the game's own environment art, not a hand-drawn shape", () => {
    // The pack's `world.svg` and `worldent.svg` are empty frames, so World
    // takes `prop_exploding_barrel` -- still the game's, never a drawing.
    const world = silhouetteFor("World");
    expect(world).not.toBeNull();
    expect(world).not.toBe(silhouetteFor("C4"));
  });

  it("gives each weapon its OWN icon, not one shared per class", () => {
    // The whole point of the pack: a Deagle no longer looks like a Glock.
    expect(silhouetteFor("Desert Eagle")).not.toBe(
      silhouetteFor("Glock-18"),
    );
    expect(silhouetteFor("AK-47")).not.toBe(silhouetteFor("M4A4"));
  });

  it("hands back a URL, not markup -- 41 icons must stay out of the bundle", () => {
    // The build emits the big ones as files and inlines the tiny class shapes
    // as data URIs; either way it is a URL a CSS mask can consume, never
    // markup a component has to inject.
    const url = silhouetteFor("AK-47")!;
    expect(url).not.toContain("<svg");
    expect(url === encodeURI(url) || url.startsWith("data:")).toBe(true);
  });
});

describe("classing is case-insensitive, because the table carries both spellings", () => {
  it.each([
    ["ak-47", "Rifles"],
    ["AK-47", "Rifles"],
    ["desert eagle", "Pistols"],
  ])("%s is a %s", (name, expected) => {
    expect(classOf(name, CATEGORIES)).toBe(expected);
  });
});

describe("an unclassed weapon is a real gap, not something to paper over", () => {
  it("returns null rather than a placeholder", () => {
    // Hiding it behind a generic shape would hide that the category table
    // needs a line.
    expect(silhouetteFor("Rocket Launcher")).toBeNull();
  });

  it("needs no category table at all", () => {
    // The pack is keyed by the database's own name, so a silhouette appears
    // whether or not `describe_filters` has answered yet.
    expect(silhouetteFor("AK-47")).not.toBeNull();
    expect(silhouetteFor("Desert Eagle")).not.toBeNull();
    expect(silhouetteFor("World")).not.toBeNull();
  });
});
