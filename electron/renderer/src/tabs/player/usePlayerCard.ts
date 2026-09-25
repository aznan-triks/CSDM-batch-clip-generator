/**
 * The Player card's ONE data model.
 *
 * Ported from `PlayerSearchWidget` (csdm/widgets.py): a search box over the
 * database's player list, multi-selection by click, active players tracked as
 * a set. The window's separate "registered accounts" file is persisted here
 * under the `saved_players` config key (one store, migrated by
 * `_migrate_config`), and each DB row carries its own ★ to register a player.
 *
 * `steam_ids` is the real source of truth (core.py: `cfg.get("steam_ids") or
 * ([cfg["steam_id"]] if cfg.get("steam_id") else [])`); `steam_id` and
 * `player_name` are kept in step as the first active player, exactly as
 * `_collect_cfg` does.
 *
 * Every card style (timeline, sentence, tiles) draws this model and nothing
 * else: the keys, the search, the order, the page and the drag live here once.
 */
import { useMemo, useRef, useState } from "react";

import { useSetting, useSettingsBatch } from "../../settings/store";
import { useDatabase } from "../../settings/useDatabase";
import type { PlayerRow } from "../../settings/useDatabase";

/**
 * How much of the list reaches the DOM at once, and the orders it can take.
 *
 * Measured on the user's own database: 7892 players. Rendered whole, that is
 * 31 568 nodes and 139 ms of layout, every one inside a blurred card. A page
 * rather than a virtual window: no scroll maths, nothing to drift out of sync
 * with a container height. HC.1 -- the size is config, not a number in a loop.
 */
export const PLAYER_LIST = {
  pageSize: 60,
  orders: ["name", "recent"] as const,
} as const;

export type Order = (typeof PLAYER_LIST.orders)[number];

/**
 * Where a user finds their OWN Steam ID -- the one thing a first run needs.
 * Shown on the search field's tip and under a search that matches nobody.
 */
export const FIND_STEAM_ID_HINT =
  "Your Steam ID (17 digits, 7656119…) is on your player page in CS Demo Manager, " +
  "or at the end of your Steam profile URL (steamcommunity.com/profiles/…).";

/** The tooltips, shared by every style. */
export const PLAYER_TIPS = {
  search: `Search players by name or Steam ID. ${FIND_STEAM_ID_HINT}`,
  sort: "Sort players alphabetically or by most recently seen",
  registered: "Click to select for capture, or drag to reorder your registered accounts",
  unregister: "Remove this player from your registered accounts (does not deselect them)",
  star: "Save this player to your Registered Accounts for quick access later",
} as const;

/** One registered account, persisted under the `saved_players` config key. */
export type SavedPlayer = { steam_id: string; name: string };

/** One player shown in the list page. */
export interface ListedPlayer {
  steamId: string;
  name: string;
  /** The database's own display label ("name  (steam id)"). */
  label: string;
  active: boolean;
  registered: boolean;
}

/** Move the element at `from` so it sits at `to` (drag reorder). */
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

/** `lastSeen` may be a timestamp, a string or nothing: unusable sorts last. */
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

/** Drag-to-reorder over the registered accounts: two indices, a live preview. */
export interface RegisteredDrag {
  /** The accounts in the order to draw them (the hover preview while dragging). */
  shown: SavedPlayer[];
  down: (index: number) => void;
  over: (index: number) => void;
  up: () => void;
  dragging: boolean;
  /** True once, right after a finished drag: the click that follows is swallowed. */
  consumeClick: () => boolean;
}

export interface PlayerCardModel {
  hasDatabase: boolean;
  /** The database holds no player at all (first run). */
  emptyDatabase: boolean;
  search: string;
  setSearch: (value: string) => void;
  sortBy: Order;
  setSortBy: (value: Order) => void;
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  /** How many players match the search, over the whole database. */
  matchCount: number;
  visible: ListedPlayer[];
  /** The active players, in selection order, by name (Steam ID if unknown). */
  active: { steamId: string; name: string }[];
  saved: SavedPlayer[];
  isActive: (steamId: string) => boolean;
  toggle: (steamId: string) => void;
  toggleRegister: (steamId: string, name: string) => void;
  removeSaved: (steamId: string) => void;
  drag: RegisteredDrag;
}

export function usePlayerCard(): PlayerCardModel {
  const { database } = useDatabase();
  const [search, setSearchRaw] = useState("");
  const [steamIds] = useSetting<string[]>("steam_ids");
  const [savedRaw, setSavedPlayers] = useSetting<SavedPlayer[]>("saved_players");
  const setMany = useSettingsBatch();

  // A config written by an older build has no `saved_players`: read as empty.
  const savedPlayers = Array.isArray(savedRaw) ? savedRaw : [];

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const suppressClick = useRef(false);

  const [sortBy, setSortByRaw] = useState<Order>("name");
  const [page, setPage] = useState(0);

  const activeIds = Array.isArray(steamIds) ? steamIds : [];
  const rows = database?.players ?? [];
  const query = search.trim().toLowerCase();

  // Filter over the WHOLE database, then order, then cut a page out: a search
  // must find a name the reader has not walked to yet.
  const matching = useMemo(
    () => order(query ? rows.filter((row) => matches(row, query)) : rows, sortBy),
    [rows, query, sortBy],
  );

  const pageCount = Math.max(1, Math.ceil(matching.length / PLAYER_LIST.pageSize));
  // Clamped rather than reset by an effect: a narrowing search can leave the
  // reader past the end, and an effect would render the empty page once first.
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * PLAYER_LIST.pageSize;

  function activate(nextIds: string[]) {
    const primary = nextIds[0];
    const primaryRow = rows.find((row) => row[1] === primary);
    setMany({ steam_ids: nextIds, steam_id: primary ?? "", player_name: primaryRow?.[2] ?? "" });
  }

  function toggle(steamId: string) {
    activate(activeIds.includes(steamId) ? activeIds.filter((s) => s !== steamId) : [...activeIds, steamId]);
  }

  const isRegistered = (steamId: string) => savedPlayers.some((p) => p.steam_id === steamId);

  return {
    hasDatabase: !!database,
    emptyDatabase: rows.length === 0,
    search,
    setSearch: (value) => {
      setSearchRaw(value);
      setPage(0);
    },
    sortBy,
    setSortBy: (value) => {
      setSortByRaw(value);
      setPage(0);
    },
    page: currentPage,
    pageCount,
    setPage,
    matchCount: matching.length,
    visible: matching.slice(start, start + PLAYER_LIST.pageSize).map((row) => ({
      steamId: row[1],
      name: row[2],
      label: row[0],
      active: activeIds.includes(row[1]),
      registered: isRegistered(row[1]),
    })),
    active: activeIds.map((steamId) => ({
      steamId,
      name: rows.find((row) => row[1] === steamId)?.[2] ?? steamId,
    })),
    saved: savedPlayers,
    isActive: (steamId) => activeIds.includes(steamId),
    toggle,
    toggleRegister: (steamId, name) =>
      setSavedPlayers(
        isRegistered(steamId)
          ? savedPlayers.filter((p) => p.steam_id !== steamId)
          : [...savedPlayers, { steam_id: steamId, name }],
      ),
    // Forget the account (reversible, no confirmation); it stays active.
    removeSaved: (steamId) => setSavedPlayers(savedPlayers.filter((p) => p.steam_id !== steamId)),
    drag: {
      shown:
        dragFrom !== null && dragOver !== null && dragFrom !== dragOver
          ? reorder(savedPlayers, dragFrom, dragOver)
          : savedPlayers,
      dragging: dragFrom !== null,
      down: (index) => {
        setDragFrom(index);
        setDragOver(index);
      },
      over: (index) => {
        if (dragFrom === null) return;
        suppressClick.current = true;
        if (index !== dragOver) setDragOver(index);
      },
      up: () => {
        if (dragFrom === null) return;
        if (dragOver !== null && dragFrom !== dragOver) setSavedPlayers(reorder(savedPlayers, dragFrom, dragOver));
        setDragFrom(null);
        setDragOver(null);
      },
      consumeClick: () => {
        if (!suppressClick.current) return false;
        suppressClick.current = false;
        return true;
      },
    },
  };
}
