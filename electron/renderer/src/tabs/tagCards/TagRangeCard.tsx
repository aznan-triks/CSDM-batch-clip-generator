/**
 * The Tag Range card: one model (`useTagRange`), drawn in its card style.
 *
 *   - timeline: the tagged demos as a span on a date line; each end, the
 *     span and the open tail after it is the button that applies it;
 *   - sentence: "The demos tagged <…> run from <start> to <end>. Filter
 *     Capture <from the start> · <to the end> · …";
 *   - tiles: one illustrated tile per way of applying the range.
 */
import type { ReactNode } from "react";

import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import { ApplyAfterButton, ApplyEndButton, ApplyFullButton, ApplyStartButton, CalcRangeButton } from "./actions";
import { useTagRange, type TagRangeModel } from "./useTagRange";
import "./TagCards.css";

function tagWords(names: readonly string[]): string {
  if (names.length === 0) return "(no tag selected)";
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

function CurrentFilter({ m }: { m: TagRangeModel }) {
  const { from, to } = m.filter;
  return (
    <p className="tgr-now">
      Capture's date filter now: <b>{from || "any date"}</b> → <b>{to || "today"}</b>
    </p>
  );
}

function Status({ m }: { m: TagRangeModel }) {
  return m.status ? <p className="tags-range-status">{m.status}</p> : null;
}

function TimelineView({ m }: { m: TagRangeModel }) {
  const r = m.range;
  return (
    <div className="tgr-a">
      <div className="tgr-head">
        <span className="sx-kick">Tagged</span>
        <b className="tgr-names">{tagWords(m.activeNames)}</b>
        <CalcRangeButton m={m} />
      </div>
      <div className={r?.date_start ? "tgr-line" : "tgr-line ghost"} aria-label="Date range of the tagged demos">
        <ApplyStartButton m={m} className="tgr-end start">
          <i aria-hidden="true" />
          <b>{r?.date_start ?? "first demo"}</b>
          <small>Apply start</small>
        </ApplyStartButton>
        <ApplyFullButton m={m} className="tgr-span">
          <b>{r ? `${r.demo_count} demo(s)` : "tagged demos"}</b>
          <small>Apply full range</small>
        </ApplyFullButton>
        <ApplyEndButton m={m} className="tgr-end end">
          <i aria-hidden="true" />
          <b>{r?.date_end ?? "last demo"}</b>
          <small>Apply end</small>
        </ApplyEndButton>
        <ApplyAfterButton m={m} className="tgr-tail">
          <b>after →</b>
          <small>After range</small>
        </ApplyAfterButton>
      </div>
      <Status m={m} />
      <CurrentFilter m={m} />
    </div>
  );
}

function SentenceView({ m }: { m: TagRangeModel }) {
  const r = m.range;
  return (
    <div className="tgr-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">The demos tagged</span> <b>{tagWords(m.activeNames)}</b>{" "}
          {r?.date_start && r.date_end ? (
            <>
              <span className="w">run from</span> <b>{r.date_start}</b> <span className="w">to</span> <b>{r.date_end}</b>
              <span className="w"> ({r.demo_count} demos).</span>
            </>
          ) : (
            <span className="w">run over dates not computed yet.</span>
          )}{" "}
          <CalcRangeButton m={m} className="sx-act">
            {r ? "compute again" : "compute them"}
          </CalcRangeButton>
        </div>
        <div className="sc-line">
          <span className="w">Filter Capture</span> <ApplyStartButton m={m} className="sx-act">from the first demo</ApplyStartButton>
          <span className="w">,</span> <ApplyEndButton m={m} className="sx-act">up to the last one</ApplyEndButton>
          <span className="w">,</span> <ApplyFullButton m={m} className="sx-act">over the whole range</ApplyFullButton>{" "}
          <span className="w">or</span> <ApplyAfterButton m={m} className="sx-act alt">to what came after</ApplyAfterButton>
          <span className="w">.</span>
        </div>
      </div>
      <Status m={m} />
      <CurrentFilter m={m} />
    </div>
  );
}

/** A little date line with the part a tile applies drawn solid. */
function RangeArt({ part }: { part: "start" | "end" | "full" | "after" }) {
  const lit: Record<typeof part, ReactNode> = {
    start: <path d="M14 14h30" />,
    end: <path d="M30 14h30" />,
    full: <path d="M14 14h46" />,
    after: <path d="M60 14h24" />,
  };
  return (
    <svg viewBox="0 0 90 28" aria-hidden="true" className="tgr-art">
      <path d="M4 14h82" className="base" />
      <path d="M14 8v12M60 8v12" className="ticks" />
      <g className="lit">{lit[part]}</g>
    </svg>
  );
}

function TilesView({ m }: { m: TagRangeModel }) {
  const r = m.range;
  return (
    <div className="tgr-c">
      <CalcRangeButton m={m} className="tgr-calc">
        <span className="tgr-calc-ic" aria-hidden="true">
          <ICONS.tagRange />
        </span>
        <b>{r ? `${r.demo_count} demo(s)` : "Calculate range"}</b>
        <small>{r?.date_start ? `${r.date_start} → ${r.date_end ?? "?"}` : tagWords(m.activeNames)}</small>
      </CalcRangeButton>
      <div className="tgr-tiles">
        <ApplyStartButton m={m} className="tgr-tile">
          <RangeArt part="start" />
          <b>From start</b>
          <small>{r?.date_start ?? "Apply start"}</small>
        </ApplyStartButton>
        <ApplyEndButton m={m} className="tgr-tile">
          <RangeArt part="end" />
          <b>Up to end</b>
          <small>{r?.date_end ?? "Apply end"}</small>
        </ApplyEndButton>
        <ApplyFullButton m={m} className="tgr-tile">
          <RangeArt part="full" />
          <b>Whole range</b>
          <small>Apply full range</small>
        </ApplyFullButton>
        <ApplyAfterButton m={m} className="tgr-tile alt">
          <RangeArt part="after" />
          <b>After it</b>
          <small>{r?.date_after ?? "After range"}</small>
        </ApplyAfterButton>
      </div>
      <Status m={m} />
      <CurrentFilter m={m} />
    </div>
  );
}

const VIEWS: CardViews<TagRangeModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function TagRangeCard(grid: GridProps) {
  const m = useTagRange();
  return <StyledCard cardId="tag-range" title="Tag Range" icon={<ICONS.tagRange />} prefix="tgr" m={m} views={VIEWS} grid={grid} />;
}
