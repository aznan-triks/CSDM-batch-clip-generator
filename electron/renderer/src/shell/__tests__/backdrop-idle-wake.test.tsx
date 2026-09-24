/**
 * The idle cadence (perf fix 2/2) must not delay a repaint the user caused.
 *
 * At rest the backdrop loop waits ~83 ms between frames. A resize resets the
 * canvas (setting its width clears it) and a theme/accent/tab change swaps
 * the palette or field; if either had to wait out the idle timer, the ground
 * would flash blank or lag the rest of the window by several frames. Both
 * must wake the loop onto the very next animation frame, as a mouse move does.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Backdrop from "../Backdrop";

/** A 2D context whose every method is a no-op: the drawing is not under test. */
function fakeContext(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (target, key) => (key in target ? target[key as keyof typeof target] : () => {}),
    set: (target, key, value) => {
      (target as unknown as Record<string | symbol, unknown>)[key] = value;
      return true;
    },
  });
}

let rafCallbacks: FrameRequestCallback[] = [];

function runFrames(): void {
  const pending = rafCallbacks;
  rafCallbacks = [];
  for (const cb of pending) cb(performance.now());
}

beforeEach(() => {
  vi.useFakeTimers();
  rafCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => fakeContext() as unknown as RenderingContext,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.mode;
});

/** Mount and run one frame: the loop is now parked on its idle timer. */
function mountAtRest(): void {
  render(<Backdrop />);
  runFrames();
  expect(rafCallbacks).toHaveLength(0);
}

describe("the resting backdrop wakes for a repaint it owes", () => {
  it("answers a resize on the next frame instead of after the idle timer", () => {
    mountAtRest();
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(rafCallbacks).toHaveLength(1);
  });

  it("answers a theme change on the next frame instead of after the idle timer", async () => {
    mountAtRest();
    await act(async () => {
      document.documentElement.dataset.mode = "dark";
      await Promise.resolve(); // MutationObserver callbacks are microtasks
    });
    expect(rafCallbacks).toHaveLength(1);
  });

  it("still parks on the idle timer when nothing happened", () => {
    mountAtRest();
    vi.advanceTimersByTime(50);
    expect(rafCallbacks).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(rafCallbacks).toHaveLength(1);
  });
});
