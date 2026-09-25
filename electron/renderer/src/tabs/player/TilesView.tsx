/**
 * Player, style C: big tiles. Your ★ accounts are the tiles you tick; anyone
 * else is one search away, drawn as small tiles.
 */
import { ActivePlayers, ListControls, PlayerList, RegisteredAccounts, SearchBox } from "./parts";
import type { PlayerCardModel } from "./usePlayerCard";

export default function TilesView({ m }: { m: PlayerCardModel }) {
  return (
    <div className="pc-c">
      <RegisteredAccounts
        m={m}
        look="tile"
        header={
          <div className="ps-registered-header">
            <span className="pc-kick">★ Your accounts · tick to capture</span>
            <span className="lab ps-count">{m.saved.length} registered</span>
          </div>
        }
        empty="No account yet. Find yourself below and tap ☆ to pin a tile here."
      />
      <ActivePlayers m={m} look="pill" label="In the clips" />
      <div className="pc-find">
        <div className="pc-findbar">
          <span className="pc-kick">Add a player</span>
          <SearchBox m={m} />
          <ListControls m={m} />
        </div>
        <PlayerList m={m} look="tile" />
      </div>
    </div>
  );
}
