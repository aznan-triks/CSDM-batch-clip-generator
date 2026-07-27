/**
 * The engine's state, as the interface sees it.
 *
 * This subscribes to the `state` channel and nothing else. It deliberately
 * covers ONLY the events the Python engine actually raises today, verified by
 * reading `csdm/engine/core.py` rather than trusting the documented list:
 *
 *     progress · buttons_idle · summary · demos_unchecked ·
 *     preview_ready · demo_entry
 *
 * `buttons_busy` is in the protocol's vocabulary and in the demo command in
 * `csdm/bridge/host.py`, but NO engine code path raises it. It is handled here
 * so the shape is right the day it gets a producer, and `busy` is otherwise
 * inferred from `buttons_idle` alone.
 *
 * There is deliberately NO mapping from a state event to an action animation
 * here. Three of the four actions have no engine-side existence yet -- see the
 * chantier 3 notes. Wiring an animation to an event that is never raised, or
 * to a click, would be exactly the lie D18 exists to prevent.
 */
import { useEffect, useState } from "react";

import { onMessage } from "../bridge";

export interface SummaryLine {
  text: string;
  level: string;
}

export interface EngineState {
  /** False once the engine has reported it is idle again. */
  busy: boolean;
  /** The latest progress line, or null before the first one. */
  progress: string | null;
  /** The latest summary line, or null. */
  summary: SummaryLine | null;
  /** Demo paths the engine asked the picker to uncheck. */
  uncheckedPaths: string[];
  /** How many demo entries have been reported this run. */
  demoEntries: number;
  /** True once a preview result has arrived. */
  previewReady: boolean;
}

export const INITIAL_ENGINE_STATE: EngineState = {
  busy: false,
  progress: null,
  summary: null,
  uncheckedPaths: [],
  demoEntries: 0,
  previewReady: false,
};

/** Fold one state event into the current state. Pure, so it is directly testable. */
export function reduceEngineState(
  state: EngineState,
  name: string,
  payload: Record<string, unknown>,
): EngineState {
  switch (name) {
    case "buttons_idle":
      return { ...state, busy: false };
    case "buttons_busy":
      return { ...state, busy: true };
    case "progress":
      return { ...state, progress: String(payload.text ?? "") };
    case "summary":
      return {
        ...state,
        summary: { text: String(payload.text ?? ""), level: String(payload.level ?? "") },
      };
    case "demos_unchecked":
      return {
        ...state,
        uncheckedPaths: Array.isArray(payload.paths) ? payload.paths.map(String) : [],
      };
    case "demo_entry":
      return { ...state, demoEntries: state.demoEntries + 1 };
    case "preview_ready":
      return { ...state, previewReady: true, busy: false };
    default:
      // An unknown event is not an error: the engine may grow new ones, and an
      // interface that crashes on them would block the engine from evolving.
      return state;
  }
}

export function useEngineState(): EngineState {
  const [state, setState] = useState<EngineState>(INITIAL_ENGINE_STATE);

  useEffect(() => {
    return onMessage((message) => {
      if (message.type !== "state") return;
      setState((previous) => reduceEngineState(previous, message.name, message.payload));
    });
  }, []);

  return state;
}
