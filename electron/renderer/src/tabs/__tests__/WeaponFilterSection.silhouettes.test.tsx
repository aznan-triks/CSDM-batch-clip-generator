/**
 * The silhouettes of the selected weapons, in the filter card.
 *
 * The art is the WEAPONS table's -- the same source the bottom band fires --
 * so no new asset and no second copy. WEAPONS only carries art for a few
 * weapons; a database holds dozens. A weapon with no silhouette is normal, not
 * an error, and must not take the card down with it.
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
  // AK-47 and AWP have art in WEAPONS; SSG 08 and MP9 do not.
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
  weapons: ["MP9", "AK-47", "AWP", "SSG 08"],
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
    expect(shown[0].getAttribute("data-weapon")).toBe("awp");
    expect(shown[0].innerHTML).toContain("<svg");
  });

  it("skips a selected weapon that has no silhouette, without crashing", async () => {
    // The filter lists every weapon the database holds; WEAPONS carries art
    // for a few. A missing silhouette is normal.
    const { container } = await renderSection();
    pick("AWP", "SSG 08");
    expect(container.querySelectorAll(".casc .gun")).toHaveLength(1);
  });

  it("keeps the silhouettes out of the accessibility tree", async () => {
    // They repeat the chip that is already selected and already labelled.
    const { container } = await renderSection();
    pick("AK-47");
    expect(container.querySelector(".casc")!.getAttribute("aria-hidden")).toBe("true");
  });
});
