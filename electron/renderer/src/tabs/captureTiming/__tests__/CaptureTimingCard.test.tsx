/**
 * The Capture & Timing card in its three styles.
 *
 * The contract of the remake: whichever style the user picks, every setting
 * the card had stays reachable and writes the SAME config key. Each key is
 * found through its `data-config-key` wrapper, operated the way a user would
 * (click, key, type) and the store is read back.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CARD_STYLES } from "../../../components/cardstyle/cardStyle";
import { SettingsProvider, useAllSettings, useSetting } from "../../../settings/store";
import CaptureTimingCard from "../CaptureTimingCard";

const initial = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));

vi.mock("../../../bridge", () => ({
  runCommand: () => Promise.resolve({ type: "result", id: "1", ok: true, data: initial.config }),
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

/** Every key the card owned before the remake: the remake may move them, never drop one. */
const CARD_KEYS = [
  "event_actor",
  "event_target",
  "event_lethal",
  "event_non_lethal",
  "event_other",
  "event_ally",
  "event_enemy",
  "events",
  "perspective",
  "kill_mod_mate_pov",
  "kill_mod_mate_pov_req",
  "player_name_override",
  "before",
  "after",
  "victim_pre_s",
] as const;

/** The engine's defaults, on the camera that shows every conditional control. */
const BOTH_DEFAULTS = {
  event_actor: true,
  event_target: false,
  event_lethal: true,
  event_non_lethal: false,
  event_other: false,
  event_ally: false,
  event_enemy: true,
  events: [],
  perspective: "both",
  kill_mod_mate_pov: false,
  kill_mod_mate_pov_req: false,
  player_name_override: "",
  before: 3,
  after: 5,
  victim_pre_s: 2,
};

let store: Record<string, unknown> = {};
function Probe() {
  store = useAllSettings();
  return null;
}

function StyleSwitch() {
  const [, set] = useSetting<string>("ui_card_style");
  return (
    <>
      {CARD_STYLES.map((s) => (
        <button key={s} type="button" data-testid={`style-${s}`} onClick={() => set(s)} />
      ))}
    </>
  );
}

async function renderCard(config: Record<string, unknown>) {
  initial.config = config;
  const rendered = render(
    <SettingsProvider>
      <CaptureTimingCard />
      <StyleSwitch />
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
  const radio = wrapper.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]');
  if (radio) return act(() => radio.click());
  const slider = wrapper.querySelector<HTMLElement>('[role="slider"]');
  if (slider) return fireEvent.keyDown(slider, { key: "ArrowUp" });
  const range = wrapper.querySelector<HTMLInputElement>('input[type="range"]');
  if (range) return fireEvent.change(range, { target: { value: String(Number(range.value) + 1) } });
  const text = wrapper.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
  if (text) return fireEvent.change(text, { target: { value: "Someone" } });
  const button = wrapper.querySelector<HTMLElement>("button");
  if (button) return act(() => button.click());
  throw new Error(`no operable control under ${wrapper.getAttribute("data-config-key")}`);
}

describe.each(CARD_STYLES)("Capture & Timing, %s style", (style) => {
  it.each(CARD_KEYS)("reaches %s and writes that key", async (key) => {
    const { container } = await renderCard({ ...BOTH_DEFAULTS, ui_card_style: style });
    expect(container.querySelector(`.ct-${style}`)).not.toBeNull();
    openPopovers(container);
    const wrapper = container.querySelector(`[data-config-key="${key}"]`);
    expect(wrapper, `${key} has no control in the ${style} style`).not.toBeNull();
    const before = JSON.stringify(store[key]);
    operate(wrapper!);
    expect(JSON.stringify(store[key]), `${key} was not written`).not.toBe(before);
  });

  it("hides the switch delay outside both and Mate POV on the killer", async () => {
    const { container } = await renderCard({ ...BOTH_DEFAULTS, perspective: "killer", ui_card_style: style });
    openPopovers(container);
    const on = (key: string) => container.querySelector(`[data-config-key="${key}"]`) !== null;
    expect(on("victim_pre_s")).toBe(false);
    expect(on("kill_mod_mate_pov")).toBe(false);

    act(() => screen.getByRole("radio", { name: "victim" }).click());
    openPopovers(container);
    expect(on("victim_pre_s")).toBe(false);
    expect(on("kill_mod_mate_pov")).toBe(true);
  });

  it("keeps the Must rule: Must arms Enable, Enable off drops Must", async () => {
    const { container } = await renderCard({ ...BOTH_DEFAULTS, ui_card_style: style });
    const chip = (key: string) => container.querySelector<HTMLElement>(`[data-config-key="${key}"] button`)!;
    act(() => chip("kill_mod_mate_pov_req").click());
    expect(store.kill_mod_mate_pov_req).toBe(true);
    expect(store.kill_mod_mate_pov).toBe(true);
    act(() => chip("kill_mod_mate_pov").click());
    expect(store.kill_mod_mate_pov).toBe(false);
    expect(store.kill_mod_mate_pov_req).toBe(false);
  });

  it("says the clip length and the merge rule from the values", async () => {
    await renderCard({ ...BOTH_DEFAULTS, ui_card_style: style });
    const text = screen.getByTestId("clip-window-summary").textContent ?? "";
    expect(text).toMatch(/10\s?s\b/);
    expect(text).toMatch(/15\s?s\b/);
  });
});

describe("the card style switch", () => {
  it("redraws the card live, without touching any card key", async () => {
    const { container } = await renderCard({ ...BOTH_DEFAULTS });
    // No stored style: the first one (DEFAULT_CONFIG's "timeline").
    expect(container.querySelector(".ct-timeline")).not.toBeNull();
    const keysBefore = JSON.stringify(CARD_KEYS.map((k) => store[k]));
    for (const style of CARD_STYLES) {
      act(() => screen.getByTestId(`style-${style}`).click());
      expect(container.querySelector(`.ct-${style}`)).not.toBeNull();
    }
    expect(JSON.stringify(CARD_KEYS.map((k) => store[k]))).toBe(keysBefore);
  });

  it("follows its own per-card override over the global style", async () => {
    const { container } = await renderCard({
      ...BOTH_DEFAULTS,
      ui_card_style: "timeline",
      ui_card_style_overrides: { "capture-timing": "tiles", "map-filter": "sentence" },
    });
    expect(container.querySelector(".ct-tiles")).not.toBeNull();
    // The global switch no longer reaches it while the override stands.
    act(() => screen.getByTestId("style-sentence").click());
    expect(container.querySelector(".ct-tiles")).not.toBeNull();
  });
});

describe("the timeline's handles", () => {
  it("snap to whole seconds and write before / victim view / after", async () => {
    await renderCard({ ...BOTH_DEFAULTS, ui_card_style: "timeline" });
    const handle = (name: string) => screen.getByRole("slider", { name });

    // Start handle one second right: one second less before.
    fireEvent.keyDown(handle("Seconds before"), { key: "ArrowRight" });
    expect(store.before).toBe(2);

    // Switch handle one second left: one more victim second, taken from the
    // killer's -- the clip's start does not move.
    fireEvent.keyDown(handle("Victim view"), { key: "ArrowLeft" });
    expect(store.victim_pre_s).toBe(3);
    expect(store.before).toBe(1);

    fireEvent.keyDown(handle("Seconds after"), { key: "ArrowRight" });
    expect(store.after).toBe(6);
  });

  it("draws the camera in the bar: killer, then victim, then after", async () => {
    const { container } = await renderCard({ ...BOTH_DEFAULTS, ui_card_style: "timeline" });
    const spans = () => [...container.querySelectorAll(".cs-tl-span")].map((s) => `${s.className}:${s.textContent}`);
    expect(spans()).toEqual(["cs-tl-span primary:3s", "cs-tl-span alt:2s", "cs-tl-span rest:5s after"]);
    act(() => screen.getByRole("radio", { name: "killer" }).click());
    expect(spans()).toEqual(["cs-tl-span primary:3s killer", "cs-tl-span rest:5s after"]);
  });
});
