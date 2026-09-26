/**
 * UI Layout: window size, split, card grid and the two layout switches.
 *
 *   - timeline: the window drawn to its proportions, the split as a bar you
 *     drag, the width and height on its edges;
 *   - sentence: "Open the window at <1600> by <900> px, <60>% for the video
 *     panel. …";
 *   - tiles: one tile per setting and one per layout action.
 *
 * The typed values are stored as they are typed; Apply clamps them the way
 * `_clamp_layout_values` did (csdm_batch_clips_generator.py) and resizes the
 * live window.
 */
import { useRef, type PointerEvent, type ReactNode } from "react";

import Field from "../../components/Field";
import Slider from "../../components/Slider";
import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import { BigTile, TextWord, WordOptions } from "../../components/cardstyle/StyledParts";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import ToggleSwitch from "../../components/cardstyle/ToggleSwitch";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { setWindowBounds } from "../../bridge";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import { asNumber } from "../../settings/asNumber";
import { useSetting, useSettingsBatch } from "../../settings/store";
import { WINDOW_DEFAULTS } from "../../settings/windowDefaults";
import { clampSplitPct } from "../../shell/splitPane";
import { Glyph, useToggle, type ToggleSetting } from "./shared";
import "./SettingsCards.css";

/** Mirrors `_clamp_layout_values` in csdm_batch_clips_generator.py. */
function clampLayout(w: number, h: number, split: number): [number, number, number] {
  const width = Math.max(1000, Math.min(3840, Math.round(w) || WINDOW_DEFAULTS.w));
  const height = Math.max(600, Math.min(2160, Math.round(h) || WINDOW_DEFAULTS.h));
  return [width, height, clampSplitPct(split)];
}

/** Card grid column, in px: the slider's reach and step. */
const BLOCK = { min: 24, max: 96, step: 4, fallback: 48 } as const;

interface NumberSetting {
  key: string;
  id: string;
  label: string;
  value: number;
  tip: string;
  set: (value: number) => void;
}

interface UiLayoutModel {
  w: NumberSetting;
  h: NumberSetting;
  split: NumberSetting;
  block: NumberSetting;
  remember: ToggleSetting;
  tooltips: ToggleSetting;
  apply: () => void;
  auto: () => void;
  resetDefaults: () => void;
  resetCards: () => void;
}

function useNumber(key: string, id: string, label: string, fallback: number, tip: string): NumberSetting {
  const [raw, set] = useSetting<number>(key);
  const value = asNumber(raw, fallback);
  return { key, id, label, value, tip, set: (next) => set(asNumber(next, value)) };
}

function useUiLayout(): UiLayoutModel {
  const setMany = useSettingsBatch();
  const w = useNumber("ui_window_w", "ui-window-w", "Window width", WINDOW_DEFAULTS.w, `Width of the application window in pixels (default ${WINDOW_DEFAULTS.w})`);
  const h = useNumber("ui_window_h", "ui-window-h", "Window height", WINDOW_DEFAULTS.h, `Height of the application window in pixels (default ${WINDOW_DEFAULTS.h})`);
  const split = useNumber(
    "ui_split_pct",
    "ui-split-pct",
    "Split %",
    WINDOW_DEFAULTS.splitPct,
    "Width split between the left video panel and right settings panel, as a percentage",
  );
  const block = useNumber(
    "ui_card_block_size",
    "ui-card-block-size",
    "Card grid size",
    BLOCK.fallback,
    "Width of one grid column, in pixels -- decides how finely cards can be resized and repositioned",
  );
  const remember = useToggle(
    "ui_remember_layout",
    "Remember current layout",
    "Automatically saves window size and pane split whenever they change, without pressing Apply",
  );
  const tooltips = useToggle(
    "ui_always_show_tooltips",
    "Always show tooltips",
    "Keep tooltips and explanation hints constantly visible under controls instead of only on hover",
  );

  function resize(width: number, height: number, pct: number) {
    const [cw, ch, cs] = clampLayout(width, height, pct);
    setMany({ ui_window_w: cw, ui_window_h: ch, ui_split_pct: cs });
    void setWindowBounds(cw, ch);
  }

  return {
    w,
    h,
    split,
    block,
    remember,
    tooltips,
    apply: () => resize(w.value, h.value, split.value),
    auto: () => {
      const sw = typeof window !== "undefined" ? window.screen.width : 1920;
      const sh = typeof window !== "undefined" ? window.screen.height : 1080;
      resize(Math.round(sw * 0.86), Math.round(sh * 0.84), WINDOW_DEFAULTS.splitPct);
    },
    resetDefaults: () => resize(WINDOW_DEFAULTS.w, WINDOW_DEFAULTS.h, WINDOW_DEFAULTS.splitPct),
    // Clearing the key is what the layout module reads as "no stored
    // placement": every tab's cards go back to the reference layout.
    resetCards: () => setMany({ ui_sections: {} }),
  };
}

/* ---- the marked controls, written once ---- */

interface Look {
  className?: string;
  children?: ReactNode;
}

function ApplyButton({ m, className, children }: { m: UiLayoutModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="M5" title="Resizes the live window to the width/height/split values typed above" onClick={m.apply}>
      {children ?? "Apply"}
    </button>
  );
}

function AutoButton({ m, className, children }: { m: UiLayoutModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="M6" title="Sizes the window automatically from your screen resolution (~86% width, 84% height)" onClick={m.auto}>
      {children ?? "Auto"}
    </button>
  );
}

function ResetButton({ m, className, children }: { m: UiLayoutModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} data-action="M7" title="Resets window size and split to the app's built-in defaults" onClick={m.resetDefaults}>
      {children ?? "Reset default"}
    </button>
  );
}

function ResetCardsButton({ m, className, children }: { m: UiLayoutModel } & Look) {
  return (
    <button type="button" className={className ?? "chip"} title="Resets every tab's card positions to the default arrangement -- does not affect window size" onClick={m.resetCards}>
      {children ?? "Reset card layout"}
    </button>
  );
}

function NumberBox({ n, bare }: { n: NumberSetting; bare?: boolean }) {
  return (
    <SettingControl settingKey={n.key}>
      <Field id={n.id} label={bare ? undefined : n.label} mono numeric={bare} value={String(n.value)} onChange={(v) => n.set(asNumber(v, n.value))} tip={n.tip} />
    </SettingControl>
  );
}

function Switch({ t }: { t: ToggleSetting }) {
  return (
    <SettingControl settingKey={t.key}>
      <ToggleSwitch label={t.label} on={t.on} tip={t.tip} onToggle={t.toggle} />
    </SettingControl>
  );
}

function BlockSlider({ m }: { m: UiLayoutModel }) {
  const b = m.block;
  return (
    <SettingControl settingKey={b.key}>
      <Slider id={b.id} label={b.label} min={BLOCK.min} max={BLOCK.max} step={BLOCK.step} value={b.value} onChange={b.set} readout={`${b.value}px`} tip={b.tip} />
    </SettingControl>
  );
}

/** The window to scale, split bar draggable: drag it, and the split follows. */
function WindowDrawing({ m }: { m: UiLayoutModel }) {
  const frame = useRef<HTMLDivElement>(null);
  const pct = clampSplitPct(m.split.value);

  function follow(event: PointerEvent<HTMLElement>) {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    m.split.set(clampSplitPct(Math.round(((event.clientX - box.left) / box.width) * 100)));
  }

  return (
    <div className="ul-win" style={{ aspectRatio: `${Math.max(1, m.w.value)} / ${Math.max(1, m.h.value)}` }} ref={frame}>
      <div className="ul-pane video" style={{ width: `${pct}%` }}>
        <span>video · {pct}%</span>
      </div>
      <SettingControl settingKey={m.split.key}>
        <span
          className="ul-bar"
          role="slider"
          tabIndex={0}
          aria-label="Split %"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          title={`${m.split.tip}. Drag it`}
          style={{ left: `${pct}%` }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            follow(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) follow(event);
          }}
          onKeyDown={(event) => {
            const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
            if (by === undefined) return;
            event.preventDefault();
            m.split.set(clampSplitPct(pct + by));
          }}
        />
      </SettingControl>
      <div className="ul-pane cards">
        <span>settings · {100 - pct}%</span>
      </div>
    </div>
  );
}

function TimelineView({ m }: { m: UiLayoutModel }) {
  return (
    <div className="ul-a">
      <div className="ul-stage">
        <div className="ul-top">
          <NumberBox n={m.w} />
        </div>
        <div className="ul-mid">
          <WindowDrawing m={m} />
          <div className="ul-side">
            <NumberBox n={m.h} />
            <NumberBox n={m.split} />
          </div>
        </div>
      </div>
      <div className="row">
        <ApplyButton m={m} className="chip on" />
        <AutoButton m={m} />
        <ResetButton m={m} />
        <ResetCardsButton m={m} />
      </div>
      <div className="row">
        <Switch t={m.remember} />
        <Switch t={m.tooltips} />
      </div>
      <div className="row">
        <BlockSlider m={m} />
      </div>
    </div>
  );
}

function NumberWord({ n, unit, tone }: { n: NumberSetting; unit: string; tone?: "alt" }) {
  return (
    <SettingControl settingKey={n.key}>
      <TextWord label={n.label} shown={`${n.value}${unit}`} empty="" tip={n.tip} tone={tone}>
        <Field id={n.id} mono numeric value={String(n.value)} onChange={(v) => n.set(asNumber(v, n.value))} tip={n.tip} />
      </TextWord>
    </SettingControl>
  );
}

function OnOffWord({ t, on, off }: { t: ToggleSetting; on: string; off: string }) {
  return (
    <SettingControl settingKey={t.key}>
      <ChoiceToken
        label={t.label}
        tone="alt"
        tip={t.tip}
        popover={(close) => (
          <WordOptions
            label={t.label}
            options={[
              { value: "on", words: on },
              { value: "off", words: off },
            ]}
            value={t.on ? "on" : "off"}
            onChange={t.toggle}
            close={close}
          />
        )}
      >
        {t.on ? on : off}
      </ChoiceToken>
    </SettingControl>
  );
}

function SentenceView({ m }: { m: UiLayoutModel }) {
  return (
    <div className="ul-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Open the window at</span> <NumberWord n={m.w} unit="" /> <span className="w">by</span>{" "}
          <NumberWord n={m.h} unit=" px" />
          <span className="w">, with</span> <NumberWord n={m.split} unit="%" tone="alt" /> <span className="w">for the video panel.</span>{" "}
          <ApplyButton m={m} className="sx-act">
            Apply
          </ApplyButton>
        </div>
        <div className="sc-line">
          <OnOffWord t={m.remember} on="Remember" off="Don't remember" /> <span className="w">the size when I resize it, and show tooltips</span>{" "}
          <OnOffWord t={m.tooltips} on="all the time" off="on hover only" />
          <span className="w">.</span>
        </div>
        <div className="sc-line">
          <span className="w">Cards snap to a</span>{" "}
          <SettingControl settingKey={m.block.key}>
            <TextWord label={m.block.label} shown={`${m.block.value} px`} empty="" tip={m.block.tip}>
              <BlockSliderBare m={m} />
            </TextWord>
          </SettingControl>{" "}
          <span className="w">grid.</span>
        </div>
      </div>
      <div className="sx-links">
        <AutoButton m={m} className="sx-act link">
          Auto
        </AutoButton>
        <ResetButton m={m} className="sx-act link">
          Reset default
        </ResetButton>
        <ResetCardsButton m={m} className="sx-act link">
          Reset card layout
        </ResetCardsButton>
      </div>
    </div>
  );
}

/** The grid slider without its own marker (the word around it carries one). */
function BlockSliderBare({ m }: { m: UiLayoutModel }) {
  const b = m.block;
  return <Slider id={b.id} label={b.label} min={BLOCK.min} max={BLOCK.max} step={BLOCK.step} value={b.value} onChange={b.set} readout={`${b.value}px`} tip={b.tip} />;
}

function TilesView({ m }: { m: UiLayoutModel }) {
  return (
    <div className="ul-c">
      <div className="sx-tiles">
        <BigTile icon={<Glyph g="window" />} title="Window" caption={`${m.w.value} by ${m.h.value} px`}>
          <NumberBox n={m.w} bare />
          <span className="ul-x">by</span>
          <NumberBox n={m.h} bare />
        </BigTile>
        <BigTile icon={<Glyph g="window" />} title="Video panel" caption="share of the width" tone="alt">
          <NumberBox n={m.split} bare />
          <span className="ul-x">%</span>
        </BigTile>
        <BigTile icon={<Glyph g="pin" />} title="Remember" on={m.remember.on} caption="saves size and split as they change">
          <Switch t={m.remember} />
        </BigTile>
        <BigTile icon={<Glyph g="tip" />} title="Tooltips" on={m.tooltips.on} caption="always visible under controls">
          <Switch t={m.tooltips} />
        </BigTile>
        <BigTile icon={<Glyph g="grid" />} title="Card grid" wide>
          <BlockSlider m={m} />
        </BigTile>
      </div>
      <div className="ul-acts">
        <ApplyButton m={m} className="ul-act on">
          <b>Apply</b>
          <small>resize the window now</small>
        </ApplyButton>
        <AutoButton m={m} className="ul-act">
          <b>Auto</b>
          <small>fit the screen</small>
        </AutoButton>
        <ResetButton m={m} className="ul-act">
          <b>Reset default</b>
          <small>
            {WINDOW_DEFAULTS.w} by {WINDOW_DEFAULTS.h}
          </small>
        </ResetButton>
        <ResetCardsButton m={m} className="ul-act">
          <b>Reset card layout</b>
          <small>every tab</small>
        </ResetCardsButton>
      </div>
    </div>
  );
}

const VIEWS: CardViews<UiLayoutModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function UiLayoutCard(grid: GridProps) {
  const m = useUiLayout();
  return (
    <StyledCard cardId="ui-layout" title="UI Layout" icon={<ICONS.uiLayout />} prefix="ul" m={m} views={VIEWS} grid={grid} count={`${m.w.value} by ${m.h.value}`} />
  );
}
