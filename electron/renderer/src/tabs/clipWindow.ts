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
  /** Seconds before the moment filmed from the killer's (or the only) camera. */
  lead: number;
  /** Seconds before the moment filmed from the victim, `both` only (else 0). */
  victimView: number;
  /** Seconds recorded before each event, switch delay included. */
  before: number;
  after: number;
  /** Length of the clip one isolated moment produces. */
  total: number;
  /** Events at most this many seconds apart end up in the same clip. */
  mergeWithin: number;
}

export function clipWindow({ before, after, perspective, switchDelay }: ClipWindowInput): ClipWindow {
  const victimView = perspective === "both" ? Math.max(0, switchDelay) : 0;
  const effectiveBefore = before + victimView;
  return {
    lead: before,
    victimView,
    before: effectiveBefore,
    after,
    total: effectiveBefore + after,
    mergeWithin: after + 2 * effectiveBefore,
  };
}

export function clipWindowSummary(input: ClipWindowInput): string {
  const w = clipWindow(input);
  const parts =
    w.victimView > 0
      ? `${w.lead}s on the killer, ${w.victimView}s on the victim, ${w.after}s after`
      : `${w.before}s before, ${w.after}s after`;
  return (
    `Each moment becomes a clip of ${w.total}s (${parts}), ` +
    `and moments up to ${w.mergeWithin}s apart are joined into one clip.`
  );
}

export interface PacingInput {
  retries: number;
  retryDelay: number;
  demoPause: number;
  timeoutMin: number;
  order: string;
}

/** "If a recording fails", in words. */
function failureSummary({ retries, retryDelay, timeoutMin }: PacingInput): string {
  const retry =
    retries > 0
      ? `A failed recording is tried again up to ${retries} ${retries === 1 ? "time" : "times"}, ${retryDelay}s apart`
      : "A failed recording is not tried again";
  const timeout =
    timeoutMin > 0
      ? `one that hangs is stopped after at least ${timeoutMin} min`
      : "one that hangs is stopped after a wait worked out from the clip length";
  return `${retry}; ${timeout}.`;
}

/** "Between demos", in words. */
function betweenDemosSummary({ demoPause, order }: PacingInput): string {
  const sequence = order === "random" ? "in random order" : "in match-date order";
  const pause = demoPause > 0 ? `a ${demoPause}s pause` : "no pause";
  return `Demos are recorded ${sequence}, with ${pause} between two.`;
}

export function pacingSummary(input: PacingInput): string {
  return `${failureSummary(input)} ${betweenDemosSummary(input)}`;
}
