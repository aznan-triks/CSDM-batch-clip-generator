/**
 * The WEAPON FILTER section.
 *
 * Ported from the window's own "WEAPON FILTER (empty = all)": `weapons` is
 * ONE list config key, not one boolean per weapon, so a single
 * `SettingControl` wraps the whole grid (the same rule `map_filter` follows
 * in `MapFilterSection`).
 *
 * The grid needs two things `connect_db` (chantier 4a.1) supplies and
 * `describe_filters` (tâche 1/2) does not: the weapons actually present in
 * the connected database, and the category grouping `tables.weaponCategories`
 * carries. A weapon only appears here if it is in BOTH -- the category table
 * lists every weapon CS2 has ever shipped, and showing one this database has
 * never recorded a kill for would let the user select a filter that always
 * matches nothing.
 *
 * Until `connect_db` answers, the window showed nothing to choose from
 * either -- there is no weapon list before the database says which weapons
 * it holds -- so this renders a wait message instead of an empty grid.
 */
import { useState } from "react";
import Chip from "../components/Chip";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import { useDatabase } from "../settings/useDatabase";
import { useTables } from "../settings/useTables";
import { silhouetteFor, silhouetteRatio } from "../weapon/silhouettes";
import "./WeaponFilterSection.css";

/**
 * Silhouette geometry.
 *
 * The cascade gives every icon the same HEIGHT and lets the WIDTH follow the
 * weapon's own proportions (from the SVG viewBox). A HE grenade is nearly
 * square, an AWP is three times wider than it is tall: forcing every one into
 * the same 96px box left the grenades floating in empty space on both sides
 * (reported 2026-08-03). The bounds keep a tiny grenade readable and stop a
 * sniper rifle from dominating the row.
 */
const CASC_HEIGHT = 44;
const CASC_MIN_WIDTH = 28;
const CASC_MAX_WIDTH = 150;

/** Seconds the fade-out of a deselected silhouette lasts; mirrors CSS. */
const CASC_FADE_SECONDS = 0.25;

/** Width in px for one silhouette, from its own viewBox ratio. */
function silhouetteWidth(name: string): number {
  const ratio = silhouetteRatio(name);
  if (ratio == null) return 96;
  return Math.round(Math.min(CASC_MAX_WIDTH, Math.max(CASC_MIN_WIDTH, CASC_HEIGHT * ratio)));
}



export default function WeaponFilterSection() {
  const { tables } = useTables();
  const { database } = useDatabase();
  const [weapons, setWeapons] = useSetting<string[]>("weapons");
  // Weapons being faded out: still rendered, already removed from `weapons`.
  // Kept as a plain array because a deselected name must survive re-renders
  // until its fade-out timer removes it.
  const [leaving, setLeaving] = useState<string[]>([]);

  if (!tables) {
    return <p className="capture-hint">Loading weapons…</p>;
  }
  if (!database) {
    return <p className="capture-hint">Waiting for DB…</p>;
  }

  const selected = Array.isArray(weapons) ? weapons : [];
  const present = new Set(database.weapons);
  const categories = Object.entries(tables.weaponCategories)
    .map(([category, names]) => [category, names.filter((n) => present.has(n))] as const)
    .filter(([, names]) => names.length > 0);
  const allWeapons = categories.flatMap(([, names]) => names);
  // EVERY picked weapon gets a silhouette, not just the two the firing table
  // draws specifically: `silhouetteFor` falls back to the weapon's class,
  // taken from the engine's own `weapon_categories`. Before this, picking any
  // of the other forty showed nothing -- indistinguishable from a click that
  // did not register.
  const silhouettes = selected
    .map((name) => ({ name, art: silhouetteFor(name) }))
    .filter((entry): entry is { name: string; art: string } => entry.art != null);

  function removeWeapon(name: string) {
    setWeapons(selected.filter((w) => w !== name));
    // Keep it rendered (fading out) until the CSS transition has run.
    setLeaving((prev) => (prev.includes(name) ? prev : [...prev, name]));
    window.setTimeout(() => {
      setLeaving((prev) => prev.filter((n) => n !== name));
    }, CASC_FADE_SECONDS * 1000);
  }

  function toggle(name: string) {
    if (selected.includes(name)) {
      removeWeapon(name);
    } else {
      setWeapons([...selected, name]);
      // A re-pick during the fade-out cancels it: the silhouette is back
      // before the timer removes it.
      setLeaving((prev) => prev.filter((n) => n !== name));
    }
  }

  return (
    <div className="weapon-filter">
      <div className="row">
        <span className="lab">empty = all</span>
        <div className="chips push-right">
          <button type="button" className="chip" data-action="E1" onClick={() => { setWeapons([...allWeapons]); setLeaving([]); }}>
            Select all
          </button>
          <button type="button" className="chip" data-action="E2" onClick={() => { const s = selected.filter(w => allWeapons.includes(w)); if (s.length === 0) return; setWeapons([]); setLeaving(s); window.setTimeout(() => setLeaving([]), CASC_FADE_SECONDS * 1000); }}>
            Deselect all
          </button>
        </div>
      </div>
      <SettingControl settingKey="weapons">
        <div className="chips">
          {categories.map(([category, names]) => (
            <div key={category} className="wf-category">
              <span className="lab" title={tables.weaponCategoryTips[category]}>{category}</span>
              <div className="chips">
                {names.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    selected={selected.includes(name)}
                    onToggle={() => toggle(name)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </SettingControl>

      {/* The mock's `.casc`: the silhouette of each picked weapon. A weapon
          being deselected fades out (.casc-g out) instead of vanishing. */}
      {(() => {
        const leavingArt = leaving
          .filter((name) => !selected.includes(name))
          .map((name) => ({ name, art: silhouetteFor(name), leaving: true }))
          .filter((e): e is { name: string; art: string; leaving: boolean } => e.art != null);
        const rendered = [
          ...silhouettes.map((s) => ({ ...s, leaving: false })),
          ...leavingArt,
        ];
        if (rendered.length === 0) return null;
        return (
          <div className="casc" aria-hidden="true">
            {rendered.map((weapon) => (
              <div
                key={weapon.name}
                className={`gun casc-g ${weapon.leaving ? "casc-out" : "in"}`}
                data-weapon={weapon.name}
                style={{
                  width: `${silhouetteWidth(weapon.name)}px`,
                  ["--gun-art" as string]: `url(${weapon.art})`,
                }}
              />
            ))}
          </div>
        );
      })()}
    </div>
  );
}
