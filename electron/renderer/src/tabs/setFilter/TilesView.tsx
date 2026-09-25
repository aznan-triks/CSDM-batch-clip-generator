/**
 * A set-filter card, "tiles" style: the master switch, then one tile per
 * option -- its picture, its name, one short line. Tiles stay drawn (greyed)
 * while the filter is off or the database has not answered.
 */
import { IconTile } from "../../components/cardstyle/IconTile";
import type { SetFilterModel } from "./model";
import { FilterSwitch, ListWrap, OptionWrap } from "./parts";

export default function SetFilterTiles({ m, switchLabel }: { m: SetFilterModel; switchLabel: string }) {
  return (
    <div className="sf-c">
      <div className="row">
        <FilterSwitch m={m} label={switchLabel} />
      </div>
      {m.pending}
      <ListWrap m={m}>
        <div className={m.locked ? "sf-c-grid locked" : "sf-c-grid"}>
          {m.options.map((o) => (
            <OptionWrap key={o.id} m={m} o={o}>
              <IconTile
                icon={o.badge}
                title={o.name}
                subtitle={o.detail}
                on={o.on}
                disabled={m.locked}
                tip={o.tip}
                onToggle={o.toggle}
              />
            </OptionWrap>
          ))}
        </div>
      </ListWrap>
    </div>
  );
}
