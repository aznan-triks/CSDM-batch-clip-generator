/**
 * The global card style: how a card that offers variants draws its settings.
 *
 * One user choice (`ui_card_style`, Settings > UI Theme), read by every card
 * that has variants. A card keeps ONE data model and renders one of three thin
 * views over it; the style never changes which keys a card writes.
 */
import { useSetting } from "../../settings/store";

/** The values `ui_card_style` takes, in the order Settings lists them. */
export const CARD_STYLES = ["timeline", "sentence", "tiles"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export function isCardStyle(value: unknown): value is CardStyle {
  return (CARD_STYLES as readonly unknown[]).includes(value);
}

/** The active card style; an unknown or missing value reads as the first one. */
export function useCardStyle(): CardStyle {
  const [raw] = useSetting<string>("ui_card_style");
  return isCardStyle(raw) ? raw : CARD_STYLES[0];
}
