/**
 * The style one card is drawn in.
 *
 * A card's style is its own entry in `ui_card_style_overrides` (Settings >
 * UI Theme > Per-card style) when it has one, else the global `ui_card_style`.
 * Both are read live, so changing either redraws the card at once; the style
 * never changes which keys a card writes.
 */
import { useSetting } from "../../settings/store";
import { CARD_STYLES, isCardStyle } from "./cardStyle";

export function useCardStyle(cardId: string): "timeline" | "sentence" | "tiles" {
  const [global] = useSetting<string>("ui_card_style");
  const [overrides] = useSetting<Record<string, unknown>>("ui_card_style_overrides");
  const own = overrides && typeof overrides === "object" ? overrides[cardId] : undefined;
  if (isCardStyle(own)) return own;
  return isCardStyle(global) ? global : CARD_STYLES[0];
}
