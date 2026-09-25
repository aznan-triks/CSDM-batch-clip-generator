/**
 * The Resolution, Framerate & Window card's ONE data model.
 *
 * `resolutions` and `framerates` come from `useTables()` (`describe_filters`),
 * never copied here -- a copy would drift the day Python adds an entry
 * (D20 / R1). `cs2_window_mode` has no such table: its values are the fixed
 * engine enum `_common_cs2_injection` reads.
 */
import { asNumber } from "../../settings/asNumber";
import { useSetting, useSettingsBatch } from "../../settings/store";
import { useTables } from "../../settings/useTables";
import { useBool, useChoice, useNum, type BoolSetting, type ChoiceSetting, type NumSetting } from "../videoKit/settings";

/** `cs2_window_mode` values, exactly as the engine reads them. */
export const WINDOW_MODES = ["none", "fullscreen", "windowed", "noborder"] as const;
export type WindowMode = (typeof WINDOW_MODES)[number];

export const WINDOW_WORDS: Record<WindowMode, { title: string; words: string }> = {
  none: { title: "Unchanged", words: "as it is" },
  fullscreen: { title: "Fullscreen", words: "fullscreen" },
  windowed: { title: "Windowed", words: "in a window" },
  noborder: { title: "Borderless", words: "borderless" },
};

export const TIPS = {
  presets: "Presets for video resolution (width x height)",
  width: "Video width in pixels",
  height: "Video height in pixels",
  fps: "Frames per second for recording (e.g. 60, 120, 240 for smooth slow-mo)",
  window: "CS2 window mode on launch: none=unchanged, fullscreen, windowed, or noborder (borderless)",
  sendToBack: "Sends the CS2 window behind other windows right after launch, so it doesn't steal focus",
} as const;

export interface Preset {
  label: string;
  width: number;
  height: number;
}

export interface ResolutionModel {
  /** Empty until the tables answer. */
  presets: Preset[];
  loaded: boolean;
  /** The preset matching width x height, or "" for a custom size. */
  presetLabel: string;
  choosePreset: (label: string) => void;
  width: NumSetting;
  height: NumSetting;
  /** "16:9", from the current width and height. */
  aspect: string;
  fps: { key: string; value: number; options: number[]; tip: string; set: (fps: number) => void };
  window: ChoiceSetting<WindowMode>;
  sendToBack: BoolSetting;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function aspectOf(width: number, height: number): string {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return "";
  const d = gcd(w, h);
  const [x, y] = [w / d, h / d];
  // 1366x768 reduces to 683:384: say the ratio it is close to instead.
  return x > 32 ? `${(w / h).toFixed(2)}:1` : `${x}:${y}`;
}

export function useResolution(): ResolutionModel {
  const { tables } = useTables();
  const setMany = useSettingsBatch();
  const width = useNum("width", { label: "Width", unit: " px", min: 320, max: 7680, step: 2, fallback: 1920, tip: TIPS.width });
  const height = useNum("height", { label: "Height", unit: " px", min: 240, max: 4320, step: 2, fallback: 1080, tip: TIPS.height });
  const [fpsRaw, setFps] = useSetting<number>("framerate");
  const window = useChoice("cs2_window_mode", WINDOW_MODES, "none", "Window mode", TIPS.window);
  const sendToBack = useBool("cs2_send_to_back", "Send to back", TIPS.sendToBack);

  const presets = tables?.resolutions ?? [];
  const presetLabel = presets.find((r) => r.width === width.value && r.height === height.value)?.label ?? "";

  return {
    presets,
    loaded: !!tables,
    presetLabel,
    // Two keys, one change: writing them separately would save twice and, for
    // a moment, pair the new width with the old height.
    choosePreset: (label) => {
      const res = presets.find((r) => r.label === label);
      if (res) setMany({ width: res.width, height: res.height });
    },
    width,
    height,
    aspect: aspectOf(width.value, height.value),
    fps: {
      key: "framerate",
      value: asNumber(fpsRaw, 60),
      options: tables?.framerates ?? [],
      tip: TIPS.fps,
      set: (fps) => setFps(fps),
    },
    window,
    sendToBack,
  };
}
