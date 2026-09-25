/**
 * The HLAE Options card -- HLAE-exclusive settings, drawn in its style (read
 * live) over one model. `VideoTab` mounts it only while `recsys` is HLAE:
 * the mirv_* commands it writes do not apply in CS mode.
 *
 *   - timeline: the camera's cone opened to its FOV, one match second
 *     stretched or squeezed by the game speed, the three switches;
 *   - sentence: the same as words;
 *   - tiles: two number tiles and three on/off tiles.
 *
 * The game speed row (L8) and its shortcut values (L6) are marked here only.
 */
import type { ReactNode } from "react";

import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import StyledCard, { type Views } from "../videoKit/StyledCard";
import { GLYPHS } from "../videoKit/glyphs";
import { BoolTile, BoolWord, NumTile, NumWord, QuickChips, Switch, TextRow, TextWord } from "../videoKit/parts";
import { useHlaeOptions, type HlaeOptionsModel } from "./useHlaeOptions";
import "./HlaeOptions.css";

/** The game speed row's parity marker, around whatever draws it. */
function SpeedRow({ children }: { children: ReactNode }) {
  return (
    <div className="hl-speedrow" data-action="L8">
      {children}
    </div>
  );
}

function Hint() {
  return (
    <p className="vk-hint">
      Passed to HLAE via CSDM. Not available in CS recording mode. Audio captured directly by HLAE (bypasses Windows mixer).
    </p>
  );
}

/** The camera seen from above: its cone opened to the FOV. */
function FovCone({ fov }: { fov: number }) {
  const half = (Math.max(1, Math.min(179, fov)) / 2) * (Math.PI / 180);
  const r = 60;
  const [x, y] = [10 + r * Math.cos(half), 36 - r * Math.sin(half)];
  const y2 = 36 + r * Math.sin(half);
  return (
    <svg className="hl-cone" viewBox="0 0 80 72" aria-hidden="true">
      <path d={`M10 36 L${x} ${y} A${r} ${r} 0 0 1 ${x} ${y2} Z`} className="hl-cone-fill" />
      <circle cx="10" cy="36" r="4" className="hl-cone-eye" />
    </svg>
  );
}

function TimelineView({ m }: { m: HlaeOptionsModel }) {
  // How long one match second lasts in the recording, as a share of the lane.
  const stretch = Math.min(1, 100 / Math.max(1, m.speed.value) / 4);
  return (
    <div className="vk-a">
      <div className="hl-grid">
        <div className="vk-lane">
          <div className="vk-lane-h">
            <span className="vk-kick">Field of view</span>
            <NumWord n={m.fov} id="hl-fov" />
          </div>
          <div className="vk-track hl-fov">
            <FovCone fov={m.fov.value} />
            <small>{m.fovWords}</small>
          </div>
        </div>
        <SpeedRow>
          <div className="vk-lane">
            <div className="vk-lane-h">
              <span className="vk-kick">Game speed</span>
              <NumWord n={m.speed} id="hl-speed" tone="alt" dataAction="L6" />
            </div>
            <div className="vk-track hl-speed">
              <span className="hl-sec">
                <i style={{ width: "25%" }} />
                <small>1 s of match</small>
              </span>
              <span className="hl-sec rec">
                <i style={{ width: `${stretch * 100}%` }} />
                <small>{m.speedWords}</small>
              </span>
            </div>
            <QuickChips n={m.speed} dataAction="L6" />
          </div>
        </SpeedRow>
      </div>
      <div className="vk-switches">
        <Switch b={m.afx} />
        <Switch b={m.noSpectatorUi} />
        <Switch b={m.fixScopeFov} />
      </div>
      <TextRow t={m.extraArgs} id="hl-extra-args" mono />
      <Hint />
    </div>
  );
}

function SentenceView({ m }: { m: HlaeOptionsModel }) {
  return (
    <div className="vk-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Film with a</span> <NumWord n={m.fov} id="hl-fov" /> <span className="w">field of view, at</span>{" "}
          <SpeedRow>
            <NumWord n={m.speed} id="hl-speed" tone="alt" dataAction="L6" />
          </SpeedRow>{" "}
          <span className="w">game speed ({m.speedWords}).</span>
        </div>
        <div className="sc-line">
          <BoolWord b={m.afx} on="Record" off="Skip" /> <span className="w">AFX streams,</span>{" "}
          <BoolWord b={m.noSpectatorUi} on="hide" off="show" /> <span className="w">the spectator UI and</span>{" "}
          <BoolWord b={m.fixScopeFov} on="fix" off="don't fix" tone="alt" /> <span className="w">the scope FOV.</span>
        </div>
        <div className="sc-line">
          <span className="w">Also pass HLAE</span> <TextWord t={m.extraArgs} id="hl-extra-args" empty="no extra args" mono />
          <span className="w">.</span>
        </div>
      </div>
      <Hint />
    </div>
  );
}

function TilesView({ m }: { m: HlaeOptionsModel }) {
  return (
    <div className="vk-c">
      <div className="vk-tiles">
        <NumTile n={m.fov} icon={GLYPHS.fov} caption={m.fovWords} />
        <SpeedRow>
          <NumTile n={m.speed} icon={GLYPHS.speed} caption={m.speedWords} dataAction="L6" />
        </SpeedRow>
      </div>
      <div className="vk-tiles three">
        <BoolTile b={m.afx} icon={GLYPHS.layers} subtitle="colour / depth passes" code="AFX" />
        <BoolTile b={m.noSpectatorUi} icon={GLYPHS.hud} subtitle="kill feed only" />
        <BoolTile b={m.fixScopeFov} icon={GLYPHS.scope} subtitle="scopes keep your FOV" />
      </div>
      <TextRow t={m.extraArgs} id="hl-extra-args" mono />
      <Hint />
    </div>
  );
}

const VIEWS: Views<HlaeOptionsModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function HlaeOptionsCard(grid: GridProps) {
  const m = useHlaeOptions();
  return (
    <StyledCard
      id="hlae-options"
      title="HLAE Options"
      icon={<ICONS.hlaeOptions />}
      prefix="hl"
      m={m}
      views={VIEWS}
      count={`${m.fov.value}° · ${m.speed.value}%`}
      grid={grid}
    />
  );
}
