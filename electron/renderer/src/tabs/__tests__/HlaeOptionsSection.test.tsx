/**
 * IN-GAME OPTIONS, RECORDING SYSTEM, HLAE OPTIONS and CS2 EFFECTS.
 *
 * Ported from `_tab_video` in csdm_batch_clips_generator.py, the second slice
 * (17 keys). Same pattern as `VideoTab.test.tsx`: render through
 * `SettingsProvider`, flush the pipe once, then read the tree.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import VideoTab from "../VideoTab";

/** `RECSYS_OPTIONS[0]` in csdm_batch_clips_generator.py -- verified, not guessed. */
const HLAE_RECSYS_VALUE = "HLAE";

const TABLES_FIXTURE = {
  filters: [],
  match_types: [],
  weapon_categories: {},
  resolutions: [{ label: "1920x1080", width: 1920, height: 1080 }],
  framerates: [60],
  video_codecs: ["libx264"],
  audio_codecs: ["libmp3lame"],
};

/** A configuration with the window's defaults for the 17 keys this section ports. */
const CONFIG_FIXTURE = {
  assemble_after: false,
  assemble_output: "assembled.mp4",
  concatenate_sequences: false,
  delete_after_assemble: false,
  width: 1920,
  height: 1080,
  framerate: 60,
  cs2_window_mode: "none",
  cs2_send_to_back: false,
  video_codec: "libx264",
  video_container: "mp4",
  video_preset: "medium",
  crf: 18,
  audio_codec: "libmp3lame",
  audio_bitrate: 256,
  ffmpeg_input_params: "",
  ffmpeg_output_params: "",
  death_notices_duration: 5,
  close_game_after: true,
  show_only_death_notices: true,
  show_xray: true,
  true_view: true,
  recsys: "CS",
  hlae_fov: 90,
  hlae_slow_motion: 100,
  hlae_extra_args: "",
  hlae_afx_stream: false,
  hlae_fix_scope_fov: true,
  hlae_no_spectator_ui: true,
  phys_ragdoll_enable: true,
  phys_ragdoll_scale: 1.0,
  phys_ragdoll_gravity: 600,
  phys_sv_gravity: 800,
  phys_blood: true,
  phys_dynamic_lighting: true,
};

vi.mock("../../bridge", () => ({
  runCommand: (command: string) => {
    if (command === "describe_filters") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: TABLES_FIXTURE });
    }
    if (command === "load_config") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: CONFIG_FIXTURE });
    }
    return Promise.resolve({ type: "result", id: "1", ok: true, data: {} });
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

async function renderTab() {
  const rendered = render(
    <SettingsProvider>
      <VideoTab />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

describe("recording system sections", () => {
  it("hides the HLAE options outside HLAE mode", async () => {
    const { container } = await renderTab(); // fixture: recsys = the non-HLAE value
    expect(container.querySelector('[data-config-key="hlae_fov"]')).toBeNull();
  });

  it("shows the HLAE options in HLAE mode", async () => {
    const { container } = await renderTab();
    act(() => screen.getByRole("radio", { name: HLAE_RECSYS_VALUE }).click());
    expect(container.querySelector('[data-config-key="hlae_fov"]')).not.toBeNull();
  });

  it("shows the CS2 effects in BOTH modes", async () => {
    // The window's own heading says "both HLAE and CS modes": hiding them with
    // the HLAE block would lose six settings in the default mode.
    const { container } = await renderTab();
    expect(container.querySelector('[data-config-key="phys_sv_gravity"]')).not.toBeNull();
    act(() => screen.getByRole("radio", { name: HLAE_RECSYS_VALUE }).click());
    expect(container.querySelector('[data-config-key="phys_sv_gravity"]')).not.toBeNull();
  });

  // `phys_ragdoll_gravity` (600/200/0/-200/-500/2000/5000) and `phys_sv_gravity`
  // (800/400/200/100/1200/2000) are separate fields with their own quick-value
  // rows, ported verbatim from the window's two presets lists. Their sets
  // overlap on "200" and "2000" -- both fields legitimately offer a button
  // with that text, so `getAllByRole` (at least one match), not `getByRole`
  // (exactly one), is the correct assertion here.
  it("offers the ragdoll gravity quick values the window had", async () => {
    await renderTab();
    for (const value of ["600", "200", "0", "-200", "-500", "2000", "5000"]) {
      expect(screen.getAllByRole("button", { name: new RegExp(`^${value}$`) }).length).toBeGreaterThan(0);
    }
  });

  it("offers the world gravity quick values the window had", async () => {
    await renderTab();
    for (const value of ["800", "400", "200", "100", "1200", "2000"]) {
      expect(screen.getAllByRole("button", { name: new RegExp(`^${value}$`) }).length).toBeGreaterThan(0);
    }
  });
});
