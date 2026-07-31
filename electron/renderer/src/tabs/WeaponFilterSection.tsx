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
import Chip from "../components/Chip";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import { useDatabase } from "../settings/useDatabase";
import { useTables } from "../settings/useTables";
import "./WeaponFilterSection.css";

export default function WeaponFilterSection() {
  const { tables } = useTables();
  const { database } = useDatabase();
  const [weapons, setWeapons] = useSetting<string[]>("weapons");

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

  function toggle(name: string) {
    setWeapons(
      selected.includes(name) ? selected.filter((w) => w !== name) : [...selected, name],
    );
  }

  return (
    <div className="weapon-filter">
      <div className="wf-heading-row">
        <span className="wf-section-heading">empty = all</span>
        <div className="wf-buttons">
          <button type="button" className="wf-btn" onClick={() => setWeapons([...allWeapons])}>
            Select all
          </button>
          <button type="button" className="wf-btn" onClick={() => setWeapons([])}>
            Deselect all
          </button>
        </div>
      </div>
      <SettingControl settingKey="weapons">
        <div className="weapon-grid">
          {categories.map(([category, names]) => (
            <div key={category} className="wf-category">
              <span className="wf-mini-label">{category}</span>
              <div className="wf-chips">
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
    </div>
  );
}
