import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  effectiveIntensity,
  isOverriddenBySystem,
  play,
  registerSequence,
  registeredSequences,
  resetSequences,
  setIntensity,
  type SequenceContext,
} from "../engine";
import { MOTION } from "../tokens";
import {
  INITIAL_ENGINE_STATE,
  reduceEngineState,
} from "../useEngineState";

// -- helpers --

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function makeHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

beforeEach(() => {
  resetSequences();
  setIntensity("full");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("registry", () => {
  it("registerSequence then registeredSequences lists the name", () => {
    registerSequence("alpha", { play: () => {} });
    expect(registeredSequences()).toContain("alpha");
  });

  it("registering the same name twice throws", () => {
    registerSequence("beta", { play: () => {} });
    expect(() => registerSequence("beta", { play: () => {} })).toThrow();
  });

  it("play() with an unregistered name throws", () => {
    const host = makeHost();
    expect(() => play("nope", host)).toThrow();
  });
});

describe("the three intensities", () => {
  it("full: play() calls the definition's play, not its settle", () => {
    const playFn = vi.fn();
    const settleFn = vi.fn();
    registerSequence("seq", { play: playFn, settle: settleFn });
    setIntensity("full");
    play("seq", makeHost());
    expect(playFn).toHaveBeenCalledTimes(1);
    expect(settleFn).not.toHaveBeenCalled();
  });

  it("sober: calls play, and context.decorative is false", () => {
    let context: SequenceContext | undefined;
    registerSequence("seq", {
      play: (ctx) => {
        context = ctx;
      },
    });
    setIntensity("sober");
    play("seq", makeHost());
    expect(context).toBeDefined();
    expect(context!.decorative).toBe(false);
  });

  it("full: context.decorative is true", () => {
    let context: SequenceContext | undefined;
    registerSequence("seq", {
      play: (ctx) => {
        context = ctx;
      },
    });
    setIntensity("full");
    play("seq", makeHost());
    expect(context).toBeDefined();
    expect(context!.decorative).toBe(true);
  });

  it("none: calls settle and NOT play", () => {
    const playFn = vi.fn();
    const settleFn = vi.fn();
    registerSequence("seq", { play: playFn, settle: settleFn });
    setIntensity("none");
    play("seq", makeHost());
    expect(settleFn).toHaveBeenCalledTimes(1);
    expect(playFn).not.toHaveBeenCalled();
  });

  it("none with a definition that has no settle: does not throw, and calls nothing", () => {
    const playFn = vi.fn();
    registerSequence("seq", { play: playFn });
    setIntensity("none");
    expect(() => play("seq", makeHost())).not.toThrow();
    expect(playFn).not.toHaveBeenCalled();
  });
});

describe("duration scaling", () => {
  it("full: context.scale(1) is 1", () => {
    let context: SequenceContext | undefined;
    registerSequence("seq", {
      play: (ctx) => {
        context = ctx;
      },
    });
    setIntensity("full");
    play("seq", makeHost());
    expect(context!.scale(1)).toBe(1);
  });

  it("sober: context.scale(1) equals MOTION.sober.durationFactor", () => {
    let context: SequenceContext | undefined;
    registerSequence("seq", {
      play: (ctx) => {
        context = ctx;
      },
    });
    setIntensity("sober");
    play("seq", makeHost());
    expect(context!.scale(1)).toBe(MOTION.sober.durationFactor);
  });

  it("sober: a hold() removes its element sooner than under full", () => {
    const host = makeHost();

    registerSequence("holdSeq", {
      play: (ctx) => {
        const el = ctx.spawn("thing");
        ctx.hold(el, ctx.scale(1));
      },
    });

    setIntensity("sober");
    play("holdSeq", host);

    const soberRemovalMs = MOTION.sober.durationFactor * 1000 + MOTION.cleanupGrace * 1000;
    const fullRemovalMs = 1 * 1000 + MOTION.cleanupGrace * 1000;
    const midpoint = (soberRemovalMs + fullRemovalMs) / 2;

    vi.advanceTimersByTime(midpoint);
    expect(host.children.length).toBe(0);

    // Now check the same setup under full still has its element at the midpoint.
    resetSequences();
    const fullHost = makeHost();
    registerSequence("holdSeq", {
      play: (ctx) => {
        const el = ctx.spawn("thing");
        ctx.hold(el, ctx.scale(1));
      },
    });
    setIntensity("full");
    play("holdSeq", fullHost);
    vi.advanceTimersByTime(midpoint);
    expect(fullHost.children.length).toBe(1);
  });
});

describe("prefers-reduced-motion wins over the user setting", () => {
  it("stub returning true and setIntensity('full'): effectiveIntensity is 'none', play() runs settle not play", () => {
    stubMatchMedia(true);
    setIntensity("full");
    expect(effectiveIntensity()).toBe("none");

    const playFn = vi.fn();
    const settleFn = vi.fn();
    registerSequence("seq", { play: playFn, settle: settleFn });
    play("seq", makeHost());
    expect(settleFn).toHaveBeenCalledTimes(1);
    expect(playFn).not.toHaveBeenCalled();
  });

  it("isOverriddenBySystem is true when stubbed true and user chose full", () => {
    stubMatchMedia(true);
    setIntensity("full");
    expect(isOverriddenBySystem()).toBe(true);
  });

  it("isOverriddenBySystem is false when the user has themselves chosen none", () => {
    stubMatchMedia(true);
    setIntensity("none");
    expect(isOverriddenBySystem()).toBe(false);
  });

  it("stub returning false: effectiveIntensity returns whatever the user set", () => {
    stubMatchMedia(false);
    setIntensity("sober");
    expect(effectiveIntensity()).toBe("sober");
  });

  it("does not throw when window.matchMedia is entirely absent", () => {
    // @ts-expect-error -- deliberately deleting to test the jsdom-safety guard
    delete window.matchMedia;
    setIntensity("full");
    expect(() => effectiveIntensity()).not.toThrow();
    expect(effectiveIntensity()).toBe("full");
  });
});

describe("cleanup runs off the clock", () => {
  it("spawn()ing three elements and hold()ing each leaves zero elements after the clock advances past the longest hold plus cleanupGrace", () => {
    const host = makeHost();
    registerSequence("triple", {
      play: (ctx) => {
        const a = ctx.spawn("a");
        const b = ctx.spawn("b");
        const c = ctx.spawn("c");
        ctx.hold(a, 0.1);
        ctx.hold(b, 0.3);
        ctx.hold(c, 0.5);
      },
    });
    setIntensity("full");
    play("triple", host);

    expect(host.children.length).toBe(3);

    const longestMs = (0.5 + MOTION.cleanupGrace) * 1000;
    vi.advanceTimersByTime(longestMs + 1);

    expect(host.children.length).toBe(0);
  });

  it("cancelling a sequence mid-flight removes every spawned element immediately and stops pending timers", () => {
    const host = makeHost();
    registerSequence("cancelable", {
      play: (ctx) => {
        const a = ctx.spawn("a");
        const b = ctx.spawn("b");
        ctx.hold(a, 1);
        ctx.hold(b, 2);
      },
    });
    setIntensity("full");
    const cancel = play("cancelable", host);

    expect(host.children.length).toBe(2);
    cancel();
    expect(host.children.length).toBe(0);

    vi.advanceTimersByTime(5000);
    expect(host.children.length).toBe(0);
  });

  it("every() keeps firing on the clock, and cancel() stops it", () => {
    const host = makeHost();
    const tick = vi.fn();
    registerSequence("ticker", {
      play: (ctx) => {
        ctx.every(1, tick);
      },
    });
    setIntensity("full");
    const cancel = play("ticker", host);

    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);

    cancel();
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});

describe("useEngineState's reducer", () => {
  it("buttons_idle clears busy", () => {
    const state = reduceEngineState({ ...INITIAL_ENGINE_STATE, busy: true }, "buttons_idle", {});
    expect(state.busy).toBe(false);
  });

  it("buttons_busy sets busy", () => {
    const state = reduceEngineState(INITIAL_ENGINE_STATE, "buttons_busy", {});
    expect(state.busy).toBe(true);
  });

  it("progress stores payload.text", () => {
    const state = reduceEngineState(INITIAL_ENGINE_STATE, "progress", { text: "working" });
    expect(state.progress).toBe("working");
  });

  it("summary stores text and level", () => {
    const state = reduceEngineState(INITIAL_ENGINE_STATE, "summary", {
      text: "done",
      level: "ok",
    });
    expect(state.summary).toEqual({ text: "done", level: "ok" });
  });

  it("demos_unchecked stores payload.paths as strings", () => {
    const state = reduceEngineState(INITIAL_ENGINE_STATE, "demos_unchecked", {
      paths: ["a.mp4", "b.mp4"],
    });
    expect(state.uncheckedPaths).toEqual(["a.mp4", "b.mp4"]);
  });

  it("demos_unchecked yields an empty array when paths is missing", () => {
    const state = reduceEngineState(INITIAL_ENGINE_STATE, "demos_unchecked", {});
    expect(state.uncheckedPaths).toEqual([]);
  });

  it("demos_unchecked yields an empty array when paths is not an array", () => {
    const state = reduceEngineState(INITIAL_ENGINE_STATE, "demos_unchecked", {
      paths: "not-an-array",
    });
    expect(state.uncheckedPaths).toEqual([]);
  });

  it("demo_entry increments the counter", () => {
    const state = reduceEngineState({ ...INITIAL_ENGINE_STATE, demoEntries: 2 }, "demo_entry", {});
    expect(state.demoEntries).toBe(3);
  });

  it("preview_ready sets previewReady and clears busy", () => {
    const state = reduceEngineState({ ...INITIAL_ENGINE_STATE, busy: true }, "preview_ready", {});
    expect(state.previewReady).toBe(true);
    expect(state.busy).toBe(false);
  });

  it("an unknown event name returns the state unchanged", () => {
    const state = reduceEngineState(INITIAL_ENGINE_STATE, "some_future_event", { foo: "bar" });
    expect(state).toBe(INITIAL_ENGINE_STATE);
  });

  it("a progress event with no text in the payload yields an empty string", () => {
    const state = reduceEngineState(INITIAL_ENGINE_STATE, "progress", {});
    expect(state.progress).toBe("");
  });
});
