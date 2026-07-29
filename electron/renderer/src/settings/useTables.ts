/**
 * The static tables, fetched once from Python.
 *
 * They are NOT declared here: `describe_filters` sends them, and this hook only
 * caches them. A copy in TypeScript would drift the day a filter is added, and
 * the window would silently stop showing it (D20 / R1).
 */
import { useEffect, useState } from "react";

import { runCommand } from "../bridge";

export interface FilterDef {
  key: string;
  label: string;
  tip: string;
  category: "mods" | "dp2" | "db";
  hidden: boolean;
}

export interface Tables {
  filters: FilterDef[];
  matchTypes: { key: string; label: string }[];
  weaponCategories: Record<string, string[]>;
  resolutions: { label: string; width: number; height: number }[];
  framerates: number[];
  videoCodecs: string[];
  audioCodecs: string[];
}

/** Shape of the JSON `describe_filters` returns, before renaming to camelCase. */
interface RawTables {
  filters: FilterDef[];
  match_types: { key: string; label: string }[];
  weapon_categories: Record<string, string[]>;
  resolutions: { label: string; width: number; height: number }[];
  framerates: number[];
  video_codecs: string[];
  audio_codecs: string[];
}

export function useTables(): { tables: Tables | null; error: string | null } {
  const [tables, setTables] = useState<Tables | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    runCommand("describe_filters")
      .then((result) => {
        if (cancelled) return;
        const raw = result.data as RawTables;
        setTables({
          filters: raw.filters,
          matchTypes: raw.match_types,
          weaponCategories: raw.weapon_categories,
          resolutions: raw.resolutions,
          framerates: raw.framerates,
          videoCodecs: raw.video_codecs,
          audioCodecs: raw.audio_codecs,
        });
      })
      .catch((cause: Error) => {
        // Say it once and keep the window usable, the way the settings store
        // already does: a blank tab hides the reason it is blank.
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { tables, error };
}
