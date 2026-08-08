/**
 * The reorder drag hook must not fire on the wrong pointer target, or miss
 * the drop -- and since 2026-08-08 (workspace-vivant §A2) it must NOT reorder
 * while the pointer moves at all: it tracks the target for the placeholder,
 * and commits `reorder` exactly once, on mouseup (or never, on Escape).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCardDrag } from "../useCardDrag";

describe("useCardDrag", () => {
  // jsdom does not implement elementFromPoint at all (no real layout engine)
  // -- the hook reads it to find what's under the pointer, so every test
  // needs a stand-in for resolveTargetId to ever be reached.
  const hitElement = document.createElement("div");
  const originalElementFromPoint = document.elementFromPoint;
  beforeEach(() => {
    document.elementFromPoint = () => hitElement;
  });
  afterEach(() => {
    document.elementFromPoint = originalElementFromPoint;
  });

  it("does NOT reorder on mousemove, only on mouseup", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    const resolveTargetId = () => "b";

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, clientY: 1 }));
    });

    // Preview: no commit while moving.
    expect(reorder).not.toHaveBeenCalled();
    // ...but the target is tracked so the placeholder can follow.
    expect(result.current.currentTargetId).toBe("b");

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith("a", "b");
  });

  it("commits exactly once even over many moves and repeats on the same target", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    const resolveTargetId = () => "b";

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, clientY: 1 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 2, clientY: 2 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 3, clientY: 3 }));
    });

    expect(reorder).not.toHaveBeenCalled();
    expect(result.current.currentTargetId).toBe("b");

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith("a", "b");
  });

  it("commits the FINAL target the pointer settled on, not an intermediate one", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    let target = "b";
    const resolveTargetId = () => target;

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove"));
      target = "c";
      window.dispatchEvent(new MouseEvent("mousemove"));
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    expect(reorder).not.toHaveBeenCalled();
    expect(result.current.currentTargetId).toBe("c");

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith("a", "c");
  });

  it("Escape cancels the gesture without reordering", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    const resolveTargetId = () => "b";

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, clientY: 1 }));
    });

    expect(result.current.currentTargetId).toBe("b");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(reorder).not.toHaveBeenCalled();
    expect(result.current.draggedId).toBeNull();
    expect(result.current.currentTargetId).toBeNull();

    // After cancel, listeners are removed: a later mouseup must not commit.
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(reorder).not.toHaveBeenCalled();
  });

  it("stops listening after mouseup -- a later mousemove does not re-commit", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    const resolveTargetId = () => "b";

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mouseup"));
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    expect(reorder).not.toHaveBeenCalled();
    expect(result.current.draggedId).toBeNull();
  });

  it("never commits when the hit element never resolves a target", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    const resolveTargetId = () => null;

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove"));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(reorder).not.toHaveBeenCalled();
  });

  it("does not commit when dropped back on the dragged card itself", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    // The gesture starts with the target = the dragged id; if it never leaves
    // that card, mouseup is a no-op drop.
    const resolveTargetId = () => "a";

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove"));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(reorder).not.toHaveBeenCalled();
  });
});
