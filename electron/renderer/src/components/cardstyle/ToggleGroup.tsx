/**
 * A multi-select segmented control: several independent on/off settings
 * sharing one tray (the V12 `.seg` tray, each option a check box).
 *
 * Unlike `Segmented` (one value out of N) every option here is its own config
 * key, so each one wears its own `SettingControl` for the coverage guard.
 */
import SettingControl from "../../settings/SettingControl";
import "./cardstyle.css";

export interface ToggleOption {
  settingKey: string;
  label: string;
  on: boolean;
  disabled?: boolean;
  tip?: string;
  onToggle: () => void;
}

export default function ToggleGroup({ label, options }: { label: string; options: ToggleOption[] }) {
  return (
    <div className="cs-mseg" role="group" aria-label={label}>
      {options.map((option) => (
        <SettingControl key={option.settingKey + option.label} settingKey={option.settingKey}>
          <button
            type="button"
            className={option.on ? "cs-mseg-opt on" : "cs-mseg-opt"}
            aria-pressed={option.on}
            aria-disabled={!!option.disabled}
            title={option.tip}
            onClick={() => {
              if (!option.disabled) option.onToggle();
            }}
          >
            {option.label}
          </button>
        </SettingControl>
      ))}
    </div>
  );
}
