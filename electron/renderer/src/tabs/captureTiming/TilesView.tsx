/**
 * Capture & Timing, "tiles" style (concept C): two panels, one question each.
 *
 *   - Moments: which events become clips, as big tiles, with the role and
 *     team shared by every tile in one strip under them;
 *   - Clip: how each clip is filmed, picked from three camera pictures, with
 *     its length under them.
 *
 * The concept draws two cards. The layout grid keeps one slot per card id and
 * the style is a live switch, so the two are drawn as two panels inside the
 * one Capture & Timing slot rather than as two grid cards.
 */
import type { ReactNode } from "react";

import Chip from "../../components/Chip";
import Slider from "../../components/Slider";
import ClipBar, { type BarPart } from "../../components/cardstyle/ClipBar";
import { IconTile, PictureChoice, type PictureOption } from "../../components/cardstyle/IconTile";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import { silhouetteFor } from "../../weapon/silhouettes";
import { FeedName, MatePovChips, MergeWords } from "./shared";
import type { CaptureTimingModel, Perspective, ToggleSetting } from "./useCaptureTiming";

/* Blocky tile glyphs, flat polygons with punched holes (the repo's icon style). */
const GLYPHS: Record<string, ReactNode> = {
  kill: (
    <svg viewBox="0 0 40 40">
      <path d="M9 5h22l4 5v13l-5 4v8H10v-8l-5-4V10z" fill="currentColor" />
      <path
        d="M11 15h7v7h-7zm11 0h7v7h-7zM18 25h4v3h-4zM14 30h2v5h-2zm5 0h2v5h-2zm5 0h2v5h-2z"
        fill="var(--panel-hole, var(--solid))"
      />
    </svg>
  ),
  damage: (
    <svg viewBox="0 0 40 40">
      <path d="M4 7l3-3 8 8-3 3zM36 7l-3-3-8 8 3 3zM4 33l3 3 8-8-3-3zM36 33l-3 3-8-8 3-3z" fill="currentColor" />
      <path d="M20 12c4 5 6.5 8 6.5 11.5a6.5 6.5 0 0 1-13 0c0-3.5 2.5-6.5 6.5-11.5z" fill="currentColor" opacity=".6" />
    </svg>
  ),
  shot: (
    <svg viewBox="0 0 40 40">
      <path d="M20 12h9c4 0 7 3.5 7 8s-3 8-7 8h-9z" fill="currentColor" />
      <path d="M14 12h5v16h-5z" fill="currentColor" opacity=".7" />
      <path d="M3 15h8v2H3zm-1 4h9v2H2zm1 4h8v2H3z" fill="currentColor" opacity=".45" />
    </svg>
  ),
  round: (
    <svg viewBox="0 0 40 40">
      <path d="M15 3h10v4H15z" fill="currentColor" />
      <path d="M20 8a14 14 0 1 1 0 28 14 14 0 0 1 0-28z" fill="currentColor" opacity=".3" />
      <path d="M20 8a14 14 0 0 1 13.6 17.3L20 22z" fill="currentColor" />
      <path d="M19 14h2v9h-2z" fill="var(--panel-hole, var(--solid))" />
    </svg>
  ),
};

/* The camera pictures: a small scene seen through each camera. */
const FIGURE = "M10 .8a4.2 4.2 0 1 1 0 8.4a4.2 4.2 0 1 1 0-8.4zM4 11h12l2 13h-3l-1 15h-3l-1-11-1 11H6L5 24H2z";
const FIGURE_AIM = "M11 .8a4.2 4.2 0 1 1 0 8.4a4.2 4.2 0 1 1 0-8.4zM5 11h12l1 3h11v3H18l1 7h-3l-1 15h-3l-1-11-1 11H7L6 24H3z";

function Gun({ name, x, y, w, h, rotate }: { name: string; x: number; y: number; w: number; h: number; rotate: number }) {
  const href = silhouetteFor(name);
  if (!href) return null;
  return (
    <image
      href={href}
      x={x}
      y={y}
      width={w}
      height={h}
      transform={`rotate(${rotate} ${x + w / 2} ${y + h / 2})`}
      className="cc-gun"
    />
  );
}

const KILLER_ART = (
  <svg viewBox="0 0 100 66" aria-hidden="true">
    <rect width="100" height="66" className="cc-sky k" />
    <path d="M0 44h100v22H0z" className="cc-floor" />
    <rect x="8" y="22" width="20" height="22" className="cc-box" />
    <rect x="72" y="26" width="18" height="18" className="cc-box lo" />
    <path d={FIGURE} transform="translate(44 22) scale(.55)" className="cc-fig" />
    <path d="M49.5 28v4M49.5 36v4M43.5 34h4M51.5 34h4" className="cc-aim" />
    <Gun name="AK-47" x={52} y={46} w={50} h={18} rotate={-8} />
    <rect x="4" y="57" width="18" height="5" rx="1.5" className="cc-hud" />
    <rect x="5" y="58" width="14" height="3" rx="1" className="cc-hud-k" />
  </svg>
);

const VICTIM_ART = (
  <svg viewBox="0 0 100 66" aria-hidden="true">
    <rect width="100" height="66" className="cc-sky" />
    <path d="M0 46h100v20H0z" className="cc-floor" />
    <rect x="60" y="20" width="30" height="26" className="cc-box" />
    <path d={FIGURE_AIM} transform="translate(46 21) scale(-.6 .6)" className="cc-fig" />
    <path d="M50 10a24 24 0 0 0-17 7" className="cc-hit" />
    <Gun name="Desert Eagle" x={64} y={48} w={34} h={15} rotate={-6} />
    <rect width="100" height="66" className="cc-vignette" />
    <rect x="4" y="57" width="18" height="5" rx="1.5" className="cc-hud" />
    <rect x="5" y="58" width="3" height="3" rx="1" className="cc-hud-v" />
  </svg>
);

const BOTH_ART = (
  <svg viewBox="0 0 100 66" aria-hidden="true">
    <path d="M0 0h62L38 66H0z" className="cc-sky k" />
    <path d="M62 0h38v66H38z" className="cc-sky v" />
    <path d="M0 44h56L48 66H0z" className="cc-floor" />
    <path d="M58 46h42v20H44z" className="cc-floor v" />
    <path d={FIGURE} transform="translate(30 22) scale(.55)" className="cc-fig" />
    <path d="M35.5 28v4M35.5 36v4M29.5 34h4M37.5 34h4" className="cc-aim" />
    <path d={FIGURE_AIM} transform="translate(80 21) scale(-.6 .6)" className="cc-fig" />
    <Gun name="AK-47" x={6} y={46} w={40} h={15} rotate={-8} />
    <path d="M62 0 38 66" className="cc-cut" />
    <circle cx="50" cy="33" r="7" className="cc-hud" />
    <path d="M47 30l4 3-4 3" className="cc-arrow" />
  </svg>
);

const CAMERAS: readonly PictureOption<Perspective>[] = [
  { value: "killer", title: "Killer", subtitle: "killer’s eyes", art: KILLER_ART, color: "var(--cam-k)", tip: "The whole clip through the killer's eyes" },
  { value: "victim", title: "Victim", subtitle: "victim’s eyes", art: VICTIM_ART, color: "var(--cam-v)", tip: "The whole clip through the victim's eyes" },
  { value: "both", title: "Both", subtitle: "killer → victim", art: BOTH_ART, color: "var(--accent)", tip: "The killer, then switches to the victim a few seconds before the kill" },
];

/** A tile's subtitle, rewritten from the role it applies to. */
function tileWords(kind: "lethal" | "non" | "other", m: CaptureTimingModel): string {
  const a = m.actor.on;
  const g = m.target.on;
  if (kind === "lethal") return a && g ? "your kills and your deaths" : a ? "your kills" : g ? "your deaths" : "pick a role below";
  if (kind === "non") return a && g ? "hits you deal and take" : a ? "hits you deal" : g ? "hits you take" : "pick a role below";
  return a ? "shots you fire, no hit" : "only when “I do it” is on";
}

function Tile(props: { t: ToggleSetting; title: string; subtitle: string; code: string; glyph: string; warn?: boolean }) {
  const { t } = props;
  return (
    <SettingControl settingKey={t.key}>
      <IconTile
        icon={GLYPHS[props.glyph]}
        title={props.title}
        subtitle={props.subtitle}
        code={props.code}
        on={t.on}
        disabled={t.disabled}
        warn={props.warn}
        tip={t.tip}
        onToggle={t.toggle}
      />
    </SettingControl>
  );
}

function DockChip({ t, label }: { t: ToggleSetting; label: string }) {
  return (
    <SettingControl settingKey={t.key}>
      <Chip label={label} tip={t.tip} selected={t.on} disabled={t.disabled} onToggle={t.toggle} />
    </SettingControl>
  );
}

function PanelHead({ icon, title, count }: { icon: ReactNode; title: string; count: string }) {
  return (
    <header className="cc-ph">
      <span className="cc-gl" aria-hidden="true">
        {icon}
      </span>
      <span className="cc-t">{title}</span>
      <span className="cc-cnt">{count}</span>
    </header>
  );
}

export default function TilesView({ m }: { m: CaptureTimingModel }) {
  const { clip } = m;
  const cam = m.perspective.value;
  const kinds = [m.lethal, m.nonLethal, m.other, m.rounds].filter((t) => t.on).length;
  const captured = [
    m.lethal.on ? "kills" : null,
    m.nonLethal.on ? "damage" : null,
    m.other.on ? "shots" : null,
  ].filter(Boolean);
  const against = m.ally.on && m.enemy.on ? "anyone" : m.ally.on ? "teammates" : "enemies";

  const parts: BarPart[] =
    cam === "both"
      ? [
          { key: "lead", seconds: clip.lead, tone: "primary", label: `${clip.lead}s` },
          ...(clip.victimView
            ? [{ key: "victim", seconds: clip.victimView, tone: "alt" as const, label: `${clip.victimView}s` }]
            : []),
        ]
      : [
          {
            key: "lead",
            seconds: clip.before,
            tone: cam === "victim" ? "alt" : "primary",
            label: `${clip.before}s ${cam}`,
          },
        ];
  parts.push({ key: "after", seconds: clip.after, tone: "rest", label: `${clip.after}s after` });

  return (
    <div className="ct-c">
      <section className="cc-panel" aria-label="Moments">
        <PanelHead icon={<ICONS.capture />} title="Moments" count={`${kinds} ${kinds === 1 ? "kind" : "kinds"}`} />
        <div className="cc-tiles">
          <Tile t={m.lethal} title="Kills & deaths" subtitle={tileWords("lethal", m)} code="LETHAL" glyph="kill" />
          <Tile t={m.nonLethal} title="Damage" subtitle={tileWords("non", m)} code="NON-LETHAL" glyph="damage" />
          <Tile
            t={m.other}
            title="Shots & swings"
            subtitle={tileWords("other", m)}
            code="OTHER"
            glyph="shot"
            warn={m.other.disabled}
          />
          <Tile t={m.rounds} title="Full rounds" subtitle="a whole round per clip" code="ROUNDS" glyph="round" />
        </div>
        <div className="cc-dock">
          <span className="lab">Role</span>
          <div className="chips">
            <DockChip t={m.actor} label="I do it" />
            <DockChip t={m.target} label="Done to me" />
          </div>
          <span className="lab">Against</span>
          <div className="chips">
            <DockChip t={m.enemy} label="Enemies" />
            <DockChip t={m.ally} label="Teammates" />
          </div>
        </div>
        <p className="cc-tally">
          Clips of <b>{captured.join(", ") || "no events"}</b> against <b>{against}</b>
          {m.rounds.on && (
            <>
              , plus <b>full rounds</b>
            </>
          )}
          .
        </p>
      </section>

      <section className="cc-panel" aria-label="Clip">
        <PanelHead icon={<ICONS.captureTiming />} title="Clip" count={`${clip.total} s · ${cam}`} />
        <SettingControl settingKey={m.perspective.key}>
          <PictureChoice label="Camera" options={CAMERAS} value={cam} onChange={m.perspective.set} />
        </SettingControl>
        <div className="cc-sub">
          {m.victimView && (
            <SettingControl settingKey={m.victimView.key}>
              <Slider
                id="victim-pre-s"
                label="Switch"
                unit="s before"
                min={m.victimView.min}
                max={m.victimView.max}
                value={m.victimView.value}
                onChange={m.victimView.set}
                tip={m.victimView.tip}
              />
            </SettingControl>
          )}
          {m.matePov && m.matePovReq && (
            <div className="row">
              <span className="lab">Mate POV</span>
              <MatePovChips enable={m.matePov} must={m.matePovReq} />
            </div>
          )}
          <div className="row">
            <FeedName m={m} />
          </div>
        </div>
        <span className="kick cc-kick">Length</span>
        <ClipBar variant="labelled" parts={parts} moment={clip.before} />
        <div className="cc-sub">
          <SettingControl settingKey={m.before.key}>
            <Slider
              id="seconds-before"
              label="Before"
              unit="s"
              min={m.before.min}
              max={m.before.max}
              value={m.before.value}
              onChange={m.before.set}
              tip={m.before.tip}
            />
          </SettingControl>
          <SettingControl settingKey={m.after.key}>
            <Slider
              id="seconds-after"
              label="After"
              unit="s"
              min={m.after.min}
              max={m.after.max}
              value={m.after.value}
              onChange={m.after.set}
              tip={m.after.tip}
            />
          </SettingControl>
        </div>
        <p className="cc-merge">
          <svg width="54" height="20" viewBox="0 0 54 20" aria-hidden="true">
            <rect x="1" y="6" width="20" height="8" rx="3" fill="var(--accent)" />
            <rect x="21" y="9" width="12" height="2" fill="var(--accent)" opacity=".35" />
            <rect x="33" y="6" width="20" height="8" rx="3" fill="none" stroke="var(--accent)" strokeDasharray="3 2" />
            <path d="M11 2v16M43 2v16" stroke="var(--txt)" strokeWidth="1.5" />
          </svg>
          <MergeWords m={m} />
        </p>
      </section>
    </div>
  );
}
