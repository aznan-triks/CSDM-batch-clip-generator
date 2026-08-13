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
import Chip from "../components/Chip";
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
  {
    key: "phys_ragdoll_gravity",
    label: "cl_ragdoll_gravity",
    fallback: "600",
    tip: "CS2 console command cl_ragdoll_gravity: gravity applied to ragdolls after death",
  },
  {
    key: "phys_ragdoll_scale",
    label: "ragdoll_gravity_scale",
    fallback: "1.0",
    tip: "Multiplier on ragdoll gravity: 1.0 = normal, 0 = weightless, negative = floats upward",
  },
  {
    key: "phys_sv_gravity",
    label: "sv_gravity",
    fallback: "800",
    tip: "Server-wide gravity affecting all physics: players, ragdolls, dropped weapons (default 800)",
  },
] as const;

/** The three toggles, in the window's own order. */
const TOGGLE_FIELDS: { key: string; label: string; tip?: string }[] = [
  {
    key: "phys_ragdoll_enable",
    label: "Ragdoll physics",
    tip: "Enables ragdoll death physics; required for the gravity/scale values above to have any effect",
  },
  { key: "phys_blood", label: "Blood on walls" },
  { key: "phys_dynamic_lighting", label: "Dynamic lighting" },
];

function NumericField({
  settingKey,
  label,
  fallback,
  tip,
}: {
  settingKey: string;
  label: string;
  fallback: string;
  tip?: string;
}) {
  const [value, setValue] = useSetting<string | number>(settingKey);
  const stringValue = value === undefined || value === null ? fallback : String(value);
  return (
    <SettingControl settingKey={settingKey}>
      <div className="fld">
        <Field id={`cs2-${settingKey}`} label={label} mono value={stringValue} onChange={setValue} tip={tip} />
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

function ToggleField({ settingKey, label, tip }: { settingKey: string; label: string; tip?: string }) {
  const [value, setValue] = useSetting<boolean>(settingKey);
  return (
    <SettingControl settingKey={settingKey}>
      <Chip label={label} tip={tip} selected={!!value} onToggle={() => setValue(!value)} />
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
              tip={field.tip}
            />
          ))}
        </div>
        <div className="cs2-col">
          {TOGGLE_FIELDS.map((field) => (
            <ToggleField key={field.key} settingKey={field.key} label={field.label} tip={field.tip} />
          ))}
        </div>
      </div>
    </div>
  );
}
