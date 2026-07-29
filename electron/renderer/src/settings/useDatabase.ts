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
 * Only the two fields the Capture-tab sections need are kept here: `weapons`
 * (a flat list of weapon names actually present in the database) and `maps`
 * (`[displayKey, rawValues[]][]`, sorted by display key). The full discovery
 * payload carries much more (players, tags, schema...), consumed by other
 * tabs in later chantiers -- this hook is not the place to widen that
 * contract before something actually reads the rest.
 */
import { useEffect, useState } from "react";

import { runCommand } from "../bridge";

export interface DatabaseInfo {
  weapons: string[];
  maps: [string, string[]][];
}

/** Shape of the JSON `connect_db` returns, before narrowing to what this hook keeps. */
interface RawDiscovery {
  weapons: string[];
  maps: [string, string[]][];
}

export function useDatabase(): { database: DatabaseInfo | null; error: string | null } {
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    runCommand("connect_db")
      .then((result) => {
        if (cancelled) return;
        const raw = result.data as RawDiscovery;
        setDatabase({
          weapons: raw.weapons ?? [],
          maps: raw.maps ?? [],
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
  }, []);

  return { database, error };
}
