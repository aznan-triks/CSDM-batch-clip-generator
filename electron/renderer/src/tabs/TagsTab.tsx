/**
 * The Tags tab: the tag grid, TAG RANGE and OPERATIONS.
 *
 * Ported from `_tab_tags` in csdm_batch_clips_generator.py. Every tag
 * operation goes through a bridge command delivered by chantier4d-bis
 * (`csdm/bridge/host.py`'s `_cmd_tags_*`/`_cmd_tag_*`, backed by the engine
 * methods in `csdm/engine/core.py`) -- no tag logic is reimplemented here.
 *
 * The tag list comes from `useDatabase()` (`connect_db`'s `tags` field), the
 * same source `discover_database` already fills for the Capture tab's other
 * sections. Reload, and the refresh after create/delete/import, go through
 * `useDatabase().reload()` so the shared state actually updates -- the naked
 * `connect_db` the old code fired did nothing visible, which is the bug
 * AUDIT_tabs-state.md pinned.
 *
 * The active-tag selection is persisted under `ui_active_tags` (spec
 * Section C): the chips write it through the settings store, which saves it to
 * disk, instead of a `useState` that dies with the tab. The search text and
 * sort are view state, kept alive by tab keep-alive but never written to disk.
 */
import { useEffect, useState } from "react";

import Card from "../components/Card";
import Chip from "../components/Chip";
import ConfirmDialog from "../components/ConfirmDialog";
import Field from "../components/Field";
import Segmented from "../components/Segmented";
import { ICONS } from "../icons";
import { pickPath, pickSavePath, runCommand } from "../bridge";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import { useDatabase } from "../settings/useDatabase";
import "./TagsTab.css";

interface FoundDemo {
  path: string;
  name: string;
  n_events: number;
  n_seq: number;
}

/**
 * `TAG_PRESET_COLORS` (`csdm/static_data.py`), mirrored the same way
 * `theme/accent.ts` mirrors `_ACCENT_PRESETS`: a fixed design table, not a
 * setting, so it is a constant here rather than a round trip through the
 * bridge. Python's own tag-creation dialog (`ColorPickerDialog`,
 * `csdm/widgets.py`) offers these 20 swatches plus free hex entry -- the
 * Electron port used to hardcode the first one and call it done.
 */
const TAG_COLOR_PRESETS = [
  "#f97316", "#ef4444", "#eab308", "#22c55e", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e", "#6366f1",
  "#0ea5e9", "#84cc16", "#d946ef", "#f59e0b", "#10b981",
  "#6b7280", "#a855f7", "#e11d48", "#0891b2", "#65a30d",
] as const;

/** Sort orders for the tag grid (view state, never persisted). */
type TagSort = "name" | "color" | "active-first";

const TAG_SORTS: readonly TagSort[] = ["name", "color", "active-first"];

interface RangeResult {
  date_start: string | null;
  date_end: string | null;
  date_after: string | null;
  demo_count: number;
}

/** A tag whose × was clicked, waiting on the ConfirmDialog. */
interface PendingTagDelete {
  tagId: number | string;
  tagName: string;
}

export default function TagsTab() {
  const { database, error: dbError, reload } = useDatabase();
  const tags = database?.tags ?? [];

  const [tagEnabled, setTagEnabled] = useSetting<boolean>("tag_enabled");
  const [, setDateFrom] = useSetting<string>("date_from");
  const [, setDateTo] = useSetting<string>("date_to");

  // Persisted selection. The store holds arrays, so the `Set` the old state
  // kept is replaced by `includes`/`filter` over the array instead.
  const [activeTagIdsSetting, setActiveTagIds] = useSetting<Array<number | string>>("ui_active_tags");
  const activeTagIds: Array<number | string> = activeTagIdsSetting ?? [];

  const [creating, setCreating] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<string>(TAG_COLOR_PRESETS[0]);

  const [tagSearch, setTagSearch] = useState("");
  const [tagSort, setTagSort] = useState<TagSort>("name");

  const [pendingDelete, setPendingDelete] = useState<PendingTagDelete | null>(null);
  const [pendingRemove, setPendingRemove] = useState(false);

  const [range, setRange] = useState<RangeResult | null>(null);
  const [rangeStatus, setRangeStatus] = useState("");

  const [foundDemos, setFoundDemos] = useState<FoundDemo[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [opStatus, setOpStatus] = useState("");

  const activeTagNames = tags.filter((t) => activeTagIds.includes(t[0])).map((t) => t[1]);

  useEffect(() => {
    runCommand("tags_set_active", { tag_ids: activeTagIdsSetting ?? [] }).catch(() => {});
    // The engine's active-tag set only ever needs to mirror this tab's own
    // selection -- nothing else reads or drives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTagIdsSetting]);

  /** Search by name, case-insensitive; then order by the chosen sort. */
  const visibleTags = [...tags]
    .filter(([, name]) => name.toLowerCase().includes(tagSearch.toLowerCase()))
    .sort((a, b) => {
      if (tagSort === "name") return a[1].localeCompare(b[1]);
      if (tagSort === "color") return a[2].localeCompare(b[2]);
      const aActive = activeTagIds.includes(a[0]) ? 0 : 1;
      const bActive = activeTagIds.includes(b[0]) ? 0 : 1;
      return aActive - bActive || a[1].localeCompare(b[1]);
    });

  function toggleTag(tagId: number | string) {
    const next = activeTagIds.includes(tagId)
      ? activeTagIds.filter((id) => id !== tagId)
      : [...activeTagIds, tagId];
    setActiveTagIds(next);
  }

  function deselectAll() {
    setActiveTagIds([]);
  }

  function reloadTags() {
    reload();
    setOpStatus("Reloaded.");
  }

  /** The real delete, reached only through ConfirmDialog (spec Section C). */
  async function deleteTagDirect(tagId: number | string, tagName: string) {
    try {
      await runCommand("tag_delete", { tag_id: tagId });
      setActiveTagIds(activeTagIds.filter((id) => id !== tagId));
      setOpStatus(`Deleted "${tagName}".`);
      reload();
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  async function createTag() {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    try {
      await runCommand("tag_create", { tag_name: trimmed, color: newTagColor });
      setNewTagName("");
      setNewTagColor(TAG_COLOR_PRESETS[0]);
      setCreating(false);
      reload();
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  async function calcRange() {
    if (activeTagIds.length === 0) {
      setRangeStatus("Select at least one tag.");
      return;
    }
    setRangeStatus("Computing…");
    try {
      const result = await runCommand("tags_calc_range", { tag_ids: activeTagIds });
      const data = result.data as RangeResult;
      setRange(data);
      setRangeStatus(
        data.date_start && data.date_end
          ? `${data.demo_count} demo(s) -- start: ${data.date_start}  end: ${data.date_end}`
          : `${data.demo_count} demo(s) -- dates unavailable.`,
      );
    } catch (cause) {
      setRangeStatus((cause as Error).message);
    }
  }

  function applyStart() {
    if (range?.date_start) setDateFrom(range.date_start);
  }

  function applyEnd() {
    if (range?.date_end) setDateTo(range.date_end);
  }

  function applyFullRange() {
    if (range?.date_start && range?.date_end) {
      setDateFrom(range.date_start);
      setDateTo(range.date_end);
    }
  }

  function applyAfterRange() {
    if (range?.date_after) {
      setDateFrom(range.date_after);
      setDateTo("");
    }
  }

  async function searchByTag() {
    if (activeTagIds.length === 0) {
      setOpStatus("Select at least one tag.");
      return;
    }
    try {
      const result = await runCommand("tags_search", { tag_ids: activeTagIds, cfg: null });
      const data = result.data as { demos: FoundDemo[] };
      setFoundDemos(data.demos ?? []);
      setSelectedPaths(new Set());
      setOpStatus(`${data.demos?.length ?? 0} demo(s) found.`);
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  async function searchByConfig() {
    try {
      const result = await runCommand("tags_search", { tag_ids: activeTagIds, cfg: {} });
      const data = result.data as { demos: FoundDemo[] };
      setFoundDemos(data.demos ?? []);
      setSelectedPaths(new Set());
      setOpStatus(`${data.demos?.length ?? 0} demo(s) found.`);
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  function toggleDemo(path: string) {
    setSelectedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function tagDemos(demoPaths: string[]) {
    if (activeTagNames.length === 0) {
      setOpStatus("Select at least one tag.");
      return;
    }
    if (demoPaths.length === 0) {
      setOpStatus("Select demos from the list.");
      return;
    }
    try {
      const result = await runCommand("tags_apply", { tag_names: activeTagNames, demo_paths: demoPaths });
      const data = result.data as { ok_count: number; total: number; first_error: string };
      setOpStatus(
        data.ok_count === data.total
          ? `Tagged ${demoPaths.length} demo(s).`
          : `${data.ok_count}/${data.total} OK -- ${data.first_error}`,
      );
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  /** The real removal, reached only through ConfirmDialog. */
  async function removeSelected() {
    const demoPaths = [...selectedPaths];
    if (activeTagNames.length === 0) {
      setOpStatus("Select at least one tag.");
      return;
    }
    if (demoPaths.length === 0) {
      setOpStatus("Select demos.");
      return;
    }
    try {
      const result = await runCommand("tags_remove", { tag_names: activeTagNames, demo_paths: demoPaths });
      const data = result.data as { ok_count: number; total: number; first_error: string };
      setOpStatus(
        data.ok_count === data.total
          ? `Removed from ${demoPaths.length} demo(s).`
          : `${data.ok_count}/${data.total} OK -- ${data.first_error}`,
      );
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  async function exportTags() {
    const path = await pickSavePath({ defaultName: "tags-export.json" });
    if (!path) return;
    try {
      const result = await runCommand("tags_export", {
        path,
        tag_ids: activeTagIds.length > 0 ? activeTagIds : null,
      });
      const data = result.data as { tag_count: number; demo_count: number };
      setOpStatus(`Exported ${data.tag_count} tag(s), ${data.demo_count} demo(s).`);
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  async function importTags() {
    const path = await pickPath({ file: true });
    if (!path) return;
    try {
      const scan = await runCommand("tags_import_scan", { path });
      const scanData = scan.data as { missing_tags: { name: string; color: string }[] };
      const result = await runCommand("tags_import_apply", {
        path,
        tags_to_create: scanData.missing_tags ?? [],
      });
      const data = result.data as { ok_count: number; skip_count: number; fail_count: number };
      setOpStatus(`Imported: ${data.ok_count} OK, ${data.skip_count} skipped, ${data.fail_count} failed.`);
      reload();
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  return (
    <div className="bento tags-tab">
      <Card title="Tags" icon={<ICONS.tags />} className="wide">
        {dbError && <p className="tags-error">{dbError}</p>}

        <div className="tags-toolbar">
          <Field id="tag-search" value={tagSearch} onChange={setTagSearch} placeholder="Filter tags…" />
          <Segmented options={TAG_SORTS} value={tagSort} onChange={(next) => setTagSort(next as TagSort)} label="Sort tags" />
        </div>

        <div className="chips">
          {visibleTags.map(([tagId, tagName, color]) => {
            const active = activeTagIds.includes(tagId);
            return (
              <span key={String(tagId)} className="tag-pair">
                <button
                  type="button"
                  className={active ? "chip on" : "chip"}
                  aria-pressed={active}
                  aria-label={`tag-${tagName}`}
                  title="Toggle this tag as an active filter for search and tagging below"
                  data-action="I3"
                  onClick={() => toggleTag(tagId)}
                >
                  <span className="d" style={{ background: color }} aria-hidden="true" />
                  {tagName}
                </button>
                <button
                  type="button"
                  className="chip tag-del"
                  aria-label={`delete-tag-${tagName}`}
                  title="Permanently delete this tag from the database"
                  data-action="I2"
                  onClick={() => setPendingDelete({ tagId, tagName })}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>

        <div className="row">
          <button type="button" className="chip" data-action="I1" onClick={() => setCreating((v) => !v)}>
            + New tag
          </button>
          <button type="button" className="chip" data-action="I17" onClick={reloadTags}>
            Reload
          </button>
          <button type="button" className="chip push-right" data-action="I4" onClick={deselectAll}>
            Deselect all
          </button>
        </div>

        {creating && (
          <div className="row tag-create">
            <Field id="new-tag-name" value={newTagName} onChange={setNewTagName} placeholder="Tag name" />
            <div className="tag-swatches" role="radiogroup" aria-label="Tag colour">
              {TAG_COLOR_PRESETS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={newTagColor === hex}
                  aria-label={`colour-${hex}`}
                  className={newTagColor === hex ? "tag-swatch tag-swatch-selected" : "tag-swatch"}
                  style={{ backgroundColor: hex }}
                  title="Use this color for the new tag"
                  onClick={() => setNewTagColor(hex)}
                />
              ))}
              <label className="tag-swatch-custom">
                <span>Custom…</span>
                <input type="color" value={newTagColor} onChange={(event) => setNewTagColor(event.target.value)} />
              </label>
            </div>
            <button type="button" className="chip" data-action="I1" onClick={createTag}>
              Create
            </button>
          </div>
        )}

        <p className="tags-selection">
          {activeTagNames.length > 0 ? `Selected: ${activeTagNames.join(", ")}` : "No tag selected"}
        </p>

        <SettingControl settingKey="tag_enabled">
          <Chip
            label="Auto-tag on export"
            selected={!!tagEnabled}
            onToggle={() => setTagEnabled(!tagEnabled)}
            tip="Automatically apply the selected tag(s) to demos when clips are exported"
          />
        </SettingControl>
      </Card>

      <Card title="Tag Range" icon={<ICONS.tagRange />}>
        <p className="tags-hint">
          Calculates the first and last demo with the selected tags, and suggests applying these
          dates as a filter in Capture.
        </p>
        <div className="row">
          <button type="button" className="chip" data-action="I7" onClick={calcRange}>
            Calculate range
          </button>
        </div>
        {rangeStatus && <p className="tags-range-status">{rangeStatus}</p>}
        <div className="row">
          <button type="button" className="chip" disabled={!range?.date_start} data-action="I8" onClick={applyStart}>
            Apply start
          </button>
          <button type="button" className="chip" disabled={!range?.date_end} data-action="I9" onClick={applyEnd}>
            Apply end
          </button>
          <button
            type="button"
            className="chip"
            disabled={!range?.date_start || !range?.date_end}
            data-action="I10" onClick={applyFullRange}
          >
            Apply full range
          </button>
          <button
            type="button"
            className="chip"
            disabled={!range?.date_after}
            title="Set the date filter to everything after this tag's most recent demo"
            data-action="I11" onClick={applyAfterRange}
          >
            After range
          </button>
        </div>
      </Card>

      <Card title="Operations" icon={<ICONS.operations />} className="wide">
        <div className="row">
          <span className="lab">Search:</span>
          <button
            type="button"
            className="chip"
            title="Find demos that have all the selected tags applied"
            data-action="I5" onClick={searchByTag}
          >
            By tag
          </button>
          <button
            type="button"
            className="chip"
            title="Find demos matching the selected tags plus the current filter settings"
            data-action="I6" onClick={searchByConfig}
          >
            By config
          </button>
        </div>
        <div className="row">
          <span className="lab">Actions:</span>
          <button
            type="button"
            className="chip"
            data-action="I12" onClick={() => tagDemos([...selectedPaths])}
          >
            Tag sel.
          </button>
          <button
            type="button"
            className="chip"
            data-action="I13" onClick={() => tagDemos(foundDemos.map((d) => d.path))}
          >
            Tag ALL
          </button>
          <button
            type="button"
            className="chip danger"
            data-action="I14"
            onClick={() => setPendingRemove(true)}
          >
            Remove sel.
          </button>
        </div>
        <div className="row">
          <span className="lab">Transfer:</span>
          <button
            type="button"
            className="chip"
            title="Export the selected tags, or all tags if none are selected"
            data-action="I15" onClick={exportTags}
          >
            Export
          </button>
          <button
            type="button"
            className="chip"
            title="Import tags from a file; missing tags are created automatically"
            data-action="I16" onClick={importTags}
          >
            Import
          </button>
        </div>

        <ul className="tags-found-list">
          {foundDemos.map((demo) => (
            <li key={demo.path} className="tags-found-row">
              <input
                type="checkbox"
                className="tags-found-check"
                checked={selectedPaths.has(demo.path)}
                onChange={() => toggleDemo(demo.path)}
              />
              <span>{demo.name}</span>
            </li>
          ))}
        </ul>

        {opStatus && <p className="tags-op-status">{opStatus}</p>}
      </Card>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete tag"
          message={`Delete tag "${pendingDelete.tagName}"? This cannot be undone.`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteTagDirect(pendingDelete.tagId, pendingDelete.tagName);
            setPendingDelete(null);
          }}
          danger
        />
      )}

      {pendingRemove && (
        <ConfirmDialog
          title="Remove tags"
          message={`Remove ${activeTagNames.length} tag(s) from ${selectedPaths.size} selected demo(s)? This cannot be undone.`}
          onCancel={() => setPendingRemove(false)}
          onConfirm={() => {
            setPendingRemove(false);
            removeSelected();
          }}
          danger
        />
      )}
    </div>
  );
}
