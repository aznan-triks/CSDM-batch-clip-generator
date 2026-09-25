/**
 * The Recording System card: HLAE or CS2's own `startmovie`, drawn in its
 * style (read live) over one model.
 *
 *   - timeline: the two recording chains side by side, the chosen one lit;
 *     a chain IS the choice (L7, marked here only, in `ChainChoice`);
 *   - sentence: one sentence, the system a word;
 *   - tiles: the two chains as pictures.
 *
 * `VideoTab` reads the same key to mount HLAE Options only in HLAE mode.
 */
import type { GridProps } from "../../components/cardstyle/gridProps";
import { PictureChoice, type PictureOption } from "../../components/cardstyle/IconTile";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import StyledCard, { type Views } from "../videoKit/StyledCard";
import { ChoiceWord } from "../videoKit/parts";
import { useChoice, type ChoiceSetting } from "../videoKit/settings";
import "./RecordingSystem.css";

/** `RECSYS_OPTIONS`, exactly as the engine lists them. */
export const RECSYS_OPTIONS = ["HLAE", "CS"] as const;
export type Recsys = (typeof RECSYS_OPTIONS)[number];

const TIP = "Recording backend: HLAE (advanced features & effects) or CS native startmovie";

/** Each system's chain, in the order the recording goes through it. */
const CHAINS: Record<Recsys, { title: string; words: string; steps: string[] }> = {
  HLAE: { title: "HLAE", words: "HLAE, injected into CS2", steps: ["CSDM", "HLAE", "CS2", "video"] },
  CS: { title: "CS native", words: "CS2's own startmovie", steps: ["CSDM", "CS2 startmovie", "video"] },
};

type RecordingSystemModel = ChoiceSetting<Recsys>;

function Hint() {
  return (
    <p className="vk-hint">
      HLAE = injects via HLAE into CS2 (recommended -- full options). CS = native CSDM recording via CS2&apos;s startmovie
      command. HLAE-exclusive features (custom FOV, AFX streams, No spectator UI, Fix scope FOV) are not available in CS
      mode; CS2 effects (physics, gravity, blood) are injected in both modes.
    </p>
  );
}

function Chain({ system }: { system: Recsys }) {
  return (
    <span className="rsys-chain" aria-hidden="true">
      {CHAINS[system].steps.map((step, i) => (
        <span className="rsys-step-wrap" key={step}>
          {i > 0 && <i className="rsys-link" />}
          <span className={step === "HLAE" ? "rsys-step hlae" : "rsys-step"}>{step}</span>
        </span>
      ))}
    </span>
  );
}

/** The two chains as one radio group: clicking a chain picks that system. */
function ChainChoice({ m }: { m: RecordingSystemModel }) {
  return (
    <SettingControl settingKey={m.key}>
      <div className="rsys-lanes" role="radiogroup" aria-label="System" title={m.tip}>
        {RECSYS_OPTIONS.map((system) => (
          <button
            key={system}
            type="button"
            role="radio"
            aria-checked={m.value === system}
            aria-label={system}
            className={m.value === system ? "rsys-lane on" : "rsys-lane"}
            data-action="L7"
            onClick={() => m.set(system)}
          >
            <b>{CHAINS[system].title}</b>
            <Chain system={system} />
          </button>
        ))}
      </div>
    </SettingControl>
  );
}

function TimelineView({ m }: { m: RecordingSystemModel }) {
  return (
    <div className="vk-a">
      <ChainChoice m={m} />
      <Hint />
    </div>
  );
}

function SentenceView({ m }: { m: RecordingSystemModel }) {
  return (
    <div className="vk-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Record through</span>{" "}
          <ChoiceWord c={m} words={{ HLAE: CHAINS.HLAE.words, CS: CHAINS.CS.words }} />
          <span className="w">.</span>
        </div>
      </div>
      <Hint />
    </div>
  );
}

const PICTURES: readonly PictureOption<Recsys>[] = RECSYS_OPTIONS.map((system) => ({
  value: system,
  title: CHAINS[system].title,
  subtitle: system === "HLAE" ? "full options" : "no HLAE extras",
  art: (
    <svg viewBox="0 0 100 66" aria-hidden="true">
      {CHAINS[system].steps.map((step, i, all) => {
        const w = 84 / all.length;
        return <rect key={step} x={8 + i * w} y={24} width={w - 6} height={18} rx={4} className={step === "HLAE" ? "rsys-art-hlae" : "rsys-art-step"} />;
      })}
    </svg>
  ),
  color: system === "HLAE" ? "var(--cam-k)" : "var(--cam-v)",
  tip: TIP,
}));

function TilesView({ m }: { m: RecordingSystemModel }) {
  return (
    <div className="vk-c">
      <SettingControl settingKey={m.key}>
        <div className="vk-pics rsys-pics" title={m.tip}>
          <PictureChoice label="System" options={PICTURES} value={m.value} onChange={m.set} />
        </div>
      </SettingControl>
      <Hint />
    </div>
  );
}

const VIEWS: Views<RecordingSystemModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export function useRecordingSystem(): RecordingSystemModel {
  return useChoice("recsys", RECSYS_OPTIONS, "HLAE", "System", TIP);
}

export default function RecordingSystemCard(grid: GridProps) {
  const m = useRecordingSystem();
  return (
    <StyledCard id="recording-system" title="Recording System" icon={<ICONS.recordingSystem />} prefix="rsys" m={m} views={VIEWS} count={m.value} grid={grid} />
  );
}
