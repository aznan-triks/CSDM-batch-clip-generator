/**
 * Step arithmetic for the number controls (NumberToken, SmallCardCountTile).
 * A step of 1 keeps whole numbers; a step of 0.1 keeps one decimal, without
 * the float noise (0.30000000000000004) a plain `+ 0.1` would store.
 */

/** Decimals a step carries: 1 -> 0, 0.1 -> 1, 0.05 -> 2. */
export function stepDecimals(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** `value` on the nearest multiple of `step`, rounded to the step's decimals. */
export function snapToStep(value: number, step: number): number {
  const snapped = Math.round(value / step) * step;
  return Number(snapped.toFixed(stepDecimals(step)));
}

/**
 * `value` written with at least the step's decimals: 1 at step 0.1 reads
 * "1.0"; a typed 2.5 at step 1 still reads "2.5", never a rounded "3".
 */
export function formatStep(value: number, step: number): string {
  return value.toFixed(Math.max(stepDecimals(step), stepDecimals(value)));
}
