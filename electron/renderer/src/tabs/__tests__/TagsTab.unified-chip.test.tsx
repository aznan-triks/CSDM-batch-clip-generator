/**
 * TagsTab unified chip (spec Section C): one button per tag carrying its dot,
 * name and × in the same pill; search + sort above the grid.
 *
 * Same harness as TagsTab.test.tsx: the settings store and the bridge are
 * mocked so the component renders without its providers.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TagsTab from "../TagsTab";

const DISCOVERY_FIXTURE = {
  weapons: [],
  maps: [],
  players: [],
  tags: [
    [1, "clip-worthy", "#f97316"],
    [2, "highlight", "#38bdf8"],
    [3, "rage", "#ef4444"],
  ],
};

// Stateful store stand-in, so picking a chip actually flips `aria-pressed`
// (see TagsTab.test.tsx for the reasoning).
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

describe("TagsTab unified chip", () => {
  it("clicking the × opens the ConfirmDialog without toggling the chip", async () => {
    await renderTab();
    calls.length = 0;
    fireEvent.click(screen.getByLabelText("delete-tag-clip-worthy"));
    // The dialog opened...
    expect(screen.getByRole("alertdialog", { name: "Delete tag" })).toBeTruthy();
    // ...and stopPropagation kept the chip from toggling.
    expect(screen.getByRole("button", { name: "tag-clip-worthy" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("cancelling the dialog does not delete; confirming does", async () => {
    await renderTab();
    calls.length = 0;
    fireEvent.click(screen.getByLabelText("delete-tag-clip-worthy"));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(calls.find((c) => c.command === "tag_delete")).toBeUndefined();

    fireEvent.click(screen.getByLabelText("delete-tag-clip-worthy"));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    const call = calls.find((c) => c.command === "tag_delete");
    expect(call?.payload).toEqual({ tag_id: 1 });
  });

  it("clicking the chip body toggles selection", async () => {
    await renderTab();
    const chip = screen.getByRole("button", { name: "tag-clip-worthy" });
    act(() => fireEvent.click(chip));
    expect(lastSet.key).toBe("ui_active_tags");
    expect(Array.isArray(lastSet.value)).toBe(true);
    act(() => fireEvent.click(chip));
    // Second click sends another toggle.
    expect(Array.isArray(lastSet.value)).toBe(true);
  });

  it("filters tags by name, case-insensitively", async () => {
    await renderTab();
    fireEvent.change(screen.getByPlaceholderText("Filter tags…"), { target: { value: "RAGE" } });
    expect(screen.getByRole("button", { name: "tag-rage" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "tag-clip-worthy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "tag-highlight" })).toBeNull();
  });
});
