/**
 * ActionBar: the four action buttons (RUN, PREVIEW, STOP, KILL), the
 * progress line and the summary line.
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

  it("shows the progress line the engine sends", async () => {
    const { emit } = await renderBar();
    act(() => emit({ type: "state", name: "progress", payload: { text: "demo 2/7" } }));
    expect(screen.getByText("demo 2/7")).toBeTruthy();
  });

  it("shows the summary line the engine sends", async () => {
    const { emit } = await renderBar();
    act(() => emit({ type: "state", name: "summary", payload: { text: "12 clips" } }));
    expect(screen.getByText("12 clips")).toBeTruthy();
  });
});
