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

  it("collapsing a card through its header hides only its own body", () => {
    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={sections()} />);
    fireEvent.click(screen.getByText("A").closest("button") as HTMLElement);
    expect(screen.queryByText("body-a")).toBeNull();
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

  it("reorders live on mousemove, before mouseup (2026-08-02)", () => {
    // Native HTML5 drag-and-drop is gone (AUDIT_restyle6_polish_regressions.md
    // #8: it loses target tracking once the DOM reorders mid-drag). This is a
    // plain mouse gesture now -- jsdom has no elementFromPoint, so it is
    // stubbed to report whatever DOM node the test wants "under the cursor".
    delete state.ui_sections;
    const { container } = render(<SectionList tabId="capture" sections={sections()} />);
    const sectionA = screen.getByText("A").closest("section") as HTMLElement;

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => sectionA;

    fireEvent.mouseDown(screen.getByLabelText("drag-b"));
    fireEvent.mouseMove(window);

    const titlesAfterMove = [...container.querySelectorAll(".t")].map((el) => el.textContent);
    expect(titlesAfterMove).toEqual(["B", "A"]);

    // A second mousemove over the same target must not reorder again.
    fireEvent.mouseMove(window);
    const titlesAfterSecondMove = [...container.querySelectorAll(".t")].map((el) => el.textContent);
    expect(titlesAfterSecondMove).toEqual(["B", "A"]);

    fireEvent.mouseUp(window);
    document.elementFromPoint = originalElementFromPoint;
  });
});
