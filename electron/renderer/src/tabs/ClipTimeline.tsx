import type { ClipWindow } from "./clipWindow";

/**
 * One clip, drawn: before | (victim view) | moment | after.
 *
 * Every width is a share of the clip's own length, from `clipWindow` -- the
 * bar has no number of its own. `aria-hidden`: the summary sentence under it
 * says the same thing in words, which is what a screen reader should read.
 */
export default function ClipTimeline({ window: w }: { window: ClipWindow }) {
  const segments: Array<{ key: string; seconds: number; label: string }> = [
    { key: "lead", seconds: w.lead, label: w.victimView > 0 ? `${w.lead}s killer` : `${w.lead}s before` },
    ...(w.victimView > 0 ? [{ key: "victim", seconds: w.victimView, label: `${w.victimView}s victim` }] : []),
    { key: "after", seconds: w.after, label: `${w.after}s after` },
  ];
  return (
    <div className="clip-timeline" aria-hidden="true" data-testid="clip-timeline">
      {segments.map((s) => (
        <span
          key={s.key}
          className={`clip-timeline-seg clip-timeline-${s.key}`}
          style={{ flexGrow: s.seconds }}
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}
