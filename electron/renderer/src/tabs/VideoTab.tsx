/**
 * The Video tab: FINAL ASSEMBLY, RESOLUTION/FRAMERATE/WINDOW, ENCODING,
 * IN-GAME OPTIONS, RECORDING SYSTEM, HLAE OPTIONS and CS2 EFFECTS.
 *
 * Ported from `_tab_video` in csdm_batch_clips_generator.py. `resolutions`,
 * `framerates`, `videoCodecs` and `audioCodecs` come from `useTables()`
 * (`describe_filters`), never hardcoded here -- a copy would drift the day
 * Python adds an entry (D20 / R1). `video_preset`, `video_container` and
 * `RECSYS_OPTIONS` have no such table (`csdm/bridge/tables.py` never sends
 * them); they are fixed engine enums, the same category as `CaptureTab`'s
 * own `PERSPECTIVES` / `CLIP_ORDERS`, so they are declared locally like
 * those.
 *
 * `HlaeOptionsSection` is mounted only while `recsys` is HLAE, ported from
 * `_on_recsys_change`'s `is_hlae` branch (`self._hlae_sec.pack`/`pack_forget`).
 * `Cs2EffectsSection` is mounted unconditionally: the window's own heading
 * for that block reads "both HLAE and CS modes".
 */
import Card from "../components/Card";
import { ICONS } from "../icons";
import Chip from "../components/Chip";
import Field from "../components/Field";
import Segmented from "../components/Segmented";
import SettingControl from "../settings/SettingControl";
import { useSetting, useSettingsBatch } from "../settings/store";
import { useTables } from "../settings/useTables";
import Cs2EffectsSection from "./Cs2EffectsSection";
import HlaeOptionsSection from "./HlaeOptionsSection";
import "./VideoTab.css";

/** `RECSYS_OPTIONS`, exactly as csdm_batch_clips_generator.py lists them. */
const RECSYS_OPTIONS = ["HLAE", "CS"] as const;

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

  const [assembleAfter, setAssembleAfter] =
    useSetting<boolean>("assemble_after");
  const [assembleOutput, setAssembleOutput] =
    useSetting<string>("assemble_output");
  const [concatenateSequences, setConcatenateSequences] = useSetting<boolean>(
    "concatenate_sequences",
  );
  const [deleteAfterAssemble, setDeleteAfterAssemble] = useSetting<boolean>(
    "delete_after_assemble",
  );

  const [width, setWidth] = useSetting<number>("width");
  const [height, setHeight] = useSetting<number>("height");
  const [framerate, setFramerate] = useSetting<number>("framerate");
  const [windowMode, setWindowMode] = useSetting<string>("cs2_window_mode");
  const [sendToBack, setSendToBack] = useSetting<boolean>("cs2_send_to_back");

  const [videoCodec, setVideoCodec] = useSetting<string>("video_codec");
  const [videoContainer, setVideoContainer] =
    useSetting<string>("video_container");
  const [videoPreset, setVideoPreset] = useSetting<string>("video_preset");
  const [crf, setCrf] = useSetting<number>("crf");
  const [audioCodec, setAudioCodec] = useSetting<string>("audio_codec");
  const [audioBitrate, setAudioBitrate] = useSetting<number>("audio_bitrate");
  const [ffmpegInput, setFfmpegInput] = useSetting<string>(
    "ffmpeg_input_params",
  );
  const [ffmpegOutput, setFfmpegOutput] = useSetting<string>(
    "ffmpeg_output_params",
  );

  const [trueView, setTrueView] = useSetting<boolean>("true_view");
  const [showOnlyDeathNotices, setShowOnlyDeathNotices] = useSetting<boolean>(
    "show_only_death_notices",
  );
  const [showXray, setShowXray] = useSetting<boolean>("show_xray");
  const [deathNoticesDuration, setDeathNoticesDuration] = useSetting<
    string | number
  >("death_notices_duration");
  const [closeGameAfter, setCloseGameAfter] =
    useSetting<boolean>("close_game_after");
  const [recsys, setRecsys] = useSetting<string>("recsys");

  const isHlae = recsys === RECSYS_OPTIONS[0];

  const currentWidth = asNumber(width, 1920);
  const currentHeight = asNumber(height, 1080);
  const currentResolutionLabel =
    tables?.resolutions.find(
      (r) => r.width === currentWidth && r.height === currentHeight,
    )?.label ?? "";

  // Two keys, one change: writing them separately would save twice and, for a
  // moment, pair the new width with the old height.
  function chooseResolution(label: string) {
    const res = tables?.resolutions.find((r) => r.label === label);
    if (!res) return;
    setMany({ width: res.width, height: res.height });
  }

  return (
    <div className="bento video-tab">
      <Card title="Final Assembly" icon={<ICONS.finalAssembly />}>
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
        <div className="row">
          <SettingControl settingKey="assemble_output">
            <Field
              id="assemble-output"
              label="Output filename"
              value={assembleOutput ?? ""}
              onChange={setAssembleOutput}
              placeholder="assembled.mp4"
            />
          </SettingControl>
        </div>
      </Card>

      <Card
        title="Resolution, Framerate &amp; Window"
        icon={<ICONS.resolution />}
        className="wide"
      >
        {!tables ? (
          <p className="video-hint">Loading tables…</p>
        ) : (
          <div className="row">
            <span className="lab">Resolution</span>
            <Segmented
              options={tables.resolutions.map((r) => r.label)}
              value={currentResolutionLabel}
              onChange={chooseResolution}
              label="Resolution"
            />
          </div>
        )}
        <div className="row">
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
          <div className="row">
            <span className="lab">FPS</span>
            <Segmented
              options={tables ? tables.framerates.map(String) : []}
              value={String(asNumber(framerate, 60))}
              onChange={(v) => setFramerate(Number(v))}
              label="FPS"
            />
          </div>
        </SettingControl>

        <SettingControl settingKey="cs2_window_mode">
          <div className="row">
            <span className="lab">Window mode</span>
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

      <Card title="Encoding" icon={<ICONS.encoding />} className="wide">
        {/* Always mounted, options empty until `useTables()` resolves -- same
            reason as the FPS control above. */}
        {/* Paired, the way the mock pairs its own controls: `.fld { flex: 1 }`
            hands a LONE field the whole card, which is how a dropdown holding
            "libx264" ended up 825px wide. Two related controls share the row
            and each takes half. */}
        <div className="row">
          <SettingControl settingKey="video_codec">
            <label className="lab" htmlFor="video-codec">
              Codec
            </label>
            <select
              id="video-codec"
              className="fld"
              value={videoCodec ?? ""}
              onChange={(event) => setVideoCodec(event.target.value)}
            >
              {(tables?.videoCodecs ?? []).map((codec) => (
                <option key={codec} value={codec}>
                  {codec}
                </option>
              ))}
            </select>
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
        </div>

        <div className="row">
          <SettingControl settingKey="video_preset">
            <span className="lab">Preset</span>
            <Segmented
              options={VIDEO_PRESETS}
              value={videoPreset ?? VIDEO_PRESETS[5]}
              onChange={setVideoPreset}
              label="Preset"
            />
          </SettingControl>

          <SettingControl settingKey="video_container">
            <span className="lab">Container</span>
            <Segmented
              options={VIDEO_CONTAINERS}
              value={videoContainer ?? VIDEO_CONTAINERS[0]}
              onChange={setVideoContainer}
              label="Container"
            />
          </SettingControl>
        </div>

        <div className="row">
          <SettingControl settingKey="audio_codec">
            <label className="lab" htmlFor="audio-codec">
              Audio codec
            </label>
            <select
              id="audio-codec"
              className="fld"
              value={audioCodec ?? ""}
              onChange={(event) => setAudioCodec(event.target.value)}
            >
              {(tables?.audioCodecs ?? []).map((codec) => (
                <option key={codec} value={codec}>
                  {codec}
                </option>
              ))}
            </select>
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
        </div>

        {/* These two hold whole command lines, so they keep the full width --
            the one place in this card where a wide field is the right answer.
            They still wear a row, so the label sits beside the box. */}
        <div className="row">
          <SettingControl settingKey="ffmpeg_input_params">
            <Field
              id="ffmpeg-input-params"
              label="FFmpeg input params"
              value={ffmpegInput ?? ""}
              onChange={setFfmpegInput}
            />
          </SettingControl>
        </div>
        <div className="row">
          <SettingControl settingKey="ffmpeg_output_params">
            <Field
              id="ffmpeg-output-params"
              label="FFmpeg output params"
              value={ffmpegOutput ?? ""}
              onChange={setFfmpegOutput}
            />
          </SettingControl>
        </div>
      </Card>

      <Card title="In-Game Options" icon={<ICONS.inGameOptions />}>
        <SettingControl settingKey="true_view">
          <Chip
            label="TrueView"
            selected={!!trueView}
            onToggle={() => setTrueView(!trueView)}
          />
        </SettingControl>
        <SettingControl settingKey="show_only_death_notices">
          <Chip
            label="Death notices only"
            selected={!!showOnlyDeathNotices}
            onToggle={() => setShowOnlyDeathNotices(!showOnlyDeathNotices)}
          />
        </SettingControl>
        <SettingControl settingKey="show_xray">
          <Chip
            label="X-Ray"
            selected={!!showXray}
            onToggle={() => setShowXray(!showXray)}
          />
        </SettingControl>
        <div className="row">
          <SettingControl settingKey="death_notices_duration">
            <Field
              id="death-notices-duration"
              label="Death notices (s)"
              mono
              value={
                deathNoticesDuration === undefined ||
                deathNoticesDuration === null
                  ? "5"
                  : String(deathNoticesDuration)
              }
              onChange={setDeathNoticesDuration}
            />
          </SettingControl>
        </div>
        <SettingControl settingKey="close_game_after">
          <Chip
            label="Close CS2 after each demo"
            selected={!!closeGameAfter}
            onToggle={() => setCloseGameAfter(!closeGameAfter)}
          />
        </SettingControl>
      </Card>

      <Card title="Recording System" icon={<ICONS.recordingSystem />}>
        <SettingControl settingKey="recsys">
          <div className="row">
            <span className="lab">System</span>
            <Segmented
              options={RECSYS_OPTIONS}
              value={recsys ?? RECSYS_OPTIONS[0]}
              onChange={setRecsys}
              label="System"
            />
          </div>
        </SettingControl>
        <p className="video-hint">
          HLAE = injects via HLAE into CS2 (recommended -- full options). CS =
          native CSDM recording via CS2&apos;s startmovie command.
          HLAE-exclusive features (custom FOV, AFX streams, No spectator UI, Fix
          scope FOV) are not available in CS mode; CS2 effects (physics,
          gravity, blood) are injected in both modes.
        </p>
      </Card>

      {isHlae && (
        <Card title="HLAE Options" icon={<ICONS.hlaeOptions />}>
          <HlaeOptionsSection />
        </Card>
      )}

      <Card title="CS2 Effects" icon={<ICONS.cs2Effects />} className="wide">
        <Cs2EffectsSection />
      </Card>
    </div>
  );
}
