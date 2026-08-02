/**
 * A card's order and collapsed state must persist across renders, keyed by tab.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state: Record<string, unknown> = {};

vi.mock("../../settings/store", () => ({
  useSetting: (key: string) => {
    const set = (value: unknown) => {
      state[key] = value;
    };
    return [state[key], set];
  },
}));

import { useSectionLayout } from "../sectionLayout";

describe("useSectionLayout", () => {
  it("falls back to the declared order when nothing is stored", () => {
    delete state.ui_sections;
    const { result } = renderHook(() => useSectionLayout("capture", ["a", "b", "c"]));
    expect(result.current.order).toEqual(["a", "b", "c"]);
    expect(result.current.isCollapsed("a")).toBe(false);
  });

  it("toggling a card persists its collapsed state, keyed by tab", () => {
    delete state.ui_sections;
    const { result, rerender } = renderHook(() => useSectionLayout("capture", ["a", "b"]));
    act(() => result.current.toggleCollapsed("a"));
    rerender();
    expect(result.current.isCollapsed("a")).toBe(true);
    expect(result.current.isCollapsed("b")).toBe(false);
  });

  it("reordering moves the dragged id before the drop target and persists it", () => {
    delete state.ui_sections;
    const { result, rerender } = renderHook(() => useSectionLayout("capture", ["a", "b", "c"]));
    act(() => result.current.reorder("c", "a"));
    rerender();
    expect(result.current.order).toEqual(["c", "a", "b"]);
  });

  it("drops a stored id that is no longer declared, without crashing", () => {
    state.ui_sections = { capture: { order: ["x", "a", "b"], collapsed: ["x"] } };
    const { result } = renderHook(() => useSectionLayout("capture", ["a", "b"]));
    expect(result.current.order).toEqual(["a", "b"]);
  });

  it("appends a newly declared id that is missing from the stored order", () => {
    state.ui_sections = { capture: { order: ["b"], collapsed: [] } };
    const { result } = renderHook(() => useSectionLayout("capture", ["a", "b", "c"]));
    expect(result.current.order).toEqual(["b", "a", "c"]);
  });

  it("keeps each tab's layout independent", () => {
    state.ui_sections = { capture: { order: ["b", "a"], collapsed: [] } };
    const { result } = renderHook(() => useSectionLayout("video", ["x", "y"]));
    expect(result.current.order).toEqual(["x", "y"]);
  });
});
