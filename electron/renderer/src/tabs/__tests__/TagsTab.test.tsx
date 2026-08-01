/**
 * TagsTab: the tag grid, the TAG RANGE block and the OPERATIONS block.
 *
 * Ported from `_tab_tags` in csdm_batch_clips_generator.py. The settings
 * store is mocked (`date_from`/`date_to`/`tag_enabled` live there) so the
 * component renders without a real `SettingsProvider`, the same pattern
 * `PresetSection.test.tsx` uses.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TagsTab from "../TagsTab";

const DISCOVERY_FIXTURE = {
  weapons: [],
  maps: [],
  players: [],
  tags: [
    [1, "clip-worthy", "#f97316"],
    [2, "highlight", "#38bdf8"],
  ],
};

vi.mock("../../settings/store", () => ({
  useSetting: (key: string) => {
    const values: Record<string, unknown> = { tag_enabled: false, date_from: "", date_to: "" };
    return [values[key], () => {}];
  },
}));

const calls: Array<{ command: string; payload: unknown }> = [];

vi.mock("../../bridge", () => ({
  runCommand: (command: string, payload?: unknown) => {
    calls.push({ command, payload });
    if (command === "connect_db") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: DISCOVERY_FIXTURE });
    }
    return Promise.resolve({ type: "result", id: "1", ok: true, data: {} });
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
  pickPath: () => Promise.resolve(null),
  pickSavePath: () => Promise.resolve(null),
}));

async function renderTab() {
  const rendered = render(<TagsTab />);
  await act(async () => {});
  return rendered;
}

describe("TagsTab", () => {
  it("offers the three tag buttons the window had", async () => {
    await renderTab();
    for (const label of ["New tag", "Reload", "Deselect all"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeTruthy();
    }
  });

  it("offers the four range application buttons", async () => {
    await renderTab();
    for (const label of ["Apply start", "Apply end", "Apply full range", "After range"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeTruthy();
    }
  });

  it("offers every operation the window had", async () => {
    await renderTab();
    for (const label of ["By tag", "By config", "Tag sel.", "Tag ALL",
                         "Remove sel.", "Export", "Import"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeTruthy();
    }
  });

  it("deletes a tag via tag_delete (P4: this button used to not exist)", async () => {
    await renderTab();
    calls.length = 0;
    const button = screen.getByRole("button", { name: /delete-tag-clip-worthy/i });
    await act(async () => button.click());
    const call = calls.find((c) => c.command === "tag_delete");
    expect(call?.payload).toEqual({ tag_id: 1 });
  });

  it("supports selecting several tags at once", async () => {
    await renderTab();
    const [first, second] = screen.getAllByRole("button", { name: /^tag-/ });
    act(() => first.click());
    act(() => second.click());
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(second.getAttribute("aria-pressed")).toBe("true");
  });
});
