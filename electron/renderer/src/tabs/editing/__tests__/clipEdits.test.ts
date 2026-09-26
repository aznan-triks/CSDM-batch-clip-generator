import { describe, expect, it } from "vitest";

import type { PreviewClip } from "../../../motion/useEngineState";
import { buildLanes, clipPayload, editedWindow, overlapsAnother } from "../clipEdits";

const TR = 64;

/** A clip shaped like the engine's: 3 s before its first kill, 2 s after its last. */
function clip(ticks: number[], extra: Partial<PreviewClip> = {}, demo = "a.dem"): PreviewClip {
  const startTick = ticks[0] - 3 * TR;
  const endTick = ticks[ticks.length - 1] + 2 * TR;
  return {
    demoPath: demo,
    startTick,
    endTick,
    durationS: (endTick - startTick) / TR,
    eventType: "kill",
    playerName: "me",
    selected: true,
    events: ticks.map((tick, i) => ({ tick, type: "kill", key: `k${i}` })),
    cameras: [],
    ...extra,
  };
}

// The same cases tests/test_clip_edits.py pins on the engine side.
describe("editedWindow mirrors apply_clip_edits", () => {
  it("leaves an unedited clip as previewed", () => {
    const c = clip([1000]);
    expect(editedWindow(c, TR)).toMatchObject({ startTick: c.startTick, endTick: c.endTick, leadS: 3, tailS: 2 });
  });

  it("overrides start and end in whole seconds", () => {
    const w = editedWindow(clip([1000], { edit: { beforeS: 5, afterS: 7 } }), TR);
    expect([w?.startTick, w?.endTick]).toEqual([1000 - 5 * TR, 1000 + 7 * TR]);
  });

  it("moves the start with an excluded first event, keeping the engine's lead", () => {
    const c = clip([1000, 1300], { edit: { excluded: ["k0"] } });
    const w = editedWindow(c, TR);
    expect(w?.startTick).toBe(1300 - 3 * TR);
    expect(w?.endTick).toBe(c.endTick);
    expect(w?.kept.map((e) => e.key)).toEqual(["k1"]);
  });

  it("is null once every event is excluded", () => {
    expect(editedWindow(clip([1000], { edit: { excluded: ["k0"] } }), TR)).toBeNull();
  });

  it("never starts below tick 0 nor lasts zero ticks", () => {
    expect(editedWindow(clip([100], { edit: { beforeS: 15 } }), TR)?.startTick).toBe(0);
    const w = editedWindow(clip([1000], { edit: { beforeS: 0, afterS: 0 } }), TR);
    expect((w?.endTick ?? 0) - (w?.startTick ?? 0)).toBe(1);
  });
});

describe("clipPayload", () => {
  it("sends only the key for an unedited clip", () => {
    expect(clipPayload(clip([1000]))).toEqual({ demo_path: "a.dem", start_tick: 1000 - 3 * TR });
  });

  it("sends each edit under the engine's name", () => {
    expect(clipPayload(clip([1000], { edit: { beforeS: 4, excluded: ["k0"] } }))).toEqual({
      demo_path: "a.dem",
      start_tick: 1000 - 3 * TR,
      before_s: 4,
      excluded_events: ["k0"],
    });
  });
});

describe("lanes", () => {
  it("groups clips by demo in preview order", () => {
    const lanes = buildLanes([clip([1000], {}, "x/b.dem"), clip([9000], {}, "a.dem"), clip([5000], {}, "x/b.dem")]);
    expect(lanes.map((l) => [l.name, l.indices])).toEqual([
      ["b.dem", [0, 2]],
      ["a.dem", [1]],
    ]);
  });

  it("flags an edit that runs into the next kept clip", () => {
    const clips = [clip([1000]), clip([1000 + 20 * TR])];
    const [lane] = buildLanes(clips);
    expect(overlapsAnother(clips, lane, 0, TR)).toBe(false);
    const stretched = [{ ...clips[0], edit: { afterS: 18 } }, clips[1]];
    expect(overlapsAnother(stretched, lane, 0, TR)).toBe(true);
    // An excluded neighbour is not recorded, so it cannot be joined.
    expect(overlapsAnother([stretched[0], { ...clips[1], selected: false }], lane, 0, TR)).toBe(false);
  });
});
