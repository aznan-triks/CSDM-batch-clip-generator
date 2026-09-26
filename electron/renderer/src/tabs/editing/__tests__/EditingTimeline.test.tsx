import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { dispatchEngineMessage, getEngineState, resetEngineState } from "../../../motion/engineStore";
import { EditingTab } from "../../EditingTab";
import { EDITING_TIMELINE } from "../EditingTimeline";

const TR = 64;

/** `demos` demos of `perDemo` two-kill clips, one minute apart, with cameras. */
function preview(demos: number, perDemo: number) {
  const sequences: Record<string, unknown[]> = {};
  for (let d = 0; d < demos; d++) {
    sequences[`C:/demos/match-${d}.dem`] = Array.from({ length: perDemo }, (_, i) => {
      const t = (i + 1) * 60 * TR;
      return {
        start_tick: t - 3 * TR,
        end_tick: t + 4 * TR,
        event_type: "kill",
        events: [
          { type: "kill", tick: t, victim_sid: "a" },
          { type: "kill", tick: t + 2 * TR, victim_sid: "b" },
        ],
        event_keys: [`${t}:kill:a`, `${t + 2 * TR}:kill:b`],
        camera_segments: [{ from_tick: t - 3 * TR, to_tick: t + 4 * TR, steam_id: "me", name: "Me" }],
      };
    });
  }
  act(() => dispatchEngineMessage("preview_ready", { sequences, cfg: { tickrate: TR } }));
}

describe("EDITING timeline", () => {
  beforeEach(() => resetEngineState());

  it("opens on the timeline with one lane per demo, a page of lanes at a time", () => {
    render(<EditingTab />);
    preview(EDITING_TIMELINE.lanesPerPage + 3, 2);
    expect(document.querySelectorAll(".edtl-lane")).toHaveLength(EDITING_TIMELINE.lanesPerPage);
    expect(screen.getByText("1 / 2")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(document.querySelectorAll(".edtl-lane")).toHaveLength(3);
    expect(document.querySelector(".editing-list")).toBeNull();
  });

  it("keeps the list view one click away", () => {
    render(<EditingTab />);
    preview(2, 3);
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(document.querySelectorAll(".editing-clip")).toHaveLength(6);
    expect(document.querySelector(".edtl")).toBeNull();
  });

  it("mounts only the clips the scroll window shows once zoomed in", () => {
    render(<EditingTab />);
    preview(1, 200);
    expect(document.querySelectorAll(".edtl-clip")).toHaveLength(200);
    const zoomIn = screen.getByLabelText("Zoom in");
    for (let i = 0; i < 12; i++) fireEvent.click(zoomIn);
    const mounted = document.querySelectorAll(".edtl-clip").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(20);
  });

  it("opens a clicked clip in the inspector and edits it there", () => {
    render(<EditingTab />);
    preview(2, 3);
    fireEvent.click(document.querySelectorAll(".edtl-clip")[1]);
    const inspector = screen.getByRole("region", { name: "Clip inspector" });
    expect(inspector.textContent).toContain("clip 2 of 3");
    expect(inspector.textContent).toContain("Me"); // the camera span

    // Include / exclude the clip.
    fireEvent.click(within(inspector).getByRole("checkbox", { name: /Include/ }));
    expect(getEngineState().previewClips[1].selected).toBe(false);

    // Take an event out.
    fireEvent.click(within(inspector).getAllByRole("checkbox", { name: /Kill/ })[1]);
    expect(getEngineState().previewClips[1].edit?.excluded).toEqual([`${120 * TR + 2 * TR}:kill:b`]);

    // Move the start handle one second earlier, from the keyboard.
    fireEvent.keyDown(within(inspector).getByRole("slider", { name: /before/ }), { key: "ArrowLeft" });
    expect(getEngineState().previewClips[1].edit?.beforeS).toBe(4);

    // Reset puts the clip back as previewed.
    fireEvent.click(within(inspector).getByRole("button", { name: "Reset" }));
    expect(getEngineState().previewClips[1].edit).toBeUndefined();
  });

  it("closes the inspector on a new preview", () => {
    render(<EditingTab />);
    preview(1, 2);
    fireEvent.click(document.querySelectorAll(".edtl-clip")[0]);
    expect(screen.getByRole("region", { name: "Clip inspector" })).toBeTruthy();
    preview(1, 2);
    expect(screen.queryByRole("region", { name: "Clip inspector" })).toBeNull();
  });
});
