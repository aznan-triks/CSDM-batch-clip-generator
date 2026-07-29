/**
 * One kill-filter row: the label, then Enable / Must / Exclude.
 *
 * EVERY filter row goes through this component. The window learnt this the
 * hard way: a row built by hand in v207 (FERRARI PEEK) silently lost its
 * Exclude box, and clips went missing with no error anywhere. Extras -- a
 * threshold field, a sub-panel -- are passed as children and stack on the row.
 */
import type { ReactNode } from "react";

import Chip from "../components/Chip";
import SettingControl from "./SettingControl";
import type { FilterDef } from "./useTables";
import { useSetting } from "./store";
import "./FilterRow.css";

export default function FilterRow({ def, children }: { def: FilterDef; children?: ReactNode }) {
  const [enabled, setEnabled] = useSetting<boolean>(def.key);
  const [required, setRequired] = useSetting<boolean>(`${def.key}_req`);
  const [excluded, setExcluded] = useSetting<boolean>(`${def.key}_exclude`);

  // `_wire_enable_must`: a Must left armed under a disabled filter silently
  // skips clips nobody asked to skip.
  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    if (!next) setRequired(false);
  }

  return (
    <div className="filter-row" title={def.tip}>
      <span className="filter-row-label">{def.label}</span>
      <SettingControl settingKey={def.key}>
        <Chip label="Enable" selected={!!enabled} onToggle={toggleEnabled} />
      </SettingControl>
      <SettingControl settingKey={`${def.key}_req`}>
        <Chip
          label="★ Must"
          selected={!!required}
          onToggle={() => enabled && setRequired(!required)}
        />
      </SettingControl>
      <SettingControl settingKey={`${def.key}_exclude`}>
        <Chip label="Exclude" selected={!!excluded} onToggle={() => setExcluded(!excluded)} />
      </SettingControl>
      {children}
    </div>
  );
}
