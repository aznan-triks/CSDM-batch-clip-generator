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
 * Since v213 the engine also raises `buttons`, `buttons_busy`, `run_started`,
 * `preview_started`, `stop_requested`, `kill_requested` and `process_exited`.
 *
 * There is still deliberately NO mapping from a state event to an animation
 * here: that lives in `weapon/controller.ts`, which takes engine events and
 * nothing else. Keeping it out of this hook is what stops a click from ever
 * becoming an animation trigger (D18).
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
  /** RUN is clickable until the engine says otherwise. Nothing runs yet, so true. */
  runEnabled: boolean;
  /** STOP is disabled until the engine reports something it can stop. */
  stopEnabled: boolean;
  /** KILL is disabled until the engine reports something it can kill. */
  killEnabled: boolean;
  /** The engine's own STOP label ("⏸ Stop" or "⏸ Stop Preview"), raw. */
  stopLabel: string;
}

export const INITIAL_ENGINE_STATE: EngineState = {
  busy: false,
  progress: null,
  summary: null,
  uncheckedPaths: [],
  demoEntries: 0,
  previewReady: false,
  runEnabled: true,
  stopEnabled: false,
  killEnabled: false,
  stopLabel: "⏸ Stop",
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
    case "buttons": {
      // A PARTIAL update: the engine only sends the keys that changed, so a
      // `{ stop: true }` event must merge, never replace -- overwriting would
      // wipe out a `kill: true` a previous event already reported.
      const next = { ...state };
      if (typeof payload.run === "boolean") next.runEnabled = payload.run;
      if (typeof payload.stop === "boolean") next.stopEnabled = payload.stop;
      if (typeof payload.kill === "boolean") next.killEnabled = payload.kill;
      if (typeof payload.stop_label === "string") next.stopLabel = payload.stop_label;
      return next;
    }
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
