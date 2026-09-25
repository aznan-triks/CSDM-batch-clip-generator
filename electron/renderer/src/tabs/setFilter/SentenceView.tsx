/**
 * A set-filter card, "sentence" style: "Record every map." / "Record only
 * Mirage, Inferno & Nuke maps." The scope word switches the filter, the list
 * word opens the options. With the filter off the picks stay one line below,
 * greyed but reachable -- the engine keeps them for when it is switched on.
 */
import Chip from "../../components/Chip";
import Segmented from "../../components/Segmented";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import SettingControl from "../../settings/SettingControl";
import { pickedWords, type SetFilterModel } from "./model";
import { ListWrap, OptionWrap } from "./parts";

const SCOPES = ["every", "only"] as const;

export default function SetFilterSentence({ m }: { m: SetFilterModel }) {
  const on = m.enabled.on;
  const scope = (
    <SettingControl settingKey={m.enabled.key}>
      <ChoiceToken
        label={`Filter by ${m.noun.one}`}
        tip={m.enabled.tip}
        popover={
          <>
            <h5>Filter by {m.noun.one}</h5>
            <Segmented
              options={SCOPES}
              value={on ? "only" : "every"}
              onChange={(v) => {
                if ((v === "only") !== on) m.enabled.toggle();
              }}
              label={`Filter by ${m.noun.one}`}
              tip={m.enabled.tip}
            />
          </>
        }
      >
        {on ? "only" : "every"}
      </ChoiceToken>
    </SettingControl>
  );
  const list = (
    <ChoiceToken
      label={`Which ${m.noun.many}`}
      tone="alt"
      popover={
        <>
          <h5>Which {m.noun.many}</h5>
          <ListWrap m={m}>
            <div className="chips sf-b-chips">
              {m.options.map((o) => (
                <OptionWrap key={o.id} m={m} o={o}>
                  <Chip label={o.name} tip={o.tip} selected={o.on} disabled={m.locked} onToggle={o.toggle} />
                </OptionWrap>
              ))}
            </div>
          </ListWrap>
        </>
      }
    >
      {pickedWords(m)}
    </ChoiceToken>
  );
  return (
    <div className="sf-b">
      <div className="sc-prose">
        {on ? (
          <div className="sc-line">
            <span className="w">Record</span> {scope} {list} <span className="w">{m.noun.many}.</span>
          </div>
        ) : (
          <>
            <div className="sc-line">
              <span className="w">Record</span> {scope} <span className="w">{m.noun.one}.</span>
            </div>
            <div className="sc-line sf-b-off">
              <span className="w">Kept for the filter:</span> {list}
            </div>
          </>
        )}
      </div>
      {m.pending}
    </div>
  );
}
