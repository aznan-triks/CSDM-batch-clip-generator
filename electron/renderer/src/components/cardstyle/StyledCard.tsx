/**
 * A card drawn in its card style: one model, three thin views.
 *
 * The TAGS and SETTINGS cards all have the same frame (read the style live,
 * pick the view, pass the grid's props on to <Card>), so it lives here once.
 * The style class is `<prefix>-<style>`, e.g. `pg-sentence`, which is what
 * the tests and the proofs look for.
 */
import type { ComponentType, ReactNode } from "react";

import Card from "../Card";
import type { CardStyle } from "./cardStyle";
import type { GridProps } from "./gridProps";
import { useCardStyle } from "./useCardStyle";
import "./StyledCard.css";

export type CardViews<M> = Record<CardStyle, ComponentType<{ m: M }>>;

interface StyledCardProps<M> {
  /** The card's layout id, the key of its `ui_card_style_overrides` entry. */
  cardId: string;
  title: string;
  icon: ReactNode;
  /** Class prefix of this card's own stylesheet. */
  prefix: string;
  m: M;
  views: CardViews<M>;
  grid: GridProps;
  count?: ReactNode;
  /** Drawn after the view in every style (a confirm dialog, for instance). */
  children?: ReactNode;
}

export default function StyledCard<M>({ cardId, title, icon, prefix, m, views, grid, count, children }: StyledCardProps<M>) {
  const style = useCardStyle(cardId);
  const View = views[style];
  const { className, ...rest } = grid;
  return (
    <Card
      title={title}
      icon={icon}
      className={`${prefix}-card ${prefix}-${style} sx-${style}${className ? ` ${className}` : ""}`}
      {...rest}
      count={count}
    >
      <View m={m} />
      {children}
    </Card>
  );
}
