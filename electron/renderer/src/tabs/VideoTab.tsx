/**
 * The Video tab -- first slice: FINAL ASSEMBLY, RESOLUTION/FRAMERATE/WINDOW,
 * ENCODING.
 *
 * Ported from `_tab_video` in csdm_batch_clips_generator.py. `resolutions`,
 * `framerates`, `videoCodecs` and `audioCodecs` come from `useTables()`
 * (`describe_filters`), never hardcoded here -- a copy would drift the day
 * Python adds an entry (D20 / R1). `video_preset` and `video_container` have
 * no such table (`csdm/bridge/tables.py` never sends them); they are fixed
 * engine enums, the same category as `CaptureTab`'s own `PERSPECTIVES` /
 * `CLIP_ORDERS`, so they are declared locally like those.
 */
import Card from "../components/Card";
import Chip from "../components/Chip";
import Field from "../components/Field";
import Segmented from "../components/Segmented";
import SettingControl from "../settings/SettingControl";
import { useSetting, useSettingsBatch } from "../settings/store";
import { useTables } from "../settings/useTables";
import "./VideoTab.css";

/** `video_preset` values, exactly as `csdm_batch_clips_generator.py`'s PRESETS_CPU lists them. */
const VIDEO_PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
] as const;

/** `video_container` values, exactly as VIDEO_CONTAINERS lists them. */
const VIDEO_CONTAINERS = ["mp4", "avi", "mkv", "mov", "webm"] as const;

/** `cs2_window_mode` values, exactly as the engine reads them; label kept identical to the value. */
const WINDOW_MODES = ["none", "fullscreen", "windowed", "noborder"] as const;

/** Read a setting that should be a number, tolerating the string a text field leaves behind. */
function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function VideoTab() {
  const { tables } = useTables();
  const setMany = useSettingsBatch();

  const [assembleAfter, setAssembleAfter] = useSetting<boolean>("assemble_after");
  const [assembleOutput, setAssembleOutput] = useSetting<string>("assemble_output");
  const [concatenateSequences, setConcatenateSequences] =
    useSetting<boolean>("concatenate_sequences");
  const [deleteAfterAssemble, setDeleteAfterAssemble] =
    useSetting<boolean>("delete_after_assemble");

  const [width, setWidth] = useSetting<number>("width");
  const [height, setHeight] = useSetting<number>("height");
  const [framerate, setFramerate] = useSetting<number>("framerate");
  const [windowMode, setWindowMode] = useSetting<string>("cs2_window_mode");
  const [sendToBack, setSendToBack] = useSetting<boolean>("cs2_send_to_back");

  const [videoCodec, setVideoCodec] = useSetting<string>("video_codec");
  const [videoContainer, setVideoContainer] = useSetting<string>("video_container");
  const [videoPreset, setVideoPreset] = useSetting<string>("video_preset");
  const [crf, setCrf] = useSetting<number>("crf");
  const [audioCodec, setAudioCodec] = useSetting<string>("audio_codec");
  const [audioBitrate, setAudioBitrate] = useSetting<number>("audio_bitrate");
  const [ffmpegInput, setFfmpegInput] = useSetting<string>("ffmpeg_input_params");
  const [ffmpegOutput, setFfmpegOutput] = useSetting<string>("ffmpeg_output_params");

  const currentWidth = asNumber(width, 1920);
  const currentHeight = asNumber(height, 1080);
  const currentResolutionLabel =
    tables?.resolutions.find((r) => r.width === currentWidth && r.height === currentHeight)
      ?.label ?? "";

  // Two keys, one change: writing them separately would save twice and, for a
  // moment, pair the new width with the old height.
  function chooseResolution(label: string) {
    const res = tables?.resolutions.find((r) => r.label === label);
    if (!res) return;
    setMany({ width: res.width, height: res.height });
  }

  return (
    <div className="video-tab">
      <Card title="FINAL ASSEMBLY">
        <SettingControl settingKey="assemble_after">
          <Chip
            label="Assemble all clips at the end"
            selected={!!assembleAfter}
            onToggle={() => setAssembleAfter(!assembleAfter)}
          />
        </SettingControl>
        <SettingControl settingKey="delete_after_assemble">
          <Chip
            label="Delete source clips after assembly"
            selected={!!deleteAfterAssemble}
            onToggle={() => setDeleteAfterAssemble(!deleteAfterAssemble)}
          />
        </SettingControl>
        <SettingControl settingKey="concatenate_sequences">
          <Chip
            label="Concatenate sequences"
            selected={!!concatenateSequences}
            onToggle={() => setConcatenateSequences(!concatenateSequences)}
          />
        </SettingControl>
        <SettingControl settingKey="assemble_output">
          <Field
            id="assemble-output"
            label="Output filename"
            value={assembleOutput ?? ""}
            onChange={setAssembleOutput}
            placeholder="assembled.mp4"
          />
        </SettingControl>
      </Card>

      <Card title="RESOLUTION, FRAMERATE & WINDOW">
        {!tables ? (
          <p className="video-hint">Loading tables…</p>
        ) : (
          <div className="video-row">
            <span className="video-label">Resolution</span>
            <Segmented
              options={tables.resolutions.map((r) => r.label)}
              value={currentResolutionLabel}
              onChange={chooseResolution}
              label="Resolution"
            />
          </div>
        )}
        <div className="video-grid">
          <SettingControl settingKey="width">
            <Field
              id="video-width"
              label="Width"
              mono
              value={String(currentWidth)}
              onChange={(v) => setWidth(asNumber(v, currentWidth))}
            />
          </SettingControl>
          <SettingControl settingKey="height">
            <Field
              id="video-height"
              label="Height"
              mono
              value={String(currentHeight)}
              onChange={(v) => setHeight(asNumber(v, currentHeight))}
            />
          </SettingControl>
        </div>

        {/* Always mounted, options empty until `useTables()` resolves: a
            control that only appears once the pipe answers is a control the
            coverage guard's synchronous tab switch would never see. */}
        <SettingControl settingKey="framerate">
          <div className="video-row">
            <span className="video-label">FPS</span>
            <Segmented
              options={tables ? tables.framerates.map(String) : []}
              value={String(asNumber(framerate, 60))}
              onChange={(v) => setFramerate(Number(v))}
              label="FPS"
            />
          </div>
        </SettingControl>

        <SettingControl settingKey="cs2_window_mode">
          <div className="video-row">
            <span className="video-label">Window mode</span>
            <Segmented
              options={WINDOW_MODES}
              value={windowMode ?? WINDOW_MODES[0]}
              onChange={setWindowMode}
              label="Window mode"
            />
          </div>
        </SettingControl>
        <SettingControl settingKey="cs2_send_to_back">
          <Chip
            label="Send to back on launch"
            selected={!!sendToBack}
            onToggle={() => setSendToBack(!sendToBack)}
          />
        </SettingControl>
      </Card>

      <Card title="ENCODING">
        {/* Always mounted, options empty until `useTables()` resolves -- same
            reason as the FPS control above. */}
        <SettingControl settingKey="video_codec">
          <div className="video-row">
            <label className="video-label" htmlFor="video-codec">
              Codec
            </label>
            <select
              id="video-codec"
              className="video-select"
              value={videoCodec ?? ""}
              onChange={(event) => setVideoCodec(event.target.value)}
            >
              {(tables?.videoCodecs ?? []).map((codec) => (
                <option key={codec} value={codec}>
                  {codec}
                </option>
              ))}
            </select>
          </div>
        </SettingControl>

        <SettingControl settingKey="crf">
          <Field
            id="video-crf"
            label="CRF"
            mono
            value={String(asNumber(crf, 18))}
            onChange={(v) => setCrf(asNumber(v, 18))}
          />
        </SettingControl>

        <SettingControl settingKey="video_preset">
          <div className="video-row">
            <span className="video-label">Preset</span>
            <Segmented
              options={VIDEO_PRESETS}
              value={videoPreset ?? VIDEO_PRESETS[5]}
              onChange={setVideoPreset}
              label="Preset"
            />
          </div>
        </SettingControl>

        <SettingControl settingKey="video_container">
          <div className="video-row">
            <span className="video-label">Container</span>
            <Segmented
              options={VIDEO_CONTAINERS}
              value={videoContainer ?? VIDEO_CONTAINERS[0]}
              onChange={setVideoContainer}
              label="Container"
            />
          </div>
        </SettingControl>

        <SettingControl settingKey="audio_codec">
          <div className="video-row">
            <label className="video-label" htmlFor="audio-codec">
              Audio codec
            </label>
            <select
              id="audio-codec"
              className="video-select"
              value={audioCodec ?? ""}
              onChange={(event) => setAudioCodec(event.target.value)}
            >
              {(tables?.audioCodecs ?? []).map((codec) => (
                <option key={codec} value={codec}>
                  {codec}
                </option>
              ))}
            </select>
          </div>
        </SettingControl>

        <SettingControl settingKey="audio_bitrate">
          <Field
            id="audio-bitrate"
            label="Audio bitrate (kbps)"
            mono
            value={String(asNumber(audioBitrate, 256))}
            onChange={(v) => setAudioBitrate(asNumber(v, 256))}
          />
        </SettingControl>

        <SettingControl settingKey="ffmpeg_input_params">
          <Field
            id="ffmpeg-input-params"
            label="FFmpeg input params"
            value={ffmpegInput ?? ""}
            onChange={setFfmpegInput}
          />
        </SettingControl>
        <SettingControl settingKey="ffmpeg_output_params">
          <Field
            id="ffmpeg-output-params"
            label="FFmpeg output params"
            value={ffmpegOutput ?? ""}
            onChange={setFfmpegOutput}
          />
        </SettingControl>
      </Card>
    </div>
  );
}
