/**
 * ActionBar: the four action buttons (RUN, PREVIEW, STOP, KILL) and the
 * weapon-row slot that leads them.
 *
 * `../../bridge` is mocked directly, the way `PresetSection.test.tsx` mocks
 * it: `runCommand` records what was sent, `onMessage` hands the test an
 * `emit` helper so it can raise engine state events exactly as
 * `useEngineState` would receive them over the real pipe.
 *
 * D18 is the point of this file: a click may never decide button state or
 * trigger an animation. `sent` after a click must hold exactly the one
 * command the click sent, and disabled/enabled state must come only from a
 * `buttons` event, never from the click itself.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BridgeMessage } from "../../bridge";
import ActionBar from "../ActionBar";

interface SentCommand {
  name: string;
  [key: string]: unknown;
}

const sent: SentCommand[] = [];
const listeners = new Set<(message: BridgeMessage) => void>();

vi.mock("../../bridge", () => ({
  runCommand: (name: string, payload: Record<string, unknown> = {}) => {
    sent.push({ name, ...payload });
    return Promise.resolve({ type: "result", id: "1", ok: true });
  },
  onMessage: (cb: (message: BridgeMessage) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
}));

vi.mock("../../settings/store", () => ({
  useAllSettings: () => ({ steam_ids: ["1"], events: ["Kills"] }),
}));

function emit(message: BridgeMessage): void {
  for (const cb of listeners) cb(message);
}

async function renderBar() {
  sent.length = 0;
  const utils = render(<ActionBar registerButton={() => () => {}} />);
  return { ...utils, sent, emit };
}

describe("ActionBar", () => {
  it("sends start_run and nothing else when RUN is clicked", async () => {
    const { sent } = await renderBar();
    act(() => screen.getByRole("button", { name: /RUN/ }).click());
    expect(sent.map((c) => c.name)).toEqual(["start_run"]);
  });

  it("disables STOP and KILL while nothing runs", async () => {
    await renderBar();
    expect(screen.getByRole("button", { name: /STOP/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /KILL/ })).toHaveProperty("disabled", true);
  });

  it("enables STOP and KILL on the engine's buttons event, never on the click", async () => {
    // D18: the window may not decide it is busy. Only the engine knows.
    const { emit } = await renderBar();
    act(() => emit({ type: "state", name: "buttons", payload: { stop: true, kill: true } }));
    expect(screen.getByRole("button", { name: /STOP/ })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: /KILL/ })).toHaveProperty("disabled", false);
  });

  // The progress and summary lines moved OUT of this component: in the mock
  // they belong to `.wband`, the weapon row that rides inside the bar, and the
  // bar now renders it through a slot. What is testable here is the slot; the
  // lines themselves are asserted where they are now wired, in AppShell.
  it("renders whatever weapon row it is handed, ahead of the buttons", async () => {
    sent.length = 0;
    render(<ActionBar registerButton={() => () => {}} weapon={<i>weapon slot</i>} />);
    const slot = screen.getByText("weapon slot");
    const run = screen.getByRole("button", { name: /RUN/ });
    expect(slot).toBeTruthy();
    expect(slot.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("switches the STOP label to STOP PREVIEW when the engine sends stop_label for a preview", async () => {
    const { emit } = await renderBar();
    expect(screen.getByRole("button", { name: /^STOP$/ })).toBeTruthy();
    act(() =>
      emit({
        type: "state",
        name: "buttons",
        payload: { stop: true, stop_label: "⏸ Stop Preview" },
      }),
    );
    expect(screen.getByRole("button", { name: /^STOP PREVIEW$/ })).toBeTruthy();
  });

  it("reverts the STOP label back to plain STOP when the engine says so", async () => {
    const { emit } = await renderBar();
    act(() =>
      emit({
        type: "state",
        name: "buttons",
        payload: { stop: true, stop_label: "⏸ Stop Preview" },
      }),
    );
    expect(screen.getByRole("button", { name: /^STOP PREVIEW$/ })).toBeTruthy();
    act(() =>
      emit({ type: "state", name: "buttons", payload: { stop: false, stop_label: "⏸ Stop" } }),
    );
    expect(screen.getByRole("button", { name: /^STOP$/ })).toBeTruthy();
  });
});
