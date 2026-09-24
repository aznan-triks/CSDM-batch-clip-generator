/**
 * Kept-alive tabs must not pay for engine chatter (perf fix 2/2, Task 4).
 *
 * Every tab stays mounted (AppShell.keepalive.test.tsx), so if AppShell
 * re-renders on each `progress` tick, all five tabs re-render with it -- a
 * run streams hundreds of those. Each tab is stubbed with a component that
 * counts its own renders; the counts must not move for `progress`, and a tab
 * switch may only touch the two tabs involved.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchEngineMessage, resetEngineState } from "../../motion/engineStore";
import { SettingsProvider } from "../../settings/store";
import AppShell from "../AppShell";

// vi.mock factories are hoisted above the imports they close over, so the
// counters and the stub factory live in vi.hoisted.
const { counts, makeCountingStub } = vi.hoisted(() => {
  const counts: Record<string, number> = {
    capture: 0,
    editing: 0,
    tags: 0,
    video: 0,
    settings: 0,
  };
  function makeCountingStub(name: string) {
    return function CountingTab() {
      counts[name]++;
      return null;
    };
  }
  return { counts, makeCountingStub };
});

vi.mock("../../tabs/CaptureTab", () => ({ default: makeCountingStub("capture") }));
vi.mock("../../tabs/EditingTab", () => ({ EditingTab: makeCountingStub("editing") }));
vi.mock("../../tabs/SettingsTab", () => ({ default: makeCountingStub("settings") }));
vi.mock("../../tabs/TagsTab", () => ({ default: makeCountingStub("tags") }));
vi.mock("../../tabs/VideoTab", () => ({ default: makeCountingStub("video") }));

function renderShell(): ReturnType<typeof render> {
  const tree: ReactElement = (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
  return render(tree);
}

describe("AppShell renders under engine traffic", () => {
  beforeEach(() => {
    // @ts-expect-error -- deliberately absent, as in a plain browser tab.
    delete window.bridge;
    resetEngineState();
    for (const key of Object.keys(counts)) counts[key] = 0;
  });

  it("does not re-render any kept-alive tab on progress ticks", () => {
    renderShell();
    const before = { ...counts };

    act(() => {
      for (let i = 0; i < 1000; i++) dispatchEngineMessage("progress", { text: `t${i}` });
    });

    expect(counts).toEqual(before);
  });

  it("a tab switch leaves the uninvolved tabs alone", () => {
    renderShell();
    const before = { ...counts };

    fireEvent.click(screen.getByRole("tab", { name: /tags/i }));

    expect(counts.editing).toBe(before.editing);
    expect(counts.video).toBe(before.video);
    expect(counts.settings).toBe(before.settings);
  });
});
