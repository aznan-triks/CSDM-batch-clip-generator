/**
 * The TAGS and SETTINGS cards in their three styles: every setting reachable
 * and written under its own key in each style, every marked action on
 * screen in each style, the style read live -- and, above all, "Card style"
 * and "Per-card style" never hidden in any style of UI Theme.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { CARD_STYLES } from "../../../components/cardstyle/cardStyle";
import { openPopovers, renderCard, store } from "../../../components/cardstyle/__tests__/smallCardHarness";
import PresetSection from "../../PresetSection";
import TagGridCard from "../../tagCards/TagGridCard";
import TagOpsCard from "../../tagCards/TagOpsCard";
import TagRangeCard from "../../tagCards/TagRangeCard";
import ConfigFolderCard from "../ConfigFolderCard";
import InjectionPreviewCard from "../InjectionPreviewCard";
import PathsCard from "../PathsCard";
import PerformanceCard from "../PerformanceCard";
import PostgresCard from "../PostgresCard";
import UiLayoutCard from "../UiLayoutCard";
import UiThemeCard from "../UiThemeCard";

const initial = vi.hoisted(() => ({ config: {} as Record<string, unknown>, calls: [] as string[] }));

vi.mock("../../../bridge", () => {
  const answers: Record<string, unknown> = {
    connect_db: { weapons: [], maps: [], players: [], tags: [[1, "Aces", "#ef4444"], [2, "Clutch", "#3b82f6"]] },
    describe_filters: { preset_categories: ["full", "date"], default_paths: { csdm_exe: "C:\\csdm.CMD", clips_dir: "C:\\clips" } },
    list_presets: { night: { cats: ["date"], data: {} } },
    probe_config_dir: { current: "C:\\app\\CSDM Batch Clip Generator", target: "C:\\x", conflicts: [], same: false, kind: "app" },
    tags_calc_range: { date_start: "2024-01-01", date_end: "2024-06-01", date_after: "2024-06-02", demo_count: 3 },
  };
  return {
    runCommand: (command: string) => {
      initial.calls.push(command);
      const data = command === "load_config" ? initial.config : (answers[command] ?? {});
      return Promise.resolve({ type: "result", id: "1", ok: true, data });
    },
    onMessage: () => () => {},
    onFlushRequest: () => () => {},
    send: () => {},
    sendCommand: () => "1",
    pickPath: () => Promise.resolve(null),
    pickSavePath: () => Promise.resolve(null),
    setWindowBounds: () => Promise.resolve(),
  };
});

interface Spec {
  id: string;
  prefix: string;
  card: ReactElement;
  keys: string[];
  actions: string[];
}

const SPECS: Spec[] = [
  { id: "tag-grid", prefix: "tg", card: <TagGridCard />, keys: ["tag_enabled", "ui_active_tags"], actions: ["I1", "I2", "I3", "I4", "I17"] },
  { id: "tag-range", prefix: "tgr", card: <TagRangeCard />, keys: [], actions: ["I7", "I8", "I9", "I10", "I11"] },
  { id: "operations", prefix: "tgo", card: <TagOpsCard />, keys: [], actions: ["I5", "I6", "I12", "I13", "I14", "I15", "I16"] },
  { id: "postgresql", prefix: "pg", card: <PostgresCard />, keys: ["pg_host", "pg_port", "pg_db", "pg_user", "pg_pass"], actions: ["B1"] },
  {
    id: "paths",
    prefix: "pa",
    card: <PathsCard />,
    keys: ["csdm_exe", "cs2_cfg_dir", "output_dir_clips", "output_dir_concat", "output_dir_assembled", "subfolder_per_demo"],
    actions: [],
  },
  { id: "config-folder", prefix: "cf", card: <ConfigFolderCard />, keys: [], actions: ["M13", "M14", "M15"] },
  { id: "presets", prefix: "ps", card: <PresetSection />, keys: [], actions: ["C3", "C4", "C5"] },
  { id: "ui-theme", prefix: "ut", card: <UiThemeCard />, keys: ["theme_accent", "theme_bg", "ui_card_style", "ui_font_family"], actions: ["M2", "M3"] },
  {
    id: "ui-layout",
    prefix: "ul",
    card: <UiLayoutCard />,
    keys: ["ui_window_w", "ui_window_h", "ui_split_pct", "ui_remember_layout", "ui_always_show_tooltips", "ui_card_block_size"],
    actions: ["M5", "M6", "M7"],
  },
  { id: "performance", prefix: "pf", card: <PerformanceCard />, keys: ["dp2_threads"], actions: ["M11"] },
  { id: "injection-preview", prefix: "ip", card: <InjectionPreviewCard />, keys: [], actions: [] },
];

const CONFIG = {
  tag_enabled: false,
  ui_active_tags: [],
  pg_host: "localhost",
  pg_port: "5432",
  pg_db: "csdm",
  pg_user: "postgres",
  pg_pass: "",
  csdm_exe: "",
  cs2_cfg_dir: "",
  output_dir_clips: "",
  output_dir_concat: "",
  output_dir_assembled: "",
  subfolder_per_demo: true,
  theme_accent: "#2563EB",
  theme_bg: "white",
  ui_card_style: "timeline",
  ui_card_style_overrides: {},
  ui_font_family: "auto",
  ui_window_w: 1600,
  ui_window_h: 900,
  ui_split_pct: 60,
  ui_remember_layout: false,
  ui_always_show_tooltips: false,
  ui_card_block_size: 48,
  dp2_threads: 4,
};

async function render(card: ReactElement, config: Record<string, unknown>) {
  initial.config = config;
  const rendered = await renderCard(card);
  // Let the self-fetching readers (tags, tables, presets, folder) answer.
  await act(async () => {});
  return rendered;
}

/** Operate the first control under a key's wrapper, the way a user would. */
function operate(wrapper: Element) {
  const radio = wrapper.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]:not(:disabled)');
  if (radio) return act(() => radio.click());
  const slider = wrapper.querySelector<HTMLElement>('[role="slider"]');
  if (slider) return fireEvent.keyDown(slider, { key: "ArrowUp" });
  const range = wrapper.querySelector<HTMLInputElement>('input[type="range"]');
  if (range) return fireEvent.change(range, { target: { value: String(Number(range.value) + Number(range.step || 1)) } });
  const box = wrapper.querySelector<HTMLInputElement>('input:not([type="checkbox"]):not([type="color"])');
  if (box) return fireEvent.change(box, { target: { value: `${box.value}9` } });
  const button = wrapper.querySelector<HTMLElement>("button:not(:disabled)");
  if (button) return act(() => button.click());
  throw new Error(`no operable control under ${wrapper.getAttribute("data-config-key")}`);
}

describe.each(CARD_STYLES)("TAGS and SETTINGS cards, %s style", (style) => {
  describe.each(SPECS)("$id", (spec) => {
    it("draws in this style and mounts every marked action", async () => {
      const { container } = await render(spec.card, { ...CONFIG, ui_card_style: style });
      expect(container.querySelector(`.${spec.prefix}-${style}`), "card not drawn in this style").not.toBeNull();
      // Tag Range's apply buttons only exist once a range is computed.
      if (spec.id === "tag-range") act(() => (container.querySelector('[data-action="I7"]') as HTMLElement).click());
      await act(async () => {});
      openPopovers(container);
      for (const action of spec.actions) {
        expect(container.querySelector(`[data-action="${action}"]`), `${action} missing in ${style}`).not.toBeNull();
      }
    });

    it.each(spec.keys.length ? spec.keys : ["(none)"])("reaches %s and writes that key", async (key) => {
      if (key === "(none)") return;
      const { container } = await render(spec.card, { ...CONFIG, ui_card_style: style });
      openPopovers(container);
      const wrapper = container.querySelector(`[data-config-key="${key}"]`);
      expect(wrapper, `${key} has no control in the ${style} style`).not.toBeNull();
      const before = JSON.stringify(store.current[key]);
      operate(wrapper!);
      expect(JSON.stringify(store.current[key]), `${key} was not written`).not.toBe(before);
    });
  });

  it("keeps Card style and Per-card style on the face of UI Theme, never behind a word", async () => {
    const { container } = await render(<UiThemeCard />, { ...CONFIG, ui_card_style: style });
    const global = container.querySelector('[data-config-key="ui_card_style"]');
    const perCard = container.querySelector('[data-config-key="ui_card_style_overrides"]');
    expect(global).not.toBeNull();
    expect(perCard).not.toBeNull();
    expect(global!.closest(".cs-pop")).toBeNull();
    expect(perCard!.closest(".cs-pop")).toBeNull();
    // UI Theme's own row is in the list: it can always be pinned back.
    expect(screen.getByLabelText("UI Theme", { selector: "select" })).toBeTruthy();
  });

  it("lets UI Theme, pinned to this style, switch itself back", async () => {
    const { container } = await render(<UiThemeCard />, { ...CONFIG, ui_card_style_overrides: { "ui-theme": style } });
    expect(container.querySelector(`.ut-${style}`)).not.toBeNull();
    const other = CARD_STYLES.find((s) => s !== style)!;
    fireEvent.change(screen.getByLabelText("UI Theme", { selector: "select" }), { target: { value: other } });
    expect(container.querySelector(`.ut-${other}`)).not.toBeNull();
  });
});

describe("Tags cards", () => {
  it("share the selection: a tag chosen in Tags is the one Tag Range computes", async () => {
    const { container } = await render(
      <>
        <TagGridCard />
        <TagRangeCard />
      </>,
      { ...CONFIG, ui_card_style: "timeline" },
    );
    act(() => screen.getByRole("button", { name: "tag-Aces" }).click());
    expect(store.current.ui_active_tags).toEqual([1]);
    act(() => (container.querySelector('[data-action="I7"]') as HTMLElement).click());
    await act(async () => {});
    act(() => (container.querySelector('[data-action="I10"]') as HTMLElement).click());
    expect(store.current.date_from).toBe("2024-01-01");
    expect(store.current.date_to).toBe("2024-06-01");
  });

  it("asks before deleting a tag", async () => {
    await render(<TagGridCard />, { ...CONFIG, ui_card_style: "tiles" });
    initial.calls.length = 0;
    act(() => screen.getByRole("button", { name: "delete-tag-Clutch" }).click());
    expect(screen.getByRole("alertdialog", { name: "Delete tag" })).toBeTruthy();
    expect(initial.calls).not.toContain("tag_delete");
  });
});

describe("UI Layout", () => {
  it("drags the split bar, keys too", async () => {
    await render(<UiLayoutCard />, { ...CONFIG, ui_card_style: "timeline" });
    const bar = screen.getByRole("slider", { name: "Split %" });
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(store.current.ui_split_pct).toBe(59);
  });
});
