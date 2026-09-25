/**
 * The Player and Demo Selection cards in their three styles.
 *
 * The contract of the remake: whichever style is picked -- globally or for
 * this card only -- every setting the card had stays reachable and writes the
 * SAME config key. Each key is found through its `data-config-key` wrapper,
 * operated the way a user would, and the store is read back.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { CARD_STYLES } from "../../components/cardstyle/cardStyle";
import { SettingsProvider, useAllSettings } from "../../settings/store";
import DemoSelectionSection from "../DemoSelectionSection";
import PlayerSection from "../PlayerSection";
import { fmt } from "../demoSelection/useDemoSelection";

const initial = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));

vi.mock("../../bridge", () => ({
  runCommand: (name: string) =>
    name === "list_demos"
      ? Promise.resolve({ type: "result", id: "1", ok: true, data: { demos: [] } })
      : Promise.resolve({ type: "result", id: "1", ok: true, data: initial.config }),
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

const PLAYERS = [
  ["Alpha  (76561190001)", "76561190001", "Alpha", 1],
  ["Beta  (76561190002)", "76561190002", "Beta", 2],
];

vi.mock("../../settings/useDatabase", () => ({
  useDatabase: () => ({ database: { weapons: [], maps: [], players: PLAYERS, tags: [] }, error: null }),
}));

let store: Record<string, unknown> = {};
function Probe() {
  store = useAllSettings();
  return null;
}

async function renderWith(node: ReactElement, config: Record<string, unknown>) {
  initial.config = config;
  const rendered = render(
    <SettingsProvider>
      {node}
      <Probe />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

/** Open every word popover, so the controls behind a word are on screen too. */
function openPopovers(container: HTMLElement) {
  for (const token of container.querySelectorAll<HTMLElement>('[aria-haspopup="dialog"][aria-expanded="false"]')) {
    act(() => token.click());
  }
}

/** Operate the first control inside a key's wrapper the way a user would. */
function operate(wrapper: Element) {
  const row = wrapper.querySelector<HTMLElement>('[role="checkbox"]');
  if (row) return act(() => row.click());
  const star = wrapper.querySelector<HTMLElement>(".ps-star");
  if (star) return act(() => star.click());
  const text = wrapper.querySelector<HTMLInputElement>('input[type="text"]');
  if (text) return fireEvent.change(text, { target: { value: "01-01-2026" } });
  const button = wrapper.querySelector<HTMLElement>("button");
  if (button) return act(() => button.click());
  throw new Error(`no operable control under ${wrapper.getAttribute("data-config-key")}`);
}

const PLAYER_BASE = { steam_ids: [], steam_id: "", player_name: "", saved_players: [{ steam_id: "76561190002", name: "Beta" }] };

describe.each(CARD_STYLES)("Player, %s style", (style) => {
  it.each(["steam_ids", "steam_id", "saved_players"])("reaches %s and writes that key", async (key) => {
    const { container } = await renderWith(<PlayerSection />, { ...PLAYER_BASE, ui_card_style: style });
    expect(container.querySelector(`.pc-${style}`)).not.toBeNull();
    openPopovers(container);
    const wrapper = container.querySelector(`[data-config-key="${key}"]`);
    expect(wrapper, `${key} has no control in the ${style} style`).not.toBeNull();
    const before = JSON.stringify(store[key]);
    // saved_players: its wrapper holds the registered chips; the ★ on a list row writes it.
    if (key === "saved_players") act(() => container.querySelector<HTMLElement>(".ps-star")!.click());
    else operate(wrapper!);
    expect(JSON.stringify(store[key]), `${key} was not written`).not.toBe(before);
  });

  it("writes player_name with the first active player, and shows it", async () => {
    const { container } = await renderWith(<PlayerSection />, { ...PLAYER_BASE, ui_card_style: style });
    act(() => container.querySelector<HTMLElement>('[role="checkbox"]')!.click());
    expect(store.player_name).toBe("Alpha");
    const active = container.querySelector('[data-config-key="player_name"]')!;
    expect(active.textContent).toContain("Alpha");
    // A click on the active chip deactivates.
    act(() => active.querySelector<HTMLElement>(".chip")!.click());
    expect(store.steam_ids).toEqual([]);
  });

  it("keeps search, sort and paging reachable", async () => {
    const { container } = await renderWith(<PlayerSection />, { ...PLAYER_BASE, ui_card_style: style });
    openPopovers(container);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "beta" } });
    expect(container.querySelectorAll(".ps-row")).toHaveLength(1);
    expect(screen.getByRole("radiogroup", { name: /sort/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /next page/i })).toBeTruthy();
  });

  it("registered chip toggles, × forgets", async () => {
    await renderWith(<PlayerSection />, { ...PLAYER_BASE, ui_card_style: style });
    act(() => document.querySelector<HTMLElement>(".ps-registered .chip:not(.close-btn)")!.click());
    expect(store.steam_ids).toEqual(["76561190002"]);
    act(() => screen.getByRole("button", { name: /unregister beta/i }).click());
    expect(store.saved_players).toEqual([]);
  });
});

const DEMO_BASE = { date_from: "", date_to: "" };

describe.each(CARD_STYLES)("Demo Selection, %s style", (style) => {
  it.each(["date_from", "date_to"])("reaches %s and writes that key", async (key) => {
    const { container } = await renderWith(<DemoSelectionSection />, { ...DEMO_BASE, ui_card_style: style });
    expect(container.querySelector(`.ds-${style}`)).not.toBeNull();
    openPopovers(container);
    const wrapper = container.querySelector(`[data-config-key="${key}"]`);
    expect(wrapper, `${key} has no control in the ${style} style`).not.toBeNull();
    operate(wrapper!);
    expect(store[key]).toBe("01-01-2026");
  });

  it("applies a shortcut, Today and Clear all", async () => {
    const { container } = await renderWith(<DemoSelectionSection />, { ...DEMO_BASE, ui_card_style: style });
    openPopovers(container);
    act(() => screen.getByRole("button", { name: /^30d$/ }).click());
    expect(store.date_from).not.toBe("");
    expect(screen.getByRole("button", { name: /^30d$/ }).getAttribute("aria-pressed")).toBe("true");
    openPopovers(container);
    act(() => screen.getByRole("button", { name: "Clear all" }).click());
    expect(store.date_from).toBe("");
    act(() => screen.getByRole("button", { name: /^Today$/ }).click());
    expect(store.date_to).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });

  it("keeps Manual mode reachable", async () => {
    const { container } = await renderWith(<DemoSelectionSection />, { ...DEMO_BASE, ui_card_style: style });
    openPopovers(container);
    const manual = screen.getByRole("button", { name: /Manual mode/i });
    act(() => manual.click());
    await act(async () => {});
    expect(screen.getByRole("button", { name: /Manual mode/i }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("per-card style override", () => {
  it("beats the global style for its own card only", async () => {
    const { container } = await renderWith(
      <>
        <PlayerSection />
        <DemoSelectionSection />
      </>,
      { ...PLAYER_BASE, ...DEMO_BASE, ui_card_style: "sentence", ui_card_style_overrides: { player: "tiles" } },
    );
    expect(container.querySelector(".pc-tiles")).not.toBeNull();
    expect(container.querySelector(".ds-sentence")).not.toBeNull();
  });
});

describe("the demo range strip", () => {
  it("moves each bound by whole days from the keyboard, never past the other", async () => {
    // Relative to today: the strip ends on today, whatever the clock says.
    const now = new Date();
    const day = (back: number) => fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
    await renderWith(<DemoSelectionSection />, { date_from: day(20), date_to: day(10), ui_card_style: "timeline" });
    const from = screen.getByRole("slider", { name: "From date" });
    const to = screen.getByRole("slider", { name: "To date" });
    fireEvent.keyDown(from, { key: "ArrowRight" });
    expect(store.date_from).toBe(day(19));
    fireEvent.keyDown(to, { key: "ArrowLeft" });
    expect(store.date_to).toBe(day(11));
    fireEvent.keyDown(from, { key: "PageUp" });
    expect(store.date_from).toBe(day(11));
  });
});
