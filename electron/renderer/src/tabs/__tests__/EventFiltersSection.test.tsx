/**
 * C5bis: the Damage Filters and Shot Filters cards.
 *
 * Both cards are built from `describe_filters` alone -- the registry decides
 * which rows exist, in which card (`applies_to`), and which numeric settings
 * they carry (`extras`). Every row goes through `FilterRow`, so each key has
 * its `data-config-key` box. The Kill Filters card shows only the filters that
 * judge kills, and names the other events a filter also judges.
 */
import type { ReactElement } from "react";
import { act, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import EventFiltersSection from "../EventFiltersSection";
import KillFiltersSection from "../KillFiltersSection";

const FIXTURE = {
  filters: [
    { key: "kill_mod_wall_bang", label: "WALLBANG:", tip: "t", category: "mods", hidden: false,
      applies_to: ["kill"], extras: [] },
    { key: "kill_mod_airborne", label: "AIRBORNE:", tip: "t", category: "dp2", hidden: false,
      applies_to: ["kill", "shot"], extras: [] },
    { key: "dmg_mod_headshot_hit", label: "HEADSHOT HIT:", tip: "t", category: "event",
      hidden: false, applies_to: ["damage"], extras: [] },
    { key: "dmg_mod_big_hit", label: "BIG HIT:", tip: "t", category: "event", hidden: false,
      applies_to: ["damage"],
      extras: [{ key: "dmg_mod_big_hit_min", label: "Min damage", unit: "HP", default: 90 }] },
    { key: "shot_mod_knife_swing", label: "KNIFE SWING:", tip: "t", category: "event",
      hidden: false, applies_to: ["shot"], extras: [] },
    { key: "shot_mod_long_spray", label: "LONG SPRAY:", tip: "t", category: "event",
      hidden: false, applies_to: ["shot"],
      extras: [{ key: "shot_mod_long_spray_min", label: "Min bullets", unit: "", default: 10 }] },
  ],
  match_types: [],
  weapon_categories: {},
  weapon_category_tips: {},
  resolutions: [],
  framerates: [],
  video_codecs: [],
  audio_codecs: [],
  preset_categories: [],
};

vi.mock("../../bridge", () => ({
  runCommand: () => Promise.resolve({ type: "result", id: "1", ok: true, data: FIXTURE }),
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

async function renderCard(node: ReactElement) {
  const rendered = render(<SettingsProvider>{node}</SettingsProvider>);
  await act(async () => {});
  return rendered;
}

function keysOf(category: string) {
  return FIXTURE.filters.filter((f) => f.category === "event" && f.applies_to.includes(category));
}

describe.each([
  ["damage", "shot"],
  ["shot", "damage"],
] as const)("EventFiltersSection (%s)", (category, other) => {
  it("builds one FilterRow per registry entry of its category, with every key", async () => {
    const { container } = await renderCard(<EventFiltersSection category={category} />);
    const rows = container.querySelectorAll(".filter-row");
    expect(rows.length).toBe(keysOf(category).length);
    for (const def of keysOf(category)) {
      for (const k of [def.key, `${def.key}_req`, `${def.key}_exclude`]) {
        expect(container.querySelector(`[data-config-key="${k}"]`), k).not.toBeNull();
      }
      for (const x of def.extras) {
        expect(container.querySelector(`[data-config-key="${x.key}"]`), x.key).not.toBeNull();
      }
    }
  });

  it("never shows another category's filter or a kill filter", async () => {
    const { container } = await renderCard(<EventFiltersSection category={category} />);
    for (const def of [...keysOf(other), FIXTURE.filters[0], FIXTURE.filters[1]]) {
      expect(container.querySelector(`[data-config-key="${def.key}"]`), def.key).toBeNull();
    }
  });
});

describe("EventFiltersSection settings", () => {
  it("shows a setting's registry default in its field", async () => {
    const { container } = await renderCard(<EventFiltersSection category="damage" />);
    const box = container.querySelector('[data-config-key="dmg_mod_big_hit_min"]') as HTMLElement;
    expect((within(box).getByRole("textbox") as HTMLInputElement).value).toBe("90");
  });
});

describe("KillFiltersSection with event filters in the registry", () => {
  it("keeps damage and shot filters out of the Kill Filters card", async () => {
    const { container } = await renderCard(<KillFiltersSection />);
    expect(container.querySelector('[data-config-key="kill_mod_wall_bang"]')).not.toBeNull();
    for (const key of ["dmg_mod_headshot_hit", "shot_mod_knife_swing"]) {
      expect(container.querySelector(`[data-config-key="${key}"]`), key).toBeNull();
    }
  });

  it("marks a kill filter that also judges shots, from applies_to", async () => {
    const { container } = await renderCard(<KillFiltersSection />);
    const airborne = container
      .querySelector('[data-config-key="kill_mod_airborne"]')!
      .closest(".filter-row") as HTMLElement;
    expect(within(airborne).getByText("also shots")).toBeTruthy();
    const wallbang = container
      .querySelector('[data-config-key="kill_mod_wall_bang"]')!
      .closest(".filter-row") as HTMLElement;
    expect(within(wallbang).queryByText(/^also /)).toBeNull();
  });
});
