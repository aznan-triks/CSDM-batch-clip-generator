/**
 * Every card of every tab on the card grid gets the grid's drag handle.
 *
 * A remade card that swallows SectionList's props (GridProps, spread on its
 * <Card>) can no longer be moved or collapsed through the grid: that
 * regression hit four remade CAPTURE cards on 2026-09-25. This used to guard
 * CAPTURE alone; VIDEO, TAGS and SETTINGS were remade the same way since.
 */
import { act, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import { DatabaseProvider } from "../../settings/useDatabase";
import CaptureTab from "../CaptureTab";
import SettingsTab from "../SettingsTab";
import TagsTab from "../TagsTab";
import VideoTab from "../VideoTab";

vi.mock("../../bridge", () => ({
  runCommand: (command: string) =>
    Promise.resolve({
      type: "result",
      id: "1",
      ok: true,
      data:
        command === "describe_filters"
          ? { filters: [], match_types: [], weapon_categories: {}, resolutions: [], framerates: [], video_codecs: [], audio_codecs: [], preset_categories: ["full", "date"] }
          : {},
    }),
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

const TABS: [string, ComponentType][] = [
  ["CAPTURE", CaptureTab],
  ["VIDEO", VideoTab],
  ["TAGS", TagsTab],
  ["SETTINGS", SettingsTab],
];

describe.each(TABS)("%s", (_name, Tab) => {
  it("gives every card the grid's drag handle", async () => {
    const { container } = render(
      <SettingsProvider>
        <DatabaseProvider>
          <Tab />
        </DatabaseProvider>
      </SettingsProvider>,
    );
    await act(async () => {});
    const cards = [...container.querySelectorAll("[data-card-id]")];
    expect(cards.length).toBeGreaterThan(0);
    const missing = cards.filter((card) => !card.querySelector(".drag-handle")).map((card) => card.getAttribute("data-card-id"));
    expect(missing).toEqual([]);
  });
});
