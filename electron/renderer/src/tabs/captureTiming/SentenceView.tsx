/**
 * Capture & Timing, "sentence" style (concept B): the card reads as English.
 *
 * Every blue or green word is a control: click a word to choose, drag a number
 * sideways (or scroll it) to change it. The clip length and the merge rule
 * follow the sentence. Every value comes from `useCaptureTiming`.
 */
import Chip from "../../components/Chip";
import Slider from "../../components/Slider";
import ClipBar, { type BarPart } from "../../components/cardstyle/ClipBar";
import { ChoiceToken, NumberToken } from "../../components/cardstyle/SentenceToken";
import ToggleSwitch from "../../components/cardstyle/ToggleSwitch";
import SettingControl from "../../settings/SettingControl";
import { CAMERA_MARKS, FeedName, MatePovChips, MergeWords, momentWords, teamWord } from "./shared";
import type { CaptureTimingModel, NumberSetting, Perspective, ToggleSetting } from "./useCaptureTiming";

function ToggleChip({ t, label }: { t: ToggleSetting; label: string }) {
  return (
    <SettingControl settingKey={t.key}>
      <Chip label={label} tip={t.tip} selected={t.on} disabled={t.disabled} onToggle={t.toggle} />
    </SettingControl>
  );
}

/** A number word, and the same setting's slider in its popover. */
function NumberWord({ n, label, tone }: { n: NumberSetting; label: string; tone?: "alt" }) {
  return (
    <SettingControl settingKey={n.key}>
      <NumberToken
        value={n.value}
        min={n.min}
        max={n.max}
        unit="s"
        label={label}
        tone={tone === "alt" ? "alt" : "primary"}
        tip={n.tip}
        onChange={n.set}
        popover={
          <>
            <h5>{label}</h5>
            <Slider id={`sentence-${n.key}`} label={label} unit="s" min={n.min} max={n.max} value={n.value} onChange={n.set} tip={n.tip} />
          </>
        }
      />
    </SettingControl>
  );
}

const CAMERA_OPTIONS: ReadonlyArray<{ value: Perspective; words: string; sub: string }> = [
  { value: "killer", words: "the killer", sub: "the whole clip in the killer's eyes" },
  { value: "victim", words: "the victim", sub: "the whole clip in the victim's eyes" },
  { value: "both", words: "the killer, then the victim", sub: "switches to the victim just before the kill" },
];

export default function SentenceView({ m }: { m: CaptureTimingModel }) {
  const { clip } = m;
  const cam = m.perspective.value;
  const both = cam === "both";
  const mate = !!m.matePov?.on;
  const camWords = cam === "victim" ? (mate ? "a teammate" : "the victim") : "the killer";

  const parts: BarPart[] = both
    ? [
        { key: "lead", seconds: clip.lead, tone: "primary" },
        { key: "victim", seconds: clip.victimView, tone: "alt" },
      ]
    : [{ key: "lead", seconds: clip.before, tone: cam === "victim" ? "alt" : "primary" }];
  parts.push({ key: "after", seconds: clip.after, tone: "rest" });

  const cameraToken = (
    <SettingControl settingKey={m.perspective.key}>
      <ChoiceToken
        label="Camera"
        tone={cam === "victim" ? "alt" : "primary"}
        tip={m.perspective.tip}
        popover={(close) => (
          <>
            <h5>Film from · Camera</h5>
            <div className="cb-opts" role="radiogroup" aria-label="Camera">
              {CAMERA_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={cam === o.value}
                  aria-label={o.value}
                  className={cam === o.value ? "cb-opt on" : "cb-opt"}
                  onClick={() => {
                    m.perspective.set(o.value);
                    close();
                  }}
                >
                  {CAMERA_MARKS[o.value]}
                  <span>
                    {o.words}
                    <small>{o.sub}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      >
        {CAMERA_MARKS[cam]}
        {camWords}
      </ChoiceToken>
    </SettingControl>
  );

  return (
    <div className="ct-b">
      <div className="cb-sent">
        <div className="cb-line">
          <span className="w">Capture my</span>{" "}
          <ChoiceToken
            label="What to capture"
            popover={
              <>
                <h5>Who does it · Event role</h5>
                <div className="chips">
                  <ToggleChip t={m.actor} label="I do it" />
                  <ToggleChip t={m.target} label="Done to me" />
                </div>
                <h5>What happens · Action type</h5>
                <div className="chips">
                  <ToggleChip t={m.lethal} label="Lethal" />
                  <ToggleChip t={m.nonLethal} label="Non-lethal" />
                  <ToggleChip t={m.other} label="Other" />
                </div>
                <div className="cb-pv">
                  Reads: “Capture my <b>{momentWords(m)}</b> …”
                </div>
              </>
            }
          >
            {momentWords(m)}
          </ChoiceToken>{" "}
          <span className="w">against</span>{" "}
          <span className="nw">
            <ChoiceToken
              label="Team"
              popover={
                <>
                  <h5>The other player is · Team</h5>
                  <div className="chips">
                    <ToggleChip t={m.enemy} label="an enemy" />
                    <ToggleChip t={m.ally} label="a teammate" />
                  </div>
                  <div className="cb-pv">
                    Reads: “… against <b>{teamWord(m)}</b>.”
                  </div>
                </>
              }
            >
              {teamWord(m)}
            </ChoiceToken>
            .
          </span>
        </div>
        {both && m.victimView ? (
          <div className="cb-line">
            <span className="w">Film from</span> {cameraToken} <span className="w">for</span>{" "}
            <NumberWord n={m.before} label="Seconds before" />
            <span className="w">, then</span> <NumberWord n={m.victimView} label="Victim view" tone="alt" />{" "}
            <span className="w">of {mate ? "the best-placed mate" : "the victim"},</span>{" "}
            <span className="w">and keep rolling</span>{" "}
            <span className="nw">
              <NumberWord n={m.after} label="Seconds after" /> <span className="w">after the kill.</span>
            </span>
          </div>
        ) : (
          <div className="cb-line">
            <span className="w">Film from</span> {cameraToken}
            <span className="w">, starting</span> <NumberWord n={m.before} label="Seconds before" />{" "}
            <span className="w">before and ending</span>{" "}
            <span className="nw">
              <NumberWord n={m.after} label="Seconds after" /> <span className="w">after.</span>
            </span>
          </div>
        )}
      </div>

      <ClipBar
        variant="thin"
        parts={parts}
        moment={clip.before}
        captions={{ start: `−${clip.before}s`, moment: "▲ kill", end: `+${clip.after}s` }}
      />
      <div className="cb-merge">
        <svg viewBox="0 0 26 14" aria-hidden="true">
          <rect x="1" y="4" width="10" height="6" rx="2" fill="currentColor" />
          <rect x="15" y="4" width="10" height="6" rx="2" fill="none" stroke="currentColor" strokeDasharray="2 1.5" />
          <path d="M11 7h4" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <MergeWords m={m} />
      </div>

      <div className="cb-foot">
        <div className="row">
          <SettingControl settingKey={m.rounds.key}>
            <ToggleSwitch label="Full rounds" on={m.rounds.on} tip={m.rounds.tip} onToggle={m.rounds.toggle} />
          </SettingControl>
          {m.matePov && m.matePovReq && (
            <>
              <span className="cb-sep" aria-hidden="true" />
              <span className="lab">Mate POV</span>
              <MatePovChips enable={m.matePov} must={m.matePovReq} />
            </>
          )}
        </div>
        <div className="row">
          <FeedName m={m} />
        </div>
      </div>
    </div>
  );
}
