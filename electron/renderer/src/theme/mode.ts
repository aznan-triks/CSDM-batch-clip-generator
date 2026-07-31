/**
 * The day/night switch.
 *
 * It reuses the EXISTING `theme_bg` setting rather than inventing a key: the
 * window already offered four grounds, the key already lives in
 * DEFAULT_CONFIG, and the parity ledger already listed it as unported. So this
 * introduces no config key and no migration -- it gives a sleeping key its
 * control back.
 *
 * Four of the five grounds are night variants. They share one dark palette
 * until someone asks for distinct ones; what matters is that none of them can
 * land in light mode by accident, which is what the mapping table makes
 * impossible to get wrong.
 *
 * No colour lives here. This file only routes a setting to an attribute; the
 * palettes are in tokens.css, and the CSS cascade does the rest.
 */

export type Mode = "light" | "dark";

/**
 * Every value `theme_bg` can hold, and the mode it selects. The source of
 * truth is `_BG_PRESETS` in csdm/theme.py (the themes the Tkinter UI offers),
 * NOT the config.py comment -- which lists only four and omits `terminal`, a
 * dark green terminal look (BG #0a0c10) that real saved configs use. An
 * unmapped ground crashed nothing but silently fell back to the default,
 * which is how a saved `terminal` theme rendered as generic dark.
 */
export const GROUND_MODES: Record<string, Mode> = {
  white: "light",
  dark: "dark",
  amoled: "dark",
  deepblue: "dark",
  terminal: "dark",
};

/**
 * The default ground AND the fallback for an unrecognised value. `white`
 * (light mode) matches the V12 mock, which boots `apply('Light')` -- the mock
 * is the reference, so a fresh install opens light, not the legacy Tkinter
 * dark. Dark mode stays available; it is just no longer the default.
 */
export const DEFAULT_GROUND = "white";

/**
 * Point the document at a palette. Returns the mode actually applied, so a
 * caller can tell that its value was not recognised.
 *
 * TWO attributes, and they answer two different questions. `data-mode` is
 * light-or-night, which the ~40 component stylesheets and the contrast guard
 * already key on; `data-ground` is WHICH night, which theme/grounds.css keys
 * on. Four of the five grounds used to collapse into one screen because only
 * the first was ever written -- `dark`, `amoled`, `deepblue` and `terminal`
 * came back byte-identical when measured.
 *
 * An unrecognised value falls back to the default for BOTH, so a stale config
 * can never leave the document stamped with a ground no stylesheet defines.
 */
export function applyMode(themeBg: string): Mode {
  const known = themeBg in GROUND_MODES ? themeBg : DEFAULT_GROUND;
  const mode = GROUND_MODES[known];
  document.documentElement.setAttribute("data-mode", mode);
  document.documentElement.setAttribute("data-ground", known);
  return mode;
}
