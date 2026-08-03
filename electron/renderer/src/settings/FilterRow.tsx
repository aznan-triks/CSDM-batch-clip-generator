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

export default function FilterRow({
  def,
  hasExclude = true,
  children,
}: {
  def: FilterDef;
  /**
   * Whether `${def.key}_exclude` is a real DEFAULT_CONFIG key with a box the
   * Tkinter window actually built.
   *
   * Two different reasons can make this false, and both must omit the box the
   * same way: the key can simply not exist (`kill_mod_trois_tap`), or it can
   * exist but be listed in `coverage-ledger.ts`'s `NO_CONTROL_BY_DESIGN`
   * (`kill_mod_high_velocity_exclude` -- FERRARI PEEK builds no Exclude box).
   * Only the caller iterating the registry against DEFAULT_CONFIG knows which
   * case applies, so it is passed in rather than guessed here.
   */
  hasExclude?: boolean;
  children?: ReactNode;
}) {
  const [enabled, setEnabled] = useSetting<boolean>(def.key);
  const [required, setRequired] = useSetting<boolean>(`${def.key}_req`);
  const [excluded, setExcluded] = useSetting<boolean>(`${def.key}_exclude`);

  // `_wire_enable_must` (mirror of the Tkinter window): arming ★ Must
  // auto-enables the filter (Enable is not a prerequisite), and switching
  // Enable off drops Must — a Must left armed under a disabled filter
  // silently skips clips nobody asked to skip.
  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    if (!next) setRequired(false);
  }

  function toggleRequired() {
    const next = !required;
    setRequired(next);
    if (next && !enabled) setEnabled(true);
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
          onToggle={toggleRequired}
        />
      </SettingControl>
      {hasExclude && (
        <SettingControl settingKey={`${def.key}_exclude`}>
          <Chip label="Exclude" selected={!!excluded} onToggle={() => setExcluded(!excluded)} />
        </SettingControl>
      )}
      {children}
    </div>
  );
}
