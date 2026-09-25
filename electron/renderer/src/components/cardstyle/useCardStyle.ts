/**
 * One card's style: its own override, else the global card style.
 *
 * `ui_card_style_overrides` maps a card id to a style; anything else there
 * ("default", a stale value, no entry) falls back to `ui_card_style`, and an
 * unknown global value reads as the first style.
 */
import { useSetting } from "../../settings/store";
import { CARD_STYLES, isCardStyle } from "./cardStyle";

export function useCardStyle(cardId: string): "timeline" | "sentence" | "tiles" {
  const [globalRaw] = useSetting<string>("ui_card_style");
  const [overridesRaw] = useSetting<Record<string, unknown>>("ui_card_style_overrides");
  const own =
    overridesRaw && typeof overridesRaw === "object" && !Array.isArray(overridesRaw) ? overridesRaw[cardId] : undefined;
  if (isCardStyle(own)) return own;
  return isCardStyle(globalRaw) ? globalRaw : CARD_STYLES[0];
}
