/**
 * The Encoding card, drawn in its style (read live) over one model.
 *
 *   - timeline: the encode drawn as it runs -- the video lane (codec, a
 *     quality/size rail for CRF, the preset ruler, the container file), the
 *     audio lane, then the ffmpeg command line with its two raw-flag boxes
 *     in place;
 *   - sentence: the same as words;
 *   - tiles: number tiles, codec tiles, container pictures.
 *
 * The codec choices (L1 video, L2 audio) are marked here only, in `CodecSelect`.
 */
import type { GridProps } from "../../components/cardstyle/gridProps";
import { PictureChoice, type PictureOption } from "../../components/cardstyle/IconTile";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import Field from "../../components/Field";
import Segmented from "../../components/Segmented";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import StyledCard, { type Views } from "../videoKit/StyledCard";
import { GLYPHS } from "../videoKit/glyphs";
import { ChoiceWord, NumTile, NumWord, TextRow, TextWord } from "../videoKit/parts";
import type { TextSetting } from "../videoKit/settings";
import {
  VIDEO_CONTAINERS,
  VIDEO_PRESETS,
  useEncoding,
  type CodecSetting,
  type EncodingModel,
  type VideoContainer,
  type VideoPreset,
} from "./useEncoding";
import "./Encoding.css";

/**
 * A codec dropdown. Its options come from the tables; a stored codec the list
 * does not (yet) hold is kept as an option, so the box never shows another
 * codec than the one the run will use.
 */
function CodecSelect({ c, id, dataAction }: { c: CodecSetting; id: string; dataAction: string }) {
  const options = c.value && !c.options.includes(c.value) ? [c.value, ...c.options] : c.options;
  return (
    <SettingControl settingKey={c.key}>
      <label className="lab" htmlFor={id}>
        {c.label}
      </label>
      <select id={id} className="fld en-select" title={c.tip} value={c.value} data-action={dataAction} onChange={(event) => c.set(event.target.value)}>
        {options.map((codec) => (
          <option key={codec} value={codec}>
            {codec}
          </option>
        ))}
      </select>
    </SettingControl>
  );
}

function VideoCodec({ m, id }: { m: EncodingModel; id: string }) {
  return <CodecSelect c={m.videoCodec} id={id} dataAction="L1" />;
}

function AudioCodec({ m, id }: { m: EncodingModel; id: string }) {
  return <CodecSelect c={m.audioCodec} id={id} dataAction="L2" />;
}

function PresetChoice({ m }: { m: EncodingModel }) {
  return (
    <SettingControl settingKey={m.preset.key}>
      <Segmented options={VIDEO_PRESETS} value={m.preset.value} onChange={(v) => m.preset.set(v as VideoPreset)} label="Preset" tip={m.preset.tip} />
    </SettingControl>
  );
}

function ContainerChoice({ m }: { m: EncodingModel }) {
  return (
    <SettingControl settingKey={m.container.key}>
      <Segmented
        options={VIDEO_CONTAINERS}
        value={m.container.value}
        onChange={(v) => m.container.set(v as VideoContainer)}
        label="Container"
        tip={m.container.tip}
      />
    </SettingControl>
  );
}

/** A raw-flags box inside the command line. */
function FlagsBox({ t, id }: { t: TextSetting; id: string }) {
  return (
    <SettingControl settingKey={t.key}>
      <span className="en-flags" title={t.tip}>
        <Field id={id} mono value={t.value} onChange={t.set} placeholder={t.label.replace("FFmpeg ", "")} tip={t.tip} />
      </span>
    </SettingControl>
  );
}

function TimelineView({ m }: { m: EncodingModel }) {
  const crfAt = (Math.min(51, Math.max(0, m.crf.value)) / 51) * 100;
  const bitrateAt = (Math.min(512, Math.max(0, m.audioBitrate.value)) / 512) * 100;
  return (
    <div className="vk-a en-a">
      <div className="en-lane" aria-label="Video">
        <span className="en-ic">{GLYPHS.film}</span>
        <div className="en-cell en-codec">
          <VideoCodec m={m} id="video-codec" />
        </div>
        <div className="en-cell en-grow">
          <div className="vk-lane-h">
            <span className="vk-kick">Quality ⟷ size</span>
            <NumWord n={m.crf} id="en-crf" />
          </div>
          <div className="en-rail crf" aria-hidden="true">
            <i style={{ left: `${crfAt}%` }} />
          </div>
          <div className="en-rail-caps">
            <small>lossless</small>
            <small>{m.crfWords}</small>
            <small>smallest</small>
          </div>
        </div>
      </div>
      <div className="en-lane" aria-label="Speed and file">
        <span className="en-ic">{GLYPHS.speed}</span>
        <div className="en-cell en-grow">
          <div className="vk-lane-h">
            <span className="vk-kick">Faster encode ⟷ smaller file</span>
          </div>
          <PresetChoice m={m} />
        </div>
        <div className="en-cell">
          <span className="vk-kick">File</span>
          <ContainerChoice m={m} />
        </div>
      </div>
      <div className="en-lane" aria-label="Audio">
        <span className="en-ic">{GLYPHS.audio}</span>
        <div className="en-cell en-codec">
          <AudioCodec m={m} id="audio-codec" />
        </div>
        <div className="en-cell en-grow">
          <div className="vk-lane-h">
            <span className="vk-kick">Bitrate</span>
            <NumWord n={m.audioBitrate} id="en-bitrate" tone="alt" />
          </div>
          <div className="en-rail audio" aria-hidden="true">
            <b style={{ width: `${bitrateAt}%` }} />
          </div>
        </div>
      </div>
      <div className="en-cmd" aria-label="FFmpeg command">
        <code>ffmpeg</code>
        <FlagsBox t={m.ffmpegIn} id="ffmpeg-input-params" />
        <code>-i frames … -c:v {m.videoCodec.value || "?"} -crf {m.crf.value} -preset {m.preset.value}</code>
        <FlagsBox t={m.ffmpegOut} id="ffmpeg-output-params" />
        <code>clip.{m.container.value}</code>
      </div>
    </div>
  );
}

function CodecWord({ m, which, tone }: { m: EncodingModel; which: "video" | "audio"; tone?: "alt" }) {
  const c = which === "video" ? m.videoCodec : m.audioCodec;
  return (
    <ChoiceToken
      label={c.label}
      tone={tone}
      tip={c.tip}
      popover={
        <>
          <h5>{c.label}</h5>
          <div className="row">{which === "video" ? <VideoCodec m={m} id="video-codec" /> : <AudioCodec m={m} id="audio-codec" />}</div>
        </>
      }
    >
      {c.value || "no codec"}
    </ChoiceToken>
  );
}

function SentenceView({ m }: { m: EncodingModel }) {
  return (
    <div className="vk-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Encode the video with</span> <CodecWord m={m} which="video" />{" "}
          <span className="w">at CRF</span> <NumWord n={m.crf} id="en-crf" />{" "}
          <span className="w">({m.crfWords}), the</span> <ChoiceWord c={m.preset} tone="alt" />{" "}
          <span className="w">preset, into a</span> <ChoiceWord c={m.container} words={Object.fromEntries(VIDEO_CONTAINERS.map((c) => [c, `.${c}`]))} />{" "}
          <span className="w">file.</span>
        </div>
        <div className="sc-line">
          <span className="w">Audio as</span> <CodecWord m={m} which="audio" tone="alt" /> <span className="w">at</span>{" "}
          <NumWord n={m.audioBitrate} id="en-bitrate" tone="alt" />
          <span className="w">.</span>
        </div>
        <div className="sc-line">
          <span className="w">Pass FFmpeg</span> <TextWord t={m.ffmpegIn} id="ffmpeg-input-params" empty="no flags" mono />{" "}
          <span className="w">before the input and</span>{" "}
          <TextWord t={m.ffmpegOut} id="ffmpeg-output-params" empty="no flags" mono />{" "}
          <span className="w">before the output.</span>
        </div>
      </div>
    </div>
  );
}

const CONTAINER_OPTIONS: readonly PictureOption<VideoContainer>[] = VIDEO_CONTAINERS.map((value) => ({
  value,
  title: `.${value}`,
  subtitle: value === "mp4" ? "plays anywhere" : value === "webm" ? "for the web" : value === "mkv" ? "any codec" : "",
  art: (
    <svg viewBox="0 0 100 66" aria-hidden="true">
      <path d="M32 8h26l12 12v38H32z" className="en-art-file" />
      <text x="51" y="46" className="en-art-ext">
        {value}
      </text>
    </svg>
  ),
  color: "var(--cam-k)",
}));

function TilesView({ m }: { m: EncodingModel }) {
  return (
    <div className="vk-c">
      <div className="vk-tiles four">
        <div className="en-tile">
          <span className="en-tile-h">
            {GLYPHS.film}
            <b>Video</b>
          </span>
          <VideoCodec m={m} id="video-codec" />
        </div>
        <NumTile n={m.crf} icon={GLYPHS.quality} caption={m.crfWords} />
        <div className="en-tile">
          <span className="en-tile-h">
            {GLYPHS.audio}
            <b>Audio</b>
          </span>
          <AudioCodec m={m} id="audio-codec" />
        </div>
        <NumTile n={m.audioBitrate} icon={GLYPHS.audio} caption="audio track" />
      </div>
      <div className="en-tile wide">
        <span className="en-tile-h">
          {GLYPHS.speed}
          <b>Preset</b>
          <small>faster encode ⟷ smaller file</small>
        </span>
        <PresetChoice m={m} />
      </div>
      <SettingControl settingKey={m.container.key}>
        <div className="vk-pics en-pics" title={m.container.tip}>
          <PictureChoice label="Container" options={CONTAINER_OPTIONS} value={m.container.value} onChange={m.container.set} />
        </div>
      </SettingControl>
      <TextRow t={m.ffmpegIn} id="ffmpeg-input-params" mono />
      <TextRow t={m.ffmpegOut} id="ffmpeg-output-params" mono />
    </div>
  );
}

const VIEWS: Views<EncodingModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function EncodingCard(grid: GridProps) {
  const m = useEncoding();
  return (
    <StyledCard
      id="encoding"
      title="Encoding"
      icon={<ICONS.encoding />}
      prefix="en"
      m={m}
      views={VIEWS}
      count={`${m.videoCodec.value || "?"} · CRF ${m.crf.value} · .${m.container.value}`}
      grid={grid}
    />
  );
}
