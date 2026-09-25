/**
 * The Timing & Retries card's ONE data model.
 *
 * Every card style draws this model and nothing else: the five keys, their
 * whole-number rule and the tooltips live here once, so a style can never
 * write a different key, store a typed string or drift a tooltip.
 *
 * Every setter stores a whole, non-negative number -- the batch loop counts
 * and sleeps with these (a typed "4" once crashed `1 + retry_count`).
 */
import { asNumber } from "../../settings/asNumber";
import { useSetting } from "../../settings/store";
import { pacingSummary } from "../clipWindow";

/** Demo processing order, exactly as the engine reads them. */
export const CLIP_ORDERS = ["chrono", "random"] as const;
export type ClipOrder = (typeof CLIP_ORDERS)[number];

/** One whole-number setting. `max` is where a drag stops, never a cap on a typed value. */
export interface CountSetting {
  key: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  tip: string;
  /** Takes a number or the text of a box; stores a whole number either way. */
  set: (value: number | string) => void;
}

export interface TimingRetriesModel {
  retries: CountSetting;
  retryDelay: CountSetting;
  timeout: CountSetting;
  demoPause: CountSetting;
  order: { key: string; value: ClipOrder; tip: string; set: (value: ClipOrder) => void };
  /** What a batch does on a failure and between demos, in words. */
  summary: string;
}

export const TIPS = {
  retries: "Extra attempts for a recording that fails, before the demo is marked failed. 0 = no retry",
  retryDelay: "Seconds to wait before each retry of a failed recording",
  timeout:
    "A recording that runs longer than this is stopped and retried. 0 = automatic, from the length of the clips; a value here can only make the wait longer",
  demoPause: "Seconds to pause between two demos, giving CS2 and the recorder time to reset",
  order: "Order in which demos are recorded: chronological by match date, or shuffled",
} as const;

/** How far a drag or a slider reaches; a typed value may go beyond. */
const DRAG_RANGES = {
  retries: 10,
  retryDelay: 120,
  timeout: 60,
  demoPause: 60,
} as const;

/**
 * A whole, non-negative number: a count of retries, seconds or minutes.
 * An empty box keeps `fallback` (the current value) rather than jumping to 0.
 */
export function asCount(value: unknown, fallback: number): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  return Math.max(0, Math.round(asNumber(value, fallback)));
}

function useCount(key: string, unit: string, dragMax: number, tip: string): CountSetting {
  const [raw, set] = useSetting<number>(key);
  const value = asCount(raw, 0);
  return {
    key,
    value,
    min: 0,
    // A stored value past the drag range stays reachable: the range grows to it.
    max: Math.max(dragMax, value),
    unit,
    tip,
    set: (next) => set(asCount(next, value)),
  };
}

export function useTimingRetries(): TimingRetriesModel {
  const retries = useCount("retry_count", "", DRAG_RANGES.retries, TIPS.retries);
  const retryDelay = useCount("retry_delay", "s", DRAG_RANGES.retryDelay, TIPS.retryDelay);
  const timeout = useCount("recording_timeout", " min", DRAG_RANGES.timeout, TIPS.timeout);
  const demoPause = useCount("delay_between_demos", "s", DRAG_RANGES.demoPause, TIPS.demoPause);
  const [orderRaw, setOrder] = useSetting<string>("clip_order");
  const order: ClipOrder = orderRaw === "random" ? "random" : CLIP_ORDERS[0];

  return {
    retries,
    retryDelay,
    timeout,
    demoPause,
    order: { key: "clip_order", value: order, tip: TIPS.order, set: setOrder },
    summary: pacingSummary({
      retries: retries.value,
      retryDelay: retryDelay.value,
      demoPause: demoPause.value,
      timeoutMin: timeout.value,
      order,
    }),
  };
}

/** Words for the order, shared by every style. */
export const ORDER_WORDS: Record<ClipOrder, { title: string; words: string }> = {
  chrono: { title: "By date", words: "match-date order" },
  random: { title: "Shuffled", words: "random order" },
};
