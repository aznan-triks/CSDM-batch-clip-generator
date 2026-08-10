/**
 * SectionList is an adapter, not a layout engine: these tests check the
 * translation in both directions (stored slots -> react-grid-layout props,
 * and the layout react-grid-layout hands back -> stored slots). The drag and
 * resize gestures themselves belong to the library and are not re-tested here.
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Card from "../../components/Card";
import SectionList, { type SectionSpec } from "../SectionList";

// The ResizeObserver/clientWidth stubs SectionList needs in jsdom live in
// the global test-setup.ts (every tab that renders it needs the same fix).

const saved = vi.fn();

vi.mock("../sectionLayout", async () => {
  const actual = await vi.importActual<typeof import("../sectionLayout")>("../sectionLayout");
  return {
    ...actual,
    useSectionLayout: () => ({
      slots: () => ({
        alpha: { x: 0, y: 0, w: 4, h: 8 },
        beta: { x: 4, y: 0, w: 2, h: 8 },
      }),
      // Nothing fresh: every declared card already has a stored rectangle,
      // so the once-only measurement effect (SectionList.tsx) has nothing
      // to do and must never call save() on its own.
      freshIds: () => [],
      isCollapsed: (id: string) => id === "beta",
      toggleCollapsed: vi.fn(),
      save: saved,
    }),
  };
});

beforeEach(() => {
  saved.mockClear();
});

const SECTIONS: SectionSpec[] = [
  { id: "alpha", element: <Card title="Alpha">a</Card> },
  { id: "beta", element: <Card title="Beta">b</Card> },
];

describe("SectionList", () => {
  it("renders one grid item per declared section", () => {
    const { container } = render(<SectionList tabId="t" sections={SECTIONS} />);
    expect(container.querySelectorAll(".react-grid-item")).toHaveLength(2);
  });

  it("gives every card a drag handle", () => {
    render(<SectionList tabId="t" sections={SECTIONS} />);
    expect(screen.getByLabelText("drag-alpha")).toBeTruthy();
    expect(screen.getByLabelText("drag-beta")).toBeTruthy();
  });

  it("passes the persisted fold state down to the card", () => {
    render(<SectionList tabId="t" sections={SECTIONS} />);
    // `beta` is collapsed in the stub above.
    const betaHeader = screen.getByRole("button", { name: /Beta/ });
    expect(betaHeader.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a section that has no stored slot", () => {
    const extra: SectionSpec[] = [...SECTIONS, { id: "gamma", element: <Card title="Gamma">g</Card> }];
    render(<SectionList tabId="t" sections={extra} />);
    expect(screen.getByText("Gamma")).toBeTruthy();
  });

  it("leaves a stored card's height alone", async () => {
    // Every declared card is stored (freshIds: () => [] in the mock above),
    // so the measurement effect (SectionList.tsx) must never fire -- but
    // react-grid-layout itself may still echo the untouched layout back
    // through onLayoutChange on mount, which is harmless. What must hold is
    // that no call ever reports a height other than the one that was stored.
    render(<SectionList tabId="t" sections={SECTIONS} />);
    await act(async () => {});
    for (const [cards] of saved.mock.calls) {
      expect(cards.alpha.h).toBe(8);
      expect(cards.beta.h).toBe(8);
    }
  });
});
