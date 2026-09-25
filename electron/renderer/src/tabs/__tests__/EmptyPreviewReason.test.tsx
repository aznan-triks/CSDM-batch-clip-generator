/**
 * An empty preview is never silent (audit finalisation 2026-09-25, axis A).
 *
 * The engine ships `empty_reason` on `preview_ready` when nothing survived;
 * the EDITING tab shows it instead of "run a PREVIEW first", and DEMO
 * SELECTION lights the shortcut whose range is on screen, so a 6-month range
 * can no longer pass for "the last 30 days".
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchEngineMessage, getEngineState, resetEngineState } from "../../motion/engineStore";
import { SettingsProvider } from "../../settings/store";
import DemoSelectionSection from "../DemoSelectionSection";
import { EditingTab } from "../EditingTab";

vi.mock("../../bridge", () => ({
  runCommand: () => Promise.reject(new Error("no engine in this test")),
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

const REASON = {
  headline: "No clips: Weapon Filter removed the last 324 events.",
  hint: "Loosen Weapon Filter to get clips.",
  stages: [
    { label: "events for this player and event types (any date, no filter)", count: 10638 },
    { label: "date range 29-03-2026 → 25-09-2026 (Demo Selection)", count: 353 },
    { label: "Weapon Filter", count: 0 },
  ],
};

describe("empty preview reason", () => {
  beforeEach(() => resetEngineState());

  it("keeps the engine's reason when a preview finds nothing", () => {
    dispatchEngineMessage("preview_ready", { sequences: {}, cfg: {}, empty_reason: REASON });
    expect(getEngineState().previewEmptyReason).toEqual(REASON);
  });

  it("drops the reason once a preview finds clips", () => {
    dispatchEngineMessage("preview_ready", { sequences: {}, cfg: {}, empty_reason: REASON });
    dispatchEngineMessage("preview_ready", {
      sequences: { "d.dem": [{ start_tick: 0, end_tick: 64, events: [{}] }] },
      cfg: { tickrate: 64 },
      empty_reason: null,
    });
    expect(getEngineState().previewEmptyReason).toBeNull();
  });

  it("shows why on the EDITING tab, with each step's count", () => {
    render(<EditingTab />);
    act(() => dispatchEngineMessage("preview_ready", { sequences: {}, cfg: {}, empty_reason: REASON }));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(REASON.headline);
    expect(status.textContent).toContain("10,638");
    expect(status.textContent).toContain("Loosen Weapon Filter");
    expect(screen.queryByText(/Run a PREVIEW first/)).toBeNull();
  });

  it("still asks for a PREVIEW before any has run", () => {
    render(<EditingTab />);
    expect(screen.getByText(/Run a PREVIEW first/)).toBeTruthy();
  });
});

describe("active date range", () => {
  async function renderSection() {
    render(
      <SettingsProvider>
        <DemoSelectionSection />
      </SettingsProvider>,
    );
    await act(async () => {});
  }

  const pressed = (name: string) =>
    screen.getByRole("button", { name: new RegExp(`^${name}$`) }).getAttribute("aria-pressed");

  it("lights the shortcut whose range is on screen, and only that one", async () => {
    await renderSection();
    act(() => screen.getByRole("button", { name: /^6m$/ }).click());
    expect(pressed("6m")).toBe("true");
    expect(pressed("30d")).toBe("false");
    act(() => screen.getByRole("button", { name: /^30d$/ }).click());
    expect(pressed("30d")).toBe("true");
    expect(pressed("6m")).toBe("false");
  });

  it("follows the range through Today and All", async () => {
    await renderSection();
    act(() => screen.getByRole("button", { name: /^30d$/ }).click());
    act(() => screen.getByRole("button", { name: /^Today$/ }).click());
    expect(pressed("30d")).toBe("true"); // Today keeps the 30-day end date
    act(() => screen.getByRole("button", { name: /^All$/ }).click());
    expect(pressed("All")).toBe("true");
    expect(pressed("30d")).toBe("false");
  });
});
