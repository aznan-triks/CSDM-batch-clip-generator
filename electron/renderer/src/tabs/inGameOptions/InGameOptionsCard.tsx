/**
 * The In-Game Options card: what the recorded picture shows, drawn in its
 * style (read live) over one model.
 *
 *   - timeline: the game screen as it will be filmed -- HUD, kill feed (its
 *     duration on it), X-ray outlines -- switches under it;
 *   - sentence: the same as words;
 *   - tiles: one tile per switch, a number tile for the feed duration.
 */
import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import StyledCard, { type Views } from "../videoKit/StyledCard";
import { GLYPHS } from "../videoKit/glyphs";
import { BoolTile, BoolWord, NumTile, NumWord, Switch } from "../videoKit/parts";
import { useBool, useNum, type BoolSetting, type NumSetting } from "../videoKit/settings";
import "./InGameOptions.css";

const TIPS = {
  trueView: "Enables CS2's TrueView free spectator camera (clean, HUD-free footage) for recording",
  deathNoticesOnly: "Hides all HUD elements except the kill-feed (death notices) during recording",
  xray: "Highlights enemy players through walls/smoke with colored outlines (spectator X-ray)",
  duration: "How long each kill-feed entry stays visible on screen, in seconds",
  closeAfter: "Automatically exits CS2 after each demo completes to free system resources",
} as const;

export interface InGameOptionsModel {
  trueView: BoolSetting;
  deathNoticesOnly: BoolSetting;
  xray: BoolSetting;
  duration: NumSetting;
  closeAfter: BoolSetting;
}

export function useInGameOptions(): InGameOptionsModel {
  return {
    trueView: useBool("true_view", "TrueView", TIPS.trueView),
    deathNoticesOnly: useBool("show_only_death_notices", "Death notices only", TIPS.deathNoticesOnly),
    xray: useBool("show_xray", "X-Ray", TIPS.xray),
    duration: useNum("death_notices_duration", {
      label: "Death notices",
      unit: "s",
      min: 1,
      max: 30,
      decimals: 1,
      fallback: 5,
      tip: TIPS.duration,
    }),
    closeAfter: useBool("close_game_after", "Close CS2 after each demo", TIPS.closeAfter),
  };
}

/** The filmed screen: HUD pieces, the kill feed, two players behind a wall. */
function GameScreen({ m }: { m: InGameOptionsModel }) {
  const hud = !m.deathNoticesOnly.on;
  return (
    <div className={["ig-screen", hud ? "hud" : null, m.xray.on ? "xray" : null].filter(Boolean).join(" ")}>
      <span className="ig-radar" aria-hidden="true" />
      <span className="ig-hp" aria-hidden="true">
        100
      </span>
      <span className="ig-ammo" aria-hidden="true">
        30 / 90
      </span>
      <span className="ig-wall" aria-hidden="true" />
      <span className="ig-man a" aria-hidden="true">
        {GLYPHS.ragdoll}
      </span>
      <span className="ig-feed">
        <i aria-hidden="true">you ✕ enemy</i>
        <i aria-hidden="true">mate ✕ enemy</i>
        <span className="ig-stay">
          <span className="w">stays</span>
          <NumWord n={m.duration} id="ig-duration" />
        </span>
      </span>
      {m.trueView.on && <span className="ig-badge">TrueView</span>}
    </div>
  );
}

function TimelineView({ m }: { m: InGameOptionsModel }) {
  return (
    <div className="vk-a">
      <GameScreen m={m} />
      <div className="vk-switches">
        <Switch b={m.trueView} />
        <Switch b={m.deathNoticesOnly} />
        <Switch b={m.xray} />
      </div>
      <div className="vk-lane-h ig-after">
        <span className="vk-kick">After each demo</span>
        <Switch b={m.closeAfter} label="Close CS2" />
      </div>
    </div>
  );
}

function SentenceView({ m }: { m: InGameOptionsModel }) {
  return (
    <div className="vk-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Film</span> <BoolWord b={m.trueView} on="through TrueView" off="without TrueView" />
          <span className="w">, with</span>{" "}
          <BoolWord b={m.deathNoticesOnly} on="only the kill feed" off="the whole HUD" tone="alt" />{" "}
          <span className="w">on screen and X-ray</span> <BoolWord b={m.xray} on="on" off="off" />
          <span className="w">.</span>
        </div>
        <div className="sc-line">
          <span className="w">Each kill stays</span> <NumWord n={m.duration} id="ig-duration" tone="alt" />{" "}
          <span className="w">in the feed.</span>
        </div>
        <div className="sc-line">
          <BoolWord b={m.closeAfter} on="Close" off="Keep" /> <span className="w">CS2 after each demo.</span>
        </div>
      </div>
    </div>
  );
}

function TilesView({ m }: { m: InGameOptionsModel }) {
  return (
    <div className="vk-c">
      <div className="vk-tiles">
        <BoolTile b={m.trueView} icon={GLYPHS.eye} subtitle="free spectator camera" />
        <BoolTile b={m.deathNoticesOnly} icon={GLYPHS.feed} subtitle="HUD hidden but the feed" />
        <BoolTile b={m.xray} icon={GLYPHS.xray} subtitle="players through walls" />
        <BoolTile b={m.closeAfter} icon={GLYPHS.close} subtitle="after each demo" />
      </div>
      <NumTile n={m.duration} icon={GLYPHS.timer} caption="each kill in the feed" />
    </div>
  );
}

const VIEWS: Views<InGameOptionsModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function InGameOptionsCard(grid: GridProps) {
  const m = useInGameOptions();
  return <StyledCard id="in-game-options" title="In-Game Options" icon={<ICONS.inGameOptions />} prefix="ig" m={m} views={VIEWS} grid={grid} />;
}
