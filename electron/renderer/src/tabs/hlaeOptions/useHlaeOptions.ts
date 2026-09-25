/**
 * The HLAE Options card's ONE data model: six keys, their words and tooltips.
 *
 * FOV and game speed are stored as numbers: the engine reads them with
 * `int(...)` (fov 1-179, speed 1-1000 %) and a typed word used to reach it.
 */
import {
  useBool,
  useNum,
  useText,
  type BoolSetting,
  type NumSetting,
  type TextSetting,
} from "../videoKit/settings";

/** The Game Speed shortcut values, copied from the window's own row. */
export const GAME_SPEED_QUICK_VALUES = [50, 75, 100, 125, 150, 200, 500, 1000] as const;

export const TIPS = {
  fov: "Camera field of view in degrees (default: 90, cinematic: 100-110, zoomed: 60)",
  speed: "Playback speed for recording: 100 = normal, below = slow motion, above = fast-forward",
  afx: "Records separate color/depth/stencil passes for compositing (HLAE AFX)",
  noSpectatorUi: "Hides the spectator HUD — injects +cl_draw_only_deathnotices 1",
  fixScopeFov: "Stops scoped weapons overriding your FOV setting. Recommended: ON",
  extraArgs: "Extra command-line arguments passed directly to the HLAE launcher (advanced)",
} as const;

export interface HlaeOptionsModel {
  fov: NumSetting;
  speed: NumSetting;
  afx: BoolSetting;
  noSpectatorUi: BoolSetting;
  fixScopeFov: BoolSetting;
  extraArgs: TextSetting;
  /** "default" / "cinematic wide" / "zoomed"… for the current FOV. */
  fovWords: string;
  /** "normal speed" / "2× slow motion" / "2× fast-forward". */
  speedWords: string;
}

export function fovWords(fov: number): string {
  if (fov < 80) return "zoomed";
  if (fov <= 95) return fov === 90 ? "default" : "near default";
  return "cinematic wide";
}

export function speedWords(speed: number): string {
  if (speed === 100) return "normal speed";
  const factor = speed < 100 ? 100 / speed : speed / 100;
  const x = Number.isInteger(factor) ? String(factor) : factor.toFixed(1);
  return speed < 100 ? `${x}× slow motion` : `${x}× fast-forward`;
}

export function useHlaeOptions(): HlaeOptionsModel {
  const fov = useNum("hlae_fov", { label: "FOV", unit: "°", min: 40, max: 140, fallback: 90, tip: TIPS.fov });
  const speed = useNum("hlae_slow_motion", {
    label: "Game speed",
    unit: "%",
    min: 10,
    max: 1000,
    step: 5,
    fallback: 100,
    tip: TIPS.speed,
    quick: GAME_SPEED_QUICK_VALUES,
  });
  return {
    fov,
    speed,
    afx: useBool("hlae_afx_stream", "AFX Stream", TIPS.afx),
    noSpectatorUi: useBool("hlae_no_spectator_ui", "No spectator UI", TIPS.noSpectatorUi),
    fixScopeFov: useBool("hlae_fix_scope_fov", "Fix scope FOV", TIPS.fixScopeFov),
    extraArgs: useText("hlae_extra_args", "Additional HLAE args", TIPS.extraArgs),
    fovWords: fovWords(fov.value),
    speedWords: speedWords(speed.value),
  };
}
