/**
 * The ask panel must answer BOTH shapes the engine sends.
 *
 * `csdm/engine/core.py::validate_run_inputs` refuses an incomplete RUN with
 * `ask("error", "...", [])` -- no options at all -- and `csdm/bridge/ports.py`
 * blocks that engine thread on `done.wait()` with no timeout until an answer
 * comes back. A panel that renders only `options.slice(1)` draws zero buttons
 * for that shape, so the answer can never be sent and the thread never wakes.
 * That is the whole of R12.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeCommand, BridgeMessage } from "../../bridge";
import LogConsole from "../LogConsole";

const listeners = new Set<(message: BridgeMessage) => void>();
const sent: BridgeCommand[] = [];

vi.mock("../../bridge", () => ({
  onMessage: (cb: (message: BridgeMessage) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  send: (command: BridgeCommand) => {
    sent.push(command);
  },
}));

// LogConsole reads the picked settings to recite them when a run starts. The
// store needs a provider; this file is not about the settings, so it gets the
// one function the console calls.
vi.mock("../../settings/store", () => ({
  useAllSettings: () => ({}),
}));


function emit(message: BridgeMessage): void {
  for (const cb of listeners) cb(message);
}

beforeEach(() => {
  listeners.clear();
  sent.length = 0;
});

describe("an error ask can always be answered", () => {
  it("draws a button even when the engine sends no options at all", () => {
    render(<LogConsole />);
    act(() =>
      emit({
        type: "ask",
        id: "7",
        kind: "error",
        message: "Check at least one registered account.",
        options: [],
      }),
    );

    const panel = document.getElementById("ask-panel");
    expect(panel).not.toBeNull();
    // The bug: `options.slice(1)` on an empty array renders no button at all,
    // and there is no cancel outside that loop, so `answer()` is unreachable.
    expect(panel!.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it('answers "ok", which is what the Tkinter host returns for kind=error', () => {
    render(<LogConsole />);
    act(() => emit({ type: "ask", id: "7", kind: "error", message: "No player.", options: [] }));

    fireEvent.click(document.getElementById("ask-panel")!.querySelector("button")!);

    expect(sent).toContainEqual({ type: "answer", id: "7", value: "ok" });
    expect(document.getElementById("ask-panel")).toBeNull();
  });

  it("shows the message itself, since an error ask carries no title", () => {
    render(<LogConsole />);
    act(() => emit({ type: "ask", id: "7", kind: "error", message: "No player.", options: [] }));
    expect(document.getElementById("ask-panel")!.textContent).toContain("No player.");
  });
});

describe("a confirm ask keeps its choices and gains a cancel", () => {
  it("still renders the engine's choices, titled by options[0]", () => {
    render(<LogConsole />);
    act(() =>
      emit({
        type: "ask",
        id: "9",
        kind: "confirm",
        message: "3 demos are already tagged.",
        options: ["Already tagged demos", "include", "ignore"],
      }),
    );

    const panel = document.getElementById("ask-panel")!;
    expect(panel.textContent).toContain("Already tagged demos");
    expect(screen.getByRole("button", { name: "include" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ignore" })).toBeTruthy();
  });

  it("answers null on cancel, the branch `if answer is None` the engine has", () => {
    // csdm/engine/core.py unchecks the already-tagged demos and restarts the
    // preview on a null answer. With no cancel button that branch is dead code.
    render(<LogConsole />);
    act(() =>
      emit({
        type: "ask",
        id: "9",
        kind: "confirm",
        message: "3 demos are already tagged.",
        options: ["Already tagged demos", "include", "ignore"],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(sent).toContainEqual({ type: "answer", id: "9", value: null });
  });
});

describe("a text ask (EDITING SAVE's preset name) takes what is typed", () => {
  const nameAsk: BridgeMessage = {
    type: "ask",
    id: "11",
    kind: "text",
    message: "Name for this preset",
    options: ["Preset name:", "Save"],
  };

  it("sends the typed name as the answer", () => {
    render(<LogConsole />);
    act(() => emit(nameAsk));
    fireEvent.change(screen.getByRole("textbox", { name: "Preset name:" }), { target: { value: "Clutch reel" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(sent).toContainEqual({ type: "answer", id: "11", value: "Clutch reel" });
    expect(document.getElementById("ask-panel")).toBeNull();
  });

  it("sends it on Enter too, and cannot send a blank name", () => {
    render(<LogConsole />);
    act(() => emit(nameAsk));
    const field = screen.getByRole("textbox", { name: "Preset name:" });
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(sent).toHaveLength(0);
    fireEvent.change(field, { target: { value: "p" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(sent).toContainEqual({ type: "answer", id: "11", value: "p" });
  });

  it("Cancel answers null: the engine saves nothing", () => {
    render(<LogConsole />);
    act(() => emit(nameAsk));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(sent).toContainEqual({ type: "answer", id: "11", value: null });
  });
});
