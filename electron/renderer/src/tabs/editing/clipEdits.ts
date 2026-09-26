/**
 * The EDITING tab's per-clip arithmetic: what a clip becomes once edited,
 * what GENERATE / SAVE send for it, and how clips group into demo lanes.
 *
 * `editedWindow` mirrors the engine's `apply_clip_edits`
 * (csdm/engine/clip_edits.py) and must follow it if it changes:
 *   - excluded events leave the clip; with none left it is not recorded;
 *   - the clip starts `before` seconds ahead of its first KEPT event and ends
 *     `after` seconds past its last one; an unedited side keeps the lead /
 *     tail the preview gave it, measured from the original first / last event;
 *   - start never below tick 0, never an empty clip.
 * The overlap join the engine does across clips is shown, not redrawn: the
 * inspector warns that two overlapping clips will be recorded as one.
 */
import type { ClipEdit, PreviewClip, PreviewEvent } from "../../motion/useEngineState";

/**
 * Range of a per-clip before / after handle, in whole seconds.
 *
 * Not configuration, same category as `CLIP_RANGES` (clipWindow.ts): the
 * widget's own range. Wider than the global setting on purpose -- one clip
 * may need a long run-up the rest of the batch does not.
 */
export const CLIP_EDIT_RANGE = { min: 0, max: 60 } as const;

export interface EditedWindow {
  startTick: number;
  endTick: number;
  durationS: number;
  /** Events still in the clip, in tick order. */
  kept: PreviewEvent[];
  /** Seconds before the first kept event / after the last one. */
  leadS: number;
  tailS: number;
}

export function isEdited(clip: PreviewClip): boolean {
  return clip.edit !== undefined;
}

export function isExcluded(clip: PreviewClip, key: string): boolean {
  return clip.edit?.excluded?.includes(key) ?? false;
}

/** The clip as the run will record it; null when every event was taken out. */
export function editedWindow(clip: PreviewClip, tickrate: number): EditedWindow | null {
  const { events, edit } = clip;
  if (events.length === 0 || !edit) {
    const first = events[0]?.tick ?? clip.startTick;
    const last = events[events.length - 1]?.tick ?? clip.endTick;
    return {
      startTick: clip.startTick,
      endTick: clip.endTick,
      durationS: (clip.endTick - clip.startTick) / tickrate,
      kept: events,
      leadS: (first - clip.startTick) / tickrate,
      tailS: (clip.endTick - last) / tickrate,
    };
  }
  const kept = events.filter((e) => !isExcluded(clip, e.key));
  if (kept.length === 0) return null;
  const lead = edit.beforeS !== undefined ? edit.beforeS * tickrate : events[0].tick - clip.startTick;
  const tail = edit.afterS !== undefined ? edit.afterS * tickrate : clip.endTick - events[events.length - 1].tick;
  const startTick = Math.max(0, Math.trunc(kept[0].tick - lead));
  const endTick = Math.max(startTick + 1, Math.trunc(kept[kept.length - 1].tick + tail));
  return {
    startTick,
    endTick,
    durationS: (endTick - startTick) / tickrate,
    kept,
    leadS: (kept[0].tick - startTick) / tickrate,
    tailS: (endTick - kept[kept.length - 1].tick) / tickrate,
  };
}

/** What GENERATE and SAVE send for one kept clip, in the engine's snake_case. */
export function clipPayload(clip: PreviewClip): {
  demo_path: string;
  start_tick: number;
  before_s?: number;
  after_s?: number;
  excluded_events?: string[];
} {
  const out: ReturnType<typeof clipPayload> = { demo_path: clip.demoPath, start_tick: clip.startTick };
  const edit: ClipEdit = clip.edit ?? {};
  if (edit.beforeS !== undefined) out.before_s = edit.beforeS;
  if (edit.afterS !== undefined) out.after_s = edit.afterS;
  if (edit.excluded?.length) out.excluded_events = [...edit.excluded];
  return out;
}

/** One demo's row on the timeline: its clips, by index into `previewClips`. */
export interface Lane {
  demoPath: string;
  name: string;
  indices: number[];
}

export function demoName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Clips grouped by demo, in the order the preview listed the demos. */
export function buildLanes(clips: readonly PreviewClip[]): Lane[] {
  const byDemo = new Map<string, Lane>();
  clips.forEach((clip, i) => {
    let lane = byDemo.get(clip.demoPath);
    if (!lane) {
      lane = { demoPath: clip.demoPath, name: demoName(clip.demoPath), indices: [] };
      byDemo.set(clip.demoPath, lane);
    }
    lane.indices.push(i);
  });
  return [...byDemo.values()];
}

/** Demo time as M:SS, e.g. 754 -> "12:34". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Whether this clip, as edited, overlaps another kept clip of its demo --
 * the engine then records the two as one (clip_edits.py).
 */
export function overlapsAnother(
  clips: readonly PreviewClip[],
  lane: Lane,
  index: number,
  tickrate: number,
): boolean {
  const own = editedWindow(clips[index], tickrate);
  if (!own) return false;
  return lane.indices.some((j) => {
    if (j === index || !clips[j].selected) return false;
    const other = editedWindow(clips[j], tickrate);
    return other !== null && other.startTick < own.endTick && own.startTick < other.endTick;
  });
}
