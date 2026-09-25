/**
 * Demo Selection, style C: one calendar tile per ready-made range, the exact
 * dates under them, and a tile for picking demos by hand.
 */
import { IconTile } from "../../components/cardstyle/IconTile";
import { ClearAll, DateFrom, DateTo, Picker, Shortcuts } from "./parts";
import { DEMO_TIPS, type DemoSelectionModel } from "./useDemoSelection";

function HandIcon() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="6" width="22" height="7" rx="2" />
      <rect x="5" y="17" width="22" height="7" rx="2" />
      <rect x="5" y="28" width="22" height="7" rx="2" />
      <path d="M30 20l3 3 5-7" />
    </svg>
  );
}

export default function TilesView({ m }: { m: DemoSelectionModel }) {
  return (
    <div className="ds-c">
      <div className="ds-head">
        <span className="ds-kick">Quick ranges</span>
        <ClearAll m={m} />
      </div>
      <div className="ds-tiles">
        <Shortcuts m={m} look="tile" />
      </div>
      <div className="row ds-dates">
        <DateFrom m={m} />
        <DateTo m={m} />
      </div>
      <div className="ds-manual">
        <IconTile
          icon={<HandIcon />}
          title="Manual mode"
          subtitle={m.error ?? "Load ALL demos from the database and tick them by hand"}
          warn={!!m.error}
          code="ALL DEMOS"
          on={m.manualMode}
          tip={DEMO_TIPS.manual}
          onToggle={m.toggleManualMode}
        />
      </div>
      <Picker m={m} />
    </div>
  );
}
