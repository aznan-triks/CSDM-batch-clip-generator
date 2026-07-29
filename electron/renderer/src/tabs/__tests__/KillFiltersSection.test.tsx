/**
 * The KILL FILTERS section and the CLUTCH block.
 *
 * Interactions are scoped to one row's own `data-config-key` container rather
 * than queried by the filter's display name: `FilterRow` (tâche 2) always
 * labels its toggle "Enable" -- confirmed by FilterRow.test.tsx's own
 * `/^Enable$/` assertions, which stay green -- so a global name search for
 * "WALLBANG" or "FERRARI PEEK" would never find a button. Scoping to the row
 * keeps the same intent (open THIS row's own conditional behaviour) without
 * depending on a label the shared component does not carry.
 */
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import KillFiltersSection from "../KillFiltersSection";

const FILTERS_FIXTURE = {
  filters: [
    { key: "kill_mod_through_smoke", label: "SMOKE:", tip: "t", category: "mods", hidden: false },
    { key: "kill_mod_no_scope", label: "NO-SCOPE:", tip: "t", category: "mods", hidden: false },
    { key: "kill_mod_assisted_flash", label: "VICTIM FLASHED:", tip: "t", category: "mods", hidden: false },
    { key: "kill_mod_wall_bang", label: "WALLBANG:", tip: "t", category: "mods", hidden: false },
    { key: "kill_mod_attacker_blind", label: "BLIND FIRE:", tip: "t", category: "mods", hidden: false },
    { key: "kill_mod_airborne", label: "AIRBORNE:", tip: "t", category: "dp2", hidden: false },
    { key: "kill_mod_collateral", label: "COLLATERAL:", tip: "t", category: "dp2", hidden: false },
    { key: "kill_mod_trois_shot", label: "TROIS SHOT:", tip: "t", category: "dp2", hidden: false },
    { key: "kill_mod_no_trois_shot", label: "EXCLUDE:", tip: "t", category: "dp2", hidden: true },
    { key: "kill_mod_trois_tap", label: "TROIS TAP:", tip: "t", category: "dp2", hidden: false },
    { key: "kill_mod_one_tap", label: "ONE TAP:", tip: "t", category: "dp2", hidden: false },
    { key: "kill_mod_spray_transfer", label: "SPRAY TRANSFER:", tip: "t", category: "dp2", hidden: false },
    { key: "kill_mod_high_velocity", label: "FERRARI PEEK:", tip: "t", category: "dp2", hidden: false },
    { key: "kill_mod_flick", label: "FLICK:", tip: "t", category: "dp2", hidden: false },
    { key: "kill_mod_savior", label: "SAVIOR:", tip: "t", category: "dp2", hidden: false },
    { key: "kill_mod_entry_frag", label: "ENTRY FRAG:", tip: "t", category: "db", hidden: false },
    { key: "kill_mod_ace", label: "ACE:", tip: "t", category: "db", hidden: false },
    { key: "kill_mod_multi_kill", label: "MULTI-KILL:", tip: "t", category: "db", hidden: false },
    { key: "kill_mod_bully", label: "BULLY:", tip: "t", category: "db", hidden: false },
    { key: "kill_mod_eco_frag", label: "ECO FRAG:", tip: "t", category: "db", hidden: false },
    { key: "kill_mod_mate_pov", label: "MATE POV:", tip: "t", category: "dp2", hidden: true },
  ],
  match_types: [],
  weapon_categories: {},
  resolutions: [],
  framerates: [],
  video_codecs: [],
  audio_codecs: [],
};

vi.mock("../../bridge", () => ({
  runCommand: () =>
    Promise.resolve({ type: "result", id: "1", ok: true, data: FILTERS_FIXTURE }),
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

async function renderTab() {
  const rendered = render(
    <SettingsProvider>
      <KillFiltersSection />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

/** The row's own wrapper, found by its Enable box -- the one box every row has. */
function rowFor(container: HTMLElement, key: string): HTMLElement {
  const enableBox = container.querySelector(`[data-config-key="${key}"]`);
  if (!enableBox) throw new Error(`no row for ${key}`);
  return enableBox.closest(".filter-row") as HTMLElement;
}

function clickEnable(container: HTMLElement, key: string) {
  const row = rowFor(container, key);
  act(() => {
    within(row).getByRole("button", { name: /^Enable$/ }).click();
  });
}

describe("KillFiltersSection", () => {
  it("builds one row per visible registry entry", async () => {
    const { container } = await renderTab();
    const visible = FILTERS_FIXTURE.filters.filter((f) => !f.hidden);
    for (const def of visible) {
      expect(container.querySelector(`[data-config-key="${def.key}"]`)).not.toBeNull();
    }
  });

  it("never builds a row for a hidden registry entry", async () => {
    const { container } = await renderTab();
    for (const key of ["kill_mod_no_trois_shot", "kill_mod_mate_pov"]) {
      expect(container.querySelector(`[data-config-key="${key}"]`)).toBeNull();
    }
  });

  it("hides the FERRARI PEEK sub-panel until the filter is enabled", async () => {
    const { container } = await renderTab();
    expect(container.querySelector('[data-config-key="kill_mod_high_vel_thr"]')).toBeNull();
    clickEnable(container, "kill_mod_high_velocity");
    expect(container.querySelector('[data-config-key="kill_mod_high_vel_thr"]')).not.toBeNull();
  });

  it("hides the clutch options until clutch is enabled", async () => {
    const { container } = await renderTab();
    expect(container.querySelector('[data-config-key="clutch_mode"]')).toBeNull();
    act(() => screen.getByRole("button", { name: /CLUTCH/i }).click());
    expect(container.querySelector('[data-config-key="clutch_mode"]')).not.toBeNull();
  });

  it("disables the headshot choice while ONE TAP is active", async () => {
    // The window greys the headshot radios out: a one-tap kill is already a
    // headshot constraint, and combining them silently matches nothing.
    const { container } = await renderTab();
    clickEnable(container, "kill_mod_one_tap");
    const headshotRow = container.querySelector('[data-config-key="headshots_mode"]') as HTMLElement;
    for (const radio of within(headshotRow).getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("clears every modifier and every Must when Clear is pressed", async () => {
    const { container } = await renderTab();
    clickEnable(container, "kill_mod_wall_bang");
    act(() => screen.getByRole("button", { name: /^Clear$/ }).click());
    const enable = within(rowFor(container, "kill_mod_wall_bang")).getByRole("button", {
      name: /^Enable$/,
    });
    expect(enable.getAttribute("aria-pressed")).toBe("false");
  });
});
