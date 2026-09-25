/**
 * Read a setting that should be a number, tolerating the string a text field
 * leaves behind. Anything that does not parse to a finite number gives back
 * `fallback` (usually the current value), never NaN.
 *
 * One copy for every tab: CAPTURE, VIDEO and SETTINGS each carried their own.
 */
export function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
