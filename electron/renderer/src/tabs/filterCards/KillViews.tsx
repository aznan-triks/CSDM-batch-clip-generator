/**
 * Kill Filters in its three styles, thin views over `useKillFilters`.
 *
 *   - timeline: a switchboard -- one line per filter, Keep / Must / Drop as
 *     columns -- and the clutch sizes as a ladder of bars;
 *   - sentence: what gets kept, required and dropped, as plain English;
 *   - tiles: one illustrated tile per filter, clutch sizes as tiles.
 */
import { Fragment } from "react";

import Chip from "../../components/Chip";
import { FilterClause, UntestedNote } from "../../components/cardstyle/FilterSentence";
import { FilterMatrix } from "../../components/cardstyle/FilterMatrix";
import { FilterTiles } from "../../components/cardstyle/FilterTiles";
import { IconTile } from "../../components/cardstyle/IconTile";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import SettingControl from "../../settings/SettingControl";
import { ChoiceControl, ClearButton } from "./shared";
import type { KillFiltersModel } from "./useKillFilters";

type Clutch = KillFiltersModel["clutch"];

function ClutchSwitch({ clutch }: { clutch: Clutch }) {
  return (
    <SettingControl settingKey={clutch.enabled.key}>
      <Chip label="🎯 CLUTCH" tip={clutch.enabled.tip} selected={clutch.enabled.on} onToggle={clutch.enabled.toggle} />
    </SettingControl>
  );
}

function WinsOnly({ clutch }: { clutch: Clutch }) {
  return (
    <SettingControl settingKey={clutch.winsOnly.key}>
      <Chip label="Wins only" tip={clutch.winsOnly.tip} selected={clutch.winsOnly.on} onToggle={clutch.winsOnly.toggle} />
    </SettingControl>
  );
}

/* ---------- timeline ---------- */

/** Clutch sizes as bars that grow with the odds: 1v1 short, 1v5 tall. */
function ClutchLadder({ clutch }: { clutch: Clutch }) {
  return (
    <div className="kf-clutch">
      <div className="row">
        <ClutchSwitch clutch={clutch} />
        {clutch.enabled.on && <WinsOnly clutch={clutch} />}
        {clutch.enabled.on && <ChoiceControl choice={clutch.mode} showLabel={false} />}
      </div>
      {clutch.enabled.on && (
        <div className="kf-ladder" role="group" aria-label="Clutch sizes">
          {clutch.sizes.map((size) => (
            <SettingControl key={size.key} settingKey={size.key}>
              <button
                type="button"
                className={size.on ? "kf-rung on" : "kf-rung"}
                aria-pressed={size.on}
                aria-label={`1v${size.n}`}
                title={size.tip}
                style={{ ["--h" as string]: `${28 + size.n * 9}px` }}
                onClick={size.toggle}
              >
                <i aria-hidden="true" />
                1v{size.n}
              </button>
            </SettingControl>
          ))}
        </div>
      )}
    </div>
  );
}

export function KillTimeline({ m }: { m: KillFiltersModel }) {
  return (
    <div className="kill-filters">
      <div className="row">
        <ChoiceControl choice={m.suicides} />
        <ChoiceControl choice={m.headshots} />
      </div>
      <div className="row">
        <span className="lab">Mods + demoparser2</span>
        <ClearButton clear={m.clear} />
      </div>
      <div className="cf-matrices">
        {m.groups.map((g) => (
          <FilterMatrix key={g.id} heading={g.heading} rows={g.rows} />
        ))}
      </div>
      <ClutchLadder clutch={m.clutch} />
    </div>
  );
}

/* ---------- sentence ---------- */

const SUICIDE_WORD: Record<string, string> = { include: "included", exclude: "left out", only: "only" };
const HEADSHOT_WORD: Record<string, string> = { all: "all", only: "only", exclude: "no" };
const MODE_WORD: Record<string, string> = { kills_only: "the kills only", full_clutch: "the whole clutch" };

function ChoiceWord({ choice, words }: { choice: KillFiltersModel["suicides"]; words: Record<string, string> }) {
  return (
    <ChoiceToken
      label={choice.label}
      tip={choice.tip}
      popover={
        <>
          <h5>{choice.label}</h5>
          <ChoiceControl choice={choice} showLabel={false} />
        </>
      }
    >
      {words[choice.value] ?? choice.value}
    </ChoiceToken>
  );
}

function ClutchSentence({ clutch }: { clutch: Clutch }) {
  const picked = clutch.sizes.filter((s) => s.on).map((s) => `1v${s.n}`);
  const sizes = (
    <ChoiceToken
      label="Clutches"
      tip={clutch.enabled.tip}
      popover={
        <>
          <h5>Clutches</h5>
          <div className="chips">
            <ClutchSwitch clutch={clutch} />
          </div>
          {clutch.enabled.on && (
            <div className="chips">
              {clutch.sizes.map((size) => (
                <SettingControl key={size.key} settingKey={size.key}>
                  <Chip label={`1v${size.n}`} tip={size.tip} selected={size.on} onToggle={size.toggle} />
                </SettingControl>
              ))}
            </div>
          )}
        </>
      }
    >
      {!clutch.enabled.on ? "no clutches" : picked.length ? `${picked.join(" · ")} clutches` : "clutches of any size"}
    </ChoiceToken>
  );
  if (!clutch.enabled.on) return <div className="cf-clause">Also catch {sizes}.</div>;
  return (
    <div className="cf-clause">
      Also catch {sizes},{" "}
      <ChoiceToken
        label="Clutch outcome"
        tip={clutch.winsOnly.tip}
        popover={
          <>
            <h5>Outcome</h5>
            <div className="chips">
              <WinsOnly clutch={clutch} />
            </div>
          </>
        }
      >
        {clutch.winsOnly.on ? "won only" : "won or lost"}
      </ChoiceToken>
      , filming <ChoiceWord choice={clutch.mode} words={MODE_WORD} />.
    </div>
  );
}

export function KillSentence({ m }: { m: KillFiltersModel }) {
  return (
    <div className="kill-filters cf-sentence">
      <FilterClause rows={m.rows} mode="enable" lead="Keep kills that are" empty="any kind" addLabel="Add a kill filter" />
      <FilterClause rows={m.rows} mode="must" lead="Every clip must be" empty="nothing in particular" addLabel="Require a filter" />
      <FilterClause rows={m.rows} mode="exclude" lead="Drop kills that are" empty="none" addLabel="Exclude a filter" />
      <div className="cf-clause">
        With suicides <ChoiceWord choice={m.suicides} words={SUICIDE_WORD} /> and{" "}
        <ChoiceWord choice={m.headshots} words={HEADSHOT_WORD} /> headshots
        {m.headshots.disabled && <span className="cf-note"> (locked by One Tap / Trois Tap)</span>}.
      </div>
      <ClutchSentence clutch={m.clutch} />
      <UntestedNote rows={m.rows} />
      <div className="row">
        <span className="capture-hint">Kept filters: any one of them lets a kill in; none = every kill.</span>
        <ClearButton clear={m.clear} />
      </div>
    </div>
  );
}

/* ---------- tiles ---------- */

/** The "1vN" glyph of a clutch tile: one figure against N. */
function ClutchGlyph({ n }: { n: number }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="7" cy="13" r="4" fill="currentColor" />
      <path d="M3 19h8l1 13H2z" fill="currentColor" />
      {Array.from({ length: n }, (_, i) => (
        <Fragment key={i}>
          <circle cx={20 + (i % 3) * 7} cy={i < 3 ? 10 : 24} r="2.6" fill="currentColor" opacity=".55" />
          <path d={`M${17 + (i % 3) * 7} ${i < 3 ? 14 : 28}h6l.6 8h-7.2z`} fill="currentColor" opacity=".55" />
        </Fragment>
      ))}
    </svg>
  );
}

export function KillTiles({ m }: { m: KillFiltersModel }) {
  const c = m.clutch;
  return (
    <div className="kill-filters cf-tiles-card">
      <div className="cf-modes">
        <ChoiceControl choice={m.suicides} />
        <ChoiceControl choice={m.headshots} />
        <ClearButton clear={m.clear} />
      </div>
      {m.groups.map((g) => (
        <FilterTiles key={g.id} heading={g.heading} rows={g.rows} />
      ))}
      <section className="cf-tiles" aria-label="Clutch">
        <h4 className="cf-heading">Clutch</h4>
        <div className="cf-tile-grid">
          <SettingControl settingKey={c.enabled.key}>
            <IconTile
              icon={<span className="cf-emoji">🎯</span>}
              title="CLUTCH"
              subtitle="the player is the last alive on their team"
              on={c.enabled.on}
              tip={c.enabled.tip}
              onToggle={c.enabled.toggle}
            />
          </SettingControl>
          {c.enabled.on &&
            c.sizes.map((size) => (
              <SettingControl key={size.key} settingKey={size.key}>
                <IconTile
                  icon={<ClutchGlyph n={size.n} />}
                  title={`1v${size.n}`}
                  subtitle={`${size.n} opponent${size.n > 1 ? "s" : ""} alive`}
                  on={size.on}
                  tip={size.tip}
                  onToggle={size.toggle}
                />
              </SettingControl>
            ))}
        </div>
        {c.enabled.on && (
          <div className="cf-modes">
            <WinsOnly clutch={c} />
            <ChoiceControl choice={c.mode} />
          </div>
        )}
      </section>
    </div>
  );
}
