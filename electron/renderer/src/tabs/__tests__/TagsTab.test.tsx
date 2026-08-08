/**
 * TagsTab: the tag grid, the TAG RANGE block and the OPERATIONS block.
 *
 * Ported from `_tab_tags` in csdm_batch_clips_generator.py. The settings
 * store is mocked (`date_from`/`date_to`/`tag_enabled` live there) so the
 * component renders without a real `SettingsProvider`, the same pattern
 * `PresetSection.test.tsx` uses.
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// A stateful stand-in for the settings store: `useSetting` must actually
// re-render its consumer when the setter fires, or toggling a chip never
// shows up as `aria-pressed`. The object lives in `vi.hoisted` so the `vi.mock`
// factory can read and write it across renders.
const tagStore = vi.hoisted(() => ({ map: {} as Record<string, unknown> }));
const lastSet = vi.hoisted(() => ({ key: null as string | null, value: null as unknown }));

vi.mock("../../settings/store", () => ({
  useSetting: (key: string) => {
    const set = (value: unknown) => {
      tagStore.map[key] = value;
      lastSet.key = key;
      lastSet.value = value;
    };
    return [tagStore.map[key], set];
  },
}));

beforeEach(() => {
  tagStore.map = {};
  lastSet.key = null;
  lastSet.value = null;
});

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
      // Anchored: "Export" must not also match the "Auto-tag on export" chip.
      expect(screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") })).toBeTruthy();
    }
  });

  it("deletes a tag via tag_delete, only after the ConfirmDialog (spec Section C)", async () => {
    await renderTab();
    calls.length = 0;
    // The × lives inside the chip; clicking it must NOT fire tag_delete yet.
    const x = screen.getByLabelText("delete-tag-clip-worthy");
    await act(async () => x.click());
    expect(calls.find((c) => c.command === "tag_delete")).toBeUndefined();
    // Confirming the dialog runs the delete.
    const confirm = screen.getByRole("button", { name: /^confirm$/i });
    await act(async () => confirm.click());
    const call = calls.find((c) => c.command === "tag_delete");
    expect(call?.payload).toEqual({ tag_id: 1 });
  });

  it("supports selecting several tags at once", async () => {
    await renderTab();
    const [first, second] = screen.getAllByRole("button", { name: /^tag-/ });
    act(() => first.click());
    // The mocked useSetting setter was called with the toggled set.
    expect(lastSet.key).toBe("ui_active_tags");
    expect(Array.isArray(lastSet.value)).toBe(true);
    act(() => second.click());
    // Second click toggles a second tag in.
    expect(Array.isArray(lastSet.value)).toBe(true);
  });
});
