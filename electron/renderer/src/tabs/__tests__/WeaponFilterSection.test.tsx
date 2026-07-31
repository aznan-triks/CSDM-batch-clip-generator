/**
 * The WEAPON FILTER section.
 *
 * `connectDbBehavior` switches what the mocked `connect_db` does between
 * tests: `renderTab()` leaves it pending forever (the "still waiting" state
 * every window opens in before a connection exists), `renderTabConnected()`
 * resolves it with a fixed weapons/maps payload (the state once `connect_db`
 * has answered).
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import WeaponFilterSection from "../WeaponFilterSection";

const FILTERS_FIXTURE = {
  filters: [],
  match_types: [],
  weapon_categories: {
    Pistols: ["Glock-18", "USP-S", "Desert Eagle"],
    SMGs: ["MP9", "MAC-10"],
    Rifles: ["AK-47", "M4A4"],
    Snipers: ["AWP", "SSG 08"],
  },
  resolutions: [],
  framerates: [],
  video_codecs: [],
  audio_codecs: [],
};

const DB_FIXTURE = {
  // Desert Eagle and MAC-10 are in the category table but NOT in this
  // database: they must not appear in the grid.
  weapons: ["Glock-18", "USP-S", "MP9", "AK-47", "M4A4", "AWP", "SSG 08"],
  maps: [
    ["ancient", ["de_ancient"]],
    ["mirage", ["de_mirage"]],
  ],
};

let connectDbBehavior: "pending" | "resolved" = "pending";

vi.mock("../../bridge", () => ({
  runCommand: (name: string) => {
    if (name === "describe_filters") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: FILTERS_FIXTURE });
    }
    if (name === "connect_db") {
      if (connectDbBehavior === "resolved") {
        return Promise.resolve({ type: "result", id: "2", ok: true, data: DB_FIXTURE });
      }
      return new Promise(() => {});
    }
    return Promise.reject(new Error(`unexpected command: ${name}`));
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

async function renderTab() {
  connectDbBehavior = "pending";
  const rendered = render(
    <SettingsProvider>
      <WeaponFilterSection />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

async function renderTabConnected() {
  connectDbBehavior = "resolved";
  const rendered = render(
    <SettingsProvider>
      <WeaponFilterSection />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

describe("WeaponFilterSection", () => {
  it("says it is waiting before the database answers", async () => {
    await renderTab();
    expect(screen.getByText(/Waiting for DB/i)).toBeTruthy();
  });

  it("groups the weapons the way the category table does", async () => {
    await renderTabConnected();
    for (const category of ["Pistols", "SMGs", "Rifles", "Snipers"]) {
      expect(screen.getByText(category)).toBeTruthy();
    }
  });

  it("only shows weapons actually present in the connected database", async () => {
    const { container } = await renderTabConnected();
    expect(screen.queryByText("Desert Eagle")).toBeNull();
    expect(screen.queryByText("MAC-10")).toBeNull();
    expect(container.querySelectorAll(".chips [aria-pressed]").length).toBe(
      DB_FIXTURE.weapons.length,
    );
  });

  it("selects and deselects every weapon at once", async () => {
    // Exact-string names on purpose: "Deselect all" contains "Select all" as
    // a substring, so a non-anchored /Select all/i regex would match both
    // buttons and getByRole would throw on ambiguity.
    const { container } = await renderTabConnected();
    act(() => screen.getByRole("button", { name: "Select all" }).click());
    const chips = [...container.querySelectorAll(".chips [aria-pressed]")];
    expect(chips.every((c) => c.getAttribute("aria-pressed") === "true")).toBe(true);

    act(() => screen.getByRole("button", { name: "Deselect all" }).click());
    expect(chips.every((c) => c.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("treats an empty selection as every weapon", async () => {
    // "WEAPON FILTER (empty = all)" -- the window's own title. An empty list
    // must not mean "no weapon at all", which would match nothing.
    await renderTabConnected();
    expect(screen.getByText(/empty = all/i)).toBeTruthy();
  });
});
