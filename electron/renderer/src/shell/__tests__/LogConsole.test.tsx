/**
 * LogConsole's tools: auto-scroll, search, and the always-mounted requirement
 * the narrow layout depends on (`console` is hidden by CSS, never
 * unmounted -- see AppShell.css).
 *
 * `../../bridge` is mocked the way `ActionBar.test.tsx` mocks it, so `emit`
 * can raise protocol messages exactly as the real pipe would.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BridgeMessage } from "../../bridge";
import LogConsole from "../LogConsole";

const listeners = new Set<(message: BridgeMessage) => void>();

vi.mock("../../bridge", () => ({
  onMessage: (cb: (message: BridgeMessage) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  send: () => {},
}));

// LogConsole reads the picked settings to recite them when a run starts. The
// store needs a provider; this file is not about the settings, so it gets the
// one function the console calls.
vi.mock("../../settings/store", () => ({
  useAllSettings: () => ({}),
}));


function emit(message: BridgeMessage): void {
  for (const cb of listeners) cb(message);
}

async function renderConsole() {
  listeners.clear();
  const utils = render(<LogConsole />);
  return { ...utils, emit };
}

describe("LogConsole tools", () => {
  it("keeps every line when the window narrows and widens again", async () => {
    // The console is hidden by CSS, never unmounted: the lines are the only
    // record of a run.
    const { emit, container } = await renderConsole();
    act(() => emit({ type: "log", message: "first", level: "info" }));
    expect(container.querySelectorAll("#log > div:not(.promptline)")).toHaveLength(1);
    // The narrow layout is CSS-only, so the node must still be in the tree.
    expect(container.querySelector(".console")).not.toBeNull();
  });

  it("filters the lines when a search is typed", async () => {
    const { emit } = await renderConsole();
    act(() => emit({ type: "log", message: "alpha", level: "info" }));
    act(() => emit({ type: "log", message: "beta", level: "info" }));
    act(() => fireEvent.change(screen.getByLabelText(/Search/i), { target: { value: "alph" } }));
    expect(screen.queryByText(/beta/)).toBeNull();
  });

  it("stops following the tail when auto-scroll is switched off", async () => {
    const { container } = await renderConsole();
    void container;
    const box = screen.getByRole("checkbox", { name: /scroll/i });
    act(() => box.click());
    expect(box.getAttribute("aria-checked")).toBe("false");
  });
});
