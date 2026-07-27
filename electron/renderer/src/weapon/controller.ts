/**
 * Turns engine state events into weapon sequences.
 *
 * This is the piece that makes D18 true rather than merely intended: it takes
 * ONLY engine events as input. There is no `onClick` here and there must never
 * be one -- a click sends a command to Python, Python reports what it actually
 * did, and only then does anything move.
 *
 * The armed charge is the whole reason this is a stateful controller and not a
 * pure mapping: STOP starts a sequence that has no end of its own, and the
 * detonation that ends it arrives as a separate event, possibly a minute later,
 * possibly never.
 */
import { play, type Cancel } from "../motion/engine";
import { ACTION_SEQUENCES, registerWeaponSequences, type Point } from "./sequences";

/** Where the sequences need to aim. Supplied by the band, read at play time. */
export interface Geometry {
  /** The effects layer: everything a sequence spawns lands in here. */
  host: HTMLElement;
  /** The window frame, for shakes. */
  frame: HTMLElement | null;
  /** The element that recoils. */
  kick: HTMLElement | null;
  /** Where the barrel ends, in the effects layer's coordinates. */
  muzzle(): Point;
  /** What an action shoots at: the button that triggered it. */
  target(action: string): Point;
}

export interface ActionController {
  /** Feed one engine state event. Unknown names are ignored, not an error. */
  onState(name: string, payload?: Record<string, unknown>): void;
  /** True while a charge is planted and beeping. */
  isArmed(): boolean;
  /** Stop everything and clear the effects layer. */
  dispose(): void;
}

/** Which sequence each engine event plays. The only mapping there is. */
const EVENT_SEQUENCES: Record<string, string> = {
  run_started: ACTION_SEQUENCES.run,
  preview_started: ACTION_SEQUENCES.preview,
  stop_requested: ACTION_SEQUENCES.stop,
  kill_requested: ACTION_SEQUENCES.kill,
  process_exited: ACTION_SEQUENCES.detonate,
};

/** Which button each action aims at, by engine event name. */
const EVENT_TARGETS: Record<string, string> = {
  run_started: "run",
  preview_started: "preview",
  stop_requested: "stop",
  kill_requested: "kill",
  process_exited: "stop",
};

export function createActionController(
  geometry: Geometry,
  weaponId: () => string,
): ActionController {
  registerWeaponSequences();

  /** The running one-shot sequence, if any. */
  let current: Cancel | null = null;
  /** The armed charge's beeping loop. Outlives `current` on purpose. */
  let armed: Cancel | null = null;

  function payloadFor(event: string): Record<string, unknown> {
    return {
      weaponId: weaponId(),
      muzzle: geometry.muzzle(),
      target: geometry.target(EVENT_TARGETS[event] ?? "run"),
      kick: geometry.kick,
      frame: geometry.frame,
    };
  }

  return {
    onState(name) {
      const sequence = EVENT_SEQUENCES[name];
      if (!sequence) return;

      if (name === "stop_requested") {
        // A second stop while one is already armed changes nothing: the charge
        // is already down and already waiting.
        if (armed) return;
        current?.();
        current = null;
        armed = play(sequence, geometry.host, payloadFor(name));
        return;
      }

      if (name === "process_exited") {
        // Nothing was armed: the process died for a reason the interface never
        // staged, so there is nothing to blow up. Staying silent is the honest
        // answer -- a detonation here would be an animation with no cause.
        if (!armed) return;
        armed();
        armed = null;
        current?.();
        current = play(sequence, geometry.host, payloadFor(name));
        return;
      }

      current?.();
      current = play(sequence, geometry.host, payloadFor(name));
    },
    isArmed() {
      return armed !== null;
    },
    dispose() {
      current?.();
      armed?.();
      current = null;
      armed = null;
    },
  };
}
