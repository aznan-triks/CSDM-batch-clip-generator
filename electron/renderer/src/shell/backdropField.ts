/**
 * The backdrop's numbers and its pure maths. No DOM, no React, no drawing.
 *
 * WHY A CANVAS AND NOT ELEMENTS -- this matters, because the obvious
 * implementation is one <div> per tile and it does not survive:
 * the mock shipped ~1500 tiles, each with a `mix-blend-mode` pseudo-element,
 * which forces one compositing layer PER TILE. It lagged at any density, and
 * no amount of tuning the tile size or the transition fixed it, because
 * neither was the cause. One bitmap surface redrawn in a single pass has no
 * per-tile DOM, no blend layers and no style recalc at all.
 *
 * Same rule as the MOTION table: every number is here. A number inside a
 * drawing function is a bug.
 */

/**
 * The shape of a ground. Written out rather than inferred from the table
 * below: `as const` would freeze every number to its own literal type, and a
 * per-tab override of `cell: 32` against a literal `38` is a type error rather
 * than the point of the exercise.
 */
export interface BackdropField {
  cell: number;
  gap: number;
  reach: number;
  ease: number;
  threshold: number;
  rampWidth: number;
  drift: { x: number; y: number };
  cluster: { scale: number; weight: number };
  band: { scaleX: number; scaleY: number; driftFactor: number; weight: number };
  falloffFloor: number;
  plateRadius: number;
  sheen: {
    tintAlpha: number;
    topBarAlpha: number;
    topBarHeight: number;
    scanAlpha: number;
    scanStep: number;
  };
  visibleFloor: number;
  maxPixelRatio: number;
  /**
   * The mark stamped on an active plate, on top of its sheen.
   *
   * The ground used to carry nothing but plates and scanlines -- "pas d'icônes
   * ni de motif dessus". Each tab picks its own, which is the other half of
   * making the ground configurable per page.
   */
  motif: Motif;
}

/**
 * The marks the ground can stamp. Geometric on purpose: they are redrawn every
 * frame inside the cursor's reach, and an image blit per plate is exactly the
 * per-tile cost that moved this whole layer off the DOM in the first place.
 */
export type Motif = "none" | "crosshair" | "hatch" | "dots" | "bracket";

export const BACKDROP: BackdropField = {
  /** Plate pitch in px, and the empty gap between two plates. */
  cell: 38,
  gap: 4,
  /** Activation window around the cursor, in cells (Chebyshev -> square, not round). */
  reach: 8,
  /** How fast a plate's intensity chases its target, per frame. */
  ease: 0.18,
  /** Hard threshold on the noise field, and the ramp width above it. */
  threshold: 0.62,
  rampWidth: 0.33,
  /** Time drift: slow shimmer. Multiplied by the frame timestamp in ms. */
  drift: { x: 0.00018, y: 0.00011 },
  /** Noise sampling: cluster octave and the horizontal data-band octave. */
  cluster: { scale: 0.5, weight: 0.6 },
  band: { scaleX: 0.18, scaleY: 1.3, driftFactor: 0.3, weight: 0.4 },
  /** Falloff toward the edge of the window: `floor + (1 - cheb / reach)`. */
  falloffFloor: 0.45,
  /** Paint: plate corner radius. */
  plateRadius: 5,
  /** Sheen on an active plate, all scaled by the plate's intensity. */
  sheen: { tintAlpha: 0.16, topBarAlpha: 0.22, topBarHeight: 2, scanAlpha: 0.3, scanStep: 3 },
  /** Below this intensity a plate is not worth a second pass. */
  visibleFloor: 0.02,
  /** Device pixel ratio is capped: beyond this the extra pixels buy nothing. */
  maxPixelRatio: 2,
  motif: "crosshair",
};

/**
 * The ground, per tab.
 *
 * Each entry states ONLY what it changes; the rest falls back to `BACKDROP`
 * above, so a tab that wants the default writes nothing and one that wants a
 * denser field writes one line. This is the whole of "the background should be
 * configurable per page" -- the drawing code is untouched and knows nothing
 * about tabs.
 *
 * The four values below are a starting point with a reason each, not a taste:
 * Tags is a reading screen, so its field is calmer and reaches less far;
 * Video carries dense forms, so its plates are quieter behind them; Settings
 * is the furthest from the work, so it is the liveliest. Change them here,
 * never in a drawing function.
 *
 * `cell`/`gap`/`maxPixelRatio`/`plateRadius` are deliberately NOT varied: a
 * plate that changes size from one tab to the next reads as a layout bug, not
 * a mood -- the grid must measure the same everywhere the user looks at it.
 */
export const BACKDROP_BY_TAB: Readonly<Record<string, Partial<BackdropField>>> = {
  capture: { motif: "crosshair" },
  tags: { reach: 6, threshold: 0.68, motif: "dots" },
  video: { threshold: 0.7, falloffFloor: 0.35, motif: "bracket" },
  settings: { reach: 10, threshold: 0.56, motif: "hatch" },
};

/**
 * The field a tab draws with. An unknown tab -- or none yet -- gets the
 * reference field rather than nothing, so the ground is never blank while the
 * shell decides which tab is open.
 */
export function fieldForTab(tab: string | null | undefined): BackdropField {
  return { ...BACKDROP, ...(tab ? (BACKDROP_BY_TAB[tab] ?? {}) : {}) };
}

/** Deterministic integer hash, mapped into [0, 1). */
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * 2D value noise: a hashed lattice with bilinear smoothing. Coherent, so
 * neighbouring cells agree and the field forms CLUSTERS rather than salt.
 */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/**
 * A plate's TARGET intensity in [0, 1]: 0 at rest, up to 1 under the cursor.
 * The caller eases towards this, which is what makes the fade fluid without a
 * single CSS transition.
 *
 * `time` is a frame timestamp in ms; it only drifts the noise field.
 */
export function cellIntensity(
  col: number,
  row: number,
  cursorCol: number,
  cursorRow: number,
  time: number,
  // The field is a PARAMETER, defaulting to the reference one: the tab decides
  // which numbers apply, and this function still knows nothing about tabs.
  field_: BackdropField = BACKDROP,
): number {
  const cheb = Math.max(Math.abs(col - cursorCol), Math.abs(row - cursorRow));
  if (cheb > field_.reach) return 0;

  const nx = time * field_.drift.x;
  const ny = time * field_.drift.y;
  const cluster = valueNoise(col * field_.cluster.scale + nx, row * field_.cluster.scale + ny);
  const band = valueNoise(
    col * field_.band.scaleX + nx * field_.band.driftFactor,
    row * field_.band.scaleY,
  );
  const field =
    (cluster * field_.cluster.weight + band * field_.band.weight) *
    (field_.falloffFloor + (1 - cheb / field_.reach));

  if (field <= field_.threshold) return 0;
  return Math.min(1, (field - field_.threshold) / field_.rampWidth);
}

/**
 * Pull the alpha channel out of an `rgba(r, g, b, a)` string, e.g. one read
 * straight from `--glow-in` / `--glow-out` via `getComputedStyle`. Those
 * tokens are already valid CSS colours; this is the one bit of them the
 * canvas needs as a plain number.
 */
export function parseAlpha(rgba: string): number {
  const match = rgba.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  return match ? Number(match[1]) : 1;
}

/**
 * The plate border's alpha, interpolated from the resting glow (`--glow-in`)
 * to the fully active glow (`--glow-out`) by the plate's own intensity. This
 * is what makes the border react to day/night mode: the two inputs are
 * mode-dependent tokens, not fixed constants.
 */
export function borderAlpha(glowInAlpha: number, glowOutAlpha: number, intensity: number): number {
  return glowInAlpha + intensity * (glowOutAlpha - glowInAlpha);
}

/**
 * Stamp a plate's motif. Pure drawing: the caller owns the colour and the
 * alpha, this only decides the shape.
 *
 * `size` is the plate's side. Everything is derived from it so a motif is
 * legible at any cell size a tab picks, and nothing here is a magic number
 * measured against one of them.
 */
export function drawMotif(
  ctx: CanvasRenderingContext2D,
  motif: Motif,
  x: number,
  y: number,
  size: number,
): void {
  const mid = size / 2;
  const arm = size * 0.18;

  switch (motif) {
    case "crosshair": {
      // Four ticks pointing at the plate's centre, never meeting it -- the
      // same language as the cursor's reticle and the cards' corner brackets.
      ctx.beginPath();
      ctx.moveTo(x + mid, y + size * 0.16);
      ctx.lineTo(x + mid, y + size * 0.16 + arm);
      ctx.moveTo(x + mid, y + size * 0.84);
      ctx.lineTo(x + mid, y + size * 0.84 - arm);
      ctx.moveTo(x + size * 0.16, y + mid);
      ctx.lineTo(x + size * 0.16 + arm, y + mid);
      ctx.moveTo(x + size * 0.84, y + mid);
      ctx.lineTo(x + size * 0.84 - arm, y + mid);
      ctx.stroke();
      return;
    }
    case "hatch": {
      // Two diagonals, corner to corner, inset so they never touch the edge.
      const inset = size * 0.24;
      ctx.beginPath();
      ctx.moveTo(x + inset, y + inset);
      ctx.lineTo(x + size - inset, y + size - inset);
      ctx.moveTo(x + size - inset, y + inset);
      ctx.lineTo(x + inset, y + size - inset);
      ctx.stroke();
      return;
    }
    case "dots": {
      // A quiet 2x2 -- the calmest mark, for a tab that is read rather than
      // worked in.
      const r = Math.max(1, size * 0.045);
      for (const cx of [size * 0.35, size * 0.65]) {
        for (const cy of [size * 0.35, size * 0.65]) {
          ctx.beginPath();
          ctx.arc(x + cx, y + cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    case "bracket": {
      // The card's own corner bracket, shrunk onto a plate.
      const inset = size * 0.22;
      const len = size * 0.2;
      ctx.beginPath();
      ctx.moveTo(x + inset, y + inset + len);
      ctx.lineTo(x + inset, y + inset);
      ctx.lineTo(x + inset + len, y + inset);
      ctx.moveTo(x + size - inset, y + size - inset - len);
      ctx.lineTo(x + size - inset, y + size - inset);
      ctx.lineTo(x + size - inset - len, y + size - inset);
      ctx.stroke();
      return;
    }
    case "none":
    default:
      return;
  }
}
