/**
 * The holographic drag preview (workspace-vivant §A2): during a drag the
 * dragged card stays at its ORIGINAL slot (dimmed, `.is-dragging`) and a
 * dashed `.card-placeholder` marks the slot it would land in. Both appear on
 * mousemove and disappear after mouseup commits the reorder.
 *
 * Each test renders its OWN SectionList and points `elementFromPoint` at that
 * instance's card A: `resolveTargetId` matches `.sec` elements against the
 * instance's own ref map, so the placeholder only resolves against the same
 * tree the drag started in.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state: Record<string, unknown> = {};

vi.mock("../../settings/store", () => ({
  useSetting: (key: string) => {
    const [value, setValue] = useState(state[key]);
    const set = (next: unknown) => {
      state[key] = next;
      setValue(next);
    };
    return [value, set];
  },
}));

import Card from "../../components/Card";
import SectionList from "../SectionList";

function sections() {
  return [
    { id: "a", element: <Card title="A">body-a</Card> },
    { id: "b", element: <Card title="B">body-b</Card> },
  ];
}

describe("SectionList holographic drag preview", () => {
  let originalElementFromPoint: typeof document.elementFromPoint;

  beforeEach(() => {
    delete state.ui_sections;
    originalElementFromPoint = document.elementFromPoint;
  });

  afterEach(() => {
    document.elementFromPoint = originalElementFromPoint;
  });

  function renderAndDrag() {
    const rendered = render(<SectionList tabId="capture" sections={sections()} />);
    const sectionA = screen.getByText("A").closest("section") as HTMLElement;
    document.elementFromPoint = () => sectionA;
    return rendered;
  }

  it("shows a placeholder before the drop target while dragging, and dims the dragged card", () => {
    const { container } = renderAndDrag();

    fireEvent.mouseDown(screen.getByLabelText("drag-b"));
    fireEvent.mouseMove(window);

    // Dragged card (B) stays in place but is dimmed.
    const cardB = screen.getByText("B").closest("section") as HTMLElement;
    expect(cardB.classList.contains("is-dragging")).toBe(true);

    // A placeholder appears at the drop slot.
    expect(container.querySelector(".card-placeholder")).not.toBeNull();
  });

  it("removes the placeholder and ghost on mouseup, committing the reorder", () => {
    const { container } = renderAndDrag();

    fireEvent.mouseDown(screen.getByLabelText("drag-b"));
    fireEvent.mouseMove(window);
    expect(container.querySelector(".card-placeholder")).not.toBeNull();

    fireEvent.mouseUp(window);

    expect(container.querySelector(".card-placeholder")).toBeNull();
    const cardB = screen.getByText("B").closest("section") as HTMLElement;
    expect(cardB.classList.contains("is-dragging")).toBe(false);
    // The single commit landed B before A.
    const titles = [...container.querySelectorAll(".t")].map((el) => el.textContent);
    expect(titles).toEqual(["B", "A"]);
  });

  it("Escape removes the placeholder and ghost WITHOUT reordering", () => {
    const { container } = renderAndDrag();

    fireEvent.mouseDown(screen.getByLabelText("drag-b"));
    fireEvent.mouseMove(window);
    expect(container.querySelector(".card-placeholder")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(container.querySelector(".card-placeholder")).toBeNull();
    const cardB = screen.getByText("B").closest("section") as HTMLElement;
    expect(cardB.classList.contains("is-dragging")).toBe(false);
    const titles = [...container.querySelectorAll(".t")].map((el) => el.textContent);
    expect(titles).toEqual(["A", "B"]);
  });
});
