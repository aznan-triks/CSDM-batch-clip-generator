/**
 * A clip drawn as one bar of proportional parts -- a picture, not a control.
 *
 * `thin`: a 6px strip with the clip's ends and the moment written under it.
 * `labelled`: a 26px bar with each part's seconds inside and a tick where the
 * moment falls. Widths are shares of the parts' own seconds; the bar has no
 * number of its own. `aria-hidden`: the card's sentence says the same thing.
 */
import type { ReactNode } from "react";

import type { TimelineTone } from "./ClipTimeline";
import "./cardstyle.css";

export interface BarPart {
  key: string;
  seconds: number;
  tone: TimelineTone;
  label?: ReactNode;
}

interface ClipBarProps {
  parts: BarPart[];
  /** Seconds from the bar's start to the moment. */
  moment: number;
  variant: "thin" | "labelled";
  /** `thin` only: captions under the strip (start, moment, end). */
  captions?: { start: ReactNode; moment: ReactNode; end: ReactNode };
}

export default function ClipBar({ parts, moment, variant, captions }: ClipBarProps) {
  const total = parts.reduce((sum, p) => sum + p.seconds, 0) || 1;
  const bar = (
    <div className={`cs-bar ${variant}`} aria-hidden="true" data-testid="clip-bar">
      {parts.map((p) => (
        <i key={p.key} className={`cs-bar-part ${p.tone}`} style={{ flexGrow: p.seconds || 0.001 }}>
          {variant === "labelled" ? p.label : null}
        </i>
      ))}
      {variant === "labelled" && <span className="cs-bar-mark" style={{ left: `calc(${(moment / total) * 100}% - 1px)` }} />}
    </div>
  );
  if (variant === "labelled" || !captions) return bar;
  return (
    <>
      {bar}
      <div className="cs-bar-caps" aria-hidden="true">
        <span style={{ flexGrow: moment }}>{captions.start}</span>
        <span className="cs-bar-caps-after" style={{ flexGrow: total - moment }}>
          <b>{captions.moment}</b>
          <span>{captions.end}</span>
        </span>
      </div>
    </>
  );
}
