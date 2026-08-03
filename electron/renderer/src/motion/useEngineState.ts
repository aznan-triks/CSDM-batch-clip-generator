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
  /** The same four numbers the sentence in `text` renders, unformatted --
   *  the engine sends both (`_summary_counts` in csdm/engine/core.py) so the
   *  counter strip never has to parse the prose back apart. Absent until a
   *  run or preview has computed them. */
  demos?: number;
  clips?: number;
  totalSeconds?: number;
  avgSeconds?: number;
}

export interface PreviewClip {
  /** Composite key: (demo_path, start_tick) */
  demoPath: string;
  startTick: number;
  endTick: number;
  /** Duration in seconds */
  durationS: number;
  /** First event's type (Kill, Death, Round) */
  eventType: string;
  /** Player name from the first event's killer or victim */
  playerName: string;
  /** Whether this clip is selected (default: true) */
  selected: boolean;
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
  /** Clips from the most recent preview, or empty. */
  previewClips: PreviewClip[];
  /** True when a new preview has arrived and hasn't been viewed yet. */
  editingBadge: boolean;
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
  previewClips: [],
  editingBadge: false,
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
        summary: {
          text: String(payload.text ?? ""),
          level: String(payload.level ?? ""),
          ...(typeof payload.demos === "number" ? { demos: payload.demos } : {}),
          ...(typeof payload.clips === "number" ? { clips: payload.clips } : {}),
          ...(typeof payload.total_s === "number" ? { totalSeconds: payload.total_s } : {}),
          ...(typeof payload.avg_s === "number" ? { avgSeconds: payload.avg_s } : {}),
        },
      };
    case "demos_unchecked":
      return {
        ...state,
        uncheckedPaths: Array.isArray(payload.paths) ? payload.paths.map(String) : [],
      };
    case "demo_entry":
      return { ...state, demoEntries: state.demoEntries + 1 };
    case "preview_ready": {
      const sequences = payload.sequences as Record<string, Array<{
        start_tick: number; end_tick: number;
        events: Array<Record<string, unknown>>;
      }>> | undefined;
      const clipCfg = payload.cfg as Record<string, unknown> | undefined;
      const tickrate = (clipCfg?.tickrate as number) ?? 64;
      const playerName = (clipCfg?.player_name as string) ?? "";

      const clips: PreviewClip[] = [];
      if (sequences) {
        for (const [dp, seqs] of Object.entries(sequences)) {
          for (const seq of seqs) {
            const firstEvt = seq.events?.[0] ?? {};
            clips.push({
              demoPath: dp,
              startTick: seq.start_tick,
              endTick: seq.end_tick,
              durationS: (seq.end_tick - seq.start_tick) / tickrate,
              eventType: String(firstEvt.type ?? "?"),
              playerName: String(firstEvt.killer_sid ?? playerName),
              selected: true,
            });
          }
        }
      }
      return { ...state, previewReady: true, busy: false, previewClips: clips, editingBadge: true };
    }
    case "editing_toggle": {
      const idx = payload.index as number;
      const clips = [...state.previewClips];
      if (idx >= 0 && idx < clips.length) {
        clips[idx] = { ...clips[idx], selected: !clips[idx].selected };
      }
      return { ...state, previewClips: clips };
    }
    case "editing_viewed":
      return { ...state, editingBadge: false };
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
