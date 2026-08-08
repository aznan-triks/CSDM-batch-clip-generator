/**
 * Focused preview-contract tests for useCardDrag (workspace-vivant §A2):
 * no reorder during mousemove, one reorder on mouseup, currentTargetId
 * tracked live for the placeholder, and Escape cancels.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCardDrag } from "../useCardDrag";

describe("useCardDrag preview contract", () => {
  const hitElement = document.createElement("div");
  const originalElementFromPoint = document.elementFromPoint;
  beforeEach(() => {
    document.elementFromPoint = () => hitElement;
  });
  afterEach(() => {
    document.elementFromPoint = originalElementFromPoint;
  });

  it("never calls reorder during mousemove -- only on mouseup", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));

    act(() => {
      result.current.startDrag("a", () => "b")({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    });

    expect(reorder).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith("a", "b");
  });

  it("tracks currentTargetId live on mousemove so the placeholder can follow", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));
    let target = "b";
    const resolveTargetId = () => target;

    act(() => {
      result.current.startDrag("a", resolveTargetId)({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove"));
    });
    expect(result.current.currentTargetId).toBe("b");

    act(() => {
      target = "c";
      window.dispatchEvent(new MouseEvent("mousemove"));
    });
    expect(result.current.currentTargetId).toBe("c");
    expect(reorder).not.toHaveBeenCalled();
  });

  it("Escape cancels the gesture without reordering and clears the tracked target", () => {
    const reorder = vi.fn();
    const { result } = renderHook(() => useCardDrag(reorder));

    act(() => {
      result.current.startDrag("a", () => "b")({ preventDefault: () => {} } as never);
      window.dispatchEvent(new MouseEvent("mousemove"));
    });
    expect(result.current.currentTargetId).toBe("b");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(reorder).not.toHaveBeenCalled();
    expect(result.current.draggedId).toBeNull();
    expect(result.current.currentTargetId).toBeNull();
  });
});
