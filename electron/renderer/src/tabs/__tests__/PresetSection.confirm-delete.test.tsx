/**
 * PresetSection delete now asks before running `delete_preset` (spec
 * Section C) -- the preset list's Delete used to destroy a preset on the
 * first click, no confirmation.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PresetSection from "../PresetSection";

const TABLES_FIXTURE = {
  filters: [],
  match_types: [],
  weapon_categories: {},
  resolutions: [],
  framerates: [],
  video_codecs: [],
  audio_codecs: [],
  preset_categories: ["full", "date", "players"],
};

vi.mock("../../settings/store", () => ({
  useAllSettings: () => ({ date_from: "", date_to: "", steam_id: "999" }),
  useSettingsBatch: () => () => {},
}));

const calls: Array<{ command: string; payload: unknown }> = [];

vi.mock("../../bridge", () => ({
  runCommand: (command: string, payload: Record<string, unknown> = {}) => {
    calls.push({ command, payload });
    if (command === "describe_filters") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: TABLES_FIXTURE });
    }
    if (command === "list_presets") {
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: { date: { cats: ["date"], data: {} } },
      });
    }
    return Promise.resolve({ type: "result", id: "1", ok: true, data: {} });
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

async function renderSection() {
  const rendered = render(<PresetSection />);
  await act(async () => {});
  return rendered;
}

function deleteButton(presetName = "date") {
  const row = screen.getByText(presetName, { selector: ".preset-row-name" }).closest("li");
  if (!row) throw new Error(`no preset row found for "${presetName}"`);
  return within(row).getByRole("button", { name: /^Delete$/i });
}

describe("PresetSection confirm-before-delete", () => {
  it("opens a ConfirmDialog instead of deleting on first click", async () => {
    await renderSection();
    calls.length = 0;
    fireEvent.click(deleteButton("date"));
    expect(calls.find((c) => c.command === "delete_preset")).toBeUndefined();
    expect(screen.getByRole("alertdialog", { name: "Delete preset" })).toBeTruthy();
  });

  it("cancelling the dialog leaves the preset untouched", async () => {
    await renderSection();
    calls.length = 0;
    fireEvent.click(deleteButton("date"));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(calls.find((c) => c.command === "delete_preset")).toBeUndefined();
    // The preset row is still there.
    expect(screen.getByText("date", { selector: ".preset-row-name" })).toBeTruthy();
  });

  it("confirming the dialog runs delete_preset for the named preset", async () => {
    await renderSection();
    calls.length = 0;
    fireEvent.click(deleteButton("date"));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    const call = calls.find((c) => c.command === "delete_preset");
    expect(call?.payload).toEqual({ preset: "date" });
  });
});
