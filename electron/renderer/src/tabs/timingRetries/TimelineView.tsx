/**
 * Timing & Retries, "timeline" style: the batch drawn as it runs.
 *
 *   - a failed recording, then one retry block per retry, each after its wait
 *     (the wait's width follows its seconds);
 *   - demos in a row with the pause between them, numbered in the order they
 *     are recorded -- shuffled when the order is random.
 *
 * Every number in the track is the control: drag it sideways, scroll it, or
 * click it for its slider and exact box.
 */
import Segmented from "../../components/Segmented";
import SettingControl from "../../settings/SettingControl";
import { CountWord, GLYPHS } from "./shared";
import { CLIP_ORDERS, type TimingRetriesModel } from "./useTimingRetries";

/** A small mark before each order word: dated steps, or crossing arrows. */
const ORDER_MARKS = { chrono: <i className="tr-om">↦</i>, random: <i className="tr-om">⤮</i> };

/** Retry blocks drawn before the rest folds into "…". */
const SHOWN_RETRIES = 2;
/** The recording order of four demos, as drawn for each order. */
const DEMO_SEQUENCE = { chrono: [1, 2, 3], random: [3, 1, 2] } as const;

/** A wait's width: grows with its seconds, never thinner than its number. */
function gapGrow(seconds: number): number {
  return 1 + Math.min(seconds, 60) / 15;
}

export default function TimelineView({ m }: { m: TimingRetriesModel }) {
  const shown = Math.min(m.retries.value, SHOWN_RETRIES);
  const folded = m.retries.value - shown;
  return (
    <div className="tr-a">
      <div className="tr-lane" aria-label="If a recording fails">
        <div className="tr-lane-h">
          <span className="tr-kick">If a recording fails</span>
          <CountWord n={m.retries} label="Retries" unit={m.retries.value === 1 ? " retry" : " retries"} />
        </div>
        <div className="tr-track">
          <span className="tr-blk fail" title="A recording that failed">
            {GLYPHS.fail}
          </span>
          {/* No retry: one ghost step, so the wait stays set for when retries return. */}
          {Array.from({ length: Math.max(shown, 1) }, (_, i) => (
            <span
              className={shown ? "tr-step" : "tr-step ghost"}
              key={i}
              style={{ flexGrow: gapGrow(m.retryDelay.value) }}
            >
              <span className="tr-gap">
                {i === 0 ? <CountWord n={m.retryDelay} label="Wait between" /> : <i>{m.retryDelay.value}s</i>}
              </span>
              <span className="tr-blk retry" title={shown ? `Retry ${i + 1}` : "No retry: the demo is marked failed"}>
                {GLYPHS.retry}
              </span>
            </span>
          ))}
          {folded > 0 && <span className="tr-more">+{folded}</span>}
        </div>
        <div className="tr-stuck">
          <span className="tr-stuck-ic">{GLYPHS.stuck}</span>
          <span className="w">Stop if stuck after</span>
          <CountWord n={m.timeout} label="Stop if stuck" />
          {m.timeout.value === 0 && <span className="w">= automatic</span>}
        </div>
      </div>

      <div className="tr-lane" aria-label="Between demos">
        <div className="tr-lane-h">
          <span className="tr-kick">Between demos</span>
          <SettingControl settingKey={m.order.key}>
            <Segmented
              options={CLIP_ORDERS}
              value={m.order.value}
              onChange={(v) => m.order.set(v as (typeof CLIP_ORDERS)[number])}
              label="Demo order"
              tip={m.order.tip}
              optionMarks={ORDER_MARKS}
            />
          </SettingControl>
        </div>
        <div className="tr-track">
          {DEMO_SEQUENCE[m.order.value].map((n, i) => (
            <span className="tr-step" key={n} style={{ flexGrow: i === 0 ? 0 : gapGrow(m.demoPause.value) }}>
              {i > 0 && (
                <span className="tr-gap pause">
                  {i === 1 ? <CountWord n={m.demoPause} label="Pause" tone="alt" /> : <i>{m.demoPause.value}s</i>}
                </span>
              )}
              <span className="tr-blk demo" title={`Demo recorded ${i + 1}${["st", "nd", "rd"][i]}`}>
                {GLYPHS.demo}
                <b>{n}</b>
              </span>
            </span>
          ))}
        </div>
      </div>

      <p className="capture-hint" data-testid="pacing-summary">
        {m.summary}
      </p>
    </div>
  );
}
