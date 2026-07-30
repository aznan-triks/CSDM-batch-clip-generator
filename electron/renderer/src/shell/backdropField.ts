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

export const BACKDROP = {
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
} as const;

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
): number {
  const cheb = Math.max(Math.abs(col - cursorCol), Math.abs(row - cursorRow));
  if (cheb > BACKDROP.reach) return 0;

  const nx = time * BACKDROP.drift.x;
  const ny = time * BACKDROP.drift.y;
  const cluster = valueNoise(col * BACKDROP.cluster.scale + nx, row * BACKDROP.cluster.scale + ny);
  const band = valueNoise(
    col * BACKDROP.band.scaleX + nx * BACKDROP.band.driftFactor,
    row * BACKDROP.band.scaleY,
  );
  const field =
    (cluster * BACKDROP.cluster.weight + band * BACKDROP.band.weight) *
    (BACKDROP.falloffFloor + (1 - cheb / BACKDROP.reach));

  if (field <= BACKDROP.threshold) return 0;
  return Math.min(1, (field - BACKDROP.threshold) / BACKDROP.rampWidth);
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
