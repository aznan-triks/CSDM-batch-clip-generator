/**
 * One engine state, shared by every reader.
 *
 * It used to be a `useState` inside `useEngineState()`, so each of the four
 * callers reduced its own private copy of the same messages. That works only
 * as long as EVERY change comes from the pipe -- and it is the reason the clip
 * selection was routed through Python and back: a local toggle in `EditingTab`
 * could not reach `ActionBar`'s copy. The engine never implemented the command,
 * `sendCommand` never reads a reply, and the feature was dead in silence.
 *
 * These tests pin the property that made the detour necessary: two readers see
 * the same value, whether the change came from the pipe or from a click.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  dispatchEngineMessage,
  getEngineState,
  markEditingViewed,
  resetEngineState,
  subscribeEngineState,
  toggleClipSelection,
} from "../engineStore";

/** A `preview_ready` payload with `count` one-kill sequences in one demo. */
function previewPayload(count: number) {
  const sequences = Array.from({ length: count }, (_, i) => ({
    start_tick: 1000 * (i + 1),
    end_tick: 1000 * (i + 1) + 640,
    event_type: "kill",
    events: [{ type: "kill", killer_sid: "76561198000000001" }],
  }));
  return { sequences: { "C:/demos/a.dem": sequences }, cfg: { tickrate: 64 } };
}

beforeEach(() => {
  resetEngineState();
});

describe("one store, several readers", () => {
  it("hands the same object to everyone", () => {
    const a = getEngineState();
    const b = getEngineState();
    expect(a).toBe(b);
  });

  it("tells every subscriber about a pipe message", () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribeEngineState(first);
    subscribeEngineState(second);

    dispatchEngineMessage("progress", { text: "12/40" });

    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(getEngineState().progress).toBe("12/40");
  });

  it("tells every subscriber about a local action too -- the whole point", () => {
    dispatchEngineMessage("preview_ready", previewPayload(2));
    const listener = vi.fn();
    subscribeEngineState(listener);

    toggleClipSelection(0);

    expect(listener).toHaveBeenCalled();
    expect(getEngineState().previewClips[0].selected).toBe(false);
  });

  it("keeps serving the others when one unsubscribes", () => {
    const staying = vi.fn();
    const leaving = vi.fn();
    subscribeEngineState(staying);
    const stop = subscribeEngineState(leaving);
    stop();

    dispatchEngineMessage("demo_entry", {});

    expect(staying).toHaveBeenCalled();
    expect(leaving).not.toHaveBeenCalled();
  });

  it("replaces the snapshot rather than mutating it, so a reader can compare", () => {
    const before = getEngineState();
    dispatchEngineMessage("demo_entry", {});
    expect(getEngineState()).not.toBe(before);
  });
});

describe("the clip selection", () => {
  beforeEach(() => {
    dispatchEngineMessage("preview_ready", previewPayload(3));
  });

  it("arrives with every clip included", () => {
    expect(getEngineState().previewClips.map((c) => c.selected)).toEqual([true, true, true]);
  });

  it("flips exactly one clip", () => {
    toggleClipSelection(1);
    expect(getEngineState().previewClips.map((c) => c.selected)).toEqual([true, false, true]);
  });

  it("flips back", () => {
    toggleClipSelection(1);
    toggleClipSelection(1);
    expect(getEngineState().previewClips.map((c) => c.selected)).toEqual([true, true, true]);
  });

  it("ignores an index that names no clip, and does not notify for nothing", () => {
    const listener = vi.fn();
    subscribeEngineState(listener);
    toggleClipSelection(9);
    toggleClipSelection(-1);
    expect(getEngineState().previewClips.map((c) => c.selected)).toEqual([true, true, true]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("the editing badge", () => {
  it("lights up when a preview lands", () => {
    dispatchEngineMessage("preview_ready", previewPayload(1));
    expect(getEngineState().editingBadge).toBe(true);
  });

  it("goes out when the tab has been seen -- no round trip through the engine", () => {
    dispatchEngineMessage("preview_ready", previewPayload(1));
    markEditingViewed();
    expect(getEngineState().editingBadge).toBe(false);
  });

  it("lights up again on the next preview", () => {
    dispatchEngineMessage("preview_ready", previewPayload(1));
    markEditingViewed();
    dispatchEngineMessage("preview_ready", previewPayload(2));
    expect(getEngineState().editingBadge).toBe(true);
  });

  it("does not notify when it is already out", () => {
    const listener = vi.fn();
    subscribeEngineState(listener);
    markEditingViewed();
    expect(listener).not.toHaveBeenCalled();
  });
});
