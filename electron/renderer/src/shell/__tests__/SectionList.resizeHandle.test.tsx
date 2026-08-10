/**
 * The resize handle belongs to the card's FRAME, never to its scrolling body.
 *
 * react-resizable appends its handle to the children of the element it
 * clones. With <Card> (a component) as the grid child, cloneElement replaced
 * Card's `children` prop, and Card renders those inside `.sb-scroll` -- so
 * the handle scrolled away with the content, fought the scrollbar for the
 * same corner, and sat four levels below `.react-grid-item`, where none of
 * our `.react-grid-item > ...` rules could reach it (audit 2026-08-10).
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Card from "../../components/Card";
import SectionList, { type SectionSpec } from "../SectionList";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 1200 });

vi.mock("../sectionLayout", async () => {
  const actual = await vi.importActual<typeof import("../sectionLayout")>("../sectionLayout");
  return {
    ...actual,
    useSectionLayout: () => ({
      slots: () => ({ alpha: { x: 0, y: 0, w: 4, h: 8 } }),
      isCollapsed: () => false,
      toggleCollapsed: vi.fn(),
      save: vi.fn(),
    }),
  };
});

const SECTIONS: SectionSpec[] = [{ id: "alpha", element: <Card title="Alpha">a</Card> }];

describe("resize handle placement", () => {
  it("the handle is a direct child of the grid item", () => {
    const { container } = render(<SectionList tabId="t" sections={SECTIONS} />);
    const item = container.querySelector(".react-grid-item");
    const handle = container.querySelector(".react-resizable-handle");
    expect(item).not.toBeNull();
    expect(handle).not.toBeNull();
    expect(handle?.parentElement).toBe(item);
  });

  it("the handle is NOT inside the card's scrolling body", () => {
    const { container } = render(<SectionList tabId="t" sections={SECTIONS} />);
    const body = container.querySelector(".sb-scroll");
    const handle = container.querySelector(".react-resizable-handle");
    expect(body?.contains(handle as Node)).toBe(false);
  });

  it("the card is a child of the grid item, not the grid item itself", () => {
    const { container } = render(<SectionList tabId="t" sections={SECTIONS} />);
    const item = container.querySelector(".react-grid-item");
    expect(item?.classList.contains("sec")).toBe(false);
    expect(item?.querySelector(":scope > .sec")).not.toBeNull();
  });
});
