/**
 * The Tags card's ONE data model: the tag list, the active selection, the
 * new-tag form, the delete confirmation and Auto-tag on export.
 *
 * Every card style draws this and nothing else. The selection is the
 * persisted `ui_active_tags` (spec Section C) -- the Tag Range and Operations
 * cards read the same key, so the three cards agree without talking. Search
 * and sort are view state: kept while the tab lives, never written to disk.
 *
 * Every tag operation is a bridge command (`csdm/bridge/host.py`'s
 * `_cmd_tag_*`); the list itself comes from `useDatabase()` and is refreshed
 * through its `reload()`, so every reader of the shared state sees the change.
 */
import { useState } from "react";

import { runCommand } from "../../bridge";
import { useSetting } from "../../settings/store";
import { useDatabase, type TagRow } from "../../settings/useDatabase";

/**
 * `TAG_PRESET_COLORS` (`csdm/static_data.py`), mirrored the way
 * `theme/accent.ts` mirrors `_ACCENT_PRESETS`: a fixed design table, not a
 * setting. Python's own tag dialog offered these 20 swatches plus a free hex.
 */
export const TAG_COLOR_PRESETS = [
  "#f97316", "#ef4444", "#eab308", "#22c55e", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e", "#6366f1",
  "#0ea5e9", "#84cc16", "#d946ef", "#f59e0b", "#10b981",
  "#6b7280", "#a855f7", "#e11d48", "#0891b2", "#65a30d",
] as const;

/** Sort orders for the tag grid (view state, never persisted). */
export const TAG_SORTS = ["name", "color", "active-first"] as const;
export type TagSort = (typeof TAG_SORTS)[number];

export type TagId = number | string;

export const TIPS = {
  tag: "Toggle this tag as an active filter for search and tagging below",
  delete: "Permanently delete this tag from the database",
  search: "Filter displayed tags by name",
  sort: "Sort tags by name, color, or show active tags first",
  create: "Open form to create a new tag",
  reload: "Reload tags from database",
  deselect: "Deselect all active tags",
  autoTag: "Automatically apply the selected tag(s) to demos when clips are exported",
  color: "Use this color for the new tag",
} as const;

export interface TagGridModel {
  /** The database's answer when it could not be read. */
  error: string | null;
  tags: readonly TagRow[];
  /** The tags matching the search, in the chosen order. */
  visible: readonly TagRow[];
  search: string;
  setSearch: (value: string) => void;
  sort: TagSort;
  setSort: (value: TagSort) => void;
  isActive: (id: TagId) => boolean;
  toggle: (id: TagId) => void;
  activeNames: string[];
  deselectAll: () => void;
  reload: () => void;
  /** The last operation's outcome, in words. */
  status: string;
  form: {
    open: boolean;
    setOpen: (open: boolean) => void;
    name: string;
    setName: (value: string) => void;
    color: string;
    setColor: (value: string) => void;
    submit: () => void;
  };
  /** The tag waiting on its delete confirmation. */
  pendingDelete: { id: TagId; name: string } | null;
  askDelete: (id: TagId, name: string) => void;
  cancelDelete: () => void;
  confirmDelete: () => void;
  autoTag: { key: string; on: boolean; tip: string; toggle: () => void };
}

/** The persisted selection, shared by the three Tags-tab cards. */
export function useActiveTags(): [TagId[], (next: TagId[]) => void] {
  const [raw, set] = useSetting<TagId[]>("ui_active_tags");
  return [Array.isArray(raw) ? raw : [], set];
}

/** The names of the active tags, in list order: what `tags_apply` takes. */
export function activeTagNames(tags: readonly TagRow[], active: readonly TagId[]): string[] {
  return tags.filter((t) => active.includes(t[0])).map((t) => t[1]);
}

export function useTagGrid(): TagGridModel {
  const { database, error, reload } = useDatabase();
  const tags = database?.tags ?? [];
  const [active, setActive] = useActiveTags();
  const [tagEnabled, setTagEnabled] = useSetting<boolean>("tag_enabled");

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TagSort>("name");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLOR_PRESETS[0]);
  const [pendingDelete, setPendingDelete] = useState<{ id: TagId; name: string } | null>(null);

  const visible = tags
    .filter(([, n]) => n.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === "name") return a[1].localeCompare(b[1]);
      if (sort === "color") return a[2].localeCompare(b[2]);
      const rank = (t: TagRow) => (active.includes(t[0]) ? 0 : 1);
      return rank(a) - rank(b) || a[1].localeCompare(b[1]);
    });

  async function deleteTag(id: TagId, tagName: string) {
    try {
      await runCommand("tag_delete", { tag_id: id });
      setActive(active.filter((a) => a !== id));
      setStatus(`Deleted "${tagName}".`);
      reload();
    } catch (cause) {
      setStatus((cause as Error).message);
    }
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus("The new tag needs a name.");
      return;
    }
    try {
      await runCommand("tag_create", { tag_name: trimmed, color });
      setName("");
      setColor(TAG_COLOR_PRESETS[0]);
      setOpen(false);
      setStatus(`Created "${trimmed}".`);
      reload();
    } catch (cause) {
      setStatus((cause as Error).message);
    }
  }

  return {
    error,
    tags,
    visible,
    search,
    setSearch,
    sort,
    setSort,
    isActive: (id) => active.includes(id),
    toggle: (id) => setActive(active.includes(id) ? active.filter((a) => a !== id) : [...active, id]),
    activeNames: activeTagNames(tags, active),
    deselectAll: () => setActive([]),
    reload: () => {
      reload();
      setStatus("Reloaded.");
    },
    status,
    form: { open, setOpen, name, setName, color, setColor, submit: () => void submit() },
    pendingDelete,
    askDelete: (id, tagName) => setPendingDelete({ id, name: tagName }),
    cancelDelete: () => setPendingDelete(null),
    confirmDelete: () => {
      if (pendingDelete) void deleteTag(pendingDelete.id, pendingDelete.name);
      setPendingDelete(null);
    },
    autoTag: {
      key: "tag_enabled",
      on: !!tagEnabled,
      tip: TIPS.autoTag,
      toggle: () => setTagEnabled(!tagEnabled),
    },
  };
}
