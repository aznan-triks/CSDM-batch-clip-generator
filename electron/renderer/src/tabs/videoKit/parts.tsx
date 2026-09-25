/**
 * The pieces the VIDEO cards draw their settings with, one per shape and per
 * style: a switch, a sentence word, a big tile. Every piece wears its key's
 * `SettingControl`, so a card's views only choose WHERE a setting sits, never
 * how it is bound.
 */
import { useState, type ReactNode } from "react";

import Field from "../../components/Field";
import Segmented from "../../components/Segmented";
import Slider from "../../components/Slider";
import { IconTile } from "../../components/cardstyle/IconTile";
import { ChoiceToken, NumberToken } from "../../components/cardstyle/SentenceToken";
import SmallCardCountTile from "../../components/cardstyle/SmallCardCountTile";
import ToggleSwitch from "../../components/cardstyle/ToggleSwitch";
import { formatStep } from "../../components/cardstyle/numberStep";
import SettingControl from "../../settings/SettingControl";
import type { BoolSetting, ChoiceSetting, NumSetting, TextSetting } from "./settings";
import "../../components/cardstyle/SmallCard.css";
import "./VideoKit.css";

type Tone = "primary" | "alt";

/* ---------------- any style ---------------- */

/** The lime on/off switch. */
export function Switch({ b, label }: { b: BoolSetting; label?: string }) {
  return (
    <SettingControl settingKey={b.key}>
      <ToggleSwitch label={label ?? b.label} on={b.on} tip={b.tip} onToggle={b.toggle} />
    </SettingControl>
  );
}

/** A labelled text box on its own row. */
export function TextRow({ t, id, mono }: { t: TextSetting; id: string; mono?: boolean }) {
  return (
    <SettingControl settingKey={t.key}>
      <div className="row vk-textrow">
        <Field id={id} label={t.label} mono={mono} value={t.value} onChange={t.set} placeholder={t.placeholder} tip={t.tip} />
      </div>
    </SettingControl>
  );
}

/**
 * The shortcut values the old window offered beside a number, as chips.
 * `dataAction` is the parity marker of a row that has one (HLAE game speed).
 */
export function QuickChips({ n, dataAction }: { n: NumSetting; dataAction?: string }) {
  if (!n.quick.length) return null;
  return (
    <div className="vk-quick" role="group" aria-label={`${n.label} shortcuts`}>
      {n.quick.map((q) => (
        <button
          key={q}
          type="button"
          className={q === n.value ? "chip on" : "chip"}
          title={`Set ${n.label} to ${formatStep(q, n.step)}`}
          data-action={dataAction}
          onClick={() => n.set(q)}
        >
          {formatStep(q, n.step)}
        </button>
      ))}
    </div>
  );
}

/** A number's popover body: its slider, an exact box (may go past the slider) and its shortcuts. */
export function NumEditor({ n, id, dataAction }: { n: NumSetting; id: string; dataAction?: string }) {
  return (
    <>
      <h5>{n.label}</h5>
      <Slider id={`${id}-slider`} label={n.label} unit={n.unit.trim()} min={n.min} max={n.max} step={n.step} value={n.value} onChange={n.set} tip={n.tip} />
      <div className="row">
        <ExactBox n={n} id={id} label="Exact" />
        <span className="unit">{n.unit.trim()}</span>
      </div>
      <QuickChips n={n} dataAction={dataAction} />
    </>
  );
}

/**
 * A typed number that may go past the slider. While it is being typed the box
 * keeps the text as typed ("0." on the way to "0.5", "-" on the way to
 * "-200"); the stored value follows every keystroke that makes a number.
 */
export function ExactBox({ n, id, label }: { n: NumSetting; id: string; label?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="vk-exact" onBlur={() => setDraft(null)}>
      <Field
        id={id}
        label={label}
        numeric
        value={draft ?? String(n.value)}
        onChange={(text) => {
          setDraft(text);
          n.set(text);
        }}
        tip={n.tip}
      />
    </span>
  );
}

/* ---------------- sentence style ---------------- */

/** A number you drag sideways; a click opens its slider, exact box and shortcuts. */
export function NumWord({ n, id, tone, unit, dataAction }: { n: NumSetting; id: string; tone?: Tone; unit?: string; dataAction?: string }) {
  return (
    <SettingControl settingKey={n.key}>
      <NumberToken
        value={n.value}
        min={n.min}
        max={n.max}
        step={n.step}
        unit={unit ?? n.unit}
        label={n.label}
        tone={tone}
        tip={n.tip}
        onChange={n.set}
        popover={<NumEditor n={n} id={id} dataAction={dataAction} />}
      />
    </SettingControl>
  );
}

/** An on/off as the words that say it, e.g. "delete" / "keep"; a click offers both. */
export function BoolWord({ b, on, off, tone }: { b: BoolSetting; on: string; off: string; tone?: Tone }) {
  return (
    <SettingControl settingKey={b.key}>
      <ChoiceToken
        label={b.label}
        tone={tone}
        tip={b.tip}
        popover={
          <>
            <h5>{b.label}</h5>
            <Segmented options={[on, off]} value={b.on ? on : off} onChange={(w) => b.set(w === on)} label={b.label} tip={b.tip} />
          </>
        }
      >
        {b.on ? on : off}
      </ChoiceToken>
    </SettingControl>
  );
}

/** One value out of N; the word shown may differ from the stored value. */
export function ChoiceWord<V extends string>({
  c,
  words,
  tone,
  extra,
}: {
  c: ChoiceSetting<V>;
  words?: Partial<Record<V, string>>;
  tone?: Tone;
  /** Anything the popover shows under the choices (a caption, a hint). */
  extra?: ReactNode;
}) {
  return (
    <SettingControl settingKey={c.key}>
      <ChoiceToken
        label={c.label}
        tone={tone}
        tip={c.tip}
        popover={
          <>
            <h5>{c.label}</h5>
            <Segmented options={c.options} value={c.value} onChange={(v) => c.set(v as V)} label={c.label} tip={c.tip} />
            {extra}
          </>
        }
      >
        {words?.[c.value] ?? c.value}
      </ChoiceToken>
    </SettingControl>
  );
}

/** A line of text as a word; a click opens its box. `empty` is shown while it is blank. */
export function TextWord({ t, id, empty, tone, mono }: { t: TextSetting; id: string; empty: string; tone?: Tone; mono?: boolean }) {
  return (
    <SettingControl settingKey={t.key}>
      <ChoiceToken
        label={t.label}
        tone={tone}
        tip={t.tip}
        popover={
          <>
            <h5>{t.label}</h5>
            <div className="row">
              <Field id={id} mono={mono} value={t.value} onChange={t.set} placeholder={t.placeholder} tip={t.tip} />
            </div>
          </>
        }
      >
        <span className={t.value ? "vk-tokval" : "vk-tokval empty"}>{t.value || empty}</span>
      </ChoiceToken>
    </SettingControl>
  );
}

/* ---------------- tiles style ---------------- */

/** An on/off as a big tile. */
export function BoolTile({
  b,
  icon,
  subtitle,
  code,
  warn,
}: {
  b: BoolSetting;
  icon: ReactNode;
  subtitle: ReactNode;
  code?: string;
  warn?: boolean;
}) {
  return (
    <SettingControl settingKey={b.key}>
      <IconTile icon={icon} title={b.label} subtitle={subtitle} code={code} on={b.on} warn={warn} tip={b.tip} onToggle={b.toggle} />
    </SettingControl>
  );
}

/** A number as a big tile, with its shortcut chips under it. */
export function NumTile({ n, icon, caption, dataAction }: { n: NumSetting; icon: ReactNode; caption?: ReactNode; dataAction?: string }) {
  return (
    <SettingControl settingKey={n.key}>
      <div className="vk-numtile">
        <SmallCardCountTile
          icon={icon}
          title={n.label}
          value={n.value}
          unit={n.unit}
          min={n.min}
          max={n.max}
          step={n.step}
          caption={caption}
          tip={n.tip}
          onChange={n.set}
        />
        <QuickChips n={n} dataAction={dataAction} />
      </div>
    </SettingControl>
  );
}
