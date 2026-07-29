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
import { useState } from "react";

import Field from "../components/Field";
import SettingControl from "../settings/SettingControl";
import { useSetting, useSettingsBatch } from "../settings/store";
import { useDatabase } from "../settings/useDatabase";
import type { PlayerRow } from "../settings/useDatabase";
import "./PlayerSection.css";

function matches(row: PlayerRow, query: string): boolean {
  const [, steamId, name] = row;
  return name.toLowerCase().includes(query) || steamId.includes(query);
}

export default function PlayerSection() {
  const { database } = useDatabase();
  const [search, setSearch] = useState("");
  const [steamIds] = useSetting<string[]>("steam_ids");
  const setMany = useSettingsBatch();

  const active = Array.isArray(steamIds) ? steamIds : [];
  const rows = database?.players ?? [];
  const query = search.trim().toLowerCase();
  const visible = query ? rows.filter((row) => matches(row, query)) : rows;

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
      <span className="ps-section-heading">Player</span>

      <SettingControl settingKey="player_name">
        <span className="ps-active-label">{activeLabel}</span>
      </SettingControl>

      <Field
        id="player-search"
        value={search}
        onChange={setSearch}
        placeholder="Search by name or Steam ID…"
      />

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
                  onClick={() => toggle(steamId)}
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
