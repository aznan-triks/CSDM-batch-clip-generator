/**
 * The accent is the one colour the user owns (D9/D23).
 *
 * Setting it rewrites four custom properties on `:root`: the accent itself,
 * its lit and shaded siblings, and the label colour that sits ON it. The three
 * derived ones are never hand-set -- a user-chosen accent has no hand to set
 * them, and a hardcoded pair would only be right for the default gold.
 *
 * `--on-gold` is not a constant: the mock's near-black label reads at 8:1 on
 * gold and at 1.2:1 on navy. It is chosen by measuring both candidates, the
 * same rule `_contrast_fg` already applies on the Tkinter side.
 */

/** Every derived value lives here. A ratio inside a function would be a bug. */
const ACCENT = {
  /** Lightness multiplier for `--gold-hi`, measured on the mock's #E0BB68. */
  litLightness: 1.2,
  /** Lightness multiplier for `--gold-d`, measured on the mock's #8A6E2E. */
  shadedLightness: 0.67,
  /** The two candidates for a label sitting on the accent. */
  onAccentDark: "#0B0E12",
  onAccentLight: "#F0F4F8",
} as const;

export const ACCENT_PRESETS = [
  { name: "Gold", hex: "#C8A24A" },
  { name: "Green", hex: "#22C55E" },
  { name: "Blue", hex: "#3B82F6" },
  { name: "Orange", hex: "#F97316" },
  { name: "Purple", hex: "#A855F7" },
  { name: "Red", hex: "#EF4444" },
  { name: "Cyan", hex: "#06B6D4" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Yellow", hex: "#EAB308" },
] as const;

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex;

/**
 * `theme_accent` is a config key shared with the Tkinter host (same
 * `csdm_config.json`), which still writes a legacy preset NAME (lowercase:
 * green|blue|orange|purple|red|cyan|pink|yellow -- `csdm/theme.py`'s
 * `_ACCENT_PRESETS`, documented in `csdm/config.py:39`), not always a hex
 * string. Electron only ever WRITES hex (`SettingsTab.tsx`'s `chooseAccent`),
 * but must still READ whatever the other host wrote -- passing a bare name
 * straight to `applyAccent` crashed on boot (`hexToRgb` rejects anything that
 * is not `#rrggbb`). Anything that is not a known preset name passes through
 * unchanged, so a genuinely corrupt value still fails fast in `hexToRgb`,
 * exactly as before.
 */
export function resolveAccent(value: string): string {
  const preset = ACCENT_PRESETS.find((candidate) => candidate.name.toLowerCase() === value.toLowerCase());
  return preset ? preset.hex : value;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` or `#rrggbb`. Throws on anything else: a bad accent must not pass silently. */
export function hexToRgb(hex: string): Rgb {
  const body = hex.replace("#", "");
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`not a hex colour: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.1 contrast ratio, always >= 1, order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Scale a colour's lightness, keeping its hue and saturation. */
export function scaleLightness(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const target = Math.min(1, Math.max(0, l * factor));

  if (max === min) {
    // Grey: hue and saturation are undefined, so scale the channels directly.
    const v = target * 255;
    return rgbToHex({ r: v, g: v, b: v });
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;

  const q = target < 0.5 ? target * (1 + s) : target + s - target * s;
  const p = 2 * target - q;
  const toChannel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return rgbToHex({
    r: toChannel(h + 1 / 3) * 255,
    g: toChannel(h) * 255,
    b: toChannel(h - 1 / 3) * 255,
  });
}

/** Whichever of the two candidates reads better on `background`. */
export function readableOn(background: string): string {
  return contrastRatio(ACCENT.onAccentDark, background) >=
    contrastRatio(ACCENT.onAccentLight, background)
    ? ACCENT.onAccentDark
    : ACCENT.onAccentLight;
}

/**
 * Apply an accent to the whole interface. Every rule reads these four
 * properties, so one write repaints everything -- there is no second place to
 * update and no component to notify.
 */
export function applyAccent(hex: string, root: HTMLElement = document.documentElement): void {
  const accent = rgbToHex(hexToRgb(hex)); // normalises #rgb and casing, and validates
  root.style.setProperty("--gold", accent);
  root.style.setProperty("--gold-hi", scaleLightness(accent, ACCENT.litLightness));
  root.style.setProperty("--gold-d", scaleLightness(accent, ACCENT.shadedLightness));
  root.style.setProperty("--on-gold", readableOn(accent));
}
