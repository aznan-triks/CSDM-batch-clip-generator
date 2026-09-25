/**
 * Timing & Retries, "sentence" style: the batch's pacing as two sentences.
 * Every blue or green word is a control; numbers drag sideways or open their
 * slider and exact box.
 */
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import Segmented from "../../components/Segmented";
import SettingControl from "../../settings/SettingControl";
import { CountWord } from "./shared";
import { CLIP_ORDERS, ORDER_WORDS, type ClipOrder, type TimingRetriesModel } from "./useTimingRetries";

export default function SentenceView({ m }: { m: TimingRetriesModel }) {
  const times = m.retries.value === 1 ? " time" : " times";
  return (
    <div className="tr-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">If a recording fails, try again</span> <CountWord n={m.retries} label="Retries" unit={times} />
          <span className="w">,</span> <CountWord n={m.retryDelay} label="Wait between" />{" "}
          <span className="w">apart.</span>
        </div>
        <div className="sc-line">
          <span className="w">Stop one that hangs after</span>{" "}
          <span className="nw">
            <CountWord n={m.timeout} label="Stop if stuck" />
            <span className="w">{m.timeout.value === 0 ? " (automatic)." : "."}</span>
          </span>
        </div>
        <div className="sc-line">
          <span className="w">Record demos in</span>{" "}
          <SettingControl settingKey={m.order.key}>
            <ChoiceToken
              label="Demo order"
              tone="alt"
              tip={m.order.tip}
              popover={
                <>
                  <h5>Demo order</h5>
                  <Segmented
                    options={CLIP_ORDERS}
                    value={m.order.value}
                    onChange={(v) => m.order.set(v as ClipOrder)}
                    label="Demo order"
                    tip={m.order.tip}
                  />
                </>
              }
            >
              {ORDER_WORDS[m.order.value].words}
            </ChoiceToken>
          </SettingControl>{" "}
          <span className="w">with a</span> <CountWord n={m.demoPause} label="Pause" tone="alt" />{" "}
          <span className="w">pause between two.</span>
        </div>
      </div>
    </div>
  );
}
