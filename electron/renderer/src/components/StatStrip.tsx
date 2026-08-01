import { useEngineState } from "../motion/useEngineState";
import "./StatStrip.css";

/**
 * The mock's `.stats` row (mockup-v12-hologlass.html): four counters closing
 * the Capture tab.
 *
 * THE NUMBERS ARE THE ENGINE'S, NOT INVENTED. The mock shows Demos / Matched /
 * Est. clips / Skipped because that is what its fake data had; this window
 * shows the four the engine actually computes and now reports alongside the
 * summary sentence (`_summary_counts` in csdm/engine/core.py). Before the
 * first preview there is nothing to report, and each counter says so with a
 * dash rather than a zero -- "0 clips" and "no run yet" are not the same
 * answer, and a strip that reads zero on a fresh window is a lie.
 */
function hms(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const NOTHING_YET = "--";

/** The mock's own one-letter tone classes: `.st .v.a` accent, `.st .v.g` green. */
const TONE_CLASS = { accent: "a", ok: "g" } as const;

export interface StatStripProps {
  /**
   * The bottom band (`weapon/WeaponBand.tsx`) is one slim row shared with the
   * status line and the weapon art -- the mock's own `.k`/`.v` two-line cell
   * is too tall for it. Compact renders the same four numbers as one inline
   * "LABEL value" row instead, no layout of its own borrowed from the mock.
   */
  compact?: boolean;
}

export default function StatStrip({ compact = false }: StatStripProps) {
  const { summary } = useEngineState();

  const cells: { key: string; value: string; tone?: "accent" | "ok" }[] = [
    {
      key: "Demos",
      value: summary?.demos != null ? summary.demos.toLocaleString("en-US") : NOTHING_YET,
    },
    {
      key: "Clips",
      value: summary?.clips != null ? summary.clips.toLocaleString("en-US") : NOTHING_YET,
      tone: "accent",
    },
    {
      key: "Total",
      value: summary?.totalSeconds != null ? hms(summary.totalSeconds) : NOTHING_YET,
      tone: "ok",
    },
    {
      key: "Avg / clip",
      value: summary?.avgSeconds != null ? hms(summary.avgSeconds) : NOTHING_YET,
    },
  ];

  if (compact) {
    return (
      <div className="stats-compact">
        {cells.map((cell) => (
          <span className="stc" key={cell.key}>
            <span className="k">{cell.key}</span>
            <span className={cell.tone ? `v ${TONE_CLASS[cell.tone]}` : "v"}>{cell.value}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="stats">
      {cells.map((cell) => (
        <div className="st" key={cell.key}>
          <div className="k">{cell.key}</div>
          <div className={cell.tone ? `v ${TONE_CLASS[cell.tone]}` : "v"}>{cell.value}</div>
        </div>
      ))}
    </div>
  );
}
