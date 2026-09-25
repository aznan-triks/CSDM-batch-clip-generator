/**
 * What a database-fed card shows before it has data.
 *
 * "Waiting for DB…" used to be the only text, for "no answer yet" AND for
 * "the connection failed": a new user with PostgreSQL unreachable looked at
 * an empty Player card forever, with the reason only in the console and the
 * fix on another tab (first-run audit, 2026-09-25). The failure now says
 * where to go.
 */
import { useDatabase } from "./useDatabase";

export const DB_UNREACHABLE_HINT =
  "Database not reachable. Check SETTINGS › PostgreSQL Connection (same values as in CS Demo Manager), then press Test & Reload.";

export default function DatabasePending() {
  const { error } = useDatabase();
  if (error) {
    return (
      <p className="capture-hint" role="status" title={error}>
        {DB_UNREACHABLE_HINT}
      </p>
    );
  }
  return <p className="capture-hint">Waiting for DB…</p>;
}
