/**
 * Match Types, "timeline" style: the queue board. Every mode is a ticket --
 * its picture large, its name under it -- lit when it is kept; click a ticket
 * to keep or drop it. The switch above says whether the board applies at all.
 */
import type { SetFilterModel } from "../setFilter/model";
import { FilterSwitch, ListWrap, OptionWrap } from "../setFilter/parts";

export default function MatchTypesTimeline({ m }: { m: SetFilterModel }) {
  return (
    <div className="mt-a">
      <div className="mt-a-head">
        <FilterSwitch m={m} label="Filter by type" />
      </div>
      {m.pending}
      <ListWrap m={m}>
        <div className={m.locked ? "mt-board locked" : "mt-board"}>
          {m.options.map((o) => (
            <OptionWrap key={o.id} m={m} o={o}>
              <button
                type="button"
                className={o.on ? "mt-ticket on" : "mt-ticket"}
                aria-pressed={o.on}
                aria-disabled={m.locked}
                aria-label={o.name}
                title={o.tip}
                onClick={() => {
                  if (!m.locked) o.toggle();
                }}
              >
                {o.badge}
                <span className="mt-ticket-n">{o.name}</span>
              </button>
            </OptionWrap>
          ))}
        </div>
      </ListWrap>
    </div>
  );
}
