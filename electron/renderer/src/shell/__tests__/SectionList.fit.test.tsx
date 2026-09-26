/**
 * Content-fitted card heights (fix/cards-fit-style): a card the user never
 * resized takes the height its content measures; a hand-resized one
 * (`manual`) and a collapsed one keep their stored height. jsdom has no
 * layout, so the measurement itself (`naturalRows`) is stubbed -- it is
 * proven against real layout by e2e/card-fit-proof.mjs.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Card from "../../components/Card";
import { SettingsProvider } from "../../settings/store";
import SectionList, { type SectionSpec } from "../SectionList";

vi.mock("../cardFit", () => ({
  layoutChildren: () => [],
  naturalRows: () => 20,
}));

vi.mock("../sectionLayout", async () => {
  const actual = await vi.importActual<typeof import("../sectionLayout")>("../sectionLayout");
  return {
    ...actual,
    useSectionLayout: () => ({
      slots: () => ({
        auto: { x: 0, y: 0, w: 4, h: 8 },
        hand: { x: 4, y: 0, w: 4, h: 8, manual: true },
        folded: { x: 8, y: 0, w: 4, h: 2, hPrev: 8 },
      }),
      isCollapsed: (id: string) => id === "folded",
      toggleCollapsed: vi.fn(),
      save: vi.fn(),
    }),
  };
});

// A ResizeObserver that reports every element it is given, like the real one
// does on `observe()`.
const RealResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      queueMicrotask(() => this.callback([{ target, contentRect: { width: 1200 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver));
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver;
});

const SECTIONS: SectionSpec[] = [
  { id: "auto", element: <Card title="Auto">a</Card> },
  { id: "hand", element: <Card title="Hand">b</Card> },
  { id: "folded", element: <Card title="Folded">c</Card> },
];

/** The pixel height react-grid-layout gives `rows` fine rows (24px rows, 10px gaps). */
const px = (rows: number) => `${rows * 24 + (rows - 1) * 10}px`;

describe("content-fitted card heights", () => {
  it("fits a card nobody resized, and leaves hand-set and folded cards alone", async () => {
    const { container } = render(
      <SettingsProvider>
        <SectionList tabId="t" sections={SECTIONS} />
      </SettingsProvider>,
    );
    await act(async () => {});
    const height = (id: string) => (container.querySelector(`[data-card-id="${id}"]`) as HTMLElement).style.height;
    expect(height("auto")).toBe(px(20));
    expect(height("hand")).toBe(px(8));
    expect(height("folded")).toBe(px(2));
  });
});
