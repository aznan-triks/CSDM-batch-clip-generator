/**
 * Pieces the filter cards draw the same way in several styles: a labelled
 * one-of-N choice and the Clear button. One place each, so styles cannot
 * drift on them.
 */
import Segmented from "../../components/Segmented";
import SettingControl from "../../settings/SettingControl";
import type { ChoiceSetting } from "./useKillFilters";

export function ChoiceControl({ choice, showLabel = true }: { choice: ChoiceSetting; showLabel?: boolean }) {
  return (
    <SettingControl settingKey={choice.key}>
      <div className="kf-top-group">
        {showLabel && <span className="lab">{choice.label}</span>}
        <Segmented
          options={choice.options}
          value={choice.value}
          onChange={choice.set}
          label={choice.label}
          disabled={choice.disabled}
          tip={choice.tip}
        />
      </div>
    </SettingControl>
  );
}

export function ClearButton({ clear, label = "Clear" }: { clear: { tip: string; run: () => void }; label?: string }) {
  return (
    <button type="button" className="chip push-right" title={clear.tip} data-action="G3" onClick={clear.run}>
      {label}
    </button>
  );
}

/** "Loading filters…" while `describe_filters` has not answered. */
export function FiltersLoading() {
  return <p className="capture-hint">Loading filters…</p>;
}
