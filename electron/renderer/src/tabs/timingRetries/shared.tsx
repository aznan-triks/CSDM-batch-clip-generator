/**
 * Pieces the Timing & Retries styles draw the same way: a number word with
 * its exact box, the order pictures, the small glyphs. One place each.
 */
import type { ReactNode } from "react";

import Field from "../../components/Field";
import Slider from "../../components/Slider";
import { NumberToken } from "../../components/cardstyle/SentenceToken";
import SettingControl from "../../settings/SettingControl";
import type { CountSetting } from "./useTimingRetries";

/**
 * A number you drag sideways; a click opens its slider and an exact box (a
 * typed value may go past the slider's reach).
 */
export function CountWord({
  n,
  label,
  unit,
  tone,
}: {
  n: CountSetting;
  label: string;
  /** The word after the number on the token, e.g. " times"; defaults to the setting's unit. */
  unit?: string;
  tone?: "alt";
}) {
  return (
    <SettingControl settingKey={n.key}>
      <NumberToken
        value={n.value}
        min={n.min}
        max={n.max}
        unit={unit ?? n.unit}
        label={label}
        tone={tone === "alt" ? "alt" : "primary"}
        tip={n.tip}
        onChange={n.set}
        popover={
          <>
            <h5>{label}</h5>
            <Slider id={`tr-${n.key}-slider`} label={label} unit={n.unit.trim()} min={n.min} max={n.max} value={n.value} onChange={n.set} tip={n.tip} />
            <div className="row">
              <Field id={`tr-${n.key}`} label="Exact" numeric value={String(n.value)} onChange={n.set} tip={n.tip} />
              <span className="unit">{n.unit.trim()}</span>
            </div>
          </>
        }
      />
    </SettingControl>
  );
}

/* Flat glyphs in the repo's icon style. */
export const GLYPHS: Record<"fail" | "retry" | "demo" | "wait" | "stuck", ReactNode> = {
  fail: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" fill="currentColor" opacity=".25" />
      <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  retry: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M19 12a7 7 0 1 1-2.05-4.95" />
      <path d="M19 4v4h-4" />
    </svg>
  ),
  demo: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h11l5 5v11H4z" fill="currentColor" opacity=".3" />
      <path d="M10 10l6 3.5-6 3.5z" fill="currentColor" />
    </svg>
  ),
  wait: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2h6" />
    </svg>
  ),
  stuck: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h2v6H9zM13 9h2v6h-2z" fill="currentColor" stroke="none" />
    </svg>
  ),
};

/** The two orders as small pictures: dated demos in a row, or shuffled. */
export const ORDER_ART: Record<"chrono" | "random", ReactNode> = {
  chrono: (
    <svg viewBox="0 0 100 50" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={8 + i * 22} y={10} width={18} height={24} rx={3} className="tr-art-card" />
          <text x={17 + i * 22} y={27} className="tr-art-num">
            {i + 1}
          </text>
        </g>
      ))}
      <path d="M8 42h84M86 38l6 4-6 4" className="tr-art-arrow" />
    </svg>
  ),
  random: (
    <svg viewBox="0 0 100 50" aria-hidden="true">
      {[3, 1, 4, 2].map((n, i) => (
        <g key={n} transform={`rotate(${[-8, 6, -4, 9][i]} ${17 + i * 22} 22)`}>
          <rect x={8 + i * 22} y={10} width={18} height={24} rx={3} className="tr-art-card" />
          <text x={17 + i * 22} y={27} className="tr-art-num">
            {n}
          </text>
        </g>
      ))}
      <path d="M10 44c20-10 30 6 50-4s22-2 30-6" className="tr-art-arrow" />
    </svg>
  ),
};
