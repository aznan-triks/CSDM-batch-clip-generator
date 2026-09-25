/**
 * The Kill / Damage / Shot Filters cards: one model each, drawn in the card's
 * style (`useCardStyle`, read live). The style never changes which keys a card
 * writes; the grid's own props (collapse, drag handle) pass straight to Card.
 */
import type { ComponentProps, ComponentType } from "react";

import Card from "../../components/Card";
import { FilterClause, UntestedNote } from "../../components/cardstyle/FilterSentence";
import { FilterMatrix } from "../../components/cardstyle/FilterMatrix";
import { FilterTiles } from "../../components/cardstyle/FilterTiles";
import type { CardStyle } from "../../components/cardstyle/cardStyle";
import { useCardStyle } from "../../components/cardstyle/useCardStyle";
import { ICONS } from "../../icons";
import "../KillFiltersSection.css";
import "./FilterCards.css";
import { KillSentence, KillTiles, KillTimeline } from "./KillViews";
import { FiltersLoading } from "./shared";
import { useEventFilters, type EventFiltersModel, type EventFilterCategory } from "./useEventFilters";
import { useKillFilters, type KillFiltersModel } from "./useKillFilters";

/** What SectionList hands every card: layout props, forwarded untouched. */
type GridProps = Omit<ComponentProps<typeof Card>, "title" | "children">;

const KILL_VIEWS: Record<CardStyle, ComponentType<{ m: KillFiltersModel }>> = {
  timeline: KillTimeline,
  sentence: KillSentence,
  tiles: KillTiles,
};

export function KillFiltersCard(props: GridProps) {
  const m = useKillFilters();
  const style = useCardStyle("kill-filters");
  const View = KILL_VIEWS[style];
  return (
    <Card title="Kill Filters" icon={<ICONS.killFilters />} count={m.ready ? m.count : undefined} {...props}>
      <div className={`cf-card cf-style-${style}`}>{m.ready ? <View m={m} /> : <FiltersLoading />}</div>
    </Card>
  );
}

/* ---------- Damage / Shot ---------- */

function EventTimeline({ m }: { m: EventFiltersModel }) {
  return (
    <div className="kill-filters">
      <p className="capture-hint">{m.hint}</p>
      <FilterMatrix rows={m.rows} />
    </div>
  );
}

function EventSentence({ m }: { m: EventFiltersModel }) {
  return (
    <div className="kill-filters cf-sentence">
      <FilterClause rows={m.rows} mode="enable" lead={`Keep ${m.noun} that are`} empty={`any ${m.noun}`} addLabel={`Add a ${m.category} filter`} />
      <FilterClause rows={m.rows} mode="must" lead="Every one must be" empty="nothing in particular" addLabel="Require a filter" />
      <FilterClause rows={m.rows} mode="exclude" lead={`Drop ${m.noun} that are`} empty="none" addLabel="Exclude a filter" />
      <UntestedNote rows={m.rows} />
      <p className="capture-hint">{m.hint}</p>
    </div>
  );
}

function EventTiles({ m }: { m: EventFiltersModel }) {
  return (
    <div className="kill-filters cf-tiles-card">
      <p className="capture-hint">{m.hint}</p>
      <FilterTiles rows={m.rows} />
    </div>
  );
}

const EVENT_VIEWS: Record<CardStyle, ComponentType<{ m: EventFiltersModel }>> = {
  timeline: EventTimeline,
  sentence: EventSentence,
  tiles: EventTiles,
};

const EVENT_TITLE: Record<EventFilterCategory, { id: string; title: string; icon: keyof typeof ICONS }> = {
  damage: { id: "damage-filters", title: "Damage Filters", icon: "damageFilters" },
  shot: { id: "shot-filters", title: "Shot Filters", icon: "shotFilters" },
};

export function EventFiltersCard({ category, ...props }: GridProps & { category: EventFilterCategory }) {
  const m = useEventFilters(category);
  const card = EVENT_TITLE[category];
  const style = useCardStyle(card.id);
  const View = EVENT_VIEWS[style];
  const Icon = ICONS[card.icon];
  return (
    <Card title={card.title} icon={<Icon />} count={m.ready ? m.count : undefined} {...props}>
      <div className={`cf-card cf-style-${style}`}>{m.ready ? <View m={m} /> : <FiltersLoading />}</div>
    </Card>
  );
}
