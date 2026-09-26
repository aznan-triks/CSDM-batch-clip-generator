/**
 * Kill / Damage / Shot Filters in their three styles.
 *
 * The contract of the remake: whichever style the card is drawn in, every
 * setting it owns stays reachable and writes the SAME key. The filter list is
 * read from Python (`describe_filters`) at test time, never retyped here, so
 * the day a filter is added this suite covers it on its own (D20 / R1).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CARD_STYLES } from "../../../components/cardstyle/cardStyle";
import { SettingsProvider, useAllSettings } from "../../../settings/store";
import { TablesProvider, type FilterDef } from "../../../settings/useTables";
import { EventFiltersCard, KillFiltersCard } from "../FilterCards";

const mocked = vi.hoisted(() => ({ config: {} as Record<string, unknown>, tables: null as unknown }));

vi.mock("../../../bridge", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync: run } = require("node:child_process");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require("node:path");
  const repoRoot = nodePath.resolve(__dirname, "../../../../../..");
  mocked.tables = JSON.parse(
    run("python", ["-c", "import json; from csdm.bridge.tables import describe_filters; print(json.dumps(describe_filters()))"], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );
  return {
    runCommand: (command: string) =>
      Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: command === "describe_filters" ? mocked.tables : mocked.config,
      }),
    onMessage: () => () => {},
    onFlushRequest: () => () => {},
    send: () => {},
    sendCommand: () => "1",
  };
});

const FILTERS = () => (mocked.tables as { filters: (FilterDef & { applies_to: string[] })[] }).filters;
const visible = (pred: (f: FilterDef & { applies_to: string[] }) => boolean) => FILTERS().filter((f) => !f.hidden && pred(f));
const killDefs = () => visible((f) => f.applies_to.includes("kill"));
const eventDefs = (c: string) => visible((f) => f.category === "event" && f.applies_to.includes(c));

/** The keys of a filter row: Enable, Must, Exclude (when the key exists). */
function rowKeys(def: FilterDef): string[] {
  return def.key === "kill_mod_trois_tap" ? [def.key, `${def.key}_req`] : [def.key, `${def.key}_req`, `${def.key}_exclude`];
}

/** The extras Kill Filters owns in TypeScript (not in the registry's extra_ui), per owning filter. */
const KILL_EXTRAS: Record<string, string> = {
  kill_mod_hv_one_shot: "kill_mod_high_velocity",
  kill_mod_high_vel_thr: "kill_mod_high_velocity",
  kill_mod_flick_deg: "kill_mod_flick",
  kill_mod_one_tap_s: "kill_mod_one_tap",
  kill_mod_multi_kill_n: "kill_mod_multi_kill",
  kill_mod_multi_kill_s: "kill_mod_multi_kill",
  kill_mod_bully_n: "kill_mod_bully",
};
const CARD_KEYS = ["suicides_mode", "headshots_mode", "clutch_enabled", "clutch_wins_only", "clutch_mode", "clutch_1v1", "clutch_1v5"];

let store: Record<string, unknown> = {};
function Probe() {
  store = useAllSettings();
  return null;
}

async function renderCard(node: React.ReactNode, config: Record<string, unknown>) {
  mocked.config = config;
  const rendered = render(
    <SettingsProvider>
      <TablesProvider>
        {node}
        <Probe />
      </TablesProvider>
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
  const radio = wrapper.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]');
  if (radio) return act(() => radio.click());
  const text = wrapper.querySelector<HTMLInputElement>("input");
  if (text) return fireEvent.change(text, { target: { value: "7" } });
  const button = wrapper.querySelector<HTMLElement>("button");
  if (button) return act(() => button.click());
  throw new Error(`no operable control under ${wrapper.getAttribute("data-config-key")}`);
}

async function expectWrites(node: React.ReactNode, config: Record<string, unknown>, key: string) {
  const { container, unmount } = await renderCard(node, config);
  openPopovers(container);
  const wrapper = container.querySelector(`[data-config-key="${key}"]`);
  expect(wrapper, `${key} reachable`).not.toBeNull();
  const before = JSON.stringify(store[key]);
  operate(wrapper!);
  expect(JSON.stringify(store[key]), `${key} written`).not.toBe(before);
  unmount();
}

describe.each(CARD_STYLES)("Kill Filters, %s style", (style) => {
  const base = { ui_card_style: style, clutch_enabled: true, suicides_mode: "include", headshots_mode: "all" };

  it("reaches every row key, card key and extra, and writes that key", async () => {
    const keys = [...killDefs().flatMap(rowKeys), ...CARD_KEYS, ...Object.keys(KILL_EXTRAS)];
    for (const key of keys) {
      const owner = KILL_EXTRAS[key];
      // clutch_enabled is on in `base`; the extras show once their filter is on.
      await expectWrites(<KillFiltersCard />, owner ? { ...base, [owner]: true } : base, key);
    }
  });

  it("never builds a row for a hidden entry or a damage / shot filter", async () => {
    const { container } = await renderCard(<KillFiltersCard />, base);
    openPopovers(container);
    for (const def of FILTERS().filter((f) => f.hidden || !f.applies_to.includes("kill"))) {
      expect(container.querySelector(`[data-config-key="${def.key}"]`), def.key).toBeNull();
    }
    expect(container.querySelector('[data-config-key="kill_mod_trois_tap_exclude"]')).toBeNull();
  });

  it("keeps the UNTESTED mark, ★ Must and Exclude on screen", async () => {
    // No shipped filter is UNTESTED any more (AIRBORNE and RUN & GUN were
    // validated, 2026-09-26): flag one here to keep the mark itself covered.
    const flagged = killDefs()[0] as FilterDef & { untested?: string };
    const before = flagged.untested;
    flagged.untested = "Not checked in game yet.";
    try {
      const { container } = await renderCard(<KillFiltersCard />, base);
      expect(container.querySelectorAll(".cf-untested").length).toBeGreaterThan(0);
      expect(container.textContent).toMatch(/must/i);
      expect(container.textContent).toMatch(/Exclude|Drop/);
    } finally {
      flagged.untested = before;
    }
  });

  it("locks the headshot choice while ONE TAP is on", async () => {
    const { container } = await renderCard(<KillFiltersCard />, { ...base, kill_mod_one_tap: true });
    openPopovers(container);
    const box = container.querySelector('[data-config-key="headshots_mode"]') as HTMLElement;
    for (const radio of within(box).getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("clears only this card's filters", async () => {
    const dmg = eventDefs("damage")[0].key;
    await renderCard(<KillFiltersCard />, { ...base, kill_mod_wall_bang: true, kill_mod_ace_req: true, [dmg]: true });
    act(() => screen.getByRole("button", { name: /^Clear$/ }).click());
    expect(store.kill_mod_wall_bang).toBe(false);
    expect(store.kill_mod_ace_req).toBe(false);
    expect(store[dmg]).toBe(true);
  });

  it("hides the FERRARI PEEK extras until the filter is on", async () => {
    const { container } = await renderCard(<KillFiltersCard />, base);
    openPopovers(container);
    expect(container.querySelector('[data-config-key="kill_mod_high_vel_thr"]')).toBeNull();
  });
});

describe.each(CARD_STYLES)("Damage / Shot Filters, %s style", (style) => {
  it.each(["damage", "shot"] as const)("%s: reaches every key and writes it", async (category) => {
    const defs = eventDefs(category);
    const on = Object.fromEntries(defs.map((d) => [d.key, true]));
    const keys = [...defs.flatMap(rowKeys), ...defs.flatMap((d) => (d.extras ?? []).map((x) => x.key))];
    for (const key of keys) {
      await expectWrites(<EventFiltersCard category={category} />, { ui_card_style: style, ...on }, key);
    }
  });

  it.each([
    ["damage", "shot"],
    ["shot", "damage"],
  ] as const)("%s never shows a %s or kill filter", async (category, other) => {
    const { container } = await renderCard(<EventFiltersCard category={category} />, { ui_card_style: style });
    openPopovers(container);
    for (const def of [...eventDefs(other), ...killDefs()]) {
      expect(container.querySelector(`[data-config-key="${def.key}"]`), def.key).toBeNull();
    }
  });
});

describe("filter card style resolution", () => {
  it("follows the card's own override over the global style", async () => {
    const { container } = await renderCard(<KillFiltersCard />, {
      ui_card_style: "timeline",
      ui_card_style_overrides: { "kill-filters": "tiles" },
    });
    expect(container.querySelector(".cf-style-tiles")).not.toBeNull();
  });

  it("shows a registry default in its field", async () => {
    const def = eventDefs("damage").find((d) => d.extras?.length)!;
    const extra = def.extras![0];
    const { container } = await renderCard(<EventFiltersCard category="damage" />, { ui_card_style: "timeline" });
    const box = container.querySelector(`[data-config-key="${extra.key}"]`) as HTMLElement;
    expect((within(box).getByRole("textbox") as HTMLInputElement).value).toBe(String(extra.default));
  });

  it("marks a kill filter that also judges shots", async () => {
    const also = killDefs().find((d) => d.applies_to.length > 1);
    if (!also) return;
    const { container } = await renderCard(<KillFiltersCard />, { ui_card_style: "timeline" });
    const row = container.querySelector(`[data-config-key="${also.key}"]`)!.closest(".filter-row") as HTMLElement;
    expect(within(row).getByText(/^also /)).toBeTruthy();
  });
});
