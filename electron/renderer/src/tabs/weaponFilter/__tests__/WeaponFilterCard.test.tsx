/**
 * The Weapon Filter card in its three styles.
 *
 * `weapons` is one list key: in every style each offered weapon must be
 * reachable and flip its own name in that list, Select all / Deselect all
 * must write it, and only weapons both classed by the engine AND present in
 * the connected database may be offered.
 */
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CARD_STYLES } from "../../../components/cardstyle/cardStyle";
import { SettingsProvider, useAllSettings } from "../../../settings/store";
import WeaponFilterCard from "../WeaponFilterCard";

const FILTERS_FIXTURE = {
  filters: [],
  match_types: [],
  weapon_categories: {
    Pistols: ["Glock-18", "USP-S", "Desert Eagle"],
    SMGs: ["MP9", "MAC-10"],
    Rifles: ["AK-47", "M4A4"],
    Snipers: ["AWP", "SSG 08"],
  },
  weapon_category_tips: { Pistols: "Sidearms.", SMGs: "Close range.", Rifles: "Main rounds.", Snipers: "Long lines." },
  resolutions: [],
  framerates: [],
  video_codecs: [],
  audio_codecs: [],
};

/** Desert Eagle and MAC-10 are classed but NOT in this database; Nunchucks is in it but unclassed. */
const DB_FIXTURE = {
  weapons: ["Glock-18", "USP-S", "MP9", "AK-47", "M4A4", "AWP", "SSG 08", "Nunchucks"],
  maps: [],
};
const OFFERED = ["Glock-18", "USP-S", "MP9", "AK-47", "M4A4", "AWP", "SSG 08"];

const mocked = vi.hoisted(() => ({ db: "pending" as "pending" | "resolved", config: {} as Record<string, unknown> }));

vi.mock("../../../bridge", () => ({
  runCommand: (name: string) => {
    if (name === "describe_filters") return Promise.resolve({ type: "result", id: "1", ok: true, data: FILTERS_FIXTURE });
    if (name === "connect_db") {
      return mocked.db === "resolved"
        ? Promise.resolve({ type: "result", id: "2", ok: true, data: DB_FIXTURE })
        : new Promise(() => {});
    }
    return Promise.resolve({ type: "result", id: "3", ok: true, data: mocked.config });
  },
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

let store: Record<string, unknown> = {};
function Probe() {
  store = useAllSettings();
  return null;
}

async function renderCard(config: Record<string, unknown>, db: "pending" | "resolved" = "resolved") {
  mocked.db = db;
  mocked.config = config;
  const rendered = render(
    <SettingsProvider>
      <WeaponFilterCard />
      <Probe />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

/** The control that toggles one weapon: its own button, or its chip inside the category word. */
function weaponControl(container: HTMLElement, name: string): HTMLElement {
  for (const token of container.querySelectorAll<HTMLElement>('[aria-haspopup="dialog"][aria-expanded="false"]')) {
    act(() => token.click());
  }
  const box = container.querySelector('[data-config-key="weapons"]') as HTMLElement;
  return within(box).getByRole("button", { name });
}

describe.each(CARD_STYLES)("Weapon Filter, %s style", (style) => {
  it("says it is waiting before the database answers", async () => {
    await renderCard({ ui_card_style: style }, "pending");
    expect(screen.getByText(/Waiting for DB/i)).toBeTruthy();
  });

  it.each(OFFERED)("reaches %s and writes it into `weapons`", async (name) => {
    const { container } = await renderCard({ ui_card_style: style, weapons: [] });
    const pick = weaponControl(container, name);
    act(() => pick.click());
    expect(store.weapons).toEqual([name]);
    const drop = weaponControl(container, name);
    act(() => drop.click());
    expect(store.weapons).toEqual([]);
  });

  it("never offers a weapon missing from the database or from the category table", async () => {
    const { container } = await renderCard({ ui_card_style: style });
    for (const token of container.querySelectorAll<HTMLElement>('[aria-haspopup="dialog"]')) act(() => token.click());
    for (const name of ["Desert Eagle", "MAC-10", "Nunchucks"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("selects and deselects every offered weapon at once", async () => {
    await renderCard({ ui_card_style: style, weapons: [] });
    act(() => screen.getByRole("button", { name: "Select all" }).click());
    expect([...(store.weapons as string[])].sort()).toEqual([...OFFERED].sort());
    act(() => screen.getByRole("button", { name: "Deselect all" }).click());
    expect(store.weapons).toEqual([]);
  });

  it("reads an empty selection as every weapon", async () => {
    await renderCard({ ui_card_style: style, weapons: [] });
    expect(screen.getAllByText(/any weapon/).length).toBeGreaterThan(0);
  });

  it("draws the game's silhouette of a picked weapon", async () => {
    const { container } = await renderCard({ ui_card_style: style, weapons: ["AWP"] });
    const gun = container.querySelector<HTMLElement>('.gun[data-weapon="AWP"]');
    expect(gun).not.toBeNull();
    expect(gun!.style.getPropertyValue("--gun-art")).toMatch(/^url\(/);
    expect(gun!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Weapon Filter rack", () => {
  it("picks and drops a whole category from its shelf name", async () => {
    await renderCard({ ui_card_style: "timeline", weapons: [] });
    act(() => screen.getByRole("button", { name: /^Snipers/ }).click());
    expect(store.weapons).toEqual(["AWP", "SSG 08"]);
    act(() => screen.getByRole("button", { name: /^Snipers/ }).click());
    expect(store.weapons).toEqual([]);
  });
});
