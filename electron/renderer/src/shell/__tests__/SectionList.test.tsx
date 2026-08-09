/**
 * SectionList is an adapter, not a layout engine: these tests check the
 * translation in both directions (stored slots -> react-grid-layout props,
 * and the layout react-grid-layout hands back -> stored slots). The drag and
 * resize gestures themselves belong to the library and are not re-tested here.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
      isCollapsed: (id: string) => id === "beta",
      toggleCollapsed: vi.fn(),
      save: saved,
    }),
  };
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
});
