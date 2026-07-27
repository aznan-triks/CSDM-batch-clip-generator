/**
 * The motion engine: a registry of sequences, an intensity gate, and cleanup
 * that runs off the clock.
 *
 * Two rules shape all of this.
 *
 * 1. A LONG SEQUENCE IS NEVER STARTED BY A CLICK (D18). The click sends a
 *    command; the engine's `state` event plays the sequence. That is what
 *    makes it impossible for an animation to lie about the real state -- a
 *    charge cannot detonate because a timer said so, only because the engine
 *    said the process is gone.
 *
 * 2. CLEANUP RUNS OFF THE CLOCK, NEVER OFF `onfinish`. `onfinish` does not
 *    fire while the window is hidden or the tab is throttled: effects stayed
 *    pinned mid-animation and spawned elements piled up in the effects layer.
 *    Session 2 correction -- do not "simplify" this back.
 */
import { DECORATIVE_SEQUENCES, MOTION } from "./tokens";

export type Intensity = "none" | "sober" | "full";

export const INTENSITIES: readonly Intensity[] = ["none", "sober", "full"] as const;

/** What a sequence is handed. It never reads a number of its own. */
export interface SequenceContext {
  /** The effects layer. Everything spawned lands here and nowhere else. */
  host: HTMLElement;
  /** The intensity actually in force, after the system preference is applied. */
  intensity: Intensity;
  /** Scale a duration for the current intensity. Always use this, never a raw number. */
  scale(seconds: number): number;
  /** Create a tracked element. Cancelling the sequence removes it. */
  spawn(className: string, x?: number, y?: number): HTMLElement;
  /** Remove an element after `seconds`, on the clock. */
  hold(element: Element, seconds: number): void;
  /** Run a callback after `seconds`, on a tracked timer. */
  after(seconds: number, run: () => void): void;
  /** Repeat a callback every `seconds`, on a tracked timer, until cancelled. */
  every(seconds: number, run: () => void): void;
  /** False under `sober`: decorative flourishes are dropped, the beat is kept. */
  decorative: boolean;
  /** Free-form payload from the state event that triggered this sequence. */
  payload: Record<string, unknown>;
}

export interface SequenceDefinition {
  play(context: SequenceContext): void;
  /**
   * Applied INSTEAD of `play` when motion is off, so the end state still
   * happens. A sequence with no end state to apply can omit it.
   */
  settle?(context: SequenceContext): void;
}

/** Cancels a running sequence: stops its timers and removes what it spawned. */
export type Cancel = () => void;

// -- the registry. Dependencies go through it, never through direct imports. --

const SEQUENCES = new Map<string, SequenceDefinition>();

export function registerSequence(name: string, definition: SequenceDefinition): void {
  if (SEQUENCES.has(name)) {
    // Fail fast: two definitions under one name means one of them silently
    // never runs, and finding that later is expensive.
    throw new Error(`sequence already registered: ${name}`);
  }
  SEQUENCES.set(name, definition);
}

export function registeredSequences(): string[] {
  return [...SEQUENCES.keys()];
}

/** Test seam only: forget every registration. */
export function resetSequences(): void {
  SEQUENCES.clear();
}

// -- intensity --

let intensity: Intensity = "full";
const listeners = new Set<(value: Intensity) => void>();

export function setIntensity(value: Intensity): void {
  intensity = value;
  for (const listener of listeners) listener(effectiveIntensity());
}

export function getIntensity(): Intensity {
  return intensity;
}

export function onIntensityChange(listener: (value: Intensity) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when the system asks for reduced motion. Safe where matchMedia is absent. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The intensity actually in force. The system preference WINS over the user
 * setting -- it is an accessibility signal, not a suggestion. The settings
 * screen shows why the control is neutralised rather than silently ignoring it.
 */
export function effectiveIntensity(): Intensity {
  return prefersReducedMotion() ? "none" : intensity;
}

/** True when the user's chosen intensity is being overridden by the system. */
export function isOverriddenBySystem(): boolean {
  return prefersReducedMotion() && intensity !== "none";
}

function durationScale(value: Intensity): number {
  return value === "sober" ? MOTION.sober.durationFactor : 1;
}

// -- playing --

/**
 * Play a registered sequence. Returns a canceller.
 *
 * Under `none` the sequence never starts: its end state is applied directly,
 * so the interface still ends up where it belongs, it just gets there without
 * moving.
 */
export function play(
  name: string,
  host: HTMLElement,
  payload: Record<string, unknown> = {},
): Cancel {
  const definition = SEQUENCES.get(name);
  if (!definition) {
    throw new Error(`unknown sequence: ${name}`);
  }

  const active = effectiveIntensity();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const intervals: ReturnType<typeof setInterval>[] = [];
  const spawned: Element[] = [];

  const cancel: Cancel = () => {
    for (const timer of timers) clearTimeout(timer);
    for (const interval of intervals) clearInterval(interval);
    timers.length = 0;
    intervals.length = 0;
    for (const element of spawned) element.remove();
    spawned.length = 0;
  };

  const scale = (seconds: number) => seconds * durationScale(active);
  const ms = (seconds: number) => Math.max(0, seconds) * 1000;

  const context: SequenceContext = {
    host,
    intensity: active,
    scale,
    payload,
    decorative: active === "full",
    spawn(className, x, y) {
      const element = document.createElement("div");
      element.className = className;
      if (x !== undefined && y !== undefined) {
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
      }
      host.appendChild(element);
      spawned.push(element);
      return element;
    },
    hold(element, seconds) {
      // Clock, not onfinish. See the file header.
      timers.push(
        setTimeout(() => {
          element.remove();
          const index = spawned.indexOf(element);
          if (index >= 0) spawned.splice(index, 1);
        }, ms(seconds + MOTION.cleanupGrace)),
      );
    },
    after(seconds, run) {
      timers.push(setTimeout(run, ms(seconds)));
    },
    every(seconds, run) {
      intervals.push(setInterval(run, ms(seconds)));
    },
  };

  if (active === "none") {
    definition.settle?.(context);
    return cancel;
  }

  definition.play(context);
  return cancel;
}

/** Whether a named flourish should play at the current intensity. */
export function playsDecorative(name: (typeof DECORATIVE_SEQUENCES)[number]): boolean {
  return effectiveIntensity() === "full" && DECORATIVE_SEQUENCES.includes(name);
}
