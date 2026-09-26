/**
 * The Operations card: one model (`useTagOps`), drawn in its card style.
 *
 *   - timeline: the job as three steps left to right -- find, pick, apply --
 *     with the tags file below;
 *   - sentence: "Find demos <with these tags> or <matching my filters>. Tag
 *     <the N picked> or <all N found> …";
 *   - tiles: one big tile per action, the found list under them.
 */
import ConfirmDialog from "../../components/ConfirmDialog";
import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import {
  ExportTagsButton,
  FoundList,
  ImportTagsButton,
  RemoveSelectedButton,
  SearchByConfigButton,
  SearchByTagButton,
  TagAllButton,
  TagSelectedButton,
} from "./actions";
import { useTagOps, type TagOpsModel } from "./useTagOps";
import "./TagCards.css";

function Status({ m }: { m: TagOpsModel }) {
  return m.status ? <p className="tags-op-status">{m.status}</p> : null;
}

function tagWords(names: readonly string[]): string {
  if (names.length === 0) return "the tags in use";
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function TimelineView({ m }: { m: TagOpsModel }) {
  return (
    <div className="tgo-a">
      <div className="tgo-steps">
        <section className="tgo-step" aria-label="Find">
          <span className="tgo-n">1</span>
          <b>Find demos</b>
          <div className="tgo-btns">
            <SearchByTagButton m={m} />
            <SearchByConfigButton m={m} />
          </div>
        </section>
        <section className="tgo-step grow" aria-label="Pick">
          <span className="tgo-n">2</span>
          <b>Pick</b>
          <FoundList m={m} />
        </section>
        <section className="tgo-step" aria-label="Apply">
          <span className="tgo-n">3</span>
          <b>Apply {tagWords(m.activeNames)}</b>
          <div className="tgo-btns">
            <TagSelectedButton m={m} />
            <TagAllButton m={m} />
            <RemoveSelectedButton m={m} />
          </div>
        </section>
      </div>
      <div className="tg-foot">
        <span className="sx-kick">Tags file</span>
        <ExportTagsButton m={m} />
        <ImportTagsButton m={m} />
      </div>
      <Status m={m} />
    </div>
  );
}

function SentenceView({ m }: { m: TagOpsModel }) {
  const n = m.found.length;
  return (
    <div className="tgo-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Find demos</span> <SearchByTagButton m={m} className="sx-act">tagged {tagWords(m.activeNames)}</SearchByTagButton>{" "}
          <span className="w">or</span> <SearchByConfigButton m={m} className="sx-act alt">that also match my Capture filters</SearchByConfigButton>
          <span className="w">.</span>
        </div>
        <div className="sc-line">
          <span className="w">Tag</span> <TagSelectedButton m={m} className="sx-act">the {m.picked} picked</TagSelectedButton>{" "}
          <span className="w">or</span> <TagAllButton m={m} className="sx-act">all {n} found</TagAllButton>{" "}
          <span className="w">with {tagWords(m.activeNames)}, or</span>{" "}
          <RemoveSelectedButton m={m} className="sx-act danger">untag the picked ones</RemoveSelectedButton>
          <span className="w">.</span>
        </div>
        <div className="sc-line">
          <span className="w">Tags file:</span> <ExportTagsButton m={m} className="sx-act">save to a file</ExportTagsButton>{" "}
          <span className="w">or</span> <ImportTagsButton m={m} className="sx-act">load from a file</ImportTagsButton>
          <span className="w">.</span>
        </div>
      </div>
      <FoundList m={m} />
      <Status m={m} />
    </div>
  );
}

const GLYPH = {
  find: <path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20" />,
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8z" />,
  tag: <path d="M4 4h8l8 8-8 8-8-8zM8 8h.01" />,
  tagAll: <path d="M3 6h7l7 7-6 6-8-8zM13 4l8 8-2 2" />,
  untag: <path d="M4 4h8l8 8-8 8-8-8zM9 13l6-6" />,
  save: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  load: <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />,
};

function Glyph({ d }: { d: keyof typeof GLYPH }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tgo-ic">
      {GLYPH[d]}
    </svg>
  );
}

function TilesView({ m }: { m: TagOpsModel }) {
  return (
    <div className="tgo-c">
      <div className="tgo-tiles">
        <SearchByTagButton m={m} className="tgo-tile">
          <Glyph d="find" />
          <b>Find by tag</b>
          <small>demos with every tag in use</small>
        </SearchByTagButton>
        <SearchByConfigButton m={m} className="tgo-tile">
          <Glyph d="filter" />
          <b>Find by config</b>
          <small>tags + Capture's filters</small>
        </SearchByConfigButton>
        <TagSelectedButton m={m} className="tgo-tile">
          <Glyph d="tag" />
          <b>Tag picked</b>
          <small>{m.picked} demo(s)</small>
        </TagSelectedButton>
        <TagAllButton m={m} className="tgo-tile">
          <Glyph d="tagAll" />
          <b>Tag all</b>
          <small>{m.found.length} found</small>
        </TagAllButton>
        <RemoveSelectedButton m={m} className="tgo-tile danger">
          <Glyph d="untag" />
          <b>Untag picked</b>
          <small>asks first</small>
        </RemoveSelectedButton>
        <ExportTagsButton m={m} className="tgo-tile alt">
          <Glyph d="save" />
          <b>Export</b>
          <small>tags to a file</small>
        </ExportTagsButton>
        <ImportTagsButton m={m} className="tgo-tile alt">
          <Glyph d="load" />
          <b>Import</b>
          <small>creates missing tags</small>
        </ImportTagsButton>
      </div>
      <FoundList m={m} />
      <Status m={m} />
    </div>
  );
}

const VIEWS: CardViews<TagOpsModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function TagOpsCard(grid: GridProps) {
  const m = useTagOps();
  return (
    <StyledCard
      cardId="operations"
      title="Operations"
      icon={<ICONS.operations />}
      prefix="tgo"
      m={m}
      views={VIEWS}
      grid={grid}
      count={m.found.length ? `${m.picked}/${m.found.length} picked` : undefined}
    >
      {m.pendingRemove && (
        <ConfirmDialog
          title="Remove tags"
          message={`Remove ${m.activeNames.length} tag(s) from ${m.picked} selected demo(s)? This cannot be undone.`}
          onCancel={m.cancelRemove}
          onConfirm={m.confirmRemove}
          danger
        />
      )}
    </StyledCard>
  );
}
