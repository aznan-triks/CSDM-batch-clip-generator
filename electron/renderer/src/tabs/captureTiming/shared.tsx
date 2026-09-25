/**
 * Pieces two or three Capture & Timing styles draw the same way: the camera
 * dots, the kill crosshair, the Mate POV pair, the feed name box and the
 * words that name what gets captured. One place each, so the styles cannot
 * drift apart on them.
 */
import type { ReactNode } from "react";

import Chip from "../../components/Chip";
import Field from "../../components/Field";
import SettingControl from "../../settings/SettingControl";
import type { CaptureTimingModel, ToggleSetting } from "./useCaptureTiming";

/** The camera colours as dots: killer = accent, victim = green, both = half each. */
export const CAMERA_MARKS: Record<string, ReactNode> = {
  killer: <i className="ct-dot k" aria-hidden="true" />,
  victim: <i className="ct-dot v" aria-hidden="true" />,
  both: <i className="ct-dot b" aria-hidden="true" />,
};

export function Crosshair() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="8" cy="8" r="5" />
      <path d="M8 0v5M8 11v5M0 8h5M11 8h5" />
    </svg>
  );
}

/** Mate POV's Enable and Must, each on its own key. */
export function MatePovChips({ enable, must }: { enable: ToggleSetting; must: ToggleSetting }) {
  return (
    <div className="chips">
      <SettingControl settingKey={enable.key}>
        <Chip label="Enable" tip={enable.tip} selected={enable.on} onToggle={enable.toggle} />
      </SettingControl>
      <SettingControl settingKey={must.key}>
        <Chip label="★ Must" tip={must.tip} selected={must.on} onToggle={must.toggle} />
      </SettingControl>
    </div>
  );
}

export function FeedName({ m }: { m: CaptureTimingModel }) {
  return (
    <SettingControl settingKey={m.feedName.key}>
      <Field
        id="player-name-override"
        label="Feed name"
        value={m.feedName.value}
        onChange={m.feedName.set}
        placeholder="name from the demo"
        tip={m.feedName.tip}
      />
    </SettingControl>
  );
}

/** What the role x action choice captures, as a noun: "kills", "hits taken"... */
export function momentWords(m: CaptureTimingModel): string {
  const out: string[] = [];
  const actor = m.actor.on;
  const target = m.target.on;
  if (m.lethal.on) {
    if (actor) out.push("kills");
    if (target) out.push("deaths");
  }
  if (m.nonLethal.on) {
    if (actor && target) out.push("hits dealt & taken");
    else if (actor) out.push("hits dealt");
    else if (target) out.push("hits taken");
  }
  if (m.other.on && actor) out.push("shots");
  if (!out.length) return "nothing yet";
  return out.length === 1 ? out[0] : `${out.slice(0, -1).join(", ")} & ${out[out.length - 1]}`;
}

/** Who the other player may be: "enemies", "teammates", "anyone". */
export function teamWord(m: CaptureTimingModel): string {
  if (m.ally.on && m.enemy.on) return "anyone";
  if (m.ally.on) return "teammates";
  if (m.enemy.on) return "enemies";
  return "nobody";
}

/** The clip length and the merge rule, short form. */
export function MergeWords({ m }: { m: CaptureTimingModel }) {
  return (
    <span data-testid="clip-window-summary" title={m.summary}>
      Each moment is a <b>{m.clip.total} s</b> clip. A second moment up to <b>{m.clip.mergeWithin} s</b> later
      joins the same clip.
    </span>
  );
}
