/**
 * The inspector's camera spans are the engine's plan for the EDITED clip.
 *
 * Taking an event out can drop a camera switch (perspective "both" cuts to the
 * victim before each kill). The inspector must then show what the run will
 * record, asked of the engine (`clip_cameras`), not the preview's old plan.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchEngineMessage, getEngineState, resetEngineState } from "../../../motion/engineStore";
import ClipInspector from "../ClipInspector";
import { buildLanes } from "../clipEdits";

const TR = 64;
const sent: Array<{ name: string; payload: Record<string, unknown> }> = [];
// What the engine plans for the edited clip: Alice's kill is out, so Me only.
const EDITED_PLAN = [{ from_tick: 2800, to_tick: 3700, steam_id: "me", name: "Me" }];

vi.mock("../../../bridge", () => ({
  runCommand: (name: string, payload: Record<string, unknown> = {}) => {
    sent.push({ name, payload });
    return Promise.resolve({ type: "result", id: "1", ok: true, cameras: EDITED_PLAN });
  },
  onMessage: () => () => {},
}));

function renderInspector() {
  const view = () => {
    const clips = getEngineState().previewClips;
    return <ClipInspector clips={clips} index={0} lane={buildLanes(clips)[0]} tickrate={TR} onClose={() => {}} />;
  };
  const utils = render(view());
  return { ...utils, refresh: () => utils.rerender(view()) };
}

describe("inspector cameras", () => {
  beforeEach(() => {
    resetEngineState();
    sent.length = 0;
    act(() =>
      dispatchEngineMessage("preview_ready", {
        cfg: { tickrate: TR },
        sequences: {
          d1: [
            {
              start_tick: 2800,
              end_tick: 3700,
              events: [{ type: "kill", tick: 3000 }, { type: "kill", tick: 3300 }],
              event_keys: ["3000:kill:a", "3300:kill:b"],
              camera_segments: [
                { from_tick: 2800, to_tick: 2936, steam_id: "me", name: "Me" },
                { from_tick: 2936, to_tick: 3000, steam_id: "a", name: "Alice" },
                { from_tick: 3000, to_tick: 3700, steam_id: "me", name: "Me" },
              ],
            },
          ],
        },
      }),
    );
  });

  it("shows the preview's plan while the clip is unedited, without asking", () => {
    renderInspector();
    expect(screen.getByLabelText("Clip inspector").textContent).toContain("Alice");
    expect(sent).toHaveLength(0);
  });

  it("asks the engine for the edited clip's cameras and shows its answer", async () => {
    const { refresh } = renderInspector();
    fireEvent.click(screen.getByRole("checkbox", { name: /Kill.*0:46/ }));
    refresh();
    await act(async () => {});
    expect(sent).toEqual([
      { name: "clip_cameras", payload: { clip: { demo_path: "d1", start_tick: 2800, excluded_events: ["3000:kill:a"] } } },
    ]);
    expect(screen.getByLabelText("Clip inspector").textContent).not.toContain("Alice");
    expect(screen.getByLabelText("Clip inspector").textContent).toContain("Me");
  });
});
