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
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeMessage } from "../../bridge";
import { editClip, resetEngineState, toggleClipEvent } from "../../motion/engineStore";
import ActionBar from "../ActionBar";

interface SentCommand {
  name: string;
  [key: string]: unknown;
}

const sent: SentCommand[] = [];
const listeners = new Set<(message: BridgeMessage) => void>();
// What the engine answers to `run_inputs_problem`: null = the settings can run.
let inputsProblem: string | null = null;

vi.mock("../../bridge", () => ({
  runCommand: (name: string, payload: Record<string, unknown> = {}) => {
    sent.push({ name, ...payload });
    const extra = name === "run_inputs_problem" ? { problem: inputsProblem } : {};
    return Promise.resolve({ type: "result", id: "1", ok: true, ...extra });
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

/**
 * Mounts the bar and lets its settings check (`run_inputs_problem`, asked on
 * mount, not on a click) answer, then empties `sent`: what a test reads after
 * that is only what its own click sent.
 */
async function renderBar(active = "capture" as "capture" | "editing", problem: string | null = null) {
  sent.length = 0;
  inputsProblem = problem;
  const setTab = vi.fn();
  const utils = render(
    <ActionBar
      registerButton={() => () => {}}
      active={active}
      onSetTab={setTab}
    />,
  );
  await act(async () => {});
  sent.length = 0;
  return { ...utils, sent, emit, setTab };
}

describe("ActionBar", () => {
  describe("settings that cannot run", () => {
    afterEach(() => resetEngineState()); // the preview below must not leak into the next test
    const why = "Pick at least one player: CAPTURE › Player, search your name or Steam ID, then click the row.";

    it("asks the engine, with the current settings, before any click", async () => {
      sent.length = 0;
      inputsProblem = null;
      render(<ActionBar registerButton={() => () => {}} active="capture" onSetTab={() => {}} />);
      await act(async () => {});
      expect(sent).toEqual([{ name: "run_inputs_problem", cfg: { steam_ids: ["1"], events: ["Kills"] } }]);
    });

    it("greys RUN and PREVIEW out and shows the engine's own sentence as their tip", async () => {
      await renderBar("capture", why);
      for (const name of [/RUN/, /PREVIEW/]) {
        const button = screen.getByRole("button", { name });
        expect(button).toHaveProperty("disabled", true);
        expect(button.getAttribute("title")).toBe(why);
      }
    });

    it("greys GENERATE out with the same sentence once a preview is there", async () => {
      const { emit } = await renderBar("editing", why);
      act(() =>
        emit({
          type: "state",
          name: "preview_ready",
          payload: { cfg: { tickrate: 64 }, sequences: { demo1: [{ start_tick: 1, end_tick: 2, events: [] }] } },
        }),
      );
      const generate = screen.getByRole("button", { name: /GENERATE/ });
      expect(generate).toHaveProperty("disabled", true);
      expect(generate.getAttribute("title")).toBe(why);
    });

    it("keeps RUN and PREVIEW usable with their normal tips when the engine has no objection", async () => {
      await renderBar("capture", null);
      expect(screen.getByRole("button", { name: /PREVIEW/ })).toHaveProperty("disabled", false);
      expect(screen.getByRole("button", { name: /RUN/ }).getAttribute("title")).toMatch(/full batch run/);
    });
  });

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
    render(
      <ActionBar
        registerButton={() => () => {}}
        active="capture"
        onSetTab={() => {}}
        weapon={<i>weapon slot</i>}
      />,
    );
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

  describe("editing tab", () => {
    it("shows GENERATE, SAVE and CANCEL instead of the capture actions", async () => {
      await renderBar("editing");
      expect(screen.getByRole("button", { name: /GENERATE/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /SAVE/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /CANCEL/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /RUN/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /PREVIEW/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /STOP/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /KILL/ })).toBeNull();
    });

    it("marks GENERATE/SAVE/CANCEL with their own ids, never the weapon-filter E1/E2/E3", async () => {
      await renderBar("editing");
      expect(screen.getByRole("button", { name: /GENERATE/ }).getAttribute("data-action")).toBe("Q1");
      expect(screen.getByRole("button", { name: /SAVE/ }).getAttribute("data-action")).toBe("Q2");
      expect(screen.getByRole("button", { name: /CANCEL/ }).getAttribute("data-action")).toBe("Q3");
    });

    it("disables GENERATE when no clip is selected, SAVE when there is no preview", async () => {
      const { emit } = await renderBar("editing");
      // No preview yet: both GENERATE (nothing selected) and SAVE (no data) disabled.
      expect(screen.getByRole("button", { name: /GENERATE/ })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: /SAVE/ })).toHaveProperty("disabled", true);
      // ...and both say why, pointing at the step that is missing.
      expect(screen.getByRole("button", { name: /GENERATE/ }).getAttribute("title")).toMatch(/PREVIEW/);
      expect(screen.getByRole("button", { name: /SAVE/ }).getAttribute("title")).toMatch(/PREVIEW/);

      // A preview arrives with two clips, one unselected.
      act(() =>
        emit({
          type: "state",
          name: "preview_ready",
          payload: {
            cfg: { tickrate: 64, player_name: "x" },
            sequences: {
              "demo1": [
                { start_tick: 1000, end_tick: 2000, events: [{ type: "Kill" }] },
                { start_tick: 3000, end_tick: 4000, events: [{ type: "Death" }] },
              ],
            },
          },
        }),
      );
      // Both clips arrive selected=true by default, so GENERATE and SAVE enable.
      expect(screen.getByRole("button", { name: /GENERATE/ })).toHaveProperty("disabled", false);
      expect(screen.getByRole("button", { name: /SAVE/ })).toHaveProperty("disabled", false);

      // Unselect the second clip; GENERATE stays enabled (one still selected).
      act(() => emit({ type: "state", name: "editing_toggle", payload: { index: 1 } }));
      expect(screen.getByRole("button", { name: /GENERATE/ })).toHaveProperty("disabled", false);

      // Unselect the last clip too: GENERATE disables, SAVE keeps working.
      act(() => emit({ type: "state", name: "editing_toggle", payload: { index: 0 } }));
      expect(screen.getByRole("button", { name: /GENERATE/ })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: /GENERATE/ }).getAttribute("title")).toMatch(/Check at least one clip/);
      expect(screen.getByRole("button", { name: /SAVE/ })).toHaveProperty("disabled", false);
    });

    it("GENERATE sends start_run with the selected clips in snake_case, and nothing else", async () => {
      const { sent, emit } = await renderBar("editing");
      act(() =>
        emit({
          type: "state",
          name: "preview_ready",
          payload: {
            cfg: { tickrate: 64 },
            sequences: {
              "demo1": [
                { start_tick: 1000, end_tick: 2000, events: [{ type: "Kill" }] },
                { start_tick: 3000, end_tick: 4000, events: [{ type: "Death" }] },
              ],
            },
          },
        }),
      );
      act(() => emit({ type: "state", name: "editing_toggle", payload: { index: 1 } }));

      sent.length = 0;
      act(() => screen.getByRole("button", { name: /GENERATE/ }).click());
      expect(sent).toHaveLength(1);
      expect(sent[0].name).toBe("start_run");
      expect(sent[0].selected_clips).toEqual([
        { demo_path: "demo1", start_tick: 1000 },
      ]);
      // The full cfg rides along, exactly like the capture-tab RUN button.
      expect(sent[0].cfg).toEqual({ steam_ids: ["1"], events: ["Kills"] });
    });

    it("SAVE sends save_preset with the cfg and selection, and nothing else", async () => {
      const { sent, emit } = await renderBar("editing");
      act(() =>
        emit({
          type: "state",
          name: "preview_ready",
          payload: {
            cfg: { tickrate: 64 },
            sequences: {
              "demo1": [{ start_tick: 1000, end_tick: 2000, events: [{ type: "Kill" }] }],
            },
          },
        }),
      );
      sent.length = 0;
      act(() => screen.getByRole("button", { name: /SAVE/ }).click());
      expect(sent).toHaveLength(1);
      expect(sent[0].name).toBe("save_preset");
      expect(sent[0].selected_clips).toEqual([{ demo_path: "demo1", start_tick: 1000 }]);
    });

    it("GENERATE and SAVE carry each clip's timeline edits", async () => {
      const { sent, emit } = await renderBar("editing");
      act(() =>
        emit({
          type: "state",
          name: "preview_ready",
          payload: {
            cfg: { tickrate: 64 },
            sequences: {
              demo1: [
                {
                  start_tick: 1000,
                  end_tick: 2000,
                  events: [{ type: "kill", tick: 1200 }, { type: "kill", tick: 1400 }],
                  event_keys: ["1200:kill:a", "1400:kill:b"],
                },
              ],
            },
          },
        }),
      );
      act(() => {
        editClip(0, { beforeS: 5, afterS: 0 });
        toggleClipEvent(0, "1400:kill:b");
      });
      const edited = { demo_path: "demo1", start_tick: 1000, before_s: 5, after_s: 0, excluded_events: ["1400:kill:b"] };

      sent.length = 0;
      act(() => screen.getByRole("button", { name: /GENERATE/ }).click());
      act(() => screen.getByRole("button", { name: /SAVE/ }).click());
      expect(sent.map((c) => c.name)).toEqual(["start_run", "save_preset"]);
      expect(sent[0].selected_clips).toEqual([edited]);
      expect(sent[1].selected_clips).toEqual([edited]);
    });

    it("CANCEL switches back to the capture tab and sends no command", async () => {
      const { sent, setTab } = await renderBar("editing");
      sent.length = 0;
      act(() => screen.getByRole("button", { name: /CANCEL/ }).click());
      expect(setTab).toHaveBeenCalledWith("capture");
      expect(sent).toHaveLength(0);
    });
  });
});
