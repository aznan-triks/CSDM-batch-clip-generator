/**
 * Demo Selection, style A: the range is the control. Drag either end of the
 * band on the calendar strip; the shortcuts and the typed dates move it too.
 */
import RangeStrip from "./RangeStrip";
import { ClearAll, DateFrom, DateTo, ManualMode, Picker, Shortcuts } from "./parts";
import { DEMO_TIPS, type DemoSelectionModel } from "./useDemoSelection";

export default function TimelineView({ m }: { m: DemoSelectionModel }) {
  return (
    <div className="ds-a">
      <div className="ds-head">
        <span className="ds-kick">Played between · drag the ends</span>
        <ClearAll m={m} />
      </div>
      <RangeStrip from={m.from} to={m.to} demos={m.demos} onChange={m.setRange} tips={DEMO_TIPS} />
      <div className="row ds-quick">
        <Shortcuts m={m} />
      </div>
      <div className="row ds-dates">
        <DateFrom m={m} />
        <DateTo m={m} />
      </div>
      <div className="row">
        <span className="lab">Demo selection:</span>
        <ManualMode m={m} />
      </div>
      <Picker m={m} />
    </div>
  );
}
