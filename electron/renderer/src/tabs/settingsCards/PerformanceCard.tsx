/**
 * Performance: how many threads pre-parse the demos (`dp2_threads`).
 *
 *   - timeline: one block per thread -- click the block to run that many;
 *   - sentence: "Pre-parse demos on <4 threads> at once.";
 *   - tiles: one big number tile.
 */
import type { ReactNode } from "react";

import Slider from "../../components/Slider";
import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import { NumberToken } from "../../components/cardstyle/SentenceToken";
import SmallCardCountTile from "../../components/cardstyle/SmallCardCountTile";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import { asNumber } from "../../settings/asNumber";
import { useSetting } from "../../settings/store";
import { Glyph } from "./shared";
import "../../components/cardstyle/SmallCard.css";
import "./SettingsCards.css";

/** The thread range the window offered. */
const THREADS = { min: 1, max: 8, fallback: 4 } as const;

const TIP =
  "Number of parallel threads used to pre-parse demo files with demoparser2 (TROIS SHOT / ONE TAP / TROIS TAP filters). Higher = faster pre-parse on multi-core CPUs. Set to 1 to disable.";

interface PerformanceModel {
  key: string;
  value: number;
  set: (value: number) => void;
}

function usePerformance(): PerformanceModel {
  const [raw, set] = useSetting<number>("dp2_threads");
  const value = Math.max(THREADS.min, Math.min(THREADS.max, Math.round(asNumber(raw, THREADS.fallback))));
  return { key: "dp2_threads", value, set: (n) => set(Math.max(THREADS.min, Math.min(THREADS.max, Math.round(n)))) };
}

/** The setting's marker (the inventory's M11), around whichever control a style draws. */
function Threads({ m, children }: { m: PerformanceModel; children: ReactNode }) {
  return (
    <SettingControl settingKey={m.key}>
      <div data-action="M11" style={{ display: "contents" }}>
        {children}
      </div>
    </SettingControl>
  );
}

function Hint() {
  return <p className="settings-hint">{TIP}</p>;
}

function TimelineView({ m }: { m: PerformanceModel }) {
  const cores = Array.from({ length: THREADS.max }, (_, i) => i + 1);
  return (
    <div className="pf-a">
      <Threads m={m}>
        <div className="pf-cores" role="radiogroup" aria-label="DP2 parse threads" title={TIP}>
          {cores.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === m.value}
              aria-label={`${n} thread${n === 1 ? "" : "s"}`}
              className={n <= m.value ? "pf-core on" : "pf-core"}
              onClick={() => m.set(n)}
            >
              <Glyph g="cpu" />
              <b>{n}</b>
            </button>
          ))}
        </div>
      </Threads>
      <p className="pf-read">
        <b>{m.value}</b> thread{m.value === 1 ? " -- parallel pre-parse off" : "s in parallel"}
      </p>
      <Hint />
    </div>
  );
}

function SentenceView({ m }: { m: PerformanceModel }) {
  return (
    <div className="pf-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Pre-parse demos on</span>{" "}
          <Threads m={m}>
            <NumberToken
              value={m.value}
              min={THREADS.min}
              max={THREADS.max}
              unit={m.value === 1 ? " thread" : " threads"}
              label="DP2 parse threads"
              tip={TIP}
              onChange={m.set}
              popover={
                <>
                  <h5>DP2 parse threads</h5>
                  <Slider id="dp2-threads" label="DP2 parse threads" min={THREADS.min} max={THREADS.max} value={m.value} onChange={m.set} tip={TIP} />
                </>
              }
            />
          </Threads>{" "}
          <span className="w">{m.value === 1 ? "(one at a time)." : "at once."}</span>
        </div>
      </div>
      <Hint />
    </div>
  );
}

function TilesView({ m }: { m: PerformanceModel }) {
  return (
    <div className="pf-c">
      <Threads m={m}>
        <SmallCardCountTile
          icon={<Glyph g="cpu" />}
          title="DP2 parse threads"
          value={m.value}
          unit=""
          min={THREADS.min}
          max={THREADS.max}
          special={{ value: 1, word: "off" }}
          caption="demos pre-parsed at once"
          tip={TIP}
          onChange={m.set}
        />
      </Threads>
      <Hint />
    </div>
  );
}

const VIEWS: CardViews<PerformanceModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function PerformanceCard(grid: GridProps) {
  const m = usePerformance();
  return <StyledCard cardId="performance" title="Performance" icon={<ICONS.performance />} prefix="pf" m={m} views={VIEWS} grid={grid} count={`${m.value} threads`} />;
}
