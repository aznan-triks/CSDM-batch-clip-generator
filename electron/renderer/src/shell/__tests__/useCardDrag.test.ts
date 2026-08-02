/**
 * The reorder drag hook must not fire on the wrong pointer target, or miss the drop.
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

  it("reorders on the first mousemove that resolves a different target", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    const resolveTargetId = () => "b";

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, clientY: 1 }));
    });

    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith("a", "b");
  });

  it("does not reorder again while the pointer stays over the same target", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    const resolveTargetId = () => "b";

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, clientY: 1 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 2, clientY: 2 }));
    });

    expect(reorder).toHaveBeenCalledTimes(1);
  });

  it("reorders again once the pointer moves onto a new target", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    let target = "b";
    const resolveTargetId = () => target;

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove"));
      target = "c";
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    expect(reorder).toHaveBeenCalledTimes(2);
    expect(reorder).toHaveBeenNthCalledWith(1, "a", "b");
    expect(reorder).toHaveBeenNthCalledWith(2, "a", "c");
  });

  it("stops listening after mouseup", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    const resolveTargetId = () => "b";

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mouseup"));
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    expect(reorder).not.toHaveBeenCalled();
  });

  it("never resolves a target when the hit element is null", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    const resolveTargetId = () => null;

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    expect(reorder).not.toHaveBeenCalled();
  });
});
