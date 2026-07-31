/**
 * The CS2 EFFECTS section -- physics and visuals shared by both recording
 * modes.
 *
 * Ported from the `self._cs2_sec` block in `_tab_video`
 * (csdm_batch_clips_generator.py). Mounted unconditionally by `VideoTab`:
 * the window's own heading reads "both HLAE and CS modes", so this section
 * never hides, unlike `HlaeOptionsSection`.
 */
import Field from "../components/Field";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import "./Cs2EffectsSection.css";

/**
 * The quick-value buttons, copied from the window's own rows.
 *
 * Not motion numbers and not configuration: they are the shortcuts the window
 * offered beside each field, and the field stays free-form.
 */
const QUICK_VALUES: Record<string, readonly string[]> = {
  phys_ragdoll_gravity: ["600", "200", "0", "-200", "-500", "2000", "5000"],
  phys_ragdoll_scale: ["1.0", "0.5", "0.1", "0.0", "2.0", "3.0"],
  phys_sv_gravity: ["800", "400", "200", "100", "1200", "2000"],
};

/** The three free-form numeric fields, in the window's own order. */
const NUMERIC_FIELDS = [
  { key: "phys_ragdoll_gravity", label: "cl_ragdoll_gravity", fallback: "600" },
  { key: "phys_ragdoll_scale", label: "ragdoll_gravity_scale", fallback: "1.0" },
  { key: "phys_sv_gravity", label: "sv_gravity", fallback: "800" },
] as const;

/** The three toggles, in the window's own order. */
const TOGGLE_FIELDS = [
  { key: "phys_ragdoll_enable", label: "Ragdoll physics" },
  { key: "phys_blood", label: "Blood on walls" },
  { key: "phys_dynamic_lighting", label: "Dynamic lighting" },
] as const;

function NumericField({
  settingKey,
  label,
  fallback,
}: {
  settingKey: string;
  label: string;
  fallback: string;
}) {
  const [value, setValue] = useSetting<string | number>(settingKey);
  const stringValue = value === undefined || value === null ? fallback : String(value);
  return (
    <SettingControl settingKey={settingKey}>
      <div className="fld">
        <Field id={`cs2-${settingKey}`} label={label} mono value={stringValue} onChange={setValue} />
        <div className="row">
          {QUICK_VALUES[settingKey].map((quick) => (
            <button
              key={quick}
              type="button"
              className="chip"
              onClick={() => setValue(quick)}
            >
              {quick}
            </button>
          ))}
        </div>
      </div>
    </SettingControl>
  );
}

function ToggleField({ settingKey, label }: { settingKey: string; label: string }) {
  const [value, setValue] = useSetting<boolean>(settingKey);
  return (
    <SettingControl settingKey={settingKey}>
      <label className="cs2-toggle">
        <input type="checkbox" checked={!!value} onChange={() => setValue(!value)} />
        <span>{label}</span>
      </label>
    </SettingControl>
  );
}

export default function Cs2EffectsSection() {
  return (
    <div className="cs2-effects">
      <span className="lab">CS2 effects -- both HLAE and CS modes</span>
      <p className="cs2-hint">
        Vanilla CS2 commands shared by both recording modes. Non-default values are injected as
        CS2 console commands on startup.
      </p>
      <div className="row">
        <div className="cs2-col">
          {NUMERIC_FIELDS.map((field) => (
            <NumericField
              key={field.key}
              settingKey={field.key}
              label={field.label}
              fallback={field.fallback}
            />
          ))}
        </div>
        <div className="cs2-col">
          {TOGGLE_FIELDS.map((field) => (
            <ToggleField key={field.key} settingKey={field.key} label={field.label} />
          ))}
        </div>
      </div>
    </div>
  );
}
