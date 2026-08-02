import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeMessage } from "../bridge";
import { EngineLostBanner } from "../shell/EngineLostBanner";

const mockRestartEngine = vi.fn().mockResolvedValue(undefined);
const listeners = new Set<(message: BridgeMessage) => void>();

vi.mock("../bridge", () => ({
  onMessage: (cb: (message: BridgeMessage) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  send: () => {},
}));

function emit(message: BridgeMessage): void {
  for (const cb of listeners) cb(message);
}

function stubBridge(hasBridge = true) {
  if (hasBridge) {
    vi.stubGlobal("bridge", { restartEngine: mockRestartEngine });
  }
}

afterEach(() => {
  listeners.clear();
  mockRestartEngine.mockReset();
  vi.unstubAllGlobals();
});

function renderBanner(onRegain?: () => void) {
  return render(<EngineLostBanner onRegain={onRegain ?? (() => {})} />);
}

describe("EngineLostBanner", () => {
  it("does not render at all when the engine is alive", () => {
    stubBridge();
    renderBanner();
    const el = document.querySelector(".engine-lost");
    expect(el).toBeNull();
  });

  it("shows a restart button once the engine dies", () => {
    stubBridge();
    const { rerender } = renderBanner();
    act(() => emit({ type: "child_exit", code: 1, signal: null }));
    rerender(<EngineLostBanner onRegain={() => {}} />);
    screen.getByRole("button", { name: /restart/i });
  });

  it("stays hidden after other engine messages", () => {
    stubBridge();
    renderBanner();
    act(() => emit({ type: "log", level: "info", message: "hello" }));
    const el = document.querySelector(".engine-lost");
    expect(el).toBeNull();
  });

  it("calls restartEngine on click and shows trying state", () => {
    stubBridge();
    const { rerender } = renderBanner();
    act(() => emit({ type: "child_exit", code: 1, signal: null }));
    rerender(<EngineLostBanner onRegain={() => {}} />);
    const button = screen.getByRole("button", { name: /restart/i });
    fireEvent.click(button);
    expect(mockRestartEngine).toHaveBeenCalled();
    screen.getByText(/trying/i);
  });

  it("calls onRegain when the engine comes back", () => {
    stubBridge();
    const onRegain = vi.fn();
    const { rerender } = renderBanner(onRegain);
    act(() => emit({ type: "child_exit", code: 1, signal: null }));
    rerender(<EngineLostBanner onRegain={onRegain} />);
    screen.getByRole("button", { name: /restart/i });
    act(() => emit({ type: "log", level: "info", message: "bridge ready" }));
    rerender(<EngineLostBanner onRegain={onRegain} />);
    expect(onRegain).toHaveBeenCalled();
    const el = document.querySelector(".engine-lost");
    expect(el).toBeNull();
  });

  it("without bridge says the engine is gone", () => {
    stubBridge(false);
    renderBanner();
    screen.getByText(/engine is gone/i);
    expect(document.querySelector(".engine-lost")).not.toBeNull();
  });
});
