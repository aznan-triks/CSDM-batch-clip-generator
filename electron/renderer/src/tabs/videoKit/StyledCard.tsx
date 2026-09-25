/**
 * The frame every remade VIDEO card shares: read the card's style live
 * (`useCardStyle`), draw the matching view over the ONE model, and hand the
 * grid's props (drag handle, collapse…) on to the <Card>.
 *
 * The root class is `<prefix>-card <prefix>-<style>`, the hook tests and the
 * proofs look the style up by.
 */
import type { ComponentType, ReactNode } from "react";

import Card from "../../components/Card";
import type { CardStyle } from "../../components/cardstyle/cardStyle";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { useCardStyle } from "../../components/cardstyle/useCardStyle";

export type Views<M> = Record<CardStyle, ComponentType<{ m: M }>>;

interface StyledCardProps<M> {
  /** The card's layout id (its `SectionSpec` id and its `STYLED_CARDS` id). */
  id: string;
  title: string;
  icon: ReactNode;
  /** Class prefix of the card's stylesheet, e.g. "fa". */
  prefix: string;
  m: M;
  views: Views<M>;
  count?: ReactNode;
  grid: GridProps;
}

export default function StyledCard<M>({ id, title, icon, prefix, m, views, count, grid }: StyledCardProps<M>) {
  const style = useCardStyle(id);
  const View = views[style];
  const { className, ...rest } = grid;
  return (
    <Card
      title={title}
      icon={icon}
      className={`vk-card ${prefix}-card ${prefix}-${style}${className ? ` ${className}` : ""}`}
      {...rest}
      count={count ?? rest.count}
    >
      <View m={m} />
    </Card>
  );
}
