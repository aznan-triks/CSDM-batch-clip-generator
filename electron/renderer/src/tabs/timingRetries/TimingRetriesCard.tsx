/**
 * The Timing & Retries card: one model, drawn in its card style (read live).
 */
import type { ComponentType } from "react";
import type { GridProps } from "../../components/cardstyle/gridProps";

import Card from "../../components/Card";
import type { CardStyle } from "../../components/cardstyle/cardStyle";
import { useCardStyle } from "../../components/cardstyle/useCardStyle";
import { ICONS } from "../../icons";
import SentenceView from "./SentenceView";
import TilesView from "./TilesView";
import TimelineView from "./TimelineView";
import { useTimingRetries, type TimingRetriesModel } from "./useTimingRetries";
import "../../components/cardstyle/SmallCard.css";
import "./TimingRetries.css";

const VIEWS: Record<CardStyle, ComponentType<{ m: TimingRetriesModel }>> = {
  timeline: TimelineView,
  sentence: SentenceView,
  tiles: TilesView,
};

export default function TimingRetriesCard({ className, ...grid }: GridProps) {
  const m = useTimingRetries();
  const style = useCardStyle("timing-retries");
  const View = VIEWS[style];
  return (
    <Card
      title="Timing &amp; Retries"
      icon={<ICONS.captureTiming />}
      className={`tr-card sc-narrow tr-${style}${className ? ` ${className}` : ""}`}
      {...grid}
    >
      <View m={m} />
    </Card>
  );
}
