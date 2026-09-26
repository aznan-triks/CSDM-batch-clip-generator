/**
 * The Tag Range card's ONE data model: the dates of the first and last demo
 * carrying the active tags (`tags_calc_range`), and the four ways of turning
 * them into Capture's date filter (`date_from` / `date_to`).
 */
import { useState } from "react";

import { runCommand } from "../../bridge";
import { useSetting, useSettingsBatch } from "../../settings/store";
import { useDatabase } from "../../settings/useDatabase";
import { activeTagNames, useActiveTags } from "./useTagGrid";

export interface RangeResult {
  date_start: string | null;
  date_end: string | null;
  date_after: string | null;
  demo_count: number;
}

/** One way of applying the range; `run` is absent while it has nothing to apply. */
export interface RangeApply {
  title: string;
  tip: string;
  run: (() => void) | null;
}

export const TIPS = {
  calc: "Compute the earliest and latest demo dates for the selected tags",
  start: "Set date_from in Capture to the earliest demo date of the selected tags",
  end: "Set date_to in Capture to the latest demo date of the selected tags",
  full: "Set both date_from and date_to in Capture to the range of the selected tags",
  after: "Set the date filter to everything after this tag's most recent demo",
} as const;

export interface TagRangeModel {
  activeNames: string[];
  calc: () => void;
  busy: boolean;
  range: RangeResult | null;
  status: string;
  /** Capture's date filter as it stands. */
  filter: { from: string; to: string };
  start: RangeApply;
  end: RangeApply;
  full: RangeApply;
  after: RangeApply;
}

export function useTagRange(): TagRangeModel {
  const { database } = useDatabase();
  const [active] = useActiveTags();
  const [dateFrom] = useSetting<string>("date_from");
  const [dateTo] = useSetting<string>("date_to");
  const batch = useSettingsBatch();
  const [range, setRange] = useState<RangeResult | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function calc() {
    if (active.length === 0) {
      setStatus("Select at least one tag.");
      return;
    }
    setBusy(true);
    setStatus("Computing…");
    try {
      const result = await runCommand("tags_calc_range", { tag_ids: active });
      const data = result.data as RangeResult;
      setRange(data);
      // The dates themselves are drawn by every style; only a gap is news.
      setStatus(data.date_start && data.date_end ? "" : `${data.demo_count} demo(s) -- dates unavailable.`);
    } catch (cause) {
      setStatus((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const s = range?.date_start ?? null;
  const e = range?.date_end ?? null;
  const a = range?.date_after ?? null;
  return {
    activeNames: activeTagNames(database?.tags ?? [], active),
    calc: () => void calc(),
    busy,
    range,
    status,
    filter: { from: dateFrom ?? "", to: dateTo ?? "" },
    start: { title: "Apply start", tip: TIPS.start, run: s ? () => batch({ date_from: s }) : null },
    end: { title: "Apply end", tip: TIPS.end, run: e ? () => batch({ date_to: e }) : null },
    full: { title: "Apply full range", tip: TIPS.full, run: s && e ? () => batch({ date_from: s, date_to: e }) : null },
    after: { title: "After range", tip: TIPS.after, run: a ? () => batch({ date_from: a, date_to: "" }) : null },
  };
}
