import { onMessage } from "../bridge";

/**
 * The engine's state: ONE store, every reader on it.
 *
 * It was a `useState` inside the hook, so each of the four callers reduced its
 * own private copy of the same pipe messages. That holds together only while
 * every change comes from the pipe -- and it is exactly why the clip selection
 * was sent to Python and echoed back: a local toggle in `EditingTab` had no way
 * to reach `ActionBar`'s copy. The engine never implemented that command, and
 * `sendCommand` never looks at a reply, so the checklist was inert in silence
 * (AUDIT_retours_ui_8_points.md, ecart E2).
 *
 * The state event -> animation ban is untouched (D18): that mapping lives in
 * `weapon/controller.ts` and still takes engine events only. What moves here is
 * a checkbox and a badge, which are screen state and were never the engine's
 * business.
 *
 * This module subscribes to the pipe ONCE, lazily, on the first subscriber --
 * importing it must stay free of side effects, the same rule `bridge.ts`
 * follows for its result router.
 */

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
  /**
   * How many previews have landed. Counts UP; never resets.
   *
   * `previewReady` cannot answer "is this a new preview": it goes true on the
   * first one and stays true, so a reader watching its rising edge acts once
   * and never again. A counter distinguishes every arrival from the one
   * before it, which is what taking the user to a fresh checklist needs.
   */
  previewSerial: number;
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
  previewSerial: 0,
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
        event_type?: string;
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
            const etype = String(seq.event_type ?? firstEvt.type ?? "?");
            // Non-kill events carry the tracked player on attacker_sid (damage,
            // shot) or victim_sid (damage_target / death) instead of killer_sid.
            let pn = playerName;
            if (etype === "death" || etype === "damage_target") {
              pn = String(firstEvt.victim_sid ?? pn);
            } else {
              pn = String(firstEvt.attacker_sid ?? firstEvt.killer_sid ?? pn);
            }
            clips.push({
              demoPath: dp,
              startTick: seq.start_tick,
              endTick: seq.end_tick,
              durationS: (seq.end_tick - seq.start_tick) / tickrate,
              eventType: etype,
              playerName: pn,
              selected: true,
            });
          }
        }
      }
      return {
        ...state,
        previewReady: true,
        previewSerial: state.previewSerial + 1,
        busy: false,
        previewClips: clips,
        editingBadge: true,
      };
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


type Listener = () => void;

let current: EngineState = INITIAL_ENGINE_STATE;
const listeners = new Set<Listener>();
let detachPipe: (() => void) | null = null;

function publish(next: EngineState): void {
  // Reference equality is the contract `useSyncExternalStore` reads: an
  // unchanged object must stay the SAME object, or every reader re-renders on
  // every message the reducer chose to ignore.
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

/** The current snapshot. Stable between changes. */
export function getEngineState(): EngineState {
  return current;
}

/** Subscribe to changes. Returns the unsubscribe function React expects. */
export function subscribeEngineState(listener: Listener): () => void {
  listeners.add(listener);
  attachPipe();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) releasePipe();
  };
}

/** Fold one state event from the engine into the store. */
export function dispatchEngineMessage(name: string, payload: Record<string, unknown>): void {
  publish(reduceEngineState(current, name, payload));
}

/**
 * Include or exclude one clip of the last preview.
 *
 * Local on purpose. The engine is told which clips to record when GENERATE
 * runs (`selected_clips` on `start_run`); it has no use for the selection
 * before that, and asking it to keep one was what broke.
 */
export function toggleClipSelection(index: number): void {
  const clips = current.previewClips;
  if (index < 0 || index >= clips.length) return;
  const next = [...clips];
  next[index] = { ...next[index], selected: !next[index].selected };
  publish({ ...current, previewClips: next });
}

/** The editing tab has been looked at: put its badge out. */
export function markEditingViewed(): void {
  if (!current.editingBadge) return;
  publish({ ...current, editingBadge: false });
}

/** Back to the opening state. For tests -- nothing in the app resets the engine. */
export function resetEngineState(): void {
  current = INITIAL_ENGINE_STATE;
  listeners.clear();
  releasePipe();
}

/**
 * Read the pipe while somebody is listening, and only then.
 *
 * ONE subscription for the whole store, opened when the first reader arrives
 * and closed when the last one leaves. Not "opened once and kept forever": a
 * subscription taken against one `window.bridge` keeps pointing at that
 * object, so a page (or a test) that installs a different bridge would go on
 * hearing the old one and see nothing. Tying the subscription to the readers
 * means it is always taken against the bridge in place at that moment.
 */
function attachPipe(): void {
  if (detachPipe) return;
  detachPipe = onMessage((message) => {
    if (message.type !== "state") return;
    dispatchEngineMessage(message.name, message.payload);
  });
}

function releasePipe(): void {
  detachPipe?.();
  detachPipe = null;
}
