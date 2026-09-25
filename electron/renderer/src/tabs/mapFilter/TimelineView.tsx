/**
 * Map Filter, "timeline" style: the map veto board. Every map in the database
 * is a card of the pool; click it to pick it (lit, PICK) or send it back to
 * the pool. The switch above says whether the veto applies at all.
 */
import type { SetFilterModel } from "../setFilter/model";
import { FilterSwitch, ListWrap, OptionWrap } from "../setFilter/parts";

export default function MapFilterTimeline({ m }: { m: SetFilterModel }) {
  return (
    <div className="mf-a">
      <div className="mt-a-head">
        <FilterSwitch m={m} label="Filter by map" />
      </div>
      {m.pending}
      <ListWrap m={m}>
        <div className={m.locked ? "mf-pool locked" : "mf-pool"}>
          {m.options.map((o) => (
            <OptionWrap key={o.id} m={m} o={o}>
              <button
                type="button"
                className={o.on ? "mf-map on" : "mf-map"}
                aria-pressed={o.on}
                aria-disabled={m.locked}
                aria-label={o.name}
                title={o.tip}
                onClick={() => {
                  if (!m.locked) o.toggle();
                }}
              >
                {o.badge}
                <span className="mf-map-n">{o.name}</span>
                <span className="mf-map-s">{o.on ? "PICK" : "pool"}</span>
              </button>
            </OptionWrap>
          ))}
        </div>
      </ListWrap>
    </div>
  );
}
