/**
 * Match Types and Map Filter in their three styles: every key reachable and
 * written in each, the options greyed (never hidden) while the switch is off
 * or the database has not answered, the style read live.
 */
import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CARD_STYLES } from "../../../components/cardstyle/cardStyle";
import { openPopovers, operate, renderCard, store } from "../../../components/cardstyle/__tests__/smallCardHarness";
import { DatabaseProvider } from "../../../settings/useDatabase";
import { TablesProvider } from "../../../settings/useTables";
import MapFilterCard from "../../mapFilter/MapFilterCard";
import MatchTypesCard from "../../matchTypes/MatchTypesCard";

const bridge = vi.hoisted(() => ({ config: {} as Record<string, unknown>, db: true }));

const FILTERS = {
  filters: [],
  match_types: [
    { key: "match_type_premier", label: "🏆 Premier", tip: "CS2 ranked Premier mode — CS Rating." },
    { key: "match_type_competitive", label: "🎯 Competitive", tip: "Valve 5v5 competitive matches." },
    { key: "match_type_wingman", label: "🤝 Wingman", tip: "2v2 Wingman matches." },
  ],
  weapon_categories: {},
  resolutions: [],
  framerates: [],
  video_codecs: [],
  audio_codecs: [],
};
const MAPS = [
  ["mirage", ["de_mirage"]],
  ["inferno", ["de_inferno"]],
  ["nuke", ["de_nuke"]],
];

vi.mock("../../../bridge", () => ({
  runCommand: (name: string) => {
    if (name === "describe_filters") return Promise.resolve({ type: "result", id: "1", ok: true, data: FILTERS });
    if (name === "connect_db") {
      return bridge.db
        ? Promise.resolve({ type: "result", id: "1", ok: true, data: { weapons: [], maps: MAPS, players: [], tags: [] } })
        : new Promise(() => {});
    }
    return Promise.resolve({ type: "result", id: "1", ok: true, data: bridge.config });
  },
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

const CARDS = [
  {
    name: "Match Types",
    id: "match-types",
    prefix: "mt",
    Card: MatchTypesCard,
    keys: ["match_type_filter_enabled", "match_type_premier", "match_type_competitive", "match_type_wingman"],
    config: { match_type_filter_enabled: true, match_type_premier: true },
    optionSelector: '[data-config-key="match_type_wingman"] button',
  },
  {
    name: "Map Filter",
    id: "map-filter",
    prefix: "mf",
    Card: MapFilterCard,
    keys: ["map_filter_enabled", "map_filter"],
    config: { map_filter_enabled: true, map_filter: ["mirage"] },
    optionSelector: '[data-config-key="map_filter"] button[aria-pressed="false"]',
  },
] as const;

async function render(card: (typeof CARDS)[number], config: Record<string, unknown>, db = true) {
  bridge.config = config;
  bridge.db = db;
  const { Card } = card;
  const rendered = await renderCard(
    <DatabaseProvider>
      <TablesProvider>
        <Card />
      </TablesProvider>
    </DatabaseProvider>,
  );
  await act(async () => {});
  return rendered;
}

describe.each(CARDS)("$name", (card) => {
  describe.each(CARD_STYLES)("%s style", (style) => {
    it.each(card.keys)("reaches %s and writes that key", async (key) => {
      const { container } = await render(card, { ...card.config, ui_card_style: style });
      expect(container.querySelector(`.${card.prefix}-${style}`)).not.toBeNull();
      openPopovers(container);
      const wrapper = container.querySelector(`[data-config-key="${key}"]`);
      expect(wrapper, `${key} has no control in the ${style} style`).not.toBeNull();
      const before = JSON.stringify(store.current[key]);
      operate(wrapper!);
      expect(JSON.stringify(store.current[key]), `${key} was not written`).not.toBe(before);
    });

    it("keeps the options drawn but inert while the switch is off", async () => {
      const { container } = await render(card, { ...card.config, [card.keys[0]]: false, ui_card_style: style });
      openPopovers(container);
      const option = container.querySelector<HTMLElement>(card.optionSelector);
      expect(option, "an option disappeared with the switch off").not.toBeNull();
      const before = JSON.stringify(card.keys.map((k) => store.current[k]));
      act(() => option!.click());
      expect(JSON.stringify(card.keys.map((k) => store.current[k]))).toBe(before);
    });

    it("says it waits for the database instead of going blank", async () => {
      const { container } = await render(card, { ...card.config, ui_card_style: style }, false);
      expect(container.textContent).toMatch(/Waiting for DB/);
    });

    it("keeps the switch tooltip", async () => {
      const { container } = await render(card, { ...card.config, ui_card_style: style });
      openPopovers(container);
      const tips = [...container.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join("\n");
      expect(tips).toMatch(/when off, all (match types|maps) are included/i);
    });
  });

  it("follows its own per-card style", async () => {
    const { container } = await render(card, {
      ...card.config,
      ui_card_style: "timeline",
      ui_card_style_overrides: { [card.id]: "tiles" },
    });
    expect(container.querySelector(`.${card.prefix}-tiles`)).not.toBeNull();
  });
});

describe("Match Types", () => {
  it("builds one option per match type, in the table's order", async () => {
    const { container } = await render(CARDS[0], { ...CARDS[0].config, ui_card_style: "timeline" });
    const keys = [...container.querySelectorAll('[data-action="H1"]')].map((n) =>
      n.closest("[data-config-key]")?.getAttribute("data-config-key"),
    );
    expect(keys).toEqual(FILTERS.match_types.map((m) => m.key));
  });
});

describe("Map Filter", () => {
  it("adds and removes a map in the one list key", async () => {
    const { container } = await render(CARDS[1], { ...CARDS[1].config, ui_card_style: "timeline" });
    act(() => container.querySelector<HTMLElement>('button[aria-label="Nuke"]')!.click());
    expect(store.current.map_filter).toEqual(["mirage", "nuke"]);
    act(() => container.querySelector<HTMLElement>('button[aria-label="Mirage"]')!.click());
    expect(store.current.map_filter).toEqual(["nuke"]);
  });
});
