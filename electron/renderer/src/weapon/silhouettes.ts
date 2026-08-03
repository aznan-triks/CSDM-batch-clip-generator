import { WEAPONS } from "./weapons";

/**
 * A silhouette for every weapon the database can return.
 *
 * Measured before this: the database returns 42 weapons and the firing table
 * held art for two, AK-47 and AWP. `WeaponFilterSection` drew the mock's
 * cascade from that table, so picking any of the other forty showed nothing at
 * all -- indistinguishable from a click that had not registered.
 *
 * The art is the GAME'S OWN, extracted by `Juknum/counter-strike-icons` and
 * vendored under `assets/cs2/` (see `assets/cs2/SOURCE.md` for provenance, the
 * Valve ownership statement, and what was stripped on the way in). Every
 * hand-drawn shape this project ever carried is gone: there is one source of
 * weapon art now, and it is the game.
 *
 * DATA URIS, NOT URLS. `import.meta.glob` with `?url` was the original choice:
 * each icon is ~11 kB and there are 41 of them, so emitting separate asset
 * files kept 461 kB out of the JavaScript bundle. Vite 6 / Rolldown tree-shakes
 * eager globs by tracing the object keys statically, and the only caller
 * (`iconUrl` → `GAME_FILE` → 22 stems) caused Rolldown to emit only 22 SVGs.
 * The user-selected weapons whose stems fell outside that set showed nothing.
 * `?raw` inlines every SVG into the bundle (~500 kB) and, crucially, cannot
 * be tree-shaken because the strings are embedded eagerly. The trade-off is
 * real but acceptable: it is still ~500 kB of text before gzip, and an offline
 * desktop app does not pay the network cost of a URL-based approach. A
 * pre-built lookup (stem → data URI) makes `silhouetteFor` O(1) instead of
 * O(n) per call, which was the reported slowness with 30 selected weapons.
 */

/** Every vendored CS2 icon, as its raw SVG text, indexed by file path. */
const CS2_ICONS = import.meta.glob("./assets/cs2/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/**
 * Pre-built lookup: file stem → base64 data URI.
 * Built once at module load so `silhouetteFor` is O(1) instead of calling
 * `Object.keys(map).find(…endsWith(…))` for every picked weapon.
 */
const ICON_BY_STEM: Record<string, string> = {};
for (const [path, svg] of Object.entries(CS2_ICONS)) {
  const match = path.match(/\/([^/]+)\.svg$/);
  if (match) {
    ICON_BY_STEM[match[1]] = `data:image/svg+xml;base64,${btoa(svg)}`;
  }
}

/**
 * Database weapon name -> the file name the game uses for it.
 *
 * The two spellings genuinely differ -- `P2000` is `hkp2000` in the game files,
 * `Dual Berettas` is `elite`, `Zeus x27` is `taser`, `PP-Bizon` is `bizon` --
 * so this table is the translation and there is no cleverness to replace it
 * with. `M4A4` is the game's plain `m4a1` and `M4A1` is `m4a1_silencer`: that
 * is the game's own naming, not a mistake here.
 *
 * `World` is the database's pseudo-weapon for world damage. The pack's own
 * `world.svg` and `worldent.svg` are both EMPTY frames, so it takes
 * `prop_exploding_barrel` -- still the game's art, and the nearest thing it
 * ships to "the environment killed you".
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
  World: "prop_exploding_barrel",
  XM1014: "xm1014",
  "Zeus x27": "taser",
};

/**
 * The icon URL to paint for a weapon, or null when the pack has nothing for it.
 *
 * Null rather than a placeholder: a weapon the pack does not cover is a real
 * gap, and a generic shape over it would hide that this table needs a line.
 * There is no longer any hand-drawn shape to fall back to, on purpose.
 */
export function silhouetteFor(weaponName: string): string | null {
  const stem = GAME_FILE[weaponName];
  if (!stem) return null;
  return ICON_BY_STEM[stem] ?? null;
}

/** Names the vendored pack covers, for the coverage test to walk. */
export const PACK_NAMES = Object.keys(GAME_FILE);

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

/** The firing table's own art, still inline: the band animates its internals. */
export const BAND_ART: Record<string, string> = Object.fromEntries(
  Object.values(WEAPONS).map((weapon) => [weapon.name, weapon.art]),
);
