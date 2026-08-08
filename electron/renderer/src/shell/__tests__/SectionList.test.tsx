/**
 * Dragging or resizing a card must not break the section list's live reorder/collapse state.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const state: Record<string, unknown> = {};

// A reactive stub: SectionList must actually re-render when a card is
// toggled or dragged, so the mock needs real React state, not a plain
// object mutation (unlike sectionLayout.test.ts, which drives the hook
// directly with renderHook + manual rerender()).
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

describe("SectionList", () => {
  it("renders every section's title and body", () => {
    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={sections()} />);
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("body-a")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("collapses a card through its header hides only its own body", () => {
    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={sections()} />);
    fireEvent.click(screen.getByText("A").closest("button") as HTMLElement);
    const cardA = screen.getByText("A").closest(".sec") as HTMLElement;
    expect(cardA.classList.contains("closed")).toBe(true);
    expect(screen.getByText("body-b")).toBeTruthy();
  });

  it("gives every section a labelled drag handle", () => {
    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={sections()} />);
    expect(screen.getByLabelText("drag-a")).toBeTruthy();
    expect(screen.getByLabelText("drag-b")).toBeTruthy();
  });

  it("renders an empty registry gracefully", () => {
    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={[]} />);
  });

  it("FLIPs a card's own width when resized, not just position (2026-08-02)", () => {
    // jsdom has no layout engine, so getBoundingClientRect must be stubbed to
    // report a real width change -- otherwise dx/dy/dw are always 0 and the
    // whole FLIP branch never runs in this environment (AUDIT_restyle6...#1).
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const width = this.className.includes("sec") && this.classList.contains("wide") ? 620 : 300;
        return { left: 0, top: 0, width, height: 0, right: width, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
      });

    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={sections()} />);
    const cardA = screen.getByText("A").closest("section") as HTMLElement;

    // Own-property shadow on this instance's `style` records every value the
    // effect assigns to `width`, including the ones it sets and clears again
    // within the same synchronous block -- a plain "read style.width after
    // the click" check would only ever see the final, already-cleared value.
    const widthSets: string[] = [];
    Object.defineProperty(cardA.style, "width", {
      configurable: true,
      get() {
        return this.getPropertyValue("width");
      },
      set(value: string) {
        widthSets.push(value);
        this.setProperty("width", value);
      },
    });

    fireEvent.click(screen.getByLabelText("resize-A"));

    expect(cardA.classList.contains("wide")).toBe(true);
    expect(widthSets).toEqual(["300px", ""]);

    rectSpy.mockRestore();
  });

  it("does not reorder during the drag, only on mouseup (2026-08-08, workspace-vivant §A2)", () => {
    // Holographic preview: the cards stay put while the pointer moves; the
    // reorder commits exactly once, on mouseup. jsdom has no elementFromPoint,
    // so it is stubbed to report whatever DOM node the test wants
    // "under the cursor".
    delete state.ui_sections;
    const { container } = render(<SectionList tabId="capture" sections={sections()} />);
    const sectionA = screen.getByText("A").closest("section") as HTMLElement;

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => sectionA;

    // mousedown on B's handle, move over A: no reorder yet.
    fireEvent.mouseDown(screen.getByLabelText("drag-b"));
    fireEvent.mouseMove(window);
    let titles = [...container.querySelectorAll(".t")].map((el) => el.textContent);
    expect(titles).toEqual(["A", "B"]);

    // A second mousemove over the same target still does not reorder.
    fireEvent.mouseMove(window);
    titles = [...container.querySelectorAll(".t")].map((el) => el.textContent);
    expect(titles).toEqual(["A", "B"]);

    // Release over A: the single commit lands B before A.
    fireEvent.mouseUp(window);
    titles = [...container.querySelectorAll(".t")].map((el) => el.textContent);
    expect(titles).toEqual(["B", "A"]);

    document.elementFromPoint = originalElementFromPoint;
  });
});
