/**
 * Settings > UI Theme > Per-card style: one row per styled card, each either
 * following the global `ui_card_style` ("Default") or pinned to its own style.
 *
 * The list is `STYLED_CARDS`, never retyped here. Choosing "Default" removes
 * the card's entry, so `ui_card_style_overrides` only ever holds exceptions.
 */
import SettingControl from "../../settings/SettingControl";
import { useSetting } from "../../settings/store";
import { CARD_STYLES, isCardStyle, type CardStyle } from "./cardStyle";
import { STYLED_CARDS } from "./styledCards";
import "./CardStyleOverrides.css";

const KEY = "ui_card_style_overrides";
const DEFAULT = "default";

const WORDS: Record<CardStyle, string> = { timeline: "Timeline", sentence: "Sentence", tiles: "Tiles" };

export default function CardStyleOverrides({ globalStyle }: { globalStyle: CardStyle }) {
  const [raw, setOverrides] = useSetting<Record<string, string>>(KEY);
  const overrides = raw && typeof raw === "object" ? raw : {};

  function choose(cardId: string, value: string) {
    const next = { ...overrides };
    if (isCardStyle(value)) next[cardId] = value;
    else delete next[cardId];
    setOverrides(next);
  }

  return (
    <SettingControl settingKey={KEY}>
      <div className="cso" role="group" aria-label="Per-card style">
        <span className="lab">Per-card style</span>
        {STYLED_CARDS.map((card) => {
          const own = overrides[card.id];
          const id = `cso-${card.id}`;
          return (
            <div className="cso-row" key={card.id}>
              <label htmlFor={id}>{card.title}</label>
              <select
                id={id}
                className={isCardStyle(own) ? "cso-sel on" : "cso-sel"}
                value={isCardStyle(own) ? own : DEFAULT}
                title={`How the ${card.title} card draws its settings. Default follows Card style above`}
                onChange={(event) => choose(card.id, event.target.value)}
              >
                <option value={DEFAULT}>Default ({WORDS[globalStyle]})</option>
                {CARD_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {WORDS[s]}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </SettingControl>
  );
}
