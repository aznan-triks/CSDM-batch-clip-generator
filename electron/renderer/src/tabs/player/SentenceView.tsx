/**
 * Player, style B: the card reads as plain English. The players are words you
 * click away, the sort order is a word you open.
 */
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import { ActivePlayers, ListControls, PlayerList, RegisteredAccounts, SearchBox, SortControl } from "./parts";
import { PLAYER_TIPS, type PlayerCardModel } from "./usePlayerCard";

const ORDER_WORDS = { name: "name", recent: "last seen" } as const;

export default function SentenceView({ m }: { m: PlayerCardModel }) {
  return (
    <div className="pc-b">
      <div className="pc-line">
        <span>Capture clips of</span>
        <ActivePlayers m={m} look="pill" label={null} joiner="and" />
      </div>
      <RegisteredAccounts
        m={m}
        look="chip"
        header={<span className="pc-line-s">Quick picks from your ★ accounts ({m.saved.length} registered):</span>}
        empty="none yet -- click ☆ on a player below to keep them here."
      />
      <div className="pc-line pc-findline">
        <span>Find someone else</span>
        <SearchBox m={m} />
        {m.hasDatabase && (
          <>
            <span>by</span>
            <ChoiceToken
              label="Sort"
              tip={PLAYER_TIPS.sort}
              popover={
                <>
                  <h5>Order the list by</h5>
                  <SortControl m={m} />
                </>
              }
            >
              {ORDER_WORDS[m.sortBy]}
            </ChoiceToken>
          </>
        )}
        <ListControls m={m} sort={false} />
      </div>
      <PlayerList m={m} look="chip" />
    </div>
  );
}
