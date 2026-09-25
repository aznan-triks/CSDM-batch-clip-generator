/**
 * The Final Assembly card: what happens to the clips once the batch ends,
 * drawn in the card's style (read live) over one model.
 *
 *   - timeline: the clips flowing into the final file, a switch on each step;
 *   - sentence: one paragraph whose words are the choices;
 *   - tiles: one big tile per switch, the file name under them.
 */
import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import StyledCard, { type Views } from "../videoKit/StyledCard";
import { GLYPHS } from "../videoKit/glyphs";
import { BoolTile, BoolWord, Switch, TextRow, TextWord } from "../videoKit/parts";
import { useFinalAssembly, type FinalAssemblyModel } from "./useFinalAssembly";
import "./FinalAssembly.css";

/** Five clips in two sequences: enough to show sequences joining. */
const CLIP_SEQUENCES = [3, 2] as const;

function TimelineView({ m }: { m: FinalAssemblyModel }) {
  return (
    <div className="fa-a">
      <div className="fa-flow">
        <div className="fa-stage" aria-label="Recorded clips">
          <span className="vk-kick">Clips</span>
          <div className="fa-seqs">
            {CLIP_SEQUENCES.map((n, s) => (
              <div className={m.concat.on ? "fa-seq joined" : "fa-seq"} key={s}>
                {Array.from({ length: n }, (_, i) => (
                  <span className={`fa-clip s${s}`} key={i}>
                    {GLYPHS.clip}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <Switch b={m.concat} />
        </div>
        <span className={m.assemble.on ? "fa-arrow" : "fa-arrow off"} aria-hidden="true" />
        <div className={m.assemble.on ? "fa-stage fa-out" : "fa-stage fa-out ghost"} aria-label="Final video">
          <span className="vk-kick">Final video</span>
          <span className="fa-file" title={m.fileName}>
            {GLYPHS.film}
            <b>{m.fileName}</b>
          </span>
          <Switch b={m.assemble} />
        </div>
      </div>
      <TextRow t={m.output} id="fa-output" mono />
      <div className="fa-foot">
        <Switch b={m.deleteSources} label="Delete source clips after assembly" />
        {m.deleteSources.on && !m.assemble.on && <span className="vk-warn">only when assembling</span>}
      </div>
      <p className="vk-hint" data-testid="assembly-summary">
        {m.summary}
      </p>
    </div>
  );
}

function SentenceView({ m }: { m: FinalAssemblyModel }) {
  return (
    <div className="vk-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">When the batch ends,</span>{" "}
          <BoolWord b={m.assemble} on="join every clip" off="keep the clips apart" />
          {m.assemble.on && (
            <>
              {" "}
              <span className="w">into</span> <TextWord t={m.output} id="fa-output" empty="assembled.mp4" mono />
            </>
          )}
          <span className="w">.</span>
        </div>
        <div className="sc-line">
          <BoolWord b={m.concat} on="Merge" off="Don't merge" tone="alt" />{" "}
          <span className="w">the clips of one sequence first, then</span>{" "}
          <BoolWord b={m.deleteSources} on="delete" off="keep" tone="alt" />{" "}
          <span className="w">the source clips{m.assemble.on ? "." : " (only when assembling)."}</span>
        </div>
      </div>
      {!m.assemble.on && <TextRow t={m.output} id="fa-output-idle" mono />}
    </div>
  );
}

function TilesView({ m }: { m: FinalAssemblyModel }) {
  return (
    <div className="vk-c">
      <div className="vk-tiles three">
        <BoolTile b={m.assemble} icon={GLYPHS.film} subtitle="one video at the end" />
        <BoolTile b={m.concat} icon={GLYPHS.join} subtitle="merge a sequence first" />
        <BoolTile
          b={m.deleteSources}
          icon={GLYPHS.trash}
          subtitle={m.assemble.on ? "once assembled" : "needs assembly on"}
          warn={m.deleteSources.on && !m.assemble.on}
        />
      </div>
      <TextRow t={m.output} id="fa-output" mono />
    </div>
  );
}

const VIEWS: Views<FinalAssemblyModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function FinalAssemblyCard(grid: GridProps) {
  const m = useFinalAssembly();
  return (
    <StyledCard
      id="final-assembly"
      title="Final Assembly"
      icon={<ICONS.finalAssembly />}
      prefix="fa"
      m={m}
      views={VIEWS}
      count={m.assemble.on ? m.fileName : "off"}
      grid={grid}
    />
  );
}
