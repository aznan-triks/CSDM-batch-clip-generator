import { WEAPONS } from "./weapons";

/**
 * A silhouette for every weapon the database can return.
 *
 * Measured before this: the database returns 42 weapons and the firing table
 * held art for two, AK-47 and AWP. `WeaponFilterSection` drew the mock's
 * cascade from that table, so picking any of the other forty showed nothing at
 * all -- indistinguishable from a click that had not registered.
 *
 * The art is now the game's own, extracted by `Juknum/counter-strike-icons`
 * and vendored under `assets/cs2/` (see `assets/cs2/SOURCE.md` for provenance,
 * the Valve ownership statement, and what was stripped on the way in). The
 * class silhouettes stay as the fallback for anything the pack does not cover.
 *
 * URLS, NOT MARKUP. Each icon is ~11 kB and there are 41 of them: inlining
 * them with `?raw` would have added 461 kB of string literals to the bundle.
 * They are loaded as asset URLs and painted through a CSS mask
 * (`background: currentColor; mask: url(...)`) which keeps them on the accent,
 * keeps them out of the bundle, and removes the `dangerouslySetInnerHTML` the
 * cascade used to need.
 */

/** Every vendored CS2 icon, by its file name, as a URL Vite emits. */
const CS2_ICONS = import.meta.glob("./assets/cs2/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Every class silhouette, same treatment. */
const CLASS_ICONS = import.meta.glob("./assets/class-*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const iconUrl = (map: Record<string, string>, stem: string): string | null => {
  const key = Object.keys(map).find((path) => path.endsWith(`/${stem}.svg`));
  return key ? map[key] : null;
};

/**
 * Database weapon name -> the file name the game uses for it.
 *
 * The two spellings genuinely differ -- `P2000` is `hkp2000` in the game files,
 * `Dual Berettas` is `elite`, `Zeus x27` is `taser`, `PP-Bizon` is `bizon` --
 * so this table is the translation and there is no cleverness to replace it
 * with. `M4A4` is the game's plain `m4a1` and `M4A1` is `m4a1_silencer`: that
 * is the game's own naming, not a mistake here.
 *
 * `World` is absent on purpose: the pack ships an EMPTY frame for it, and it is
 * the database's pseudo-weapon for world damage rather than a weapon. It falls
 * through to its class.
 */
const GAME_FILE: Record<string, string> = {
  "AK-47": "ak47",
  AUG: "aug",
  AWP: "awp",
  C4: "c4",
  "CZ75 Auto": "cz75a",
  "Desert Eagle": "deagle",
  "Dual Berettas": "elite",
  FAMAS: "famas",
  "Five-SeveN": "fiveseven",
  Flashbang: "flashbang",
  G3SG1: "g3sg1",
  "Galil AR": "galilar",
  "Glock-18": "glock",
  "HE Grenade": "hegrenade",
  "Incendiary Grenade": "incgrenade",
  Knife: "knife",
  M249: "m249",
  M4A1: "m4a1_silencer",
  M4A4: "m4a1",
  "MAC-10": "mac10",
  "MAG-7": "mag7",
  Molotov: "molotov",
  "MP5-SD": "mp5sd",
  MP7: "mp7",
  MP9: "mp9",
  Negev: "negev",
  Nova: "nova",
  P2000: "hkp2000",
  P250: "p250",
  P90: "p90",
  "PP-Bizon": "bizon",
  "R8 Revolver": "revolver",
  "Sawed-Off": "sawedoff",
  "SCAR-20": "scar20",
  "SG 553": "sg556",
  "SSG 08": "ssg08",
  "Tec-9": "tec9",
  "UMP-45": "ump45",
  "USP-S": "usp_silencer",
  XM1014: "xm1014",
  "Zeus x27": "taser",
};

/** The class a weapon falls back to when the pack has nothing for it. */
const CLASS_FILE: Record<string, string> = {
  Pistols: "class-pistol",
  SMGs: "class-smg",
  Rifles: "class-smg",
  Snipers: "class-smg",
  Heavy: "class-heavy",
  Knives: "class-knife",
  "Grenades & Utility": "class-grenade",
  "C4 / World": "class-c4",
  Misc: "class-taser",
};

/**
 * The class a weapon belongs to, from the engine's own table.
 *
 * `categories` is `weapon_categories` as `describe_filters` sends it. Matching
 * is case-insensitive because that list deliberately carries both `ak47` and
 * `AK-47`, and a database column is not obliged to pick one.
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
 * The icon URL to paint for a weapon, or null when nothing covers it.
 *
 * Null rather than a placeholder: a weapon that is neither in the pack nor in
 * any class is a real gap, and a generic shape over it would hide that the
 * category table needs a line.
 */
export function silhouetteFor(
  weaponName: string,
  categories: Record<string, string[]> | undefined,
): string | null {
  const stem = GAME_FILE[weaponName];
  const game = stem ? iconUrl(CS2_ICONS, stem) : null;
  if (game) return game;

  const className = classOf(weaponName, categories);
  const classStem = className ? CLASS_FILE[className] : null;
  return classStem ? iconUrl(CLASS_ICONS, classStem) : null;
}

/** Names the vendored pack covers, for the coverage test to walk. */
export const PACK_NAMES = Object.keys(GAME_FILE);

/** Classes the fallback can draw, for the same. */
export const DRAWN_CLASSES = Object.keys(CLASS_FILE);

/** The firing table's own art, still inline: the band animates its internals. */
export const BAND_ART: Record<string, string> = Object.fromEntries(
  Object.values(WEAPONS).map((weapon) => [weapon.name, weapon.art]),
);
