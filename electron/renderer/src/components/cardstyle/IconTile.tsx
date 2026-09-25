/**
 * Big picture choices.
 *
 *   - `IconTile`: an on/off tile -- icon, title, a line that explains it, a
 *     short code in the corner and a check box. One tile = one toggle.
 *   - `PictureChoice`: one-of-N pictures with a caption under each (a radio
 *     group), e.g. which camera films the clip.
 *
 * Both are generic: the card passes the art and the words.
 */
import type { ReactNode } from "react";

import "./cardstyle.css";

interface IconTileProps {
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  code?: string;
  on: boolean;
  disabled?: boolean;
  /** Draw the subtitle as a warning (the tile cannot apply right now). */
  warn?: boolean;
  tip?: string;
  onToggle: () => void;
}

export function IconTile({ icon, title, subtitle, code, on, disabled, warn, tip, onToggle }: IconTileProps) {
  return (
    <button
      type="button"
      className={["cs-tile", on ? "on" : null, warn ? "warn" : null].filter(Boolean).join(" ")}
      aria-pressed={on}
      aria-disabled={!!disabled}
      aria-label={title}
      title={tip}
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      <span className="cs-tile-ck" aria-hidden="true">
        ✓
      </span>
      <span className="cs-tile-ic" aria-hidden="true">
        {icon}
      </span>
      <b>{title}</b>
      <small>{subtitle}</small>
      {code && (
        <span className="cs-tile-code" aria-hidden="true">
          {code}
        </span>
      )}
    </button>
  );
}

export interface PictureOption<V extends string> {
  value: V;
  title: string;
  subtitle: string;
  art: ReactNode;
  /** Colour of the selection ring and title; a CSS colour or var(). */
  color: string;
  tip?: string;
}

interface PictureChoiceProps<V extends string> {
  label: string;
  options: readonly PictureOption<V>[];
  value: V;
  onChange: (value: V) => void;
}

export function PictureChoice<V extends string>({ label, options, value, onChange }: PictureChoiceProps<V>) {
  return (
    <div className="cs-pics" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.value}
          className={o.value === value ? "cs-pic on" : "cs-pic"}
          style={{ ["--c" as string]: o.color }}
          title={o.tip}
          onClick={() => onChange(o.value)}
        >
          <span className="cs-pic-th">
            <span className="cs-pic-tick" aria-hidden="true">
              ✓
            </span>
            {o.art}
          </span>
          <b>{o.title}</b>
          <small>{o.subtitle}</small>
        </button>
      ))}
    </div>
  );
}
