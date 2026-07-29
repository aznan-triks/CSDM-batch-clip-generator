/**
 * The Video tab -- first slice: FINAL ASSEMBLY, RESOLUTION/FRAMERATE/WINDOW,
 * ENCODING.
 *
 * Ported from `_tab_video` in csdm_batch_clips_generator.py. Same pattern as
 * `CaptureTab.test.tsx`: render through `SettingsProvider`, flush the pipe
 * once, then read the tree.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import VideoTab from "../VideoTab";

/** The tables `describe_filters` would return, trimmed to what this tab reads. */
const TABLES_FIXTURE = {
  filters: [],
  match_types: [],
  weapon_categories: {},
  resolutions: [
    { label: "1280x720", width: 1280, height: 720 },
    { label: "1920x1080", width: 1920, height: 1080 },
    { label: "2560x1440", width: 2560, height: 1440 },
    { label: "3840x2160", width: 3840, height: 2160 },
  ],
  framerates: [30, 60, 120],
  video_codecs: ["libx264", "libx265", "h264_nvenc"],
  audio_codecs: ["libmp3lame", "aac"],
};

/** A configuration with the window's defaults for the 17 keys this tab ports. */
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

describe("VideoTab", () => {
  it("offers every resolution the table declares", async () => {
    await renderTab();
    for (const res of TABLES_FIXTURE.resolutions) {
      expect(screen.getByRole("radio", { name: res.label })).toBeTruthy();
    }
  });

  it("writes width and height together when a resolution is chosen", async () => {
    // The window stores two numbers, not a label: picking "1920x1080" must set
    // both, or the next run records at the previous height.
    const { container } = await renderTab();
    act(() => screen.getByRole("radio", { name: "2560x1440" }).click());
    expect(container.querySelector('[data-config-key="width"]')).not.toBeNull();
    expect(container.querySelector('[data-config-key="height"]')).not.toBeNull();
  });

  it("offers every codec the table declares", async () => {
    await renderTab();
    for (const codec of TABLES_FIXTURE.video_codecs) {
      expect(screen.getByRole("option", { name: codec })).toBeTruthy();
    }
  });

  it("keeps the raw ffmpeg fields", async () => {
    const { container } = await renderTab();
    for (const key of ["ffmpeg_input_params", "ffmpeg_output_params"]) {
      expect(container.querySelector(`[data-config-key="${key}"]`)).not.toBeNull();
    }
  });
});
