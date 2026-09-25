/**
 * The Resolution, Framerate & Window card, drawn in its style (read live).
 *
 *   - timeline: the frame itself, sized to its ratio, its width and height on
 *     its edges; one second of film cut into frames; the CS2 window;
 *   - sentence: two sentences whose words are the settings;
 *   - tiles: pictures of each preset, frame rate and window mode.
 *
 * The preset choice (L3) is marked here only, in `PresetChoice`.
 */
import type { ReactNode } from "react";

import type { GridProps } from "../../components/cardstyle/gridProps";
import { PictureChoice, type PictureOption } from "../../components/cardstyle/IconTile";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import Segmented from "../../components/Segmented";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import StyledCard, { type Views } from "../videoKit/StyledCard";
import { GLYPHS } from "../videoKit/glyphs";
import { BoolTile, BoolWord, ChoiceWord, ExactBox, NumTile, NumWord, Switch } from "../videoKit/parts";
import { TIPS, WINDOW_MODES, WINDOW_WORDS, useResolution, type ResolutionModel, type WindowMode } from "./useResolution";
import "./Resolution.css";

/**
 * The presets as a segmented row. It writes width AND height, so it wears
 * both keys' wrappers.
 */
function PresetChoice({ m }: { m: ResolutionModel }) {
  return (
    <SettingControl settingKey="width">
      <SettingControl settingKey="height">
        <Segmented
          options={m.presets.map((r) => r.label)}
          value={m.presetLabel}
          onChange={m.choosePreset}
          label="Resolution"
          tip={TIPS.presets}
          optionActions={Object.fromEntries(m.presets.map((r) => [r.label, "L3"]))}
        />
      </SettingControl>
    </SettingControl>
  );
}

/** The frame rates as a segmented row; always mounted, empty until the tables answer. */
function FpsChoice({ m }: { m: ResolutionModel }) {
  return (
    <SettingControl settingKey={m.fps.key}>
      <Segmented options={m.fps.options.map(String)} value={String(m.fps.value)} onChange={(v) => m.fps.set(Number(v))} label="FPS" tip={m.fps.tip} />
    </SettingControl>
  );
}

/** One second of film as cells: one per ten frames, so 60 fps reads twice as dense as 30. */
function filmCells(fps: number): number[] {
  return Array.from({ length: Math.max(1, Math.min(24, Math.round(fps / 10))) }, (_, i) => i);
}

function FilmSecond({ fps }: { fps: number }) {
  return (
    <div className="rs-film" aria-hidden="true">
      {filmCells(fps).map((i) => (
        <i key={i} />
      ))}
    </div>
  );
}

const WINDOW_MARKS: Record<WindowMode, ReactNode> = {
  none: <i className="rs-wm">–</i>,
  fullscreen: <i className="rs-wm">⛶</i>,
  windowed: <i className="rs-wm">❐</i>,
  noborder: <i className="rs-wm">▢</i>,
};

function TimelineView({ m }: { m: ResolutionModel }) {
  // The frame is drawn at its own ratio, never wider than 2.4:1 nor taller than 1:1.
  const ratio = Math.min(2.4, Math.max(1, m.width.value / Math.max(1, m.height.value)));
  return (
    <div className="vk-a rs-a">
      <div className="vk-lane">
        <div className="vk-lane-h">
          <span className="vk-kick">Frame</span>
          {m.loaded ? <PresetChoice m={m} /> : <span className="vk-hint">Loading tables…</span>}
        </div>
        <div className="rs-stage">
          <div className="rs-frame" style={{ aspectRatio: String(ratio) }}>
            <span className="rs-w">
              <NumWord n={m.width} id="rs-width" unit="" />
            </span>
            <span className="rs-h">
              <NumWord n={m.height} id="rs-height" unit="" />
            </span>
            <span className="rs-in">
              <b>{m.presetLabel || "custom"}</b>
              <small>{m.aspect}</small>
            </span>
          </div>
        </div>
      </div>
      <div className="vk-lane">
        <div className="vk-lane-h">
          <span className="vk-kick">One second = {m.fps.value} frames</span>
          <FpsChoice m={m} />
        </div>
        <FilmSecond fps={m.fps.value} />
      </div>
      <div className="vk-lane">
        <div className="vk-lane-h">
          <span className="vk-kick">CS2 window</span>
          <SettingControl settingKey={m.window.key}>
            <Segmented options={WINDOW_MODES} value={m.window.value} onChange={(v) => m.window.set(v as WindowMode)} label="Window mode" tip={m.window.tip} optionMarks={WINDOW_MARKS} />
          </SettingControl>
        </div>
        <div className="vk-switches">
          <Switch b={m.sendToBack} label="Send to back on launch" />
        </div>
      </div>
    </div>
  );
}

function SentenceView({ m }: { m: ResolutionModel }) {
  return (
    <div className="vk-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Record at</span>{" "}
          <ChoiceToken
            label="Resolution"
            tip={TIPS.presets}
            popover={
              <>
                <h5>Resolution</h5>
                {m.loaded ? <PresetChoice m={m} /> : <span className="vk-hint">Loading tables…</span>}
              </>
            }
          >
            {m.presetLabel || "a custom size"}
          </ChoiceToken>{" "}
          <span className="w">(</span>
          <NumWord n={m.width} id="rs-width" unit="" /> <span className="w">by</span> <NumWord n={m.height} id="rs-height" unit="" />
          <span className="w">{` pixels, ${m.aspect})`}</span>
          <span className="w">,</span>{" "}
          <SettingControl settingKey={m.fps.key}>
            <ChoiceToken
              label="FPS"
              tone="alt"
              tip={m.fps.tip}
              popover={
                <>
                  <h5>Frames per second</h5>
                  <Segmented options={m.fps.options.map(String)} value={String(m.fps.value)} onChange={(v) => m.fps.set(Number(v))} label="FPS" tip={m.fps.tip} />
                </>
              }
            >
              {m.fps.value}
            </ChoiceToken>
          </SettingControl>{" "}
          <span className="w">frames a second.</span>
        </div>
        <div className="sc-line">
          <span className="w">Open CS2</span>{" "}
          <ChoiceWord c={m.window} words={Object.fromEntries(WINDOW_MODES.map((w) => [w, WINDOW_WORDS[w].words]))} tone="alt" />{" "}
          <span className="w">and</span> <BoolWord b={m.sendToBack} on="send it behind other windows" off="leave it in front" />
          <span className="w">.</span>
        </div>
      </div>
    </div>
  );
}

/** A preset as a screen whose size follows its width (the largest fills the thumb). */
function presetArt(width: number, height: number, widest: number) {
  const w = 20 + 70 * (width / widest);
  const h = w * (height / width);
  return (
    <svg viewBox="0 0 100 66" aria-hidden="true">
      <rect x={50 - w / 2} y={33 - h / 2} width={w} height={h} rx={3} className="rs-art-screen" />
    </svg>
  );
}

const WINDOW_ART: Record<WindowMode, ReactNode> = {
  none: (
    <svg viewBox="0 0 100 66" aria-hidden="true">
      <rect x="18" y="12" width="64" height="42" rx="3" className="rs-art-ghost" />
      <text x="50" y="38" className="rs-art-word">
        as is
      </text>
    </svg>
  ),
  fullscreen: (
    <svg viewBox="0 0 100 66" aria-hidden="true">
      <rect x="6" y="6" width="88" height="54" rx="3" className="rs-art-screen" />
    </svg>
  ),
  windowed: (
    <svg viewBox="0 0 100 66" aria-hidden="true">
      <rect x="6" y="6" width="88" height="54" rx="3" className="rs-art-desk" />
      <rect x="20" y="14" width="56" height="38" rx="2" className="rs-art-screen" />
      <rect x="20" y="14" width="56" height="7" rx="2" className="rs-art-bar" />
    </svg>
  ),
  noborder: (
    <svg viewBox="0 0 100 66" aria-hidden="true">
      <rect x="6" y="6" width="88" height="54" rx="3" className="rs-art-desk" />
      <rect x="20" y="14" width="56" height="38" className="rs-art-screen" />
    </svg>
  ),
};

const WINDOW_OPTIONS: readonly PictureOption<WindowMode>[] = WINDOW_MODES.map((value) => ({
  value,
  title: WINDOW_WORDS[value].title,
  subtitle: value,
  art: WINDOW_ART[value],
  color: "var(--cam-k)",
}));

function TilesView({ m }: { m: ResolutionModel }) {
  const widest = Math.max(1, ...m.presets.map((r) => r.width));
  const presetOptions: PictureOption<string>[] = m.presets.map((r) => ({
    value: r.label,
    title: r.label,
    subtitle: `${r.height}p`,
    art: presetArt(r.width, r.height, widest),
    color: "var(--cam-k)",
    tip: TIPS.presets,
  }));
  const fpsOptions: PictureOption<string>[] = m.fps.options.map((fps) => ({
    value: String(fps),
    title: `${fps} fps`,
    subtitle: fps >= 120 ? "for slow motion" : fps >= 60 ? "smooth" : "light",
    art: (
      <svg viewBox="0 0 100 66" aria-hidden="true">
        {filmCells(fps).map((i, _, all) => (
          <rect key={i} x={6 + (i * 88) / all.length} y={20} width={88 / all.length - 1.5} height={26} rx={1.5} className="rs-art-frame" />
        ))}
      </svg>
    ),
    color: "var(--cam-v)",
    tip: m.fps.tip,
  }));
  return (
    <div className="vk-c rs-c">
      <SettingControl settingKey="width">
        <SettingControl settingKey="height">
          <div className="vk-pics rs-pics" title={TIPS.presets}>
            <PictureChoice label="Resolution" options={presetOptions} value={m.presetLabel} onChange={m.choosePreset} />
          </div>
        </SettingControl>
      </SettingControl>
      <div className="vk-tiles four">
        <NumTile n={m.width} icon={GLYPHS.screen} caption={m.presetLabel ? "preset" : "custom"} />
        <NumTile n={m.height} icon={GLYPHS.screen} caption={m.aspect} />
        <BoolTile b={m.sendToBack} icon={GLYPHS.back} subtitle="CS2 opens behind" />
        <div className="rs-exact">
          <span className="vk-kick">Exact size</span>
          <ExactBox n={m.width} id="rs-width-exact" label="W" />
          <ExactBox n={m.height} id="rs-height-exact" label="H" />
        </div>
      </div>
      <SettingControl settingKey={m.fps.key}>
        <div className="vk-pics rs-pics" title={m.fps.tip}>
          <PictureChoice label="FPS" options={fpsOptions} value={String(m.fps.value)} onChange={(v) => m.fps.set(Number(v))} />
        </div>
      </SettingControl>
      <SettingControl settingKey={m.window.key}>
        <div className="vk-pics rs-pics" title={m.window.tip}>
          <PictureChoice label="Window mode" options={WINDOW_OPTIONS} value={m.window.value} onChange={m.window.set} />
        </div>
      </SettingControl>
    </div>
  );
}

const VIEWS: Views<ResolutionModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function ResolutionCard(grid: GridProps) {
  const m = useResolution();
  return (
    <StyledCard
      id="resolution"
      title="Resolution, Framerate &amp; Window"
      icon={<ICONS.resolution />}
      prefix="rs"
      m={m}
      views={VIEWS}
      count={`${m.width.value}x${m.height.value} · ${m.fps.value} fps`}
      grid={grid}
    />
  );
}
