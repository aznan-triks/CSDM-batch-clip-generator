/**
 * UI Theme: accent, ground, font -- and the card styles themselves.
 *
 *   - timeline: a live mini-window showing the accent on the ground, the
 *     swatches under it;
 *   - sentence: "Paint the app <blue> on a <white> ground, in the <auto>
 *     font.";
 *   - tiles: one swatch tile per accent, one picture per ground.
 *
 * "Card style" and "Per-card style" are drawn FIRST and the SAME way in every
 * style, never behind a word or a tile: they are how a user gets out of a
 * style, so no style may hide them (a user must never lock themselves in).
 *
 * `theme_accent` drives `--gold`, `theme_bg` the day/night ground. The stored
 * theme is re-applied at boot by AppShell; the calls here are the
 * immediate-feedback path.
 */
import Field from "../../components/Field";
import Segmented from "../../components/Segmented";
import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import { BigTile, TextWord, WordOptions } from "../../components/cardstyle/StyledParts";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import { CARD_STYLES, isCardStyle, type CardStyle } from "../../components/cardstyle/cardStyle";
import CardStyleOverrides from "../../components/cardstyle/CardStyleOverrides";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import { useSetting } from "../../settings/store";
import { ACCENT_PRESETS, applyAccent, resolveAccent } from "../../theme/accent";
import { applyMode, DEFAULT_GROUND, GROUND_MODES } from "../../theme/mode";
import "./SettingsCards.css";

/** The grounds, from the mapping table so a value added there cannot be missing here. */
const GROUNDS: readonly string[] = Object.keys(GROUND_MODES);

const GROUND_TIP = "Dark variants: amoled = pure black (OLED), deepblue = blue-tinted, terminal = green-on-black";
const FONT_TIP =
  'Monospace font used across the UI. "auto" keeps the built-in stack (JetBrains Mono / Fira Code / Cascadia Mono / Consolas); type an installed font name to force it';
const STYLE_TIP =
  "How cards with variants draw their settings: timeline = a clip you drag, sentence = a sentence with fill-in words, tiles = big picture tiles. Every style changes the same settings";

/**
 * How each ground looks, for its picture only (page, card, ink): a drawing of
 * the ground, not the theme -- the theme's real colours live in the tokens.
 */
const GROUND_LOOK: Record<string, [string, string, string]> = {
  white: ["#eef2f8", "#ffffff", "#1e293b"],
  dark: ["#15171c", "#22252c", "#e5e7eb"],
  amoled: ["#000000", "#0d0d0d", "#e5e7eb"],
  deepblue: ["#0b1426", "#13213b", "#dbe7ff"],
  terminal: ["#030a04", "#0a160c", "#4ade80"],
};

interface UiThemeModel {
  accent: string;
  chooseAccent: (hex: string) => void;
  ground: string;
  chooseGround: (ground: string) => void;
  cardStyle: CardStyle;
  setCardStyle: (style: string) => void;
  font: string;
  setFont: (value: string) => void;
}

function useUiTheme(): UiThemeModel {
  const [themeAccent, setThemeAccent] = useSetting<string>("theme_accent");
  const [themeBg, setThemeBg] = useSetting<string>("theme_bg");
  const [styleRaw, setCardStyle] = useSetting<string>("ui_card_style");
  const [font, setFont] = useSetting<string>("ui_font_family");
  return {
    // A legacy Tkinter preset name ("green") resolves to its hex.
    accent: resolveAccent(themeAccent ?? ACCENT_PRESETS[0].hex),
    chooseAccent: (hex) => {
      setThemeAccent(hex);
      applyAccent(hex);
    },
    ground: themeBg && themeBg in GROUND_MODES ? themeBg : DEFAULT_GROUND,
    chooseGround: (ground) => {
      setThemeBg(ground);
      applyMode(ground);
    },
    cardStyle: isCardStyle(styleRaw) ? styleRaw : CARD_STYLES[0],
    setCardStyle,
    font: font ?? "",
    setFont,
  };
}

function accentName(hex: string): string {
  return ACCENT_PRESETS.find((p) => p.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex;
}

/** Card style + Per-card style: identical, and first, in every style. */
function StyleControls({ m }: { m: UiThemeModel }) {
  return (
    <div className="ut-styles">
      <SettingControl settingKey="ui_card_style">
        <div className="row">
          <span className="lab">Card style</span>
          <Segmented options={CARD_STYLES} value={m.cardStyle} onChange={m.setCardStyle} label="Card style" tip={STYLE_TIP} />
        </div>
      </SettingControl>
      <CardStyleOverrides globalStyle={m.cardStyle} />
    </div>
  );
}

function Swatches({ m }: { m: UiThemeModel }) {
  return (
    <SettingControl settingKey="theme_accent">
      <div className="settings-accent">
        <div className="row" role="radiogroup" aria-label="Accent">
          {ACCENT_PRESETS.map((preset) => {
            const selected = preset.hex.toLowerCase() === m.accent.toLowerCase();
            return (
              <button
                key={preset.hex}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "settings-swatch settings-swatch-selected" : "settings-swatch"}
                style={{ backgroundColor: preset.hex }}
                title={`Select ${preset.name} accent (${preset.hex})`}
                data-action="M2"
                onClick={() => m.chooseAccent(preset.hex)}
              >
                <span className="settings-swatch-label">{preset.name}</span>
              </button>
            );
          })}
          <label className="settings-swatch-custom" title="Pick a custom hex accent color">
            <span>Custom…</span>
            <input
              type="color"
              value={m.accent}
              title="Pick a custom hex accent color"
              data-action="M3"
              onChange={(event) => m.chooseAccent(event.target.value)}
            />
          </label>
        </div>
      </div>
    </SettingControl>
  );
}

function Grounds({ m }: { m: UiThemeModel }) {
  return (
    <SettingControl settingKey="theme_bg">
      <Segmented
        options={GROUNDS}
        value={m.ground}
        onChange={m.chooseGround}
        label="Ground"
        tip={GROUND_TIP}
        optionActions={Object.fromEntries(GROUNDS.map((g) => [g, "M1"]))}
      />
    </SettingControl>
  );
}

function FontBox({ m, label = "Font family" }: { m: UiThemeModel; label?: string }) {
  return (
    <SettingControl settingKey="ui_font_family">
      <Field id="ui-font-family" label={label} value={m.font} onChange={m.setFont} placeholder="auto" tip={FONT_TIP} />
    </SettingControl>
  );
}

/** A small window in the chosen ground, the accent on its active parts. */
function Preview({ m, ground = m.ground }: { m: UiThemeModel; ground?: string }) {
  const [page, card, ink] = GROUND_LOOK[ground] ?? GROUND_LOOK.white;
  return (
    <svg viewBox="0 0 120 70" className="ut-preview" aria-hidden="true">
      <rect width="120" height="70" rx="7" fill={page} />
      <rect x="6" y="6" width="108" height="9" rx="3" fill={card} />
      <rect x="10" y="9" width="16" height="3" rx="1.5" fill={m.accent} />
      <rect x="30" y="9" width="12" height="3" rx="1.5" fill={ink} opacity=".35" />
      <rect x="6" y="20" width="52" height="44" rx="5" fill={card} />
      <rect x="62" y="20" width="52" height="44" rx="5" fill={card} />
      <rect x="11" y="26" width="30" height="3" rx="1.5" fill={ink} opacity=".7" />
      <rect x="11" y="34" width="20" height="8" rx="4" fill={m.accent} />
      <rect x="34" y="34" width="18" height="8" rx="4" fill={ink} opacity=".15" />
      <rect x="11" y="48" width="40" height="4" rx="2" fill={ink} opacity=".15" />
      <rect x="11" y="48" width="24" height="4" rx="2" fill={m.accent} />
      <rect x="67" y="26" width="26" height="3" rx="1.5" fill={ink} opacity=".7" />
      <circle cx="104" cy="28" r="4" fill={m.accent} />
      <rect x="67" y="36" width="42" height="22" rx="3" fill={ink} opacity=".08" />
    </svg>
  );
}

function TimelineView({ m }: { m: UiThemeModel }) {
  return (
    <div className="ut-a">
      <StyleControls m={m} />
      <div className="ut-look">
        <Preview m={m} />
        <div className="ut-look-ctl">
          <span className="lab">Accent</span>
          <Swatches m={m} />
          <span className="lab">Mode</span>
          <Grounds m={m} />
        </div>
      </div>
      <FontBox m={m} />
    </div>
  );
}

function SentenceView({ m }: { m: UiThemeModel }) {
  return (
    <div className="ut-b">
      <StyleControls m={m} />
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Paint the app</span>{" "}
          <ChoiceToken
            label="Accent"
            tip="The one colour of the interface"
            popover={
              <>
                <h5>Accent</h5>
                <Swatches m={m} />
              </>
            }
          >
            <i className="ut-dot" style={{ background: m.accent }} aria-hidden="true" />
            {accentName(m.accent)}
          </ChoiceToken>{" "}
          <span className="w">on a</span>{" "}
          <ChoiceToken
            label="Ground"
            tone="alt"
            tip={GROUND_TIP}
            popover={(close) => (
              <>
                <h5>Ground</h5>
                <WordOptions
                  label="Ground"
                  options={GROUNDS.map((g) => ({ value: g, words: g, sub: GROUND_MODES[g] === "light" ? "light mode" : "dark mode" }))}
                  value={m.ground}
                  onChange={m.chooseGround}
                  close={close}
                />
              </>
            )}
          >
            {m.ground}
          </ChoiceToken>{" "}
          <span className="w">ground, in the</span>{" "}
          <SettingControl settingKey="ui_font_family">
            <TextWord label="Font family" shown={m.font === "auto" ? "" : m.font} empty="built-in" tip={FONT_TIP}>
              <Field id="ui-font-family" value={m.font} onChange={m.setFont} placeholder="auto" tip={FONT_TIP} />
            </TextWord>
          </SettingControl>{" "}
          <span className="w">font.</span>
        </div>
      </div>
    </div>
  );
}

function TilesView({ m }: { m: UiThemeModel }) {
  return (
    <div className="ut-c">
      <StyleControls m={m} />
      <SettingControl settingKey="theme_bg">
        <div className="ut-grounds" role="radiogroup" aria-label="Ground">
          {GROUNDS.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={m.ground === g}
              aria-label={g}
              className={m.ground === g ? "ut-ground on" : "ut-ground"}
              title={GROUND_TIP}
              onClick={() => m.chooseGround(g)}
            >
              <Preview m={m} ground={g} />
              <b>{g}</b>
            </button>
          ))}
        </div>
      </SettingControl>
      <div className="sx-tiles">
        <BigTile icon={<i className="ut-dot big" style={{ background: m.accent }} />} title={`Accent · ${accentName(m.accent)}`} wide>
          <Swatches m={m} />
        </BigTile>
        <BigTile icon={<span className="ut-aa">Aa</span>} title="Font family" wide>
          <FontBox m={m} label="" />
        </BigTile>
      </div>
    </div>
  );
}

const VIEWS: CardViews<UiThemeModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function UiThemeCard(grid: GridProps) {
  const m = useUiTheme();
  return <StyledCard cardId="ui-theme" title="UI Theme" icon={<ICONS.uiTheme />} prefix="ut" m={m} views={VIEWS} grid={grid} count={m.cardStyle} />;
}
