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

/** The fallback, and the same default the Python config ships. */
export const DEFAULT_GROUND = "dark";

/**
 * Point the document at a palette. Returns the mode actually applied, so a
 * caller can tell that its value was not recognised.
 */
export function applyMode(themeBg: string): Mode {
  const mode = GROUND_MODES[themeBg] ?? GROUND_MODES[DEFAULT_GROUND];
  document.documentElement.setAttribute("data-mode", mode);
  return mode;
}
