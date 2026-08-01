/**
 * The Tags tab: the tag grid, TAG RANGE and OPERATIONS.
 *
 * Ported from `_tab_tags` in csdm_batch_clips_generator.py. Every tag
 * operation goes through a bridge command delivered by chantier4d-bis
 * (`csdm/bridge/host.py`'s `_cmd_tags_*`/`_cmd_tag_*`, backed by the engine
 * methods in `csdm/engine/core.py`) -- no tag logic is reimplemented here.
 *
 * The tag list itself comes from `useDatabase()` (`connect_db`'s `tags`
 * field), the same source `discover_database` already fills for the Capture
 * tab's other sections -- not a dedicated fetch, so Reload is just another
 * `connect_db` round trip.
 */
import { useEffect, useState } from "react";

import Card from "../components/Card";
import { ICONS } from "../icons";
import Field from "../components/Field";
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

interface RangeResult {
  date_start: string | null;
  date_end: string | null;
  date_after: string | null;
  demo_count: number;
}

export default function TagsTab() {
  const { database, error: dbError } = useDatabase();
  const tags = database?.tags ?? [];

  const [tagEnabled, setTagEnabled] = useSetting<boolean>("tag_enabled");
  const [, setDateFrom] = useSetting<string>("date_from");
  const [, setDateTo] = useSetting<string>("date_to");

  const [activeTagIds, setActiveTagIds] = useState<Set<number | string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  const [range, setRange] = useState<RangeResult | null>(null);
  const [rangeStatus, setRangeStatus] = useState("");

  const [foundDemos, setFoundDemos] = useState<FoundDemo[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [opStatus, setOpStatus] = useState("");

  const activeTagNames = tags.filter((t) => activeTagIds.has(t[0])).map((t) => t[1]);

  useEffect(() => {
    runCommand("tags_set_active", { tag_ids: [...activeTagIds] }).catch(() => {});
    // The engine's active-tag set only ever needs to mirror this tab's own
    // selection -- nothing else reads or drives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTagIds]);

  function toggleTag(tagId: number | string) {
    setActiveTagIds((previous) => {
      const next = new Set(previous);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  function deselectAll() {
    setActiveTagIds(new Set());
  }

  async function reload() {
    setOpStatus("Reloading…");
    try {
      await runCommand("connect_db");
      setOpStatus("Reloaded.");
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  async function deleteTag(tagId: number | string, tagName: string) {
    try {
      await runCommand("tag_delete", { tag_id: tagId });
      setActiveTagIds((previous) => {
        if (!previous.has(tagId)) return previous;
        const next = new Set(previous);
        next.delete(tagId);
        return next;
      });
      setOpStatus(`Deleted "${tagName}".`);
      await runCommand("connect_db");
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  async function createTag() {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    try {
      await runCommand("tag_create", { tag_name: trimmed, color: "#f97316" });
      setNewTagName("");
      setCreating(false);
      await runCommand("connect_db");
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  async function calcRange() {
    if (activeTagIds.size === 0) {
      setRangeStatus("Select at least one tag.");
      return;
    }
    setRangeStatus("Computing…");
    try {
      const result = await runCommand("tags_calc_range", { tag_ids: [...activeTagIds] });
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
    if (activeTagIds.size === 0) {
      setOpStatus("Select at least one tag.");
      return;
    }
    try {
      const result = await runCommand("tags_search", { tag_ids: [...activeTagIds], cfg: null });
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
      const result = await runCommand("tags_search", { tag_ids: [...activeTagIds], cfg: {} });
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
        tag_ids: activeTagIds.size > 0 ? [...activeTagIds] : null,
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
      await runCommand("connect_db");
    } catch (cause) {
      setOpStatus((cause as Error).message);
    }
  }

  return (
    <div className="bento tags-tab">
      <Card title="Tags" icon={<ICONS.tags />} className="wide">
        {dbError && <p className="tags-error">{dbError}</p>}

        <div className="chips">
          {tags.map(([tagId, tagName, color]) => {
            const active = activeTagIds.has(tagId);
            return (
              <button
                key={String(tagId)}
                type="button"
                className={active ? "chip on" : "chip"}
                aria-pressed={active}
                aria-label={`tag-${tagName}`}
                onClick={() => toggleTag(tagId)}
              >
                {/* The mock's own `.d` dot, which exists for exactly this and
                    was never used here. The tag's colour rides on the dot in
                    BOTH states: painting the border and the text instead meant
                    a tag showed nothing at rest -- the state it is in when the
                    tab opens -- and once picked, `.chip.on` kept its lime fill
                    on top, so a blue tag read as green either way. */}
                <span className="d" style={{ background: color }} aria-hidden="true" />
                {tagName}
              </button>
            );
          })}
        </div>

        <div className="row">
          <span className="lab">Delete:</span>
          {tags.map(([tagId, tagName]) => (
            <button
              key={`del-${String(tagId)}`}
              type="button"
              className="chip danger"
              aria-label={`delete-tag-${tagName}`}
              onClick={() => deleteTag(tagId, tagName)}
            >
              {tagName} ×
            </button>
          ))}
        </div>

        <div className="row">
          <button type="button" className="chip" onClick={() => setCreating((v) => !v)}>
            + New tag
          </button>
          <button type="button" className="chip" onClick={reload}>
            Reload
          </button>
          <button type="button" className="chip push-right" onClick={deselectAll}>
            Deselect all
          </button>
        </div>

        {creating && (
          <div className="row">
            <Field id="new-tag-name" value={newTagName} onChange={setNewTagName} placeholder="Tag name" />
            <button type="button" className="chip" onClick={createTag}>
              Create
            </button>
          </div>
        )}

        <p className="tags-selection">
          {activeTagNames.length > 0 ? `Selected: ${activeTagNames.join(", ")}` : "No tag selected"}
        </p>

        <SettingControl settingKey="tag_enabled">
          <label className="row">
            <input
              type="checkbox"
              checked={!!tagEnabled}
              onChange={(event) => setTagEnabled(event.target.checked)}
            />
            Auto-tag on export
          </label>
        </SettingControl>
      </Card>

      <Card title="Tag Range" icon={<ICONS.tagRange />}>
        <p className="tags-hint">
          Calculates the first and last demo with the selected tags, and suggests applying these
          dates as a filter in Capture.
        </p>
        <div className="row">
          <button type="button" className="chip" onClick={calcRange}>
            Calculate range
          </button>
        </div>
        {rangeStatus && <p className="tags-range-status">{rangeStatus}</p>}
        <div className="row">
          <button type="button" className="chip" disabled={!range?.date_start} onClick={applyStart}>
            Apply start
          </button>
          <button type="button" className="chip" disabled={!range?.date_end} onClick={applyEnd}>
            Apply end
          </button>
          <button
            type="button"
            className="chip"
            disabled={!range?.date_start || !range?.date_end}
            onClick={applyFullRange}
          >
            Apply full range
          </button>
          <button type="button" className="chip" disabled={!range?.date_after} onClick={applyAfterRange}>
            After range
          </button>
        </div>
      </Card>

      <Card title="Operations" icon={<ICONS.operations />} className="wide">
        <div className="row">
          <span className="lab">Search:</span>
          <button type="button" className="chip" onClick={searchByTag}>
            By tag
          </button>
          <button type="button" className="chip" onClick={searchByConfig}>
            By config
          </button>
        </div>
        <div className="row">
          <span className="lab">Actions:</span>
          <button
            type="button"
            className="chip"
            onClick={() => tagDemos([...selectedPaths])}
          >
            Tag sel.
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => tagDemos(foundDemos.map((d) => d.path))}
          >
            Tag ALL
          </button>
          <button type="button" className="chip danger" onClick={removeSelected}>
            Remove sel.
          </button>
        </div>
        <div className="row">
          <span className="lab">Transfer:</span>
          <button type="button" className="chip" onClick={exportTags}>
            Export
          </button>
          <button type="button" className="chip" onClick={importTags}>
            Import
          </button>
        </div>

        <ul className="tags-found-list">
          {foundDemos.map((demo) => (
            <li key={demo.path} className="tags-found-row">
              <input
                type="checkbox"
                checked={selectedPaths.has(demo.path)}
                onChange={() => toggleDemo(demo.path)}
              />
              <span>{demo.name}</span>
            </li>
          ))}
        </ul>

        {opStatus && <p className="tags-op-status">{opStatus}</p>}
      </Card>
    </div>
  );
}
