/**
 * E3 (interface): the engine produces no jump and no grenade-miss event, so
 * neither the Editing badges nor the Event Type "Other" tooltip may promise
 * them. A knife swing is its own event type and gets its own badge.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import { eventTypeMeta } from "../EditingTab";
import CaptureTimingCard from "../captureTiming/CaptureTimingCard";

vi.mock("../../bridge", () => ({
  runCommand: () => Promise.resolve({ type: "result", id: "1", ok: true, data: {} }),
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

describe("Editing badges", () => {
  it("labels a knife swing Swing", () => {
    expect(eventTypeMeta("knife_swing").label).toMatch(/Swing/);
  });

  it("has no Jump or Miss badge -- the engine never produces them", () => {
    expect(eventTypeMeta("jump").label).not.toMatch(/Jump/);
    expect(eventTypeMeta("grenade_miss").label).not.toMatch(/Miss/);
    expect(eventTypeMeta("jump").kind).toBe("other");
  });
});

describe("Event Type Other tooltip", () => {
  it("names shots and knife swings, never jumps", async () => {
    // Every card style reads its tooltips from the one model; the timeline
    // style (the default) is enough to see the one the user hovers.
    render(
      <SettingsProvider>
        <CaptureTimingCard />
      </SettingsProvider>,
    );
    await act(async () => {});
    const tip = screen.getByRole("button", { name: /^Other$/ }).getAttribute("title") ?? "";
    expect(tip).toMatch(/shots/i);
    expect(tip).toMatch(/knife swings/i);
    expect(tip).not.toMatch(/jump/i);
  });
});
