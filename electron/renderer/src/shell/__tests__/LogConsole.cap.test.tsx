/**
 * The console must not grow without bound.
 *
 * It had no cap at all: every engine message appended a <div> that was never
 * removed, in a scrolling area inside a `backdrop-filter: blur(14px)` surface.
 * On a batch of several hundred clips that is the player list's problem all
 * over again, except it grows while the user watches. The approved mock trims
 * its own console past 40 lines.
 *
 * But a work tool's log IS the record of a run, so the lines are KEPT and only
 * the rendering is bounded -- the export still writes every one of them.
 */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeMessage } from "../../bridge";
import LogConsole, { LOG_CONSOLE } from "../LogConsole";

const listeners = new Set<(message: BridgeMessage) => void>();

vi.mock("../../bridge", () => ({
  onMessage: (cb: (message: BridgeMessage) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  send: () => {},
}));

// LogConsole reads the picked settings to recite them when a run starts. The
// store needs a provider; this file is not about the settings, so it gets the
// one function the console calls.
vi.mock("../../settings/store", () => ({
  useAllSettings: () => ({}),
}));


/**
 * The typewriter is off here, on purpose.
 *
 * This file is about the CAP -- how many lines reach the DOM -- and the
 * typewriter leaves the newest line half-written, which would make an
 * assertion on its text about animation timing instead. `LogConsole.typing`
 * covers the writing itself.
 */
vi.mock("../../motion/engine", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  effectiveIntensity: () => "none",
}));

function emit(message: BridgeMessage): void {
  for (const cb of listeners) cb(message);
}

function renderedLines(): number {
  return document.querySelectorAll("#log > div:not(.promptline)").length;
}

beforeEach(() => {
  listeners.clear();
});

describe("the console bounds what it renders", () => {
  it("renders every line while under the cap", () => {
    render(<LogConsole />);
    act(() => {
      for (let i = 0; i < 25; i++) emit({ type: "log", message: `line ${i}`, level: "info" });
    });
    expect(renderedLines()).toBe(25);
  });

  it("stops growing once past the cap", () => {
    render(<LogConsole />);
    act(() => {
      for (let i = 0; i < LOG_CONSOLE.maxRendered + 300; i++) {
        emit({ type: "log", message: `line ${i}`, level: "info" });
      }
    });
    expect(renderedLines()).toBe(LOG_CONSOLE.maxRendered);
  });

  it("keeps the TAIL, which is where a running batch writes", () => {
    render(<LogConsole />);
    const total = LOG_CONSOLE.maxRendered + 10;
    act(() => {
      for (let i = 0; i < total; i++) emit({ type: "log", message: `line ${i}`, level: "info" });
    });
    const lines = [...document.querySelectorAll("#log > div:not(.promptline)")];
    expect(lines[lines.length - 1].textContent).toContain(`line ${total - 1}`);
    expect(lines[0].textContent).not.toContain("line 0");
  });
});
