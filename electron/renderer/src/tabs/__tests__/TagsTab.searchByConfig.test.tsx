/**
 * TagsTab's "By config" search (`searchByConfig`, data-action "I6") must send
 * the window's current settings as `cfg` -- the same run model PREVIEW uses --
 * not the empty object it used to hardcode (audit 2026-09-15, E17). A `cfg: {}`
 * fails `run_inputs_problem` on the engine side ("Check at least one
 * registered account.") no matter what the window actually holds.
 *
 * Mocked the way `PresetSection.test.tsx` mocks the settings store and the
 * bridge: real components, faked collaborators, so this exercises TagsTab's
 * own wiring rather than the store or the bridge transport.
 */
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TagsTab from "../TagsTab";

/** Exactly the shape `useAllSettings` returns: the whole flat settings dict. */
const SETTINGS = { steam_ids: ["1"], event_actor: true, events: [] };

const calls: { command: string; payload: Record<string, unknown> }[] = [];

vi.mock("../../settings/store", () => ({
  useSetting: () => [undefined, () => {}],
  useAllSettings: () => SETTINGS,
}));

vi.mock("../../settings/useDatabase", () => ({
  useDatabase: () => ({
    database: { weapons: [], maps: [], players: [], tags: [] },
    error: null,
    reload: () => {},
  }),
}));

vi.mock("../../bridge", () => ({
  runCommand: (command: string, payload: Record<string, unknown> = {}) => {
    calls.push({ command, payload });
    return Promise.resolve({ type: "result", id: "1", ok: true, data: { demos: [] } });
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
  pickPath: () => Promise.resolve(null),
  pickSavePath: () => Promise.resolve(null),
}));

describe("TagsTab searchByConfig", () => {
  it("sends the window's settings as cfg, not an empty object", async () => {
    const { container } = render(<TagsTab />);
    await act(async () => {});
    calls.length = 0; // drop the mount-time tags_set_active call

    const button = container.querySelector('[data-action="I6"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    act(() => button.click());
    await act(async () => {});

    const searchCall = calls.find((c) => c.command === "tags_search");
    expect(searchCall).toBeTruthy();
    expect(searchCall?.payload.cfg).toEqual(SETTINGS);
  });
});
