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
  /** Mate POV: the victim's side is filmed from the best-placed teammate. */
  matePov?: boolean;
}

/**
 * Range of each clip setting, from the window's own `tk.Scale` calls.
 *
 * Not configuration: they are the widget's range, the same category as a
 * field's width, and the engine clamps nothing on its own. Every card style
 * reads them from here.
 */
export const CLIP_RANGES = {
  before: { min: 1, max: 15 },
  after: { min: 1, max: 15 },
  switchDelay: { min: 0, max: 10 },
} as const;

type Range = { readonly min: number; readonly max: number };

export function clampTo(value: number, { min, max }: Range): number {
  return Math.max(min, Math.min(max, Math.round(value)));
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

/** Whose eyes film the seconds before, in words. */
function leadCamera({ perspective, matePov }: ClipWindowInput): string {
  if (perspective === "victim") return matePov ? "the best-placed teammate" : "the victim";
  return "the killer";
}

export function clipWindowSummary(input: ClipWindowInput): string {
  const w = clipWindow(input);
  const parts =
    w.victimView > 0
      ? `${w.lead}s on the killer, ${w.victimView}s on ${input.matePov ? "the best-placed teammate" : "the victim"}, ${w.after}s after`
      : `${w.before}s on ${leadCamera(input)} before, ${w.after}s after`;
  // "an 8s", "an 11s", "an 18s": the article follows how the number is said.
  const article = /^(8|11$|18$)/.test(String(w.total)) ? "an" : "a";
  return `Each moment becomes ${article} ${w.total}s clip (${parts}). A second moment within ${w.mergeWithin}s joins the same clip.`;
}

/** The three handles of a drawn clip: its start, the camera switch, its end. */
export type ClipHandle = "start" | "switch" | "end";

export interface ClipSeconds {
  before: number;
  after: number;
  switchDelay: number;
}

/**
 * Where a handle dragged to second `at` (0 = the moment) leaves the clip.
 *
 * The start handle sets the seconds before, the end handle the seconds after.
 * The switch handle (`both` only) trades killer seconds for victim seconds:
 * their sum -- the clip's start -- stays where it is.
 */
export function moveClipHandle(handle: ClipHandle, at: number, input: ClipWindowInput): ClipSeconds {
  const { victimView } = clipWindow(input);
  const next: ClipSeconds = { before: input.before, after: input.after, switchDelay: input.switchDelay };
  if (handle === "end") {
    next.after = clampTo(at, CLIP_RANGES.after);
  } else if (handle === "start") {
    next.before = clampTo(-at - victimView, CLIP_RANGES.before);
  } else {
    const lead = input.before + victimView;
    const maxSwitch = Math.min(CLIP_RANGES.switchDelay.max, lead - CLIP_RANGES.before.min);
    next.switchDelay = clampTo(-at, { min: CLIP_RANGES.switchDelay.min, max: Math.max(0, maxSwitch) });
    next.before = clampTo(lead - next.switchDelay, CLIP_RANGES.before);
  }
  return next;
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
