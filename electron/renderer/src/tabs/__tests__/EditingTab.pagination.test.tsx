import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatchEngineMessage, getEngineState, resetEngineState } from "../../motion/engineStore";
import { EDITING_LIST, EditingTab } from "../EditingTab";

/** One preview_ready carrying `count` one-second clips in a single demo. */
function previewOf(count: number) {
  const seqs = Array.from({ length: count }, (_, i) => ({
    start_tick: i * 1000, end_tick: i * 1000 + 64, event_type: "kill", events: [{ killer_sid: `p${i}` }],
  }));
  act(() => dispatchEngineMessage("preview_ready", { sequences: { "d.dem": seqs }, cfg: { tickrate: 64 } }));
}

describe("EditingTab pagination", () => {
  beforeEach(() => resetEngineState());

  it("renders one page of clips, not the whole preview", () => {
    render(<EditingTab />);
    previewOf(EDITING_LIST.pageSize * 2 + 5);
    expect(document.querySelectorAll(".editing-clip")).toHaveLength(EDITING_LIST.pageSize);
    expect(screen.getByText(`1 / 3`)).toBeTruthy();
  });

  it("counts the whole preview in the header", () => {
    render(<EditingTab />);
    previewOf(EDITING_LIST.pageSize + 1);
    expect(document.querySelector(".editing-summary")?.textContent).toContain(`of ${EDITING_LIST.pageSize + 1} clips`);
  });

  it("toggles the clip under the cursor on a later page", () => {
    render(<EditingTab />);
    previewOf(EDITING_LIST.pageSize + 3);
    fireEvent.click(screen.getByLabelText("Next page"));
    fireEvent.click(document.querySelectorAll(".editing-clip")[1]);
    expect(getEngineState().previewClips[EDITING_LIST.pageSize + 1].selected).toBe(false);
    expect(getEngineState().previewClips[1].selected).toBe(true);
  });

  it("goes back to the first page on a new preview, not on a toggle", () => {
    render(<EditingTab />);
    previewOf(EDITING_LIST.pageSize + 3);
    fireEvent.click(screen.getByLabelText("Next page"));
    fireEvent.click(document.querySelectorAll(".editing-clip")[0]);
    expect(screen.getByText("2 / 2")).toBeTruthy();
    previewOf(EDITING_LIST.pageSize + 3);
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  it("shows no pager when everything fits on one page", () => {
    render(<EditingTab />);
    previewOf(3);
    expect(screen.queryByLabelText("Next page")).toBeNull();
  });
});
