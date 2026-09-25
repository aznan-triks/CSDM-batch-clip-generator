/**
 * Demo Selection, style B: the card reads as plain English. The range is a
 * word you open, the dates sit in the sentence, and so does how the demos
 * are picked.
 */
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import { ClearAll, DateFrom, DateTo, ManualMode, Picker, Shortcuts } from "./parts";
import { DEMO_TIPS, SHORTCUT_WORDS, type DemoSelectionModel } from "./useDemoSelection";

/** The range in words: a shortcut's phrase, the two dates, or "at any time". */
function rangeWords(m: DemoSelectionModel): string {
  if (m.activeShortcut) return SHORTCUT_WORDS[m.activeShortcut.label];
  if (m.from && m.to) return `between ${m.from.slice(0, 5)} and ${m.to.slice(0, 5)}`;
  if (m.from) return `since ${m.from}`;
  if (m.to) return `until ${m.to}`;
  return SHORTCUT_WORDS.All;
}

export default function SentenceView({ m }: { m: DemoSelectionModel }) {
  return (
    <div className="ds-b">
      <p className="ds-line">
        Use the demos played{" "}
        <ChoiceToken
          label="Date range"
          tip="Pick a ready-made date range"
          popover={
            <>
              <h5>Quick ranges</h5>
              <div className="chips">
                <Shortcuts m={m} />
              </div>
              <ClearAll m={m} />
            </>
          }
        >
          {rangeWords(m)}
        </ChoiceToken>
      </p>
      <div className="ds-line ds-dates">
        <span>from</span>
        <DateFrom m={m} label="" />
        <span>to</span>
        <DateTo m={m} label="" />
      </div>
      <p className="ds-line">
        and pick them{" "}
        <ChoiceToken
          label="Demo selection"
          tone="alt"
          tip={DEMO_TIPS.manual}
          popover={
            <>
              <h5>Demo selection</h5>
              <div className="chips">
                <ManualMode m={m} />
              </div>
              <small>Off: the date range above picks the demos. On: every demo in the database, ticked by hand.</small>
            </>
          }
        >
          {m.manualMode ? "by hand, from every demo" : "from that range"}
        </ChoiceToken>
        .
      </p>
      <Picker m={m} />
    </div>
  );
}
