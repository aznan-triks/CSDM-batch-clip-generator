/**
 * Keep-alive tabs (workspace-vivant §B.1, AUDIT_tabs-state.md #2): every tab
 * stays MOUNTED and the inactive ones are hidden, not unmounted, so local
 * state survives a switch. Each tab is stubbed with a stateful component that
 * counts clicks, proving the instance (and its state) is the SAME one after a
 * switch -- an unmount/remount would reset the counter to zero.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import AppShell from "../AppShell";

// vi.mock factories are hoisted above the imports they close over, so the
// stub factory must live in vi.hoisted (referenced only at render time, never
// called during hoisting).
const { makeTabStub } = vi.hoisted(() => {
  function makeTabStub(name: string) {
    return function TabStub() {
      const [count, setCount] = useState(0);
      return (
        <div data-tabname={name}>
          <span>{`${name}-state-${count}`}</span>
          <button onClick={() => setCount((c) => c + 1)}>{`inc-${name}`}</button>
        </div>
      );
    };
  }
  return { makeTabStub };
});

vi.mock("../../tabs/CaptureTab", () => ({ default: makeTabStub("capture") }));
vi.mock("../../tabs/EditingTab", () => ({ EditingTab: makeTabStub("editing") }));
vi.mock("../../tabs/SettingsTab", () => ({ default: makeTabStub("settings") }));
vi.mock("../../tabs/TagsTab", () => ({ default: makeTabStub("tags") }));
vi.mock("../../tabs/VideoTab", () => ({ default: makeTabStub("video") }));

function renderShell(): ReturnType<typeof render> {
  const tree: ReactElement = (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
  return render(tree);
}

function panel(name: string): HTMLElement {
  const el = document.querySelector(`[data-tabname="${name}"]`);
  if (!el) throw new Error(`no ${name} panel mounted`);
  return el as HTMLElement;
}

describe("AppShell keep-alive tabs", () => {
  beforeEach(() => {
    // @ts-expect-error -- deliberately absent, as in a plain browser tab.
    delete window.bridge;
  });

  it("mounts every tab up front, not only the active one", () => {
    renderShell();
    expect(panel("capture")).toBeTruthy();
    expect(panel("editing")).toBeTruthy();
    expect(panel("tags")).toBeTruthy();
    expect(panel("video")).toBeTruthy();
    expect(panel("settings")).toBeTruthy();
  });

  it("hides the previous tab's panel (hidden + inert) instead of unmounting it", () => {
    renderShell();
    fireEvent.click(screen.getByRole("tab", { name: /tags/i }));

    const captureWrap = panel("capture").parentElement as HTMLElement;
    const tagsWrap = panel("tags").parentElement as HTMLElement;
    expect(captureWrap.hasAttribute("hidden")).toBe(true);
    expect(captureWrap.hasAttribute("inert")).toBe(true);
    expect(tagsWrap.hasAttribute("hidden")).toBe(false);
    // Still in the DOM -- just hidden.
    expect(panel("capture")).toBeTruthy();
  });

  it("keeps the tabpanel role on the visible panel only", () => {
    renderShell();
    const captureWrap = panel("capture").parentElement as HTMLElement;
    expect(captureWrap.getAttribute("role")).toBe("tabpanel");

    fireEvent.click(screen.getByRole("tab", { name: /tags/i }));
    const tagsWrap = panel("tags").parentElement as HTMLElement;
    expect(tagsWrap.getAttribute("role")).toBe("tabpanel");
    expect(captureWrap.getAttribute("role")).toBeNull();
  });

  it("preserves a tab's local state across a switch and back (not remounted)", () => {
    renderShell();

    // Capture is active: bump its internal counter.
    fireEvent.click(screen.getByRole("button", { name: "inc-capture" }));
    expect(screen.getByText("capture-state-1")).toBeTruthy();

    // Leave and come back.
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /tags/i }));
      fireEvent.click(screen.getByRole("tab", { name: /capture/i }));
    });

    // The same instance survived: counter is still 1, not reset to 0.
    expect(screen.getByText("capture-state-1")).toBeTruthy();
  });
});
