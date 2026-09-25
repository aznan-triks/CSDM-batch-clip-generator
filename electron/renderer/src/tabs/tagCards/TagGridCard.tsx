/**
 * The Tags card: one model (`useTagGrid`), drawn in its card style.
 *
 *   - timeline: the selection as a tray above the palette of every tag --
 *     click a tag to move it in or out;
 *   - sentence: "Work with <these tags>. When clips are exported, <tag or
 *     leave> their demos.", each blue word opening its choices;
 *   - tiles: one big colour tile per tag, a tile to create one.
 */
import ConfirmDialog from "../../components/ConfirmDialog";
import Field from "../../components/Field";
import Segmented from "../../components/Segmented";
import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import { WordOptions, type WordOption } from "../../components/cardstyle/StyledParts";
import ToggleSwitch from "../../components/cardstyle/ToggleSwitch";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import { DeselectAllButton, NewTagButton, NewTagForm, ReloadTagsButton, TagChip, TagTile } from "./actions";
import { TAG_SORTS, TIPS, useTagGrid, type TagGridModel, type TagSort } from "./useTagGrid";
import "./TagCards.css";

function Toolbar({ m }: { m: TagGridModel }) {
  return (
    <div className="tags-toolbar">
      <Field id="tag-search" value={m.search} onChange={m.setSearch} placeholder="Filter tags…" tip={TIPS.search} />
      <Segmented options={TAG_SORTS} value={m.sort} onChange={(v) => m.setSort(v as TagSort)} label="Sort tags" tip={TIPS.sort} />
    </div>
  );
}

function AutoTag({ m }: { m: TagGridModel }) {
  return (
    <SettingControl settingKey={m.autoTag.key}>
      <ToggleSwitch label="Auto-tag on export" on={m.autoTag.on} tip={m.autoTag.tip} onToggle={m.autoTag.toggle} />
    </SettingControl>
  );
}

function Status({ m }: { m: TagGridModel }) {
  return (
    <>
      {m.error && <p className="tags-error">{m.error}</p>}
      {m.status && <p className="tg-status">{m.status}</p>}
    </>
  );
}

function EmptyTags({ m }: { m: TagGridModel }) {
  if (m.tags.length === 0) return <p className="tg-empty">No tag in the database yet. Create one with “+ New tag”.</p>;
  if (m.visible.length === 0) return <p className="tg-empty">No tag matches “{m.search}”.</p>;
  return null;
}

function TimelineView({ m }: { m: TagGridModel }) {
  const active = m.tags.filter((t) => m.isActive(t[0]));
  return (
    <div className="tg-a">
      <div className="tg-tray" aria-label="Active tags">
        <span className="sx-kick">In use</span>
        {active.length ? (
          active.map(([id, name, color]) => (
            <button key={String(id)} type="button" className="tg-pill" style={{ ["--tag" as string]: color }} title="Stop using this tag" onClick={() => m.toggle(id)}>
              <i aria-hidden="true" />
              {name}
              <span aria-hidden="true">×</span>
            </button>
          ))
        ) : (
          <span className="tg-tray-empty">No tag selected -- click a tag below to use it</span>
        )}
        <span className="tg-tray-end">
          <DeselectAllButton m={m} />
        </span>
      </div>
      <Toolbar m={m} />
      <div className="chips tg-palette">
        {m.visible.map((tag) => (
          <TagChip key={String(tag[0])} m={m} tag={tag} />
        ))}
      </div>
      <EmptyTags m={m} />
      <div className="tg-foot">
        <NewTagButton m={m} />
        <ReloadTagsButton m={m} />
        <span className="tg-foot-sep" aria-hidden="true" />
        <AutoTag m={m} />
      </div>
      {m.form.open && <NewTagForm m={m} />}
      <Status m={m} />
    </div>
  );
}

/** "Aces, Clutch and 2 more" -- the selection as words. */
function selectionWords(names: readonly string[]): string {
  if (names.length === 0) return "no tag yet";
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

const AUTO_TAG_OPTIONS: readonly WordOption<"on" | "off">[] = [
  { value: "on", words: "tag their demos", sub: "the tags in use are added to each exported demo" },
  { value: "off", words: "leave demos as they are", sub: "exporting never changes a demo's tags" },
];

function SentenceView({ m }: { m: TagGridModel }) {
  return (
    <div className="tg-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Work with</span>{" "}
          <SettingControl settingKey="ui_active_tags">
            <ChoiceToken
              label="Active tags"
              tip={TIPS.tag}
              popover={
                <>
                  <h5>Tags in use</h5>
                  <Toolbar m={m} />
                  <div className="chips tg-palette">
                    {m.visible.map((tag) => (
                      <TagChip key={String(tag[0])} m={m} tag={tag} />
                    ))}
                  </div>
                  <EmptyTags m={m} />
                  <div className="row">
                    <DeselectAllButton m={m} />
                  </div>
                </>
              }
            >
              {selectionWords(m.activeNames)}
            </ChoiceToken>
          </SettingControl>
          <span className="w">
            {" "}
            ({m.activeNames.length} of {m.tags.length} tags).
          </span>
        </div>
        <div className="sc-line">
          <span className="w">When clips are exported,</span>{" "}
          <SettingControl settingKey={m.autoTag.key}>
            <ChoiceToken
              label="Auto-tag on export"
              tone="alt"
              tip={m.autoTag.tip}
              popover={(close) => (
                <>
                  <h5>Auto-tag on export</h5>
                  <WordOptions
                    label="Auto-tag on export"
                    options={AUTO_TAG_OPTIONS}
                    value={m.autoTag.on ? "on" : "off"}
                    onChange={m.autoTag.toggle}
                    close={close}
                  />
                </>
              )}
            >
              {m.autoTag.on ? "tag their demos" : "leave demos as they are"}
            </ChoiceToken>
          </SettingControl>
          <span className="w">.</span>
        </div>
      </div>
      <div className="sx-links">
        <NewTagButton m={m} className="sx-act link">
          + New tag
        </NewTagButton>
        <ReloadTagsButton m={m} className="sx-act link">
          Reload from the database
        </ReloadTagsButton>
      </div>
      {m.form.open && <NewTagForm m={m} />}
      <Status m={m} />
    </div>
  );
}

function TilesView({ m }: { m: TagGridModel }) {
  return (
    <div className="tg-c">
      <Toolbar m={m} />
      <div className="tg-tiles">
        {m.visible.map((tag) => (
          <TagTile key={String(tag[0])} m={m} tag={tag} />
        ))}
        <NewTagButton m={m} className={m.form.open ? "tg-tile-new on" : "tg-tile-new"}>
          <span aria-hidden="true">+</span>
          <b>New tag</b>
        </NewTagButton>
      </div>
      <EmptyTags m={m} />
      {m.form.open && <NewTagForm m={m} />}
      <div className="tg-foot">
        <AutoTag m={m} />
        <span className="tg-foot-sep" aria-hidden="true" />
        <DeselectAllButton m={m} />
        <ReloadTagsButton m={m} />
      </div>
      <Status m={m} />
    </div>
  );
}

const VIEWS: CardViews<TagGridModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function TagGridCard(grid: GridProps) {
  const m = useTagGrid();
  return (
    <StyledCard cardId="tag-grid" title="Tags" icon={<ICONS.tags />} prefix="tg" m={m} views={VIEWS} grid={grid} count={`${m.activeNames.length} in use`}>
      {m.pendingDelete && (
        <ConfirmDialog
          title="Delete tag"
          message={`Delete tag "${m.pendingDelete.name}"? This cannot be undone.`}
          onCancel={m.cancelDelete}
          onConfirm={m.confirmDelete}
          danger
        />
      )}
    </StyledCard>
  );
}
