/**
 * The controls of a filter's extras (a threshold box, a count picker, a
 * sub-option), drawn the same way in every card style. Each wears its own
 * `SettingControl`, so the coverage guard sees the key wherever it is shown.
 */
import Chip from "../Chip";
import Field from "../Field";
import Segmented from "../Segmented";
import SettingControl from "../../settings/SettingControl";
import type { FilterExtraModel } from "./filterRows";
import "./filterstyle.css";

export function FilterExtraControl({ extra }: { extra: FilterExtraModel }) {
  if (extra.kind === "toggle") {
    return (
      <SettingControl settingKey={extra.key}>
        <Chip label={extra.label} tip={extra.tip} selected={extra.on} onToggle={extra.toggle} />
      </SettingControl>
    );
  }
  return (
    <span className="cf-extra">
      {extra.label && <span className="lab">{extra.label}</span>}
      <SettingControl settingKey={extra.key}>
        {extra.kind === "choice" ? (
          <Segmented options={extra.options} value={extra.value} onChange={extra.set} label={extra.label} tip={extra.tip} />
        ) : (
          <Field id={extra.key.replace(/_/g, "-")} value={extra.value} onChange={extra.set} mono tip={extra.tip} />
        )}
      </SettingControl>
      {extra.unit && <span className="cf-unit">{extra.unit}</span>}
    </span>
  );
}

export function FilterExtras({ extras }: { extras: readonly FilterExtraModel[] }) {
  if (!extras.length) return null;
  return (
    <div className="cf-extras">
      {extras.map((extra) => (
        <FilterExtraControl key={extra.key} extra={extra} />
      ))}
    </div>
  );
}

/** "UNTESTED" named on the filter, the detail in its tooltip. */
export function UntestedMark({ detail }: { detail: string }) {
  if (!detail) return null;
  return (
    <span className="cf-untested" title={detail}>
      UNTESTED
    </span>
  );
}

/** A filter's tooltip, with what is not yet checked in game after it. */
export function filterTip(tip: string, untested: string): string {
  return untested ? `${tip}\nUNTESTED: ${untested}` : tip;
}
