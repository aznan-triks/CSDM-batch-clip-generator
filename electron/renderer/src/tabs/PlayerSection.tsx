/**
 * The PLAYER section.
 *
 * Ported from `PlayerSearchWidget` (csdm/widgets.py): a search box over the
 * database's player list, multi-selection by click, active players tracked as
 * a set. The window's own widget also manages a separate "registered
 * accounts" file (`load_saved_players`/`save_saved_players`) with its own
 * ordering and a dedicated search-then-★-to-register flow; that persistence
 * layer is not ported here (see the task report's Écarts) -- this section
 * keeps the multi-select core (`get_steam_ids`/`get_steam_id`/`get_name`)
 * without it, which is enough to drive a run.
 *
 * `steam_ids` is the real source of truth (core.py line 1804: `cfg.get(
 * "steam_ids") or ([cfg["steam_id"]] if cfg.get("steam_id") else [])`), the
 * same "list wins, single value is compat" rule the window's own
 * `get_steam_ids`/`get_steam_id` pair follows. `steam_id`/`player_name` are
 * kept in step as the first active player, exactly as `_collect_cfg` (line
 * 401-403) does -- `steam_id` is not itself a separate control (the window
 * never drew one either): the active-player readout below IS its display.
 */
import { useMemo, useState } from "react";

import Field from "../components/Field";
import Segmented from "../components/Segmented";
import SettingControl from "../settings/SettingControl";
import { useSetting, useSettingsBatch } from "../settings/store";
import { useDatabase } from "../settings/useDatabase";
import type { PlayerRow } from "../settings/useDatabase";
import "./PlayerSection.css";

/**
 * How much of the list reaches the DOM at once, and the orders it can take.
 *
 * Measured on the user's own database: 7892 players. Rendered whole, that is
 * 31 568 nodes and 139 ms of layout before anything appears -- against 395
 * nodes for the entire rest of the page -- and every one of them sits inside a
 * card carrying `backdrop-filter: blur(14px)`, so each repaint re-blurs the
 * region. That is the lag, and it is structural: it is not the hover rule,
 * which only changes two colours.
 *
 * A page rather than a virtual window: the window asked for "pagination and
 * sorting", it needs no scroll maths, and it cannot drift out of sync with a
 * container height. HC.1 -- the size is config, not a number in a loop.
 */
export const PLAYER_LIST = {
  pageSize: 60,
  orders: ["name", "recent"] as const,
} as const;

type Order = (typeof PLAYER_LIST.orders)[number];

function matches(row: PlayerRow, query: string): boolean {
  const [, steamId, name] = row;
  return name.toLowerCase().includes(query) || steamId.includes(query);
}

/**
 * `lastSeen` is whatever the database column held -- a timestamp, a string, or
 * nothing at all. Sorting has to survive all three, so an unusable value sorts
 * last rather than throwing the comparison.
 */
function seenAt(row: PlayerRow): number {
  const raw = row[3];
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

function order(rows: PlayerRow[], by: Order): PlayerRow[] {
  // A copy: `database.players` is shared with every other section.
  const sorted = [...rows];
  if (by === "recent") return sorted.sort((a, b) => seenAt(b) - seenAt(a));
  return sorted.sort((a, b) => a[2].localeCompare(b[2]));
}

export default function PlayerSection() {
  const { database } = useDatabase();
  const [search, setSearch] = useState("");
  const [steamIds] = useSetting<string[]>("steam_ids");
  const setMany = useSettingsBatch();

  const [sortBy, setSortBy] = useState<Order>("name");
  const [page, setPage] = useState(0);

  const active = Array.isArray(steamIds) ? steamIds : [];
  const rows = database?.players ?? [];
  const query = search.trim().toLowerCase();

  // Filter over the WHOLE database, then order, then cut a page out. Searching
  // a page instead of the list would make a name findable only if the reader
  // had already walked to it, which is the opposite of what a search is for.
  const matching = useMemo(
    () => order(query ? rows.filter((row) => matches(row, query)) : rows, sortBy),
    [rows, query, sortBy],
  );

  const pageCount = Math.max(1, Math.ceil(matching.length / PLAYER_LIST.pageSize));
  // Clamped rather than reset by an effect: a narrowing search can leave the
  // reader past the end, and an effect would render the empty page once first.
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * PLAYER_LIST.pageSize;
  const visible = matching.slice(start, start + PLAYER_LIST.pageSize);

  function search_(next: string) {
    setSearch(next);
    setPage(0);
  }

  function activate(nextIds: string[]) {
    const primary = nextIds[0];
    const primaryRow = rows.find((row) => row[1] === primary);
    setMany({
      steam_ids: nextIds,
      steam_id: primary ?? "",
      player_name: primaryRow?.[2] ?? "",
    });
  }

  function toggle(steamId: string) {
    activate(active.includes(steamId) ? active.filter((s) => s !== steamId) : [...active, steamId]);
  }

  const activeRow = rows.find((row) => row[1] === active[0]);
  const activeLabel =
    active.length === 0
      ? "No active player -- pick one below"
      : active.length === 1
        ? `Active: ${activeRow?.[2] ?? active[0]}  (${active[0]})`
        : `Active: ${activeRow?.[2] ?? active[0]}  (+${active.length - 1} more)`;

  return (
    <div className="player-section">
      {/* One row: who is active, and the box that narrows the list. The mock
          keeps its own "+ add player" field on the row beside the player
          pills, capped rather than spanning the card -- a search box as wide
          as the window is what made this card read as a banner. */}
      <div className="row">
        <SettingControl settingKey="player_name">
          <span className="lab">{activeLabel}</span>
        </SettingControl>

        <Field
          id="player-search"
          value={search}
          onChange={search_}
          placeholder="Search by name or Steam ID…"
        />
      </div>

      {/* Ordering and paging. A database of 7892 players is not a list you
          scroll -- it is one you narrow, order, and step through. */}
      {database && (
        <div className="row ps-controls">
          <Segmented
            label="Sort"
            options={[...PLAYER_LIST.orders]}
            value={sortBy}
            onChange={(next) => {
              setSortBy(next as Order);
              setPage(0);
            }}
          />
          <span className="lab ps-count">
            {matching.length} player{matching.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="chip"
            aria-label="Previous page"
            disabled={currentPage === 0}
            data-action="N6" onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ‹
          </button>
          <span className="lab ps-page">
            {currentPage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="chip"
            aria-label="Next page"
            disabled={currentPage >= pageCount - 1}
            data-action="N7" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            ›
          </button>
        </div>
      )}

      {!database ? (
        <p className="capture-hint">Waiting for DB…</p>
      ) : (
        <SettingControl settingKey="steam_id">
          <div className="ps-list">
            {visible.length === 0 && <p className="capture-hint">No player matches.</p>}
            {visible.map((row) => {
              const [label, steamId] = row;
              const isActive = active.includes(steamId);
              return (
                <button
                  key={steamId}
                  type="button"
                  role="checkbox"
                  aria-checked={isActive}
                  className={isActive ? "ps-row ps-row-active" : "ps-row"}
                  data-action="N10" onClick={() => toggle(steamId)}
                >
                  <span className="ps-dot" aria-hidden="true" />
                  <span className="ps-label">{label}</span>
                </button>
              );
            })}
          </div>
        </SettingControl>
      )}
    </div>
  );
}
