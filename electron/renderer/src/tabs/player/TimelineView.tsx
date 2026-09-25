/**
 * Player, style A: the roster board. The players are the control -- your
 * lineup and your ★ roster (drag to reorder) on the left, the searchable
 * database on the right, everyone drawn as a V12 avatar pill.
 */
import { ActivePlayers, ListControls, PlayerList, RegisteredAccounts, SearchBox } from "./parts";
import type { PlayerCardModel } from "./usePlayerCard";

export default function TimelineView({ m }: { m: PlayerCardModel }) {
  return (
    <div className="pc-a">
      <div className="pc-side">
        <div className="pc-lineup">
          <span className="pc-kick">In the clips · {m.active.length}</span>
          <ActivePlayers m={m} look="pill" label={null} />
        </div>
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
      </div>
      <div className="pc-find">
        <div className="pc-findbar">
          <SearchBox m={m} />
          <ListControls m={m} />
        </div>
        <PlayerList m={m} look="pill" />
      </div>
    </div>
  );
}
