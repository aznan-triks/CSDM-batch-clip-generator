/**
 * The Operations card's ONE data model: find demos (by the active tags, or by
 * the tags plus the window's whole configuration), pick some, tag or untag
 * them, and move tags in and out of a file.
 *
 * "By config" sends the window's settings as `cfg` -- the run model PREVIEW
 * uses -- never an empty object (audit 2026-09-15, E17).
 */
import { useState } from "react";

import { pickPath, pickSavePath, runCommand } from "../../bridge";
import { useAllSettings } from "../../settings/store";
import { useDatabase } from "../../settings/useDatabase";
import { activeTagNames, useActiveTags } from "./useTagGrid";

export interface FoundDemo {
  path: string;
  name: string;
  n_events: number;
  n_seq: number;
}

export const TIPS = {
  byTag: "Find demos that have all the selected tags applied",
  byConfig: "Find demos matching the selected tags plus the current filter settings",
  tagSel: "Apply the active tags to the selected demos",
  tagAll: "Apply the active tags to all found demos",
  removeSel: "Remove the active tags from the selected demos",
  exportTags: "Export the selected tags, or all tags if none are selected",
  importTags: "Import tags from a file; missing tags are created automatically",
} as const;

export interface TagOpsModel {
  activeNames: string[];
  found: FoundDemo[];
  /** How the list was found, once a search ran. */
  foundBy: "tag" | "config" | null;
  isPicked: (path: string) => boolean;
  pick: (path: string) => void;
  pickAll: (on: boolean) => void;
  picked: number;
  searchByTag: () => void;
  searchByConfig: () => void;
  tagSelected: () => void;
  tagAll: () => void;
  /** Opens the confirmation; the removal itself is `confirmRemove`. */
  askRemove: () => void;
  pendingRemove: boolean;
  cancelRemove: () => void;
  confirmRemove: () => void;
  exportTags: () => void;
  importTags: () => void;
  status: string;
}

interface ApplyResult {
  ok_count: number;
  total: number;
  first_error: string;
}

export function useTagOps(): TagOpsModel {
  const { database, reload } = useDatabase();
  const settings = useAllSettings();
  const [active] = useActiveTags();
  const names = activeTagNames(database?.tags ?? [], active);

  const [found, setFound] = useState<FoundDemo[]>([]);
  const [foundBy, setFoundBy] = useState<"tag" | "config" | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pendingRemove, setPendingRemove] = useState(false);
  const [status, setStatus] = useState("");

  async function guard(work: () => Promise<void>) {
    try {
      await work();
    } catch (cause) {
      setStatus((cause as Error).message);
    }
  }

  function search(by: "tag" | "config") {
    if (by === "tag" && active.length === 0) {
      setStatus("Select at least one tag.");
      return;
    }
    void guard(async () => {
      const result = await runCommand("tags_search", { tag_ids: active, cfg: by === "config" ? settings : null });
      const demos = (result.data as { demos?: FoundDemo[] }).demos ?? [];
      setFound(demos);
      setFoundBy(by);
      setPicked(new Set());
      setStatus(`${demos.length} demo(s) found.`);
    });
  }

  function tagDemos(paths: string[]) {
    if (names.length === 0) return setStatus("Select at least one tag.");
    if (paths.length === 0) return setStatus("Select demos from the list.");
    void guard(async () => {
      const result = await runCommand("tags_apply", { tag_names: names, demo_paths: paths });
      const data = result.data as ApplyResult;
      setStatus(data.ok_count === data.total ? `Tagged ${paths.length} demo(s).` : `${data.ok_count}/${data.total} OK -- ${data.first_error}`);
    });
  }

  function removeSelected() {
    const paths = [...picked];
    if (names.length === 0) return setStatus("Select at least one tag.");
    if (paths.length === 0) return setStatus("Select demos.");
    void guard(async () => {
      const result = await runCommand("tags_remove", { tag_names: names, demo_paths: paths });
      const data = result.data as ApplyResult;
      setStatus(data.ok_count === data.total ? `Removed from ${paths.length} demo(s).` : `${data.ok_count}/${data.total} OK -- ${data.first_error}`);
    });
  }

  return {
    activeNames: names,
    found,
    foundBy,
    isPicked: (path) => picked.has(path),
    pick: (path) =>
      setPicked((previous) => {
        const next = new Set(previous);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    pickAll: (on) => setPicked(on ? new Set(found.map((d) => d.path)) : new Set()),
    picked: picked.size,
    searchByTag: () => search("tag"),
    searchByConfig: () => search("config"),
    tagSelected: () => tagDemos([...picked]),
    tagAll: () => tagDemos(found.map((d) => d.path)),
    askRemove: () => setPendingRemove(true),
    pendingRemove,
    cancelRemove: () => setPendingRemove(false),
    confirmRemove: () => {
      setPendingRemove(false);
      removeSelected();
    },
    exportTags: () =>
      void guard(async () => {
        const path = await pickSavePath({ defaultName: "tags-export.json" });
        if (!path) return;
        const result = await runCommand("tags_export", { path, tag_ids: active.length > 0 ? active : null });
        const data = result.data as { tag_count: number; demo_count: number };
        setStatus(`Exported ${data.tag_count} tag(s), ${data.demo_count} demo(s).`);
      }),
    importTags: () =>
      void guard(async () => {
        const path = await pickPath({ file: true });
        if (!path) return;
        const scan = await runCommand("tags_import_scan", { path });
        const missing = (scan.data as { missing_tags?: { name: string; color: string }[] }).missing_tags ?? [];
        const result = await runCommand("tags_import_apply", { path, tags_to_create: missing });
        const data = result.data as { ok_count: number; skip_count: number; fail_count: number };
        setStatus(`Imported: ${data.ok_count} OK, ${data.skip_count} skipped, ${data.fail_count} failed.`);
        reload();
      }),
    status,
  };
}
