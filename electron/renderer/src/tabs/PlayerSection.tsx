/**
 * The PLAYER card's body: one model (player/usePlayerCard), drawn in the
 * card's style (`ui_card_style_overrides.player` ?? `ui_card_style`).
 *
 * The style is read live, so a switch in Settings redraws the card at once;
 * the keys written -- `steam_ids`, `steam_id`, `player_name`, `saved_players`
 * -- are the same in all three.
 */
import type { ComponentType } from "react";

import { useCardStyle } from "../components/cardstyle/useCardStyle";
import type { CardStyle } from "../components/cardstyle/cardStyle";
import SentenceView from "./player/SentenceView";
import TilesView from "./player/TilesView";
import TimelineView from "./player/TimelineView";
import { usePlayerCard, type PlayerCardModel } from "./player/usePlayerCard";
import "./PlayerSection.css";
import "./player/Player.css";

export { FIND_STEAM_ID_HINT, PLAYER_LIST, type SavedPlayer } from "./player/usePlayerCard";

const VIEWS: Record<CardStyle, ComponentType<{ m: PlayerCardModel }>> = {
  timeline: TimelineView,
  sentence: SentenceView,
  tiles: TilesView,
};

export default function PlayerSection() {
  const m = usePlayerCard();
  const style = useCardStyle("player");
  const View = VIEWS[style];
  return (
    <div className={`player-section pc-${style}`}>
      <View m={m} />
    </div>
  );
}
