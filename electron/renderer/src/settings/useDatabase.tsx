/**
 * The connected database's discovery payload, fetched once from Python.
 *
 * `connect_db` (delivered in chantier 4a.1, `csdm/bridge/host.py`'s
 * `_cmd_connect_db`) resolves the PostgreSQL connection from the saved
 * configuration on its own -- the renderer does not need to pass `pg_host`
 * etc. through the command, the same way `describe_filters` needs nothing
 * from the renderer either. Calling it with no payload is enough to trigger
 * a real connection attempt against whatever `csdm_config.json` already
 * holds.
 *
 * Three fields the Capture-tab sections need are kept here: `weapons` (a flat
 * list of weapon names actually present in the database), `maps`
 * (`[displayKey, rawValues[]][]`, sorted by display key), and `players`
 * (`[label, steamId, name, lastSeen][]`, the same tuple shape
 * `discovery_to_json` sends -- PlayerSection, tâche 5, is the first reader).
 * `tags` (`[tagId, name, color][]`) is the Tags tab's own reader, added in
 * chantier 4d tâche 4. The full discovery payload carries more still
 * (schema...), consumed by other tabs in later chantiers -- this hook is not
 * the place to widen that contract before something actually reads the rest.
 *
 * Mounting the Capture tab used to fire one `connect_db` per consuming
 * section (MatchTypesSection, WeaponFilterSection, MapFilterSection,
 * PlayerSection all called this hook independently), each spawning its own
 * Python thread that reconnects and re-introspects the schema. `DatabaseProvider`
 * fetches once and every `useDatabase()` call inside it reads the same value; a
 * `useDatabase()` call with no `DatabaseProvider` above it (a section rendered
 * on its own in a test, say) falls back to fetching for itself, so no existing
 * caller needs to change.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { runCommand } from "../bridge";

/** One row of `connect_db`'s `players` list, unpacked from its tuple shape. */
export type PlayerRow = [label: string, steamId: string, name: string, lastSeen: string | number | null];

/** One row of `connect_db`'s `tags` list: `discovery_to_json`'s `[tag_id, name, color]`. */
export type TagRow = [tagId: number | string, name: string, color: string];

export interface DatabaseInfo {
  weapons: string[];
  maps: [string, string[]][];
  players: PlayerRow[];
  tags: TagRow[];
}

/** Shape of the JSON `connect_db` returns, before narrowing to what this hook keeps. */
interface RawDiscovery {
  weapons: string[];
  maps: [string, string[]][];
  players: PlayerRow[];
  tags: TagRow[];
}

interface DatabaseValue {
  database: DatabaseInfo | null;
  error: string | null;
  /** Re-runs `connect_db` and updates the shared state, so every `useDatabase()`
   *  caller under the same provider sees the fresh payload. */
  reload: () => void;
}

const DatabaseContext = createContext<DatabaseValue | null>(null);

/**
 * Runs the actual `connect_db` fetch, unless `skip` is set.
 *
 * Called unconditionally by both `DatabaseProvider` (never skips) and
 * `useDatabase` (skips whenever a provider is already supplying the value) so
 * that the same hooks fire in the same order every render either way --
 * `skip` toggling which branch of the effect body does anything, never
 * whether the hook itself runs.
 */
function useDatabaseFetch(skip: boolean): DatabaseValue {
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by `reload()` so the effect below re-runs `connect_db` on demand,
  // the whole reason `DatabaseProvider` fetches exactly once on mount.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    runCommand("connect_db")
      .then((result) => {
        if (cancelled) return;
        const raw = result.data as RawDiscovery;
        setDatabase({
          weapons: raw.weapons ?? [],
          maps: raw.maps ?? [],
          players: raw.players ?? [],
          tags: raw.tags ?? [],
        });
      })
      .catch((cause: Error) => {
        // Say it once and keep the window usable: the sections that need this
        // stay in their "waiting for DB" state, which is already the correct
        // display for "no answer yet" and for "answer will never come".
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [skip, revision]);

  function reload() {
    setError(null);
    setRevision((n) => n + 1);
  }

  return { database, error, reload };
}

/** Fetches `connect_db` once and shares it with every `useDatabase()` call underneath. */
export function DatabaseProvider({ children }: { children: ReactNode }) {
  const value = useDatabaseFetch(false);
  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseValue {
  const context = useContext(DatabaseContext);
  // Skips its own fetch whenever a provider above already ran one; runs it
  // when there isn't one, so a section rendered on its own (outside
  // `CaptureTab`, as most of this tab's tests do) still gets its data.
  const standalone = useDatabaseFetch(context !== null);
  return context ?? standalone;
}
