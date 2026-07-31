/**
 * The console writes itself out, as the approved mock does.
 *
 * The report asked for "quelque chose d'animé, des écritures qui s'enchaînent"
 * and the mock shows exactly what: a line is inserted empty and written a
 * character at a time, and the next one waits for it. This console appended
 * whole lines instantly.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeMessage } from "../../bridge";
import LogConsole from "../LogConsole";
import { MOTION } from "../../motion/tokens";

const listeners = new Set<(message: BridgeMessage) => void>();

vi.mock("../../bridge", () => ({
  onMessage: (cb: (message: BridgeMessage) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  send: () => {},
}));

/** Motion intensity: the typewriter must be silent under `none`. */
let intensity = "full";
vi.mock("../../motion/engine", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  effectiveIntensity: () => intensity,
}));

function emit(message: BridgeMessage): void {
  for (const cb of listeners) cb(message);
}

/**
 * Step the typewriter `n` characters.
 *
 * One `act` per tick on purpose: the effect that schedules the NEXT timeout
 * only runs after React commits, which happens when `act` returns. Advancing
 * `charMs * n` inside a single `act` fires exactly one step, which is what
 * made the first draft of this file look like the typewriter was broken.
 */
function type(n: number): void {
  for (let i = 0; i < n; i++) {
    act(() => {
      vi.advanceTimersByTime(MOTION.consoleType.charMs);
    });
  }
}

function shown(): string {
  return [...document.querySelectorAll("#log > div:not(.promptline)")]
    .map((line) => line.textContent ?? "")
    .join("\n");
}

beforeEach(() => {
  listeners.clear();
  intensity = "full";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a line writes itself out instead of landing whole", () => {
  it("shows nothing of a new line before the clock has ticked", () => {
    render(<LogConsole />);
    act(() => emit({ type: "log", message: "engine ready", level: "ok" }));
    expect(shown()).not.toContain("engine ready");
  });

  it("reveals it character by character", () => {
    render(<LogConsole />);
    act(() => emit({ type: "log", message: "engine ready", level: "ok" }));

    type(4);
    const partial = shown();
    expect(partial).toContain("engi");
    expect(partial).not.toContain("engine ready");

    type(40);
    expect(shown()).toContain("engine ready");
  });

  it("writes a multicolour line straight through its colour change", () => {
    // The engine sends coloured runs; the typewriter cuts ACROSS them rather
    // than typing each piece separately.
    render(<LogConsole />);
    act(() =>
      emit({
        type: "log_parts",
        parts: [
          ["ready ", "ok"],
          ["in 3s", "dim"],
        ],
      }),
    );
    type(8);
    const partial = shown();
    expect(partial).toContain("ready ");
    expect(partial).not.toContain("in 3s");
  });
});

describe("a burst is not narrated", () => {
  it("lands the backlog complete and only types the tail", () => {
    // A batch emits hundreds of lines. A log still spelling out what happened
    // a minute ago is a log nobody can read.
    render(<LogConsole />);
    const total = MOTION.consoleType.maxTyped + 30;
    act(() => {
      for (let i = 0; i < total; i++) {
        emit({ type: "log", message: `line ${i}`, level: "info" });
      }
    });
    type(1);
    // The oldest are fully out without having been typed one by one.
    expect(shown()).toContain("line 0");
    expect(shown()).toContain("line 5");
  });
});

describe("a work tool can hold still", () => {
  it("types nothing at all under motion intensity none", () => {
    intensity = "none";
    render(<LogConsole />);
    act(() => emit({ type: "log", message: "engine ready", level: "ok" }));
    // No clock advanced: the line is simply there.
    expect(shown()).toContain("engine ready");
  });
});
