/**
 * Small pieces the TAGS and SETTINGS cards share across their styles:
 *
 *   - `WordOptions`: the radio list inside a sentence word's popover;
 *   - `TextWord`: a sentence word that shows a text setting and opens its box;
 *   - `BigTile`: the tiles style's large illustrated panel around any control.
 *
 * `sx-` prefixed (StyledCard.css): `cs-` and `sc-` belong to the CAPTURE cards.
 */
import type { ReactNode } from "react";

import { ChoiceToken } from "./SentenceToken";
import "./StyledCard.css";

export interface WordOption<V extends string> {
  value: V;
  words: string;
  sub?: string;
  mark?: ReactNode;
  tip?: string;
}

/** One-of-n choice in a popover: each option a line of words and a hint. */
export function WordOptions<V extends string>({
  label,
  options,
  value,
  onChange,
  close,
}: {
  label: string;
  options: readonly WordOption<V>[];
  value: V;
  onChange: (value: V) => void;
  close?: () => void;
}) {
  return (
    <div className="sx-opts" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.value}
          className={o.value === value ? "sx-opt on" : "sx-opt"}
          title={o.tip}
          onClick={() => {
            if (o.value !== value) onChange(o.value);
            close?.();
          }}
        >
          {o.mark}
          <span>
            {o.words}
            {o.sub && <small>{o.sub}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * A text setting as a word: the value (or what an empty value means) on the
 * token, the real box in its popover. `children` is that box.
 */
export function TextWord({
  label,
  shown,
  empty,
  tip,
  tone,
  children,
}: {
  label: string;
  /** The text on the token; empty = `empty`. */
  shown: string;
  /** What an empty value means, in words ("auto-detected"). */
  empty: string;
  tip?: string;
  tone?: "alt";
  children: ReactNode;
}) {
  return (
    <ChoiceToken
      label={label}
      tip={tip}
      tone={tone === "alt" ? "alt" : "primary"}
      popover={
        <>
          <h5>{label}</h5>
          {children}
        </>
      }
    >
      {shown ? <span className="sx-word">{shown}</span> : <span className="sx-word empty">{empty}</span>}
    </ChoiceToken>
  );
}

/** The tail of a path, the part that tells folders apart. */
export function pathTail(path: string, parts = 2): string {
  const bits = path.split(/[\\/]+/).filter(Boolean);
  return bits.length <= parts ? path : `…\\${bits.slice(-parts).join("\\")}`;
}

/** A large tile: an illustration, a title, a caption and the control itself. */
export function BigTile({
  icon,
  title,
  caption,
  on,
  wide,
  tone,
  children,
}: {
  icon: ReactNode;
  title: string;
  caption?: ReactNode;
  /** Lit, as a chosen or active tile. */
  on?: boolean;
  /** Spans the whole row. */
  wide?: boolean;
  tone?: "alt" | "warn";
  children?: ReactNode;
}) {
  const cls = ["sx-tile", on ? "on" : null, wide ? "wide" : null, tone ?? null].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <div className="sx-tile-h">
        <span className="sx-tile-ic" aria-hidden="true">
          {icon}
        </span>
        <b>{title}</b>
      </div>
      {caption && <small className="sx-tile-cap">{caption}</small>}
      {children && <div className="sx-tile-body">{children}</div>}
    </div>
  );
}
