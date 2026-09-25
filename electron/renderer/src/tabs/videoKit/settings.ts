/**
 * The setting shapes every VIDEO card model is built from: an on/off, a line
 * of text, a number, one choice out of N. Each hook binds one config key and
 * its words (label, tooltip) once, so the three styles of a card draw the same
 * object and can never write a different key or drift a tooltip.
 *
 * Numbers are STORED AS NUMBERS. The old fields stored whatever was typed
 * ("90", "1.0", "abc"), and the engine then did `int(cfg["hlae_fov"])` on it:
 * a typed word crashed the run's summary line. A box that does not hold a
 * number now keeps the current value instead.
 */
import { asNumber } from "../../settings/asNumber";
import { useSetting } from "../../settings/store";

export interface BoolSetting {
  key: string;
  on: boolean;
  label: string;
  tip: string;
  set: (on: boolean) => void;
  toggle: () => void;
}

export interface TextSetting {
  key: string;
  value: string;
  label: string;
  tip: string;
  placeholder?: string;
  set: (value: string) => void;
}

/** One number. `min`..`max` is where a drag stops, never a cap on a typed value. */
export interface NumSetting {
  key: string;
  value: number;
  label: string;
  min: number;
  max: number;
  /** One drag / arrow step. */
  step: number;
  unit: string;
  tip: string;
  /** Shortcut values the old window offered beside the field, if any. */
  quick: readonly number[];
  /** Takes a number or the text of a box; stores a number either way. */
  set: (value: number | string) => void;
}

export interface ChoiceSetting<V extends string = string> {
  key: string;
  value: V;
  options: readonly V[];
  label: string;
  tip: string;
  set: (value: V) => void;
}

export function useBool(key: string, label: string, tip: string, fallback = false): BoolSetting {
  const [raw, set] = useSetting<boolean>(key);
  const on = raw === undefined || raw === null ? fallback : !!raw;
  return { key, on, label, tip, set, toggle: () => set(!on) };
}

export function useText(key: string, label: string, tip: string, placeholder?: string): TextSetting {
  const [raw, set] = useSetting<string>(key);
  return { key, value: typeof raw === "string" ? raw : raw == null ? "" : String(raw), label, tip, placeholder, set };
}

export interface NumSpec {
  label: string;
  unit?: string;
  /** Drag range. */
  min: number;
  max: number;
  step?: number;
  /** Decimals a stored value keeps (0 = a whole number). */
  decimals?: number;
  /** The value shown while the key is unset. */
  fallback: number;
  tip: string;
  quick?: readonly number[];
}

/**
 * A typed or dragged number, rounded to `decimals`. Text that is not a number
 * (an empty box, "abc") gives back `current`, so a half-typed box never
 * stores 0.
 */
export function toStoredNumber(value: number | string, current: number, decimals: number): number {
  if (typeof value === "string" && value.trim() === "") return current;
  const parsed = asNumber(typeof value === "string" ? value.trim() : value, Number.NaN);
  if (!Number.isFinite(parsed)) return current;
  return Number(parsed.toFixed(decimals));
}

export function useNum(key: string, spec: NumSpec): NumSetting {
  const [raw, set] = useSetting<number | string>(key);
  const value = raw === undefined || raw === null ? spec.fallback : asNumber(raw, spec.fallback);
  const decimals = spec.decimals ?? 0;
  return {
    key,
    value,
    label: spec.label,
    // A stored value past the drag range stays reachable: the range grows to it.
    min: Math.min(spec.min, value),
    max: Math.max(spec.max, value),
    step: spec.step ?? 1,
    unit: spec.unit ?? "",
    tip: spec.tip,
    quick: spec.quick ?? [],
    set: (next) => set(toStoredNumber(next, value, decimals)),
  };
}

export function useChoice<V extends string>(
  key: string,
  options: readonly V[],
  fallback: V,
  label: string,
  tip: string,
): ChoiceSetting<V> {
  const [raw, set] = useSetting<string>(key);
  const value = (options as readonly string[]).includes(raw ?? "") ? (raw as V) : fallback;
  return { key, value, options, label, tip, set };
}
