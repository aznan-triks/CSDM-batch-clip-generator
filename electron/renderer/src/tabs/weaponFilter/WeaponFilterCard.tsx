/**
 * The Weapon Filter card: one model, drawn in the card's style.
 *
 *   - timeline: a weapon rack -- every weapon the database holds as its own
 *     silhouette, one shelf per category; a click lights it up;
 *   - sentence: "Keep kills made with …", one word per category opening its
 *     weapons;
 *   - tiles: one illustrated tile per weapon.
 *
 * `weapons` is ONE list key, so ONE `SettingControl` wraps the whole body in
 * every style: Select all / Deselect all write it too.
 */
import type { ComponentProps, ComponentType } from "react";

import Card from "../../components/Card";
import Chip from "../../components/Chip";
import type { CardStyle } from "../../components/cardstyle/cardStyle";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import { useCardStyle } from "../../components/cardstyle/useCardStyle";
import { ICONS } from "../../icons";
import DatabasePending from "../../settings/DatabasePending";
import SettingControl from "../../settings/SettingControl";
import { gunWidth, useWeaponFilter, type WeaponFilterModel, type WeaponModel } from "./useWeaponFilter";
import "../WeaponFilterSection.css";

type GridProps = Omit<ComponentProps<typeof Card>, "title" | "children">;

/** The game's silhouette of one weapon, as a CSS mask so it takes the text colour. */
function Gun({ w, height, className = "" }: { w: Pick<WeaponModel, "name" | "art">; height: number; className?: string }) {
  if (!w.art) return <span className={`gun wf-noart ${className}`} style={{ height }} aria-hidden="true" />;
  return (
    <span
      className={`gun ${className}`}
      data-weapon={w.name}
      aria-hidden="true"
      style={{ width: `${gunWidth(w.name, height)}px`, height: `${height}px`, ["--gun-art" as string]: `url(${w.art})` }}
    />
  );
}

function BulkButtons({ m }: { m: WeaponFilterModel }) {
  return (
    <div className="chips push-right">
      <button type="button" className="chip" data-action="E1" title={m.selectAll.tip} onClick={m.selectAll.run}>
        Select all
      </button>
      <button type="button" className="chip" data-action="E2" title={m.deselectAll.tip} onClick={m.deselectAll.run}>
        Deselect all
      </button>
    </div>
  );
}

/** The picked weapons' silhouettes; a deselected one fades out. */
function Cascade({ m }: { m: WeaponFilterModel }) {
  if (!m.cascade.length) return null;
  return (
    <div className="casc" aria-hidden="true">
      {m.cascade.map((g) => (
        <Gun key={g.name} w={g} height={44} className={`casc-g ${g.leaving ? "casc-out" : "in"}`} />
      ))}
    </div>
  );
}

/* ---------- timeline: the rack ---------- */

function RackView({ m }: { m: WeaponFilterModel }) {
  return (
    <>
      <div className="row">
        <span className="lab">empty = all</span>
        <span className="wf-summary">
          Keeps kills with <b>{m.summary}</b>
        </span>
        <BulkButtons m={m} />
      </div>
      <div className="wf-rack">
        {m.categories.map((c) => (
          <div key={c.name} className="wf-shelf">
            <button
              type="button"
              className={c.picked ? "wf-shelf-name on" : "wf-shelf-name"}
              title={`${c.tip} — click to pick or drop the whole category`}
              onClick={c.toggleAll}
            >
              {c.name}
              <small>
                {c.picked}/{c.weapons.length}
              </small>
            </button>
            <div className="wf-shelf-guns">
              {c.weapons.map((w) => (
                <button
                  key={w.name}
                  type="button"
                  className={w.on ? "wf-rackgun on" : "wf-rackgun"}
                  aria-pressed={w.on}
                  aria-label={w.name}
                  title={w.tip}
                  onClick={w.toggle}
                >
                  <Gun w={w} height={30} />
                  <small>{w.name}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- sentence ---------- */

function SentenceView({ m }: { m: WeaponFilterModel }) {
  return (
    <div className="cf-sentence">
      <div className="cf-clause">
        Keep kills made with <b className="wf-summary-strong">{m.summary}</b>
        {!m.selected.length && <span className="lab"> (empty = all)</span>}.
      </div>
      <div className="cf-clause wf-pickline">
        Pick from{" "}
        {m.categories.map((c) => (
          <ChoiceToken
            key={c.name}
            label={c.name}
            tip={c.tip}
            popover={
              <>
                <h5>{c.name}</h5>
                <p className="cf-pop-tip">{c.tip}</p>
                <div className="chips">
                  <Chip
                    label={c.picked === c.weapons.length ? "None" : "All"}
                    tip={`Pick or drop every ${c.name} weapon`}
                    selected={false}
                    onToggle={c.toggleAll}
                  />
                </div>
                <div className="chips">
                  {c.weapons.map((w) => (
                    <Chip key={w.name} label={w.name} tip={w.tip} selected={w.on} onToggle={w.toggle} />
                  ))}
                </div>
              </>
            }
          >
            {c.name}
            {c.picked > 0 && <span className="wf-tokcount">{c.picked}</span>}
          </ChoiceToken>
        ))}
      </div>
      <Cascade m={m} />
      <div className="row">
        <BulkButtons m={m} />
      </div>
    </div>
  );
}

/* ---------- tiles ---------- */

function TilesView({ m }: { m: WeaponFilterModel }) {
  return (
    <>
      <div className="row">
        <span className="lab">empty = all</span>
        <span className="wf-summary">
          Keeps kills with <b>{m.summary}</b>
        </span>
        <BulkButtons m={m} />
      </div>
      {m.categories.map((c) => (
        <section key={c.name} className="wf-tilecat" aria-label={c.name}>
          <h4 className="cf-heading" title={c.tip}>
            {c.name}
            <button type="button" className="wf-catall" title={`Pick or drop every ${c.name} weapon`} onClick={c.toggleAll}>
              {c.picked === c.weapons.length ? "none" : "all"}
            </button>
          </h4>
          <div className="wf-tiles">
            {c.weapons.map((w) => (
              <button
                key={w.name}
                type="button"
                className={w.on ? "wf-tile on" : "wf-tile"}
                aria-pressed={w.on}
                aria-label={w.name}
                title={w.tip}
                onClick={w.toggle}
              >
                <span className="wf-tile-ck" aria-hidden="true">
                  ✓
                </span>
                <span className="wf-tile-art">
                  <Gun w={w} height={34} />
                </span>
                <b>{w.name}</b>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

const VIEWS: Record<CardStyle, ComponentType<{ m: WeaponFilterModel }>> = {
  timeline: RackView,
  sentence: SentenceView,
  tiles: TilesView,
};

export default function WeaponFilterCard(props: GridProps) {
  const m = useWeaponFilter();
  const style = useCardStyle("weapon-filter");
  const View = VIEWS[style];
  return (
    <Card title="Weapon Filter" icon={<ICONS.weaponFilter />} count={m.count} {...props}>
      {m.state === "loading" ? (
        <p className="capture-hint">Loading weapons…</p>
      ) : m.state === "pending" ? (
        <DatabasePending />
      ) : (
        <SettingControl settingKey={m.key}>
          <div className={`weapon-filter wf-${style}`}>
            <View m={m} />
          </div>
        </SettingControl>
      )}
    </Card>
  );
}
