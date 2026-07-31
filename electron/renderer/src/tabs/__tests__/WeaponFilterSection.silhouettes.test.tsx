/**
 * The silhouettes of the selected weapons, in the filter card.
 *
 * EVERY weapon gets one now: `weapon/silhouettes.ts` prefers the firing
 * table's specific art and falls back to the weapon's class, taken from the
 * engine's own `weapon_categories`. This file used to assert the opposite --
 * that a weapon with no art drew nothing, "normal, not an error" -- which was
 * true of the code and false of what the window needed: forty of the database's
 * forty-two weapons showed nothing when picked.
 *
 * A weapon the engine has never CLASSED still draws nothing, and that is the
 * real gap the last case here guards.
 *
 * The mount below is the one WeaponFilterSection.test.tsx already uses, kept
 * in step with it on purpose: two different mounts for the same section would
 * eventually test two different sections.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import WeaponFilterSection from "../WeaponFilterSection";

const FILTERS_FIXTURE = {
  filters: [],
  match_types: [],
  // AK-47 and AWP have specific art in WEAPONS; SSG 08 and MP9 fall back to
  // their class. "Nunchucks" is in no class at all -- the unclassed case.
  weapon_categories: {
    SMGs: ["MP9"],
    Rifles: ["AK-47"],
    Snipers: ["AWP", "SSG 08"],
  },
  resolutions: [],
  framerates: [],
  video_codecs: [],
  audio_codecs: [],
};

const DB_FIXTURE = {
  weapons: ["MP9", "AK-47", "AWP", "SSG 08", "Nunchucks"],
  maps: [["mirage", ["de_mirage"]]],
};

vi.mock("../../bridge", () => ({
  runCommand: (name: string) => {
    if (name === "describe_filters") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: FILTERS_FIXTURE });
    }
    if (name === "connect_db") {
      return Promise.resolve({ type: "result", id: "2", ok: true, data: DB_FIXTURE });
    }
    return Promise.reject(new Error(`unexpected command: ${name}`));
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

async function renderSection() {
  const rendered = render(
    <SettingsProvider>
      <WeaponFilterSection />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

/** Click the chips whose labels are given, in order. */
function pick(...labels: string[]) {
  for (const label of labels) {
    act(() => screen.getByRole("button", { name: label }).click());
  }
}

describe("WeaponFilterSection silhouettes", () => {
  it("shows nothing when nothing is selected", async () => {
    const { container } = await renderSection();
    expect(container.querySelectorAll(".casc .gun")).toHaveLength(0);
  });

  it("shows a silhouette for each SELECTED weapon and none for the others", async () => {
    const { container } = await renderSection();
    pick("AWP");
    const shown = [...container.querySelectorAll(".casc .gun")];
    expect(shown).toHaveLength(1);
    // The database's own name, not an internal id: a class silhouette has no
    // weapon id to carry.
    expect(shown[0].getAttribute("data-weapon")).toBe("AWP");
    expect(shown[0].innerHTML).toContain("<svg");
  });

  it("draws a weapon with no specific art, using its class", async () => {
    // This is the whole of the report: 40 of the database's 42 weapons used to
    // show nothing at all when picked.
    const { container } = await renderSection();
    pick("AWP", "SSG 08");
    const shown = [...container.querySelectorAll(".casc .gun")];
    expect(shown).toHaveLength(2);
    expect(shown[1].getAttribute("data-weapon")).toBe("SSG 08");
    expect(shown[1].innerHTML).toContain("<svg");
  });

  it("never offers a weapon the engine has not classed", async () => {
    // "Nunchucks" is in the database fixture and in no category. The card is
    // built by walking the CATEGORIES, so an unclassed weapon gets no chip at
    // all -- which is why the missing-silhouette case cannot be reached from
    // the screen. `weapon/__tests__/silhouettes.test.ts` covers the resolver's
    // own null for it.
    await renderSection();
    expect(screen.queryByRole("button", { name: "Nunchucks" })).toBeNull();
  });

  it("keeps the silhouettes out of the accessibility tree", async () => {
    // They repeat the chip that is already selected and already labelled.
    const { container } = await renderSection();
    pick("AK-47");
    expect(container.querySelector(".casc")!.getAttribute("aria-hidden")).toBe("true");
  });
});
