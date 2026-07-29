/**
 * PresetSection: the name field, one checkbox per `PRESET_KEYS` category
 * (`describe_filters`'s `preset_categories`), SAVE, and the preset list's
 * Load/Delete actions.
 *
 * The settings store is mocked directly rather than wrapped in a real
 * `SettingsProvider`: this lets `loadPresetAndCaptureWrites` see exactly the
 * keys `setMany` was called with, without decoding a debounced `save_config`
 * round trip.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
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

const writes: Record<string, unknown>[] = [];

vi.mock("../../settings/store", () => ({
  useAllSettings: () => ({ date_from: "", date_to: "", steam_id: "999" }),
  useSettingsBatch: () => (changes: Record<string, unknown>) => {
    writes.push(changes);
  },
}));

vi.mock("../../bridge", () => ({
  runCommand: (command: string) => {
    if (command === "describe_filters") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: TABLES_FIXTURE });
    }
    if (command === "list_presets") {
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: { date: { cats: ["date"], data: { date_from: "", date_to: "" } } },
      });
    }
    if (command === "load_preset") {
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: { date_from: "01-01-2024", date_to: "02-02-2024", steam_id: "999" },
        keys: ["date_from", "date_to"],
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

async function loadPresetAndCaptureWrites() {
  writes.length = 0;
  await renderSection();
  act(() => {
    screen.getByRole("button", { name: /^Load$/i }).click();
  });
  await act(async () => {});
  return writes[0] ?? {};
}

describe("PresetSection", () => {
  it("refuses to save a preset with no name", async () => {
    await renderSection();
    act(() => screen.getByRole("button", { name: /^SAVE$/ }).click());
    expect(screen.getByText(/needs a name/i)).toBeTruthy();
  });

  it("refuses to save a preset with no category", async () => {
    await renderSection();
    act(() => fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "x" } }));
    act(() => screen.getByRole("button", { name: /^SAVE$/ }).click());
    expect(screen.getByText(/at least one category/i)).toBeTruthy();
  });

  it("writes only the keys the preset owns", async () => {
    // `load_preset` returns the keys it may overwrite. Writing `data` wholesale
    // would let a "date" preset replace the entire configuration.
    const written = await loadPresetAndCaptureWrites();
    expect(Object.keys(written)).toEqual(["date_from", "date_to"]);
  });
});
