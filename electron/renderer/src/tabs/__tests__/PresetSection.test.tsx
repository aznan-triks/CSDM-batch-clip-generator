/**
 * PresetSection: the name field, one checkbox per category the Python side
 * sends as `describe_filters`'s `preset_categories` ("full" plus the
 * tab-grouped categories -- not the two backward-compat aliases `PRESET_KEYS`
 * also carries), SAVE, and the preset list's Load/Delete actions.
 *
 * The settings store is mocked directly rather than wrapped in a real
 * `SettingsProvider`: this lets `loadPresetAndCaptureWrites` see exactly the
 * keys `setMany` was called with, without decoding a debounced `save_config`
 * round trip.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { dispatchEngineMessage, editClip, getEngineState, resetEngineState } from "../../motion/engineStore";
import PresetSection, { toggleCategory } from "../PresetSection";

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
  // The card reads its style (none stored: the default timeline).
  useSetting: () => [undefined, () => {}],
}));

vi.mock("../../bridge", () => ({
  runCommand: (command: string, payload: Record<string, unknown> = {}) => {
    if (command === "describe_filters") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: TABLES_FIXTURE });
    }
    if (command === "list_presets") {
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: {
          date: { cats: ["date"], data: { date_from: "", date_to: "" } },
          everything: { cats: ["full"], data: { date_from: "", date_to: "", steam_id: "" } },
          reel: { cats: ["full"], data: {} },
        },
      });
    }
    if (command === "load_preset" && payload.preset === "reel") {
      // Saved from EDITING: the engine hands back the clips of its selection
      // the current preview still lists, with their edits.
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: {},
        keys: null,
        selected_clips: [{ demo_path: "d1", start_tick: 3000, after_s: 4, excluded_events: ["3200:kill:a"] }],
      });
    }
    if (command === "load_preset" && payload.preset === "everything") {
      // A "full" preset: `keys` comes back null, meaning "overwrite the
      // entire configuration", not just the keys `data` happens to list.
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: { date_from: "01-01-2024", date_to: "02-02-2024", steam_id: "999" },
        keys: null,
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

async function loadPresetAndCaptureWrites(presetName = "date") {
  writes.length = 0;
  await renderSection();
  const row = screen.getByText(presetName, { selector: ".preset-row-name" }).closest("li");
  if (!row) throw new Error(`no preset row found for "${presetName}"`);
  act(() => {
    within(row).getByRole("button", { name: /^Load$/i }).click();
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
    const written = await loadPresetAndCaptureWrites("date");
    expect(Object.keys(written)).toEqual(["date_from", "date_to"]);
  });

  it("writes the entire configuration for a full-config preset (keys === null)", async () => {
    // A "full" preset comes back with `keys: null`, meaning "this preset may
    // overwrite everything" -- the one dangerous-by-design branch. Anything
    // that turned this into a subset write would silently narrow a full
    // config restore into a partial one.
    const written = await loadPresetAndCaptureWrites("everything");
    expect(Object.keys(written).sort()).toEqual(["date_from", "date_to", "steam_id"]);
    expect(written).toEqual({ date_from: "01-01-2024", date_to: "02-02-2024", steam_id: "999" });
  });

  it("restores the EDITING selection and edits a preset holds", async () => {
    resetEngineState();
    dispatchEngineMessage("preview_ready", {
      cfg: { tickrate: 64 },
      sequences: {
        d1: [
          { start_tick: 1000, end_tick: 2000, events: [{ type: "kill", tick: 1200 }] },
          { start_tick: 3000, end_tick: 4000, events: [{ type: "kill", tick: 3200 }], event_keys: ["3200:kill:a"] },
        ],
      },
    });
    editClip(0, { beforeS: 9 }); // an edit the preset does not hold: it goes
    await loadPresetAndCaptureWrites("reel");
    const [first, second] = getEngineState().previewClips;
    expect(first.selected).toBe(false);
    expect(first.edit).toBeUndefined();
    expect(second.selected).toBe(true);
    expect(second.edit).toEqual({ afterS: 4, excluded: ["3200:kill:a"] });
    resetEngineState();
  });

  it("leaves the EDITING selection alone when the preset gives none back", async () => {
    resetEngineState();
    dispatchEngineMessage("preview_ready", {
      cfg: { tickrate: 64 },
      sequences: { d1: [{ start_tick: 1000, end_tick: 2000, events: [{ type: "kill", tick: 1200 }] }] },
    });
    editClip(0, { beforeS: 9 });
    const before = getEngineState().previewClips;
    await loadPresetAndCaptureWrites("date");
    expect(getEngineState().previewClips).toBe(before);
    resetEngineState();
  });

  it("keeps Full config and the partial categories mutually exclusive (M9 / M10)", async () => {
    const { container } = await renderSection();
    const chip = (action: string, label: string) =>
      [...container.querySelectorAll<HTMLElement>(`[data-action="${action}"]`)].find((el) => el.textContent === label)!;
    const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed") === "true";
    act(() => chip("M9", "Date").click());
    act(() => chip("M9", "Players").click());
    act(() => chip("M10", "Full config").click());
    expect(pressed(chip("M10", "Full config"))).toBe(true);
    expect(pressed(chip("M9", "Date")) || pressed(chip("M9", "Players"))).toBe(false);
    act(() => chip("M9", "Date").click());
    expect(pressed(chip("M9", "Date"))).toBe(true);
    expect(pressed(chip("M10", "Full config"))).toBe(false);
  });
});

describe("toggleCategory", () => {
  it("unticks a ticked category without touching the others", () => {
    expect([...toggleCategory(new Set(["date", "players"]), "date")]).toEqual(["players"]);
    expect([...toggleCategory(new Set(["full"]), "full")]).toEqual([]);
  });
});
