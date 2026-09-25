/**
 * Player, style A: the roster board. The players are the control -- your
 * lineup on top, your ★ roster (drag to reorder) beside the searchable list,
 * everyone drawn as a V12 avatar pill.
 */
import { ActivePlayers, ListControls, PlayerList, RegisteredAccounts, SearchBox } from "./parts";
import type { PlayerCardModel } from "./usePlayerCard";

export default function TimelineView({ m }: { m: PlayerCardModel }) {
  return (
    <div className="pc-a">
      <div className="pc-lineup">
        <span className="pc-kick">In the clips · {m.active.length}</span>
        <ActivePlayers m={m} look="pill" label={null} />
      </div>
      <div className="pc-board">
        <RegisteredAccounts
          m={m}
          look="pill"
          header={
            <div className="ps-registered-header">
              <span className="pc-kick">★ Roster · drag to reorder</span>
              <span className="lab ps-count">{m.saved.length} registered</span>
            </div>
          }
        />
        <div className="pc-find">
          <span className="pc-kick">Find a player</span>
          <SearchBox m={m} />
          <ListControls m={m} />
          <PlayerList m={m} look="pill" />
        </div>
      </div>
    </div>
  );
}
