/**
 * The Capture & Timing card: one model, drawn in the user's card style.
 *
 * Its style (`useCardStyle`) is read live, so switching it in Settings redraws this card
 * at once; the model -- and so every key written -- is the same in all three.
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
import { useCaptureTiming, type CaptureTimingModel } from "./useCaptureTiming";
import "./CaptureTiming.css";

const VIEWS: Record<CardStyle, ComponentType<{ m: CaptureTimingModel }>> = {
  timeline: TimelineView,
  sentence: SentenceView,
  tiles: TilesView,
};

export default function CaptureTimingCard({ className, ...grid }: GridProps) {
  const m = useCaptureTiming();
  const style = useCardStyle("capture-timing");
  const View = VIEWS[style];
  return (
    <Card
      title="Capture &amp; Timing"
      icon={<ICONS.captureTiming />}
      className={`ct-card ct-${style}${className ? ` ${className}` : ""}`}
      {...grid}
      count={`${m.clip.total} s clip`}
    >
      <View m={m} />
    </Card>
  );
}
