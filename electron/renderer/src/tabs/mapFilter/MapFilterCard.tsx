/**
 * The Map Filter card: one model, drawn in its card style (read live).
 * Sentence and tiles are the generic set-filter views; the timeline is its
 * own veto board.
 */
import Card from "../../components/Card";
import { useCardStyle } from "../../components/cardstyle/useCardStyle";
import { ICONS } from "../../icons";
import { keptWords } from "../setFilter/parts";
import SetFilterSentence from "../setFilter/SentenceView";
import SetFilterTiles from "../setFilter/TilesView";
import MapFilterTimeline from "./TimelineView";
import { useMapFilter } from "./useMapFilter";
import "../../components/cardstyle/SmallCard.css";
import "../setFilter/SetFilter.css";
import "./MapFilter.css";

export default function MapFilterCard() {
  const m = useMapFilter();
  const style = useCardStyle("map-filter");
  return (
    <Card title="Map Filter" icon={<ICONS.mapFilter />} className={`mf-card sc-narrow mf-${style}`} count={keptWords(m)}>
      {style === "timeline" && <MapFilterTimeline m={m} />}
      {style === "sentence" && <SetFilterSentence m={m} />}
      {style === "tiles" && <SetFilterTiles m={m} switchLabel="Filter by map" />}
    </Card>
  );
}
