/**
 * The static tables, fetched once from Python.
 *
 * They are NOT declared here: `describe_filters` sends them, and this hook only
 * caches them. A copy in TypeScript would drift the day a filter is added, and
 * the window would silently stop showing it (D20 / R1).
 *
 * Mounting the Capture tab used to fire one `describe_filters` per consuming
 * section (KillFiltersSection, MatchTypesSection, WeaponFilterSection all
 * called this hook independently), each spawning its own Python thread doing
 * schema work. `TablesProvider` fetches once and every `useTables()` call
 * inside it reads the same value; a `useTables()` call with no `TablesProvider`
 * above it (a section rendered on its own in a test, say) falls back to
 * fetching for itself, so no existing caller needs to change.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

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
  /** `PresetSection`'s checkbox keys -- straight from Python's `PRESET_KEYS`, never retyped here. */
  presetCategories: string[];
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
  preset_categories: string[];
}

interface TablesValue {
  tables: Tables | null;
  error: string | null;
}

const TablesContext = createContext<TablesValue | null>(null);

/**
 * Runs the actual `describe_filters` fetch, unless `skip` is set.
 *
 * Called unconditionally by both `TablesProvider` (never skips) and
 * `useTables` (skips whenever a provider is already supplying the value) so
 * that the same hooks fire in the same order every render either way --
 * `skip` toggling which branch of the effect body does anything, never
 * whether the hook itself runs.
 */
function useTablesFetch(skip: boolean): TablesValue {
  const [tables, setTables] = useState<Tables | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (skip) return;
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
          presetCategories: raw.preset_categories ?? [],
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
  }, [skip]);

  return { tables, error };
}

/** Fetches `describe_filters` once and shares it with every `useTables()` call underneath. */
export function TablesProvider({ children }: { children: ReactNode }) {
  const value = useTablesFetch(false);
  return <TablesContext.Provider value={value}>{children}</TablesContext.Provider>;
}

export function useTables(): TablesValue {
  const context = useContext(TablesContext);
  // Skips its own fetch whenever a provider above already ran one; runs it
  // when there isn't one, so a section rendered on its own (outside
  // `CaptureTab`, as most of this tab's tests do) still gets its data.
  const standalone = useTablesFetch(context !== null);
  return context ?? standalone;
}
