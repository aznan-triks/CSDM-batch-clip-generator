/**
 * The Player card's controls, drawn by all three styles.
 *
 * Each control lives here once -- with its setting key wrapper, its tooltip and
 * its parity marker (N1, N3/N4, N6/N7, N10-N13) -- so a style only chooses
 * where it sits and which `look` it wears. The class names the rest of the app
 * and its tests know (`.ps-registered`, `.ps-active-chips`, `.ps-row`,
 * `.ps-star`) are the same in every style.
 */
import type { ReactNode } from "react";

import CloseButton, { ChipPair, CLOSE_GLYPH } from "../../components/CloseButton";
import Field from "../../components/Field";
import Pager from "../../components/Pager";
import Segmented from "../../components/Segmented";
import DatabasePending from "../../settings/DatabasePending";
import SettingControl from "../../settings/SettingControl";
import { FIND_STEAM_ID_HINT, PLAYER_LIST, PLAYER_TIPS, type Order, type PlayerCardModel } from "./usePlayerCard";

/** How a player is drawn: a plain chip, a V12 avatar pill, or a big tile. */
export type PlayerLook = "chip" | "pill" | "tile";

/** Colour slots for avatars (Player.css maps each to a theme token). */
const AVATAR_HUES = 5;

function hueOf(steamId: string): number {
  let h = 0;
  for (const c of steamId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % AVATAR_HUES;
}

/** A round badge with the player's initial, coloured by their Steam ID. */
export function Avatar({ name, steamId }: { name: string; steamId: string }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className="pc-av" data-hue={hueOf(steamId)} aria-hidden="true">
      {initial}
    </span>
  );
}

/** Steam ID's last digits, enough to tell two same-named players apart. */
export function shortId(steamId: string): string {
  return steamId.length > 6 ? `…${steamId.slice(-6)}` : steamId;
}

export function SearchBox({ m }: { m: PlayerCardModel }) {
  return (
    <div className="row pc-search" data-action="N1">
      <Field
        id="player-search"
        value={m.search}
        onChange={m.setSearch}
        placeholder="Search by name or Steam ID…"
        tip={PLAYER_TIPS.search}
      />
    </div>
  );
}

export function SortControl({ m }: { m: PlayerCardModel }) {
  return (
    <Segmented
      label="Sort"
      tip={PLAYER_TIPS.sort}
      options={[...PLAYER_LIST.orders]}
      value={m.sortBy}
      onChange={(next) => m.setSortBy(next as Order)}
      optionActions={{ name: "N3", recent: "N4" }}
    />
  );
}

/** The count and the pager (and the sort, unless the style puts it elsewhere). Mounted once the database is in. */
export function ListControls({ m, sort = true }: { m: PlayerCardModel; sort?: boolean }) {
  if (!m.hasDatabase) return null;
  return (
    <div className="row ps-controls">
      {sort && <SortControl m={m} />}
      <span className="lab ps-count">
        {m.matchCount} player{m.matchCount === 1 ? "" : "s"}
      </span>
      <Pager page={m.page} pageCount={m.pageCount} onPage={m.setPage} prevAction="N6" nextAction="N7" pageClassName="ps-page" />
    </div>
  );
}

/** One page of the database's players: click a row to (de)select, ★ to register. */
export function PlayerList({ m, look }: { m: PlayerCardModel; look: PlayerLook }) {
  if (!m.hasDatabase) return <DatabasePending />;
  return (
    <SettingControl settingKey="steam_id">
      {/* One list, two keys: a row click writes steam_ids (every active player) and steam_id (the first). */}
      <SettingControl settingKey="steam_ids">
        <div className={`ps-list pc-list-${look}`}>
          {m.visible.length === 0 && (
            <p className="capture-hint">
              {m.emptyDatabase
                ? "No player in this database yet: analyze your demos in CS Demo Manager first, then press Test & Reload in SETTINGS."
                : `No player matches. ${FIND_STEAM_ID_HINT}`}
            </p>
          )}
          {m.visible.map((p) => (
            // A div, not a button: the row carries its own ★ button, and HTML
            // forbids a button inside a button. The ★ stops its own click.
            <div
              key={p.steamId}
              role="checkbox"
              aria-checked={p.active}
              className={p.active ? "ps-row ps-row-active" : "ps-row"}
              title={p.label}
              data-action="N13"
              onClick={() => m.toggle(p.steamId)}
            >
              {look === "chip" ? <span className="ps-dot" aria-hidden="true" /> : <Avatar name={p.name} steamId={p.steamId} />}
              {look === "chip" ? (
                <span className="ps-label">{p.label}</span>
              ) : (
                <span className="pc-who">
                  <b className="ps-label">{p.name}</b>
                  <small>{shortId(p.steamId)}</small>
                </span>
              )}
              <button
                type="button"
                className="ps-star"
                aria-label={p.registered ? "Remove from accounts" : "Add to accounts"}
                aria-pressed={p.registered}
                title={PLAYER_TIPS.star}
                data-action="N10"
                onClick={(e) => {
                  e.stopPropagation();
                  m.toggleRegister(p.steamId, p.name);
                }}
              >
                {p.registered ? "★" : "☆"}
              </button>
            </div>
          ))}
        </div>
      </SettingControl>
    </SettingControl>
  );
}

/**
 * ★ Registered Accounts: click to select, drag to reorder, × to forget.
 * `header` replaces the default title row (a style may say it in words).
 */
export function RegisteredAccounts({
  m,
  look,
  header,
  empty = "None. Select a player below and click ★ to register.",
}: {
  m: PlayerCardModel;
  look: PlayerLook;
  header?: ReactNode;
  empty?: string;
}) {
  return (
    <SettingControl settingKey="saved_players">
      <div className={`ps-registered pc-reg-${look}`}>
        {header === undefined ? (
          <div className="ps-registered-header">
            <span className="lab">★ Registered Accounts</span>
            <span className="lab ps-count">{m.saved.length} registered</span>
          </div>
        ) : (
          header
        )}
        <div className={m.drag.dragging ? "ps-registered-chips dragging" : "ps-registered-chips"} data-action="N11">
          {m.saved.length === 0 && <span className="ps-registered-empty">{empty}</span>}
          {m.drag.shown.map((p, i) => {
            const on = m.isActive(p.steam_id);
            return (
              <ChipPair key={p.steam_id}>
                <button
                  type="button"
                  className={["chip", `pc-${look}`, on ? "on" : null].filter(Boolean).join(" ")}
                  aria-pressed={on}
                  title={PLAYER_TIPS.registered}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    m.drag.down(i);
                  }}
                  onMouseMove={(e) => {
                    if (!m.drag.dragging) return;
                    e.preventDefault();
                    m.drag.over(i);
                  }}
                  onMouseUp={(e) => {
                    if (!m.drag.dragging) return;
                    e.preventDefault();
                    m.drag.up();
                  }}
                  onClick={() => {
                    // A finished drag is also a click: do not toggle what just moved.
                    if (m.drag.consumeClick()) return;
                    m.toggle(p.steam_id);
                  }}
                >
                  {look === "chip" ? <span className="d" aria-hidden="true" /> : <Avatar name={p.name} steamId={p.steam_id} />}
                  {look === "tile" ? (
                    <span className="pc-who">
                      <b>{p.name}</b>
                      <small>{on ? "in the clips" : shortId(p.steam_id)}</small>
                    </span>
                  ) : (
                    p.name
                  )}
                  {look !== "chip" && (
                    <span className="pc-grip" aria-hidden="true">
                      ⋮⋮
                    </span>
                  )}
                </button>
                <CloseButton label={`Unregister ${p.name}`} title={PLAYER_TIPS.unregister} dataAction="N12" onClick={() => m.removeSaved(p.steam_id)} />
              </ChipPair>
            );
          })}
        </div>
      </div>
    </SettingControl>
  );
}

/** The active players: one chip each; a click deactivates. */
export function ActivePlayers({
  m,
  look,
  label = "Active",
  joiner,
}: {
  m: PlayerCardModel;
  look: PlayerLook;
  label?: ReactNode;
  /** Word drawn between two players ("and" in a sentence). */
  joiner?: string;
}) {
  return (
    <SettingControl settingKey="player_name">
      <div className={`ps-active pc-active-${look}`}>
        {label && <span className="lab">{label}</span>}
        <div className="ps-active-chips">
          {m.active.length === 0 && <span className="ps-registered-empty">No active player -- pick one below</span>}
          {m.active.map((p, i) => (
            <span key={p.steamId} className="pc-activewrap">
              {joiner && i > 0 && <span className="pc-joiner">{i === m.active.length - 1 ? joiner : ","}</span>}
              <button
                type="button"
                className={`chip on pc-${look}`}
                aria-pressed="true"
                title={`Click to remove ${p.name} from active filter`}
                onClick={() => m.toggle(p.steamId)}
              >
                {look === "chip" ? <span className="d" aria-hidden="true" /> : <Avatar name={p.name} steamId={p.steamId} />}
                {p.name}
                {look !== "chip" && (
                  <span className="pc-x" aria-hidden="true">
                    {CLOSE_GLYPH}
                  </span>
                )}
              </button>
            </span>
          ))}
        </div>
      </div>
    </SettingControl>
  );
}
