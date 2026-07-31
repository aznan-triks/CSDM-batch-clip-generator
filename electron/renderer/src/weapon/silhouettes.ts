import { WEAPONS } from "./weapons";

import pistolArt from "./assets/class-pistol.svg?raw";
import smgArt from "./assets/class-smg.svg?raw";
import heavyArt from "./assets/class-heavy.svg?raw";
import knifeArt from "./assets/class-knife.svg?raw";
import grenadeArt from "./assets/class-grenade.svg?raw";
import c4Art from "./assets/class-c4.svg?raw";
import taserArt from "./assets/class-taser.svg?raw";

/**
 * A silhouette for EVERY weapon the database can return, not just the two the
 * firing table happens to draw.
 *
 * Measured: the database returns 42 weapons and `WEAPONS` holds art for two,
 * AK-47 and AWP. `WeaponFilterSection` drew the mock's cascade from that table,
 * so picking any of the other forty showed nothing at all -- indistinguishable
 * from a click that did not register, especially while the chip itself had no
 * selected face either.
 *
 * WHY BY CLASS, and not one drawing per weapon: a per-weapon set means 42
 * accurate silhouettes of real firearms, and the only source the project ever
 * considered for those is `Juknum/counter-strike-icons` -- assets extracted
 * from the game, whose licence `PLAN_ELECTRON.md` and the direction notes both
 * say must be settled by the user before anything is vendored. That decision
 * is not this file's to make. A class silhouette says the true thing (a rifle,
 * a pistol, a grenade) without claiming to be a specific weapon it is not.
 *
 * WHEN REAL ART ARRIVES: add the weapon to `WEAPONS` with its own `art`, and
 * `silhouetteFor` prefers it automatically -- there is nothing to change here.
 * That is why the specific table is consulted FIRST.
 *
 * The class itself is never guessed: it comes from `WEAPON_CATEGORIES` in
 * csdm/static_data.py, which the engine already ships to the window through
 * `describe_filters`. One source, one spelling, no second list to drift.
 */
const CLASS_ART: Record<string, string> = {
  Pistols: pistolArt,
  SMGs: smgArt,
  Rifles: WEAPONS.ak47.art,
  Snipers: WEAPONS.awp.art,
  Heavy: heavyArt,
  Knives: knifeArt,
  "Grenades & Utility": grenadeArt,
  "C4 / World": c4Art,
  Misc: taserArt,
};

/** Database weapon name -> the specific art the firing table holds for it. */
const ART_BY_NAME = new Map(Object.values(WEAPONS).map((weapon) => [weapon.name, weapon.art]));

/**
 * The class a weapon belongs to, from the engine's own table.
 *
 * `categories` is `weapon_categories` as `describe_filters` sends it: a class
 * name mapped to every spelling the database and the demo files use for the
 * weapons in it. Matching is case-insensitive because that list deliberately
 * carries both `ak47` and `AK-47`, and a database column is not obliged to
 * pick one.
 */
export function classOf(
  weaponName: string,
  categories: Record<string, string[]> | undefined,
): string | null {
  if (!categories) return null;
  const wanted = weaponName.trim().toLowerCase();
  for (const [className, names] of Object.entries(categories)) {
    if (names.some((name) => name.trim().toLowerCase() === wanted)) return className;
  }
  return null;
}

/**
 * The SVG markup to draw for a weapon, or null when even its class is unknown.
 *
 * Null rather than a placeholder: a weapon the engine has never classified is
 * a real gap, and drawing a generic shape over it would hide the fact that the
 * category table needs a line.
 */
export function silhouetteFor(
  weaponName: string,
  categories: Record<string, string[]> | undefined,
): string | null {
  const specific = ART_BY_NAME.get(weaponName);
  if (specific) return specific;
  const className = classOf(weaponName, categories);
  return className ? (CLASS_ART[className] ?? null) : null;
}

/** The classes this file can draw, for the coverage test to walk. */
export const DRAWN_CLASSES = Object.keys(CLASS_ART);
