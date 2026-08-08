/**
 * SectionList block-grid gestures: the pointer math and commit path for
 * drag-to-move and corner-drag resize. jsdom cannot lay out a real CSS grid,
 * so the bento is stubbed to a fixed geometry (3 columns of 96px, gap 10px)
 * and the gesture is driven by window mousemove/mouseup -- exactly the
 * listeners SectionList installs.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { CSSProperties, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SectionList from "../SectionList";

const store: Record<string, unknown> = {};
const lastWrite = { value: null as unknown };

vi.mock("../../settings/store", () => ({
  useSetting: (key: string) => {
    const set = (value: unknown) => {
      store[key] = value;
      lastWrite.value = value;
    };
    return [store[key], set];
  },
}));

/** Minimal card: forwards style, renders the drag handle and resize corner. */
function FakeCard({
  className,
  style,
  dragHandle,
  onResizeToggle,
}: {
  className?: string;
  style?: CSSProperties;
  dragHandle?: ReactElement;
  onResizeToggle?: (e: unknown) => void;
}) {
  return (
    <div className={`sec ${className ?? ""}`} style={style}>
      {dragHandle}
      <span className="fake-content">content</span>
      <button type="button" className="resize-br" onMouseDown={onResizeToggle} aria-label="resize-card" />
    </div>
  );
}

const SECTIONS = [{ id: "card", element: <FakeCard /> }];

/** A 3-column bento at 96px blocks, 10px gap. */
const fakeBento = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) }),
} as unknown as Element;

const origGetComputedStyle = window.getComputedStyle.bind(window);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  lastWrite.value = null;
  vi.spyOn(document, "querySelector").mockImplementation((sel) => {
    if (String(sel) === '[role="tabpanel"] .bento') return fakeBento;
    return null;
  });
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
    if (el === fakeBento) {
      return { gridTemplateColumns: "96px 96px 96px" } as CSSStyleDeclaration;
    }
    if (el === document.documentElement) {
      return {
        getPropertyValue: (name: string) => (name === "--block" ? "96px" : name === "--block-gap" ? "10px" : ""),
      } as unknown as CSSStyleDeclaration;
    }
    return origGetComputedStyle(el);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SectionList block-grid gestures", () => {
  it("drag moves the card to the pointer cell and persists it", () => {
    render(<SectionList tabId="capture" sections={SECTIONS} />);
    const handle = screen.getByLabelText("drag-card");
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });
    // Pointer at (250, 150): col = floor(250/106)+1 = 3, row = floor(150/106)+1 = 2
    fireEvent.mouseMove(window, { clientX: 250, clientY: 150 });
    fireEvent.mouseUp(window);
    const written = lastWrite.value as { capture: { cards: Record<string, { col: number; row: number }> } };
    expect(written.capture.cards.card.col).toBe(3);
    expect(written.capture.cards.card.row).toBe(2);
  });

  it("corner drag resizes the card's span and persists it", () => {
    render(<SectionList tabId="capture" sections={SECTIONS} />);
    const corner = screen.getByLabelText("resize-card");
    // Start at the card's origin (1,1); drag the corner to (500, 400):
    // colSpan is clamped to the grid's 3 columns (cell 5 -> 3, span 3),
    // rowSpan = floor(400/106)+1 = 4 (rows are not clamped by column count).
    fireEvent.mouseDown(corner, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 400 });
    fireEvent.mouseUp(window);
    const written = lastWrite.value as { capture: { cards: Record<string, { colSpan: number; rowSpan: number }> } };
    expect(written.capture.cards.card.colSpan).toBe(3);
    expect(written.capture.cards.card.rowSpan).toBe(4);
  });

  it("clamps the drag target to the column count", () => {
    render(<SectionList tabId="capture" sections={SECTIONS} />);
    const handle = screen.getByLabelText("drag-card");
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });
    // Pointer far right: col must clamp to 3, not go past it.
    fireEvent.mouseMove(window, { clientX: 9000, clientY: 200 });
    fireEvent.mouseUp(window);
    const written = lastWrite.value as { capture: { cards: Record<string, { col: number }> } };
    expect(written.capture.cards.card.col).toBe(3);
  });
});
