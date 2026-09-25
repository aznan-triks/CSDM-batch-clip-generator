/**
 * The DEMO SELECTION card's body: one model (demoSelection/useDemoSelection),
 * drawn in the card's style (`ui_card_style_overrides["demo-selection"]` ??
 * `ui_card_style`).
 *
 * The style is read live; the keys written -- `date_from`, `date_to` -- are
 * the same in all three, and so are Manual mode and the demo picker.
 */
import type { ComponentType } from "react";

import { useCardStyle } from "../components/cardstyle/useCardStyle";
import type { CardStyle } from "../components/cardstyle/cardStyle";
import SentenceView from "./demoSelection/SentenceView";
import TilesView from "./demoSelection/TilesView";
import TimelineView from "./demoSelection/TimelineView";
import { useDemoSelection, type DemoSelectionModel } from "./demoSelection/useDemoSelection";
import "./DemoSelectionSection.css";
import "./demoSelection/DemoSelection.css";

export { rangeForShortcut } from "./demoSelection/useDemoSelection";

const VIEWS: Record<CardStyle, ComponentType<{ m: DemoSelectionModel }>> = {
  timeline: TimelineView,
  sentence: SentenceView,
  tiles: TilesView,
};

export default function DemoSelectionSection() {
  const m = useDemoSelection();
  const style = useCardStyle("demo-selection");
  const View = VIEWS[style];
  return (
    <div className={`demo-selection ds-${style}`}>
      <View m={m} />
    </div>
  );
}
