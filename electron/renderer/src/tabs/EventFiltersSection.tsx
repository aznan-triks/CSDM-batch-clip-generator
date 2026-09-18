/**
 * The DAMAGE FILTERS and SHOT FILTERS cards (C5bis).
 *
 * Kill Filters only ever judged kills; these two cards hold the filters that
 * judge non-lethal damage and shots / knife swings. Nothing here names a
 * filter: `tables.filters` decides which rows exist (`category: "event"`),
 * which card they belong to (`applies_to`) and which numeric settings they
 * carry (`extras`). Every row is a `FilterRow`, like Kill Filters (D20 / R1).
 */
import Field from "../components/Field";
import FilterRow from "../settings/FilterRow";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import { appliesTo } from "../settings/appliesTo";
import { useTables } from "../settings/useTables";
import type { FilterExtra } from "../settings/useTables";
import "../components/reflowColumns.css";
import "./KillFiltersSection.css";

/** What each card says the engine needs before it has anything to judge. */
const EMPTY_HINT: Record<"damage" | "shot", string> = {
  damage: "Judges non-lethal damage — tick Non-lethal in Event Type.",
  shot: "Judges shots and knife swings — tick Other in Event Type.",
};

/** One numeric setting, labelled from the registry. */
function RegistryExtra({ extra }: { extra: FilterExtra }) {
  const [value, setValue] = useSetting<string>(extra.key);
  const shown = value === undefined || value === null || value === "" ? extra.default : value;
  return (
    <div className="kf-extra">
      <span className="lab">{extra.label}</span>
      <SettingControl settingKey={extra.key}>
        <Field
          id={extra.key.replace(/_/g, "-")}
          value={shown === undefined || shown === null ? "" : String(shown)}
          onChange={setValue}
          mono
          tip={`${extra.label} (default ${String(extra.default)})`}
        />
      </SettingControl>
      {extra.unit && <span className="kf-suffix">{extra.unit}</span>}
    </div>
  );
}

export default function EventFiltersSection({ category }: { category: "damage" | "shot" }) {
  const { tables } = useTables();

  if (!tables) {
    return <p className="capture-hint">Loading filters…</p>;
  }

  const defs = tables.filters.filter(
    (f) => f.category === "event" && !f.hidden && appliesTo(f).includes(category),
  );

  return (
    <div className="kill-filters">
      <p className="capture-hint">{EMPTY_HINT[category]}</p>
      <div className="kf-group reflow-columns">
        {defs.map((def) => (
          <FilterRow key={def.key} def={def}>
            {(def.extras ?? []).map((extra) => (
              <RegistryExtra key={extra.key} extra={extra} />
            ))}
          </FilterRow>
        ))}
      </div>
    </div>
  );
}
