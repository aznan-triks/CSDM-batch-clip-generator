/**
 * The Tags tab: the tag grid, TAG RANGE and OPERATIONS.
 *
 * Ported from `_tab_tags` in csdm_batch_clips_generator.py. Every tag
 * operation goes through a bridge command delivered by chantier4d-bis
 * (`csdm/bridge/host.py`'s `_cmd_tags_*`/`_cmd_tag_*`, backed by the engine
 * methods in `csdm/engine/core.py`) -- no tag logic is reimplemented here.
 *
 * Each card is one data model drawn in its card style (`tagCards/`), on the
 * same card grid as the other tabs (`ui_sections.tags` in DEFAULT_CONFIG).
 * The three cards share the active-tag selection through the persisted
 * `ui_active_tags` key (spec Section C), never through state of their own.
 */
import { useEffect } from "react";

import { runCommand } from "../bridge";
import SectionList, { type SectionSpec } from "../shell/SectionList";
import { useSetting } from "../settings/store";
import TagGridCard from "./tagCards/TagGridCard";
import TagOpsCard from "./tagCards/TagOpsCard";
import TagRangeCard from "./tagCards/TagRangeCard";
import "./TagsTab.css";

const SECTIONS: SectionSpec[] = [
  { id: "tag-grid", element: <TagGridCard className="wide" /> },
  { id: "tag-range", element: <TagRangeCard /> },
  { id: "operations", element: <TagOpsCard /> },
];

export default function TagsTab() {
  const [activeTags] = useSetting<Array<number | string>>("ui_active_tags");

  // The engine's active-tag set mirrors the selection, whichever card (or
  // style) changed it. Here, at tab level, so a folded card cannot stop it.
  useEffect(() => {
    runCommand("tags_set_active", { tag_ids: activeTags ?? [] }).catch(() => {});
  }, [activeTags]);

  return (
    <div className="bento tags-tab">
      <SectionList tabId="tags" sections={SECTIONS} />
    </div>
  );
}
