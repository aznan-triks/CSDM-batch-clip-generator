/**
 * The seven VIDEO cards in their three styles: every key reachable and written
 * in each style, numbers stored as numbers, the style read live.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

import { CARD_STYLES } from "../../../components/cardstyle/cardStyle";
import { openPopovers } from "../../../components/cardstyle/__tests__/smallCardHarness";
import { SettingsProvider, useAllSettings, useSetting } from "../../../settings/store";
import Cs2EffectsCard from "../../cs2Effects/Cs2EffectsCard";
import EncodingCard from "../../encoding/EncodingCard";
import FinalAssemblyCard from "../../finalAssembly/FinalAssemblyCard";
import HlaeOptionsCard from "../../hlaeOptions/HlaeOptionsCard";
import InGameOptionsCard from "../../inGameOptions/InGameOptionsCard";
import RecordingSystemCard from "../../recordingSystem/RecordingSystemCard";
import ResolutionCard from "../../resolution/ResolutionCard";

const initial = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));

const TABLES = {
  filters: [],
  match_types: [],
  weapon_categories: {},
  resolutions: [
    { label: "1280x720", width: 1280, height: 720 },
    { label: "1920x1080", width: 1920, height: 1080 },
    { label: "2560x1440", width: 2560, height: 1440 },
  ],
  framerates: [30, 60, 120],
  video_codecs: ["libx264", "libx265", "h264_nvenc"],
  audio_codecs: ["libmp3lame", "aac"],
};

vi.mock("../../../bridge", () => ({
  runCommand: (command: string) =>
    Promise.resolve({ type: "result", id: "1", ok: true, data: command === "describe_filters" ? TABLES : initial.config }),
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

/** The window's defaults for every key of the tab. */
const DEFAULTS: Record<string, unknown> = {
  assemble_after: false,
  assemble_output: "assembled.mp4",
  concatenate_sequences: false,
  delete_after_assemble: false,
  width: 1920,
  height: 1080,
  framerate: 60,
  cs2_window_mode: "none",
  cs2_send_to_back: false,
  recsys: "HLAE",
  hlae_fov: 90,
  hlae_slow_motion: 100,
  hlae_extra_args: "",
  hlae_afx_stream: false,
  hlae_fix_scope_fov: true,
  hlae_no_spectator_ui: true,
  true_view: true,
  show_only_death_notices: true,
  show_xray: true,
  death_notices_duration: 5,
  close_game_after: true,
  phys_ragdoll_enable: true,
  phys_ragdoll_scale: 1.0,
  phys_ragdoll_gravity: 600,
  phys_sv_gravity: 800,
  phys_blood: true,
  phys_dynamic_lighting: true,
  video_codec: "libx264",
  video_container: "mp4",
  video_preset: "medium",
  crf: 18,
  audio_codec: "libmp3lame",
  audio_bitrate: 256,
  ffmpeg_input_params: "",
  ffmpeg_output_params: "",
};

const CARDS: { name: string; prefix: string; Card: ComponentType; keys: string[] }[] = [
  { name: "Final Assembly", prefix: "fa", Card: FinalAssemblyCard, keys: ["assemble_after", "delete_after_assemble", "concatenate_sequences", "assemble_output"] },
  { name: "Resolution", prefix: "rs", Card: ResolutionCard, keys: ["width", "height", "framerate", "cs2_window_mode", "cs2_send_to_back"] },
  { name: "Recording System", prefix: "rsys", Card: RecordingSystemCard, keys: ["recsys"] },
  {
    name: "HLAE Options",
    prefix: "hl",
    Card: HlaeOptionsCard,
    keys: ["hlae_fov", "hlae_slow_motion", "hlae_afx_stream", "hlae_no_spectator_ui", "hlae_fix_scope_fov", "hlae_extra_args"],
  },
  { name: "In-Game Options", prefix: "ig", Card: InGameOptionsCard, keys: ["true_view", "show_only_death_notices", "show_xray", "death_notices_duration", "close_game_after"] },
  {
    name: "CS2 Effects",
    prefix: "fx",
    Card: Cs2EffectsCard,
    keys: ["phys_ragdoll_gravity", "phys_ragdoll_scale", "phys_sv_gravity", "phys_ragdoll_enable", "phys_blood", "phys_dynamic_lighting"],
  },
  {
    name: "Encoding",
    prefix: "en",
    Card: EncodingCard,
    keys: ["video_codec", "crf", "video_preset", "video_container", "audio_codec", "audio_bitrate", "ffmpeg_input_params", "ffmpeg_output_params"],
  },
];

const NUMERIC_KEYS = new Set(
  Object.entries(DEFAULTS)
    .filter(([, v]) => typeof v === "number")
    .map(([k]) => k),
);

const store: { current: Record<string, unknown> } = { current: {} };

function Probe() {
  store.current = useAllSettings();
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

async function renderCard(Card: ComponentType, config: Record<string, unknown>) {
  initial.config = config;
  const rendered = render(
    <SettingsProvider>
      <Card />
      <StyleSwitch />
      <Probe />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

/** Operate the first control under a key's wrapper the way a user would. */
function operate(wrapper: Element) {
  const radio = wrapper.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]');
  if (radio) return act(() => radio.click());
  const select = wrapper.querySelector<HTMLSelectElement>("select");
  if (select) {
    const other = [...select.options].find((o) => o.value !== select.value);
    return fireEvent.change(select, { target: { value: other!.value } });
  }
  const slider = wrapper.querySelector<HTMLElement>('[role="slider"]');
  if (slider) return fireEvent.keyDown(slider, { key: "ArrowUp" });
  const text = wrapper.querySelector<HTMLInputElement>('input[type="text"]');
  if (text) return fireEvent.change(text, { target: { value: `${text.value}-x` } });
  const button = wrapper.querySelector<HTMLElement>("button:not([aria-haspopup]):not([aria-disabled='true']):not(:disabled)");
  if (button) return act(() => button.click());
  throw new Error(`no operable control under ${wrapper.getAttribute("data-config-key")}`);
}

describe.each(CARDS)("$name", ({ prefix, Card, keys }) => {
  describe.each(CARD_STYLES)("%s style", (style) => {
    it.each(keys)("reaches %s and writes that key", async (key) => {
      const { container } = await renderCard(Card, { ...DEFAULTS, ui_card_style: style });
      expect(container.querySelector(`.${prefix}-${style}`)).not.toBeNull();
      openPopovers(container);
      const wrapper = container.querySelector(`[data-config-key="${key}"]`);
      expect(wrapper, `${key} has no control in the ${style} style`).not.toBeNull();
      const before = JSON.stringify(store.current[key]);
      operate(wrapper!);
      expect(JSON.stringify(store.current[key]), `${key} was not written`).not.toBe(before);
      if (NUMERIC_KEYS.has(key)) expect(typeof store.current[key], `${key} stored as text`).toBe("number");
    });
  });
});

describe("VIDEO card numbers", () => {
  it("stores a typed number as a number and ignores a typed word", async () => {
    // The engine did int(cfg["hlae_fov"]) on whatever the old box held.
    await renderCard(HlaeOptionsCard, { ...DEFAULTS, ui_card_style: "timeline" });
    openPopovers(document.body);
    const box = document.getElementById("hl-fov") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "105" } });
    expect(store.current.hlae_fov).toBe(105);
    fireEvent.change(box, { target: { value: "wide" } });
    expect(store.current.hlae_fov).toBe(105);
    fireEvent.change(box, { target: { value: "" } });
    expect(store.current.hlae_fov).toBe(105);
  });

  it("keeps a decimal as it is typed, through the half-typed '0.'", async () => {
    await renderCard(Cs2EffectsCard, { ...DEFAULTS, ui_card_style: "timeline" });
    openPopovers(document.body);
    const box = document.getElementById("fx-rag-scale") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "0." } });
    expect(box.value).toBe("0.");
    fireEvent.change(box, { target: { value: "0.25" } });
    expect(store.current.phys_ragdoll_scale).toBe(0.25);
    fireEvent.change(box, { target: { value: "-" } });
    expect(store.current.phys_ragdoll_scale).toBe(0.25);
  });

  it("steps a decimal number by its step without float noise", async () => {
    await renderCard(Cs2EffectsCard, { ...DEFAULTS, phys_ragdoll_scale: 0.2, ui_card_style: "tiles" });
    const slider = screen.getByRole("slider", { name: "Ragdoll scale" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(store.current.phys_ragdoll_scale).toBe(0.3);
    expect(slider.textContent).toContain("0.3");
  });

  it("offers the old window's shortcut values and stores them as numbers", async () => {
    await renderCard(Cs2EffectsCard, { ...DEFAULTS, ui_card_style: "timeline" });
    for (const value of ["600", "200", "0", "-200", "-500", "2000", "5000", "1.0", "0.5", "800", "1200"]) {
      expect(screen.getAllByRole("button", { name: new RegExp(`^${value}$`) }).length, value).toBeGreaterThan(0);
    }
    act(() => screen.getAllByRole("button", { name: /^-200$/ })[0].click());
    expect(store.current.phys_ragdoll_gravity).toBe(-200);
  });

  it("keeps a stored codec the table does not list", async () => {
    await renderCard(EncodingCard, { ...DEFAULTS, video_codec: "hevc_amf", ui_card_style: "timeline" });
    const select = document.getElementById("video-codec") as HTMLSelectElement;
    expect(select.value).toBe("hevc_amf");
  });

  it("writes width and height together from a preset", async () => {
    await renderCard(ResolutionCard, { ...DEFAULTS, ui_card_style: "timeline" });
    act(() => screen.getByRole("radio", { name: "2560x1440" }).click());
    expect([store.current.width, store.current.height]).toEqual([2560, 1440]);
  });
});

describe("VIDEO card style", () => {
  it("redraws live when the style changes, without touching a key", async () => {
    const { container } = await renderCard(EncodingCard, { ...DEFAULTS, ui_card_style: "timeline" });
    const keys = JSON.stringify(CARDS[6].keys.map((k) => store.current[k]));
    for (const style of CARD_STYLES) {
      act(() => screen.getByTestId(`style-${style}`).click());
      expect(container.querySelector(`.en-${style}`)).not.toBeNull();
    }
    expect(JSON.stringify(CARDS[6].keys.map((k) => store.current[k]))).toBe(keys);
  });

  it("follows its own override over the global style", async () => {
    const { container } = await renderCard(FinalAssemblyCard, {
      ...DEFAULTS,
      ui_card_style: "timeline",
      ui_card_style_overrides: { "final-assembly": "tiles" },
    });
    expect(container.querySelector(".fa-tiles")).not.toBeNull();
  });
});
