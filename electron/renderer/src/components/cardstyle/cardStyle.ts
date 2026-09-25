/**
 * The card styles: how a card that offers variants draws its settings.
 *
 * One global user choice (`ui_card_style`, Settings > UI Theme), which a card
 * may override for itself (`ui_card_style_overrides`); a card reads the result
 * through `useCardStyle(cardId)`. A card keeps ONE data model and renders one
 * of three thin views over it; the style never changes which keys it writes.
 */

/** The values `ui_card_style` takes, in the order Settings lists them. */
export const CARD_STYLES = ["timeline", "sentence", "tiles"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export function isCardStyle(value: unknown): value is CardStyle {
  return (CARD_STYLES as readonly unknown[]).includes(value);
}
