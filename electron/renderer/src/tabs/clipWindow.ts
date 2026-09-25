/**
 * Plain-language summaries of the Capture & Timing and Timing & Retries
 * cards, derived from the current values -- no value of their own.
 *
 * The arithmetic mirrors the engine and must follow it if it changes:
 *   - `_effective_before` (csdm/engine/core.py): in `both` perspective the
 *     switch delay is added to the seconds before;
 *   - `_build_sequences`: two clips merge when the gap between the first
 *     clip's end and the next clip's start is at most the (effective)
 *     seconds before. With events at t1 < t2, that is
 *     t2 - t1 <= after + 2 * before.
 *   - `_worker`: `recording_timeout` 0 means the automatic timeout; a value
 *     only ever raises it, never lowers it.
 */

export interface ClipWindowInput {
  before: number;
  after: number;
  perspective: string;
  switchDelay: number;
}

export interface ClipWindow {
  /** Seconds recorded before each event, switch delay included. */
  before: number;
  after: number;
  /** Events at most this many seconds apart end up in the same clip. */
  mergeWithin: number;
}

export function clipWindow({ before, after, perspective, switchDelay }: ClipWindowInput): ClipWindow {
  const effectiveBefore = before + (perspective === "both" ? Math.max(0, switchDelay) : 0);
  return { before: effectiveBefore, after, mergeWithin: after + 2 * effectiveBefore };
}

export function clipWindowSummary(input: ClipWindowInput): string {
  const w = clipWindow(input);
  return (
    `Each clip: ${w.before}s before → event → ${w.after}s after. ` +
    `Events up to ${w.mergeWithin}s apart share one clip.`
  );
}

export interface PacingInput {
  retries: number;
  retryDelay: number;
  demoPause: number;
  timeoutMin: number;
}

export function pacingSummary({ retries, retryDelay, demoPause, timeoutMin }: PacingInput): string {
  const retry =
    retries > 0
      ? `A failed recording is retried up to ${retries}× (${retryDelay}s apart).`
      : "A failed recording is not retried.";
  const timeout =
    timeoutMin > 0
      ? `a stuck recording is stopped after at least ${timeoutMin} min`
      : "a stuck recording is stopped after an automatic delay";
  return `${retry} ${demoPause}s pause between demos; ${timeout}.`;
}
