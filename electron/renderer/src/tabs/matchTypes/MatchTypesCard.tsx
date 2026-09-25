/**
 * The Match Types card: one model, drawn in its card style (read live).
 * Sentence and tiles are the generic set-filter views; the timeline is its
 * own queue board.
 */
import Card from "../../components/Card";
import { useCardStyle } from "../../components/cardstyle/useCardStyle";
import { ICONS } from "../../icons";
import { keptWords } from "../setFilter/parts";
import SetFilterSentence from "../setFilter/SentenceView";
import SetFilterTiles from "../setFilter/TilesView";
import MatchTypesTimeline from "./TimelineView";
import { useMatchTypes } from "./useMatchTypes";
import "../../components/cardstyle/SmallCard.css";
import "../setFilter/SetFilter.css";
import "./MatchTypes.css";

export default function MatchTypesCard() {
  const m = useMatchTypes();
  const style = useCardStyle("match-types");
  return (
    <Card title="Match Types" icon={<ICONS.matchTypes />} className={`mt-card sc-narrow mt-${style}`} count={keptWords(m)}>
      {style === "timeline" && <MatchTypesTimeline m={m} />}
      {style === "sentence" && <SetFilterSentence m={m} />}
      {style === "tiles" && <SetFilterTiles m={m} switchLabel="Filter by type" />}
    </Card>
  );
}
