/**
 * The PLAYER section.
 *
 * Ported from `PlayerSearchWidget` (csdm/widgets.py): a search box over the
 * database's player list, multi-selection by click, active players tracked as
 * a set. The window's own widget also manages a separate "registered
 * accounts" file (`load_saved_players`/`save_saved_players`) with its own
 * ordering and a dedicated search-then-★-to-register flow. That flow is ported
 * here as the ★ Registered Accounts section (Section D), persisted under the
 * `saved_players` config key instead of a sidecar JSON file -- one store, one
 * place, migrated by `_migrate_config`. Each DB row below also carries its own
 * ★ to register/unregister the player.
 *
 * `steam_ids` is the real source of truth (core.py line 1804: `cfg.get(
 * "steam_ids") or ([cfg["steam_id"]] if cfg.get("steam_id") else [])`), the
 * same "list wins, single value is compat" rule the window's own
 * `get_steam_ids`/`get_steam_id` pair follows. `steam_id`/`player_name` are
 * kept in step as the first active player, exactly as `_collect_cfg` (line
 * 401-403) does -- `steam_id` is not itself a separate control (the window
 * never drew one either): the active-player readout below IS its display.
 */
import { useMemo, useRef, useState } from "react";

import Field from "../components/Field";
import Segmented from "../components/Segmented";
import SettingControl from "../settings/SettingControl";
import { useSetting, useSettingsBatch } from "../settings/store";
import CloseButton, { ChipPair } from "../components/CloseButton";
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

/** One registered account, persisted under the `saved_players` config key. */
export type SavedPlayer = { steam_id: string; name: string };

/**
 * Move the element at `from` so it sits at `to` (Section D drag reorder).
 * The chips are a plain inline-flex row, so reordering is an index swap in
 * the same array -- no layout animation, no ghost layer.
 */
function reorder(list: SavedPlayer[], from: number, to: number): SavedPlayer[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

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
  const [savedRaw, setSavedPlayers] = useSetting<SavedPlayer[]>("saved_players");
  const setMany = useSettingsBatch();

  // `saved_players` is a fresh key with an empty default; a config written by
  // an older build simply has no entry, so treat anything non-array as empty.
  const savedPlayers = Array.isArray(savedRaw) ? savedRaw : [];

  // Section D drag reorder: the chips are a plain inline-flex row, so the
  // whole drag lives in two indices -- where the pointer grabbed and where it
  // currently hovers. While dragging, the array is rendered pre-committed to
  // the hover slot (a live preview, no ghost layer); on mouse-up the swap is
  // persisted. `suppressClick` swallows the toggle that a finished drag would
  // otherwise fire (a drag is a mousedown+mouseup, and the chip also toggles
  // on click).
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const suppressClick = useRef(false);
  const dragPreview =
    dragFrom !== null && dragOver !== null && dragFrom !== dragOver
      ? reorder(savedPlayers, dragFrom, dragOver)
      : savedPlayers;

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

  /** ★ per DB row: add the player to (or remove them from) the saved accounts. */
  function toggleRegister(steamId: string, name: string) {
    setSavedPlayers(
      savedPlayers.some((p) => p.steam_id === steamId)
        ? savedPlayers.filter((p) => p.steam_id !== steamId)
        : [...savedPlayers, { steam_id: steamId, name }],
    );
  }

  /** × on a registered chip: forget the account (reversible, no confirmation). */
  function removeSaved(steamId: string) {
    setSavedPlayers(savedPlayers.filter((p) => p.steam_id !== steamId));
  }

  /** End a drag: persist the hover preview order, or do nothing if it never moved. */
  function commitDrag() {
    if (dragFrom === null) return;
    if (dragOver !== null && dragFrom !== dragOver) {
      setSavedPlayers(reorder(savedPlayers, dragFrom, dragOver));
    }
    setDragFrom(null);
    setDragOver(null);
  }

  return (
    <div className="player-section">
      {/* ★ Registered Accounts -- the saved-player chips. Wrapped in
          SettingControl so the coverage guard sees `saved_players` reach the
          screen; it is a marker only, no visual box. */}
      <SettingControl settingKey="saved_players">
        <div className="ps-registered">
          <div className="ps-registered-header">
            <span className="lab">★ Registered Accounts</span>
            <span className="lab ps-count">{savedPlayers.length} registered</span>
          </div>
          <div className="ps-registered-chips">
            {savedPlayers.length === 0 && (
              <span className="ps-registered-empty">
                None. Select a player below and click ★ to register.
              </span>
            )}
            {dragPreview.map((p, i) => {
              const isActive = active.includes(p.steam_id);
              return (
                <ChipPair key={p.steam_id}>
                <button
                  type="button"
                  className={isActive ? "chip on" : "chip"}
                  aria-pressed={isActive}
                  title="Click to select for capture, or drag to reorder your registered accounts"
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    setDragFrom(i);
                    setDragOver(i);
                  }}
                  onMouseMove={(e) => {
                    if (dragFrom === null) return;
                    e.preventDefault();
                    suppressClick.current = true;
                    if (i !== dragOver) setDragOver(i);
                  }}
                  onMouseUp={(e) => {
                    if (dragFrom === null) return;
                    e.preventDefault();
                    commitDrag();
                  }}
                  onClick={() => {
                    // A finished drag is also a click; swallow it so it does
                    // not toggle the account it just moved.
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    const next = isActive
                      ? active.filter((s) => s !== p.steam_id)
                      : [...active, p.steam_id];
                    activate(next);
                  }}
                >
                  <span className="d" aria-hidden="true" />
                  {p.name}
                </button>
                <CloseButton
                  label={`Unregister ${p.name}`}
                  title="Remove this player from your registered accounts (does not deselect them)"
                  onClick={() => removeSaved(p.steam_id)}
                />
                </ChipPair>
              );
            })}
          </div>
        </div>
      </SettingControl>

      {/* One row: who is active, and the box that narrows the list. The mock
          keeps its own "+ add player" field on the row beside the player
          pills, capped rather than spanning the card -- a search box as wide
          as the window is what made this card read as a banner. */}
      {/* Active players -- one removable chip each, same visual vocabulary
          as the ★ Registered Accounts chips above. No separate ×: unlike a
          registered account (activate vs. unregister are two different
          things), an active chip has exactly one action -- click it, it
          deactivates. */}
      <SettingControl settingKey="player_name">
        <div className="ps-active">
          <span className="lab">Active</span>
          <div className="ps-active-chips">
            {active.length === 0 && (
              <span className="ps-registered-empty">No active player -- pick one below</span>
            )}
            {active.map((steamId) => {
              const name = rows.find((row) => row[1] === steamId)?.[2] ?? steamId;
              return (
                <button
                  key={steamId}
                  type="button"
                  className="chip on"
                  aria-pressed="true"
                  onClick={() => toggle(steamId)}
                >
                  <span className="d" aria-hidden="true" />
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      </SettingControl>

      <div className="row">
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
              const name = row[2];
              const isActive = active.includes(steamId);
              const isRegistered = savedPlayers.some((p) => p.steam_id === steamId);
              return (
                // A div, not a button: the row carries its own register ★
                // button, and HTML forbids a button inside a button. The row's
                // checkbox role keeps the active-toggle semantics intact; the
                // ★ is a sibling that stopPropagation's away from it.
                <div
                  key={steamId}
                  role="checkbox"
                  aria-checked={isActive}
                  className={isActive ? "ps-row ps-row-active" : "ps-row"}
                  data-action="N10"
                  onClick={() => toggle(steamId)}
                >
                  <span className="ps-dot" aria-hidden="true" />
                  <span className="ps-label">{label}</span>
                  <button
                    type="button"
                    className="ps-star"
                    aria-label={isRegistered ? "Remove from accounts" : "Add to accounts"}
                    aria-pressed={isRegistered}
                    title="Save this player to your Registered Accounts for quick access later"
                    data-action="N11"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRegister(steamId, name);
                    }}
                  >
                    {isRegistered ? "★" : "☆"}
                  </button>
                </div>
              );
            })}
          </div>
        </SettingControl>
      )}
    </div>
  );
}
