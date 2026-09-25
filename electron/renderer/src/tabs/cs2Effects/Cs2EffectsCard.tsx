/**
 * The CS2 Effects card -- physics and visuals shared by both recording modes
 * (mounted in HLAE and CS mode alike), drawn in its style (read live).
 *
 *   - timeline: one lane per gravity, its shortcut values laid out as a
 *     ruler from lowest to highest, an arrow showing which way bodies go;
 *     the three switches under them;
 *   - sentence: the same as words;
 *   - tiles: three number tiles (shortcuts under each), three on/off tiles.
 *
 * The three numbers are stored as numbers: the engine reads them with
 * `int()` / `float()` and clamps them (gravity -5000..5000, scale -10..10).
 */
import type { GridProps } from "../../components/cardstyle/gridProps";
import { formatStep } from "../../components/cardstyle/numberStep";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import StyledCard, { type Views } from "../videoKit/StyledCard";
import { GLYPHS } from "../videoKit/glyphs";
import { BoolTile, BoolWord, NumTile, NumWord, Switch } from "../videoKit/parts";
import { useBool, useNum, type BoolSetting, type NumSetting } from "../videoKit/settings";
import "./Cs2Effects.css";

const TIPS = {
  ragGravity: "CS2 console command cl_ragdoll_gravity: gravity applied to ragdolls after death",
  ragScale: "Multiplier on ragdoll gravity: 1.0 = normal, 0 = weightless, negative = floats upward",
  svGravity: "Server-wide gravity affecting all physics: players, ragdolls, dropped weapons (default 800)",
  ragdoll: "Enables ragdoll death physics; required for the gravity/scale values above to have any effect",
  blood: "CS2 console command r_drawdecals: show blood and bullet impact decals on walls",
  lighting: "CS2 dynamic lighting and shadows on models and environment",
} as const;

/** The shortcut values, copied from the window's own rows; the fields stay free-form. */
const QUICK = {
  ragGravity: [600, 200, 0, -200, -500, 2000, 5000],
  ragScale: [1.0, 0.5, 0.1, 0.0, 2.0, 3.0],
  svGravity: [800, 400, 200, 100, 1200, 2000],
} as const;

export interface Cs2EffectsModel {
  ragGravity: NumSetting;
  ragScale: NumSetting;
  svGravity: NumSetting;
  ragdoll: BoolSetting;
  blood: BoolSetting;
  lighting: BoolSetting;
}

/** Each number's console command, shown beside it. */
const COMMANDS: Record<"ragGravity" | "ragScale" | "svGravity", string> = {
  ragGravity: "cl_ragdoll_gravity",
  ragScale: "ragdoll_gravity_scale",
  svGravity: "sv_gravity",
};

export function useCs2Effects(): Cs2EffectsModel {
  return {
    ragGravity: useNum("phys_ragdoll_gravity", {
      label: "Ragdoll gravity",
      min: -5000,
      max: 5000,
      step: 50,
      fallback: 600,
      tip: TIPS.ragGravity,
      quick: QUICK.ragGravity,
    }),
    ragScale: useNum("phys_ragdoll_scale", {
      label: "Ragdoll scale",
      unit: "x",
      min: -3,
      max: 3,
      step: 0.1,
      decimals: 2,
      fallback: 1,
      tip: TIPS.ragScale,
      quick: QUICK.ragScale,
    }),
    svGravity: useNum("phys_sv_gravity", {
      label: "World gravity",
      min: -5000,
      max: 5000,
      step: 50,
      fallback: 800,
      tip: TIPS.svGravity,
      quick: QUICK.svGravity,
    }),
    ragdoll: useBool("phys_ragdoll_enable", "Ragdoll physics", TIPS.ragdoll),
    blood: useBool("phys_blood", "Blood on walls", TIPS.blood),
    lighting: useBool("phys_dynamic_lighting", "Dynamic lighting", TIPS.lighting),
  };
}

function Hint() {
  return (
    <p className="vk-hint">
      Vanilla CS2 commands shared by both recording modes. Non-default values are injected as CS2 console commands on
      startup.
    </p>
  );
}

/** Which way, and how hard, bodies are pulled: down for positive gravity, up for negative. */
function PullArrow({ pull }: { pull: number }) {
  const len = Math.min(1, Math.abs(pull)) * 18;
  const up = pull < 0;
  return (
    <svg className="fx-pull" viewBox="0 0 24 48" aria-hidden="true">
      <circle cx="12" cy="24" r="5" className="fx-pull-body" />
      {len > 0 && <path d={up ? `M12 19V${19 - len}m-4 4l4-4 4 4` : `M12 29V${29 + len}m-4-4l4 4 4-4`} className="fx-pull-arrow" />}
    </svg>
  );
}

/** A number's shortcut values as a ruler, lowest to highest, the current one lit. */
function Ruler({ n }: { n: NumSetting }) {
  const ticks = [...n.quick].sort((a, b) => a - b);
  return (
    <div className="fx-ruler" role="group" aria-label={`${n.label} shortcuts`}>
      {ticks.map((q) => (
        <button
          key={q}
          type="button"
          className={q === n.value ? "fx-tick on" : "fx-tick"}
          title={`Set ${n.label} to ${formatStep(q, n.step)}`}
          onClick={() => n.set(q)}
        >
          {formatStep(q, n.step)}
        </button>
      ))}
    </div>
  );
}

function Lane({ n, id, command, pull, dim }: { n: NumSetting; id: string; command: string; pull: number; dim?: boolean }) {
  return (
    <SettingControl settingKey={n.key}>
      <div className={dim ? "fx-lane dim" : "fx-lane"}>
        <PullArrow pull={pull} />
        <div className="fx-lane-main">
          <div className="vk-lane-h">
            <span className="fx-name">
              <b>{n.label}</b>
              <code>{command}</code>
            </span>
            <NumWord n={n} id={id} />
          </div>
          <Ruler n={n} />
        </div>
      </div>
    </SettingControl>
  );
}

function TimelineView({ m }: { m: Cs2EffectsModel }) {
  const off = !m.ragdoll.on;
  return (
    <div className="vk-a">
      <Hint />
      <div className="fx-lanes">
        <Lane n={m.ragGravity} id="fx-rag-gravity" command={COMMANDS.ragGravity} pull={(m.ragGravity.value * m.ragScale.value) / 600} dim={off} />
        <Lane n={m.ragScale} id="fx-rag-scale" command={COMMANDS.ragScale} pull={m.ragScale.value} dim={off} />
        <Lane n={m.svGravity} id="fx-sv-gravity" command={COMMANDS.svGravity} pull={m.svGravity.value / 800} />
      </div>
      <div className="vk-switches">
        <Switch b={m.ragdoll} />
        <Switch b={m.blood} />
        <Switch b={m.lighting} />
        {off && <span className="vk-warn">ragdoll physics off: the two ragdoll values do nothing</span>}
      </div>
    </div>
  );
}

function SentenceView({ m }: { m: Cs2EffectsModel }) {
  return (
    <div className="vk-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Bodies</span> <BoolWord b={m.ragdoll} on="fall as ragdolls" off="don't ragdoll" />{" "}
          <span className="w">with gravity</span> <NumWord n={m.ragGravity} id="fx-rag-gravity" />{" "}
          <span className="w">scaled by</span> <NumWord n={m.ragScale} id="fx-rag-scale" />
          <span className="w">; the world pulls at</span> <NumWord n={m.svGravity} id="fx-sv-gravity" tone="alt" />
          <span className="w">.</span>
        </div>
        <div className="sc-line">
          <span className="w">Blood</span> <BoolWord b={m.blood} on="stays on walls" off="is hidden" tone="alt" />
          <span className="w">, dynamic lighting</span> <BoolWord b={m.lighting} on="on" off="off" tone="alt" />
          <span className="w">.</span>
        </div>
      </div>
      <Hint />
    </div>
  );
}

function TilesView({ m }: { m: Cs2EffectsModel }) {
  return (
    <div className="vk-c">
      <div className="vk-tiles three">
        <NumTile n={m.ragGravity} icon={GLYPHS.ragdoll} caption={COMMANDS.ragGravity} />
        <NumTile n={m.ragScale} icon={GLYPHS.weight} caption={COMMANDS.ragScale} />
        <NumTile n={m.svGravity} icon={GLYPHS.globe} caption={COMMANDS.svGravity} />
      </div>
      <div className="vk-tiles three">
        <BoolTile b={m.ragdoll} icon={GLYPHS.ragdoll} subtitle="needed by the two ragdoll values" />
        <BoolTile b={m.blood} icon={GLYPHS.blood} subtitle="decals on walls" />
        <BoolTile b={m.lighting} icon={GLYPHS.light} subtitle="lights and shadows" />
      </div>
      <Hint />
    </div>
  );
}

const VIEWS: Views<Cs2EffectsModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function Cs2EffectsCard(grid: GridProps) {
  const m = useCs2Effects();
  return <StyledCard id="cs2-effects" title="CS2 Effects" icon={<ICONS.cs2Effects />} prefix="fx" m={m} views={VIEWS} grid={grid} />;
}
