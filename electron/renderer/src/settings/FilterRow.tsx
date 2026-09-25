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
import { useAlwaysTooltips } from "./useAlwaysTooltips";
import "./FilterRow.css";

export default function FilterRow({
  def,
  hasExclude = true,
  children,
}: {
  def: FilterDef;
  /**
   * Whether `${def.key}_exclude` is a real DEFAULT_CONFIG key.
   *
   * False only when the key simply does not exist (`kill_mod_trois_tap`, see
   * `_NO_AUTO_EXCLUDE` in csdm/static_data.py). Only the caller iterating the
   * registry against DEFAULT_CONFIG knows which keys those are, so it is
   * passed in rather than guessed here.
   */
  hasExclude?: boolean;
  children?: ReactNode;
}) {
  const [enabled, setEnabled] = useSetting<boolean>(def.key);
  const [required, setRequired] = useSetting<boolean>(`${def.key}_req`);
  const [excluded, setExcluded] = useSetting<boolean>(`${def.key}_exclude`);
  const alwaysShow = useAlwaysTooltips();

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
      <span className="filter-row-label">
        {def.label}
        {def.untested && (
          <span className="filter-row-untested" title={def.untested}>
            {" "}UNTESTED
          </span>
        )}
      </span>
      <SettingControl settingKey={def.key}>
        {/* Marker only, same "display: contents" rule SettingControl itself
            uses: Chip does not forward a data-action, and every filter row's
            Enable chip is the same registry action (G1), not one per row. */}
        <div data-action="G1" style={{ display: "contents" }}>
          <Chip
            label="Enable"
            tip={def.tip || `Enable ${def.label} filter`}
            selected={!!enabled}
            onToggle={toggleEnabled}
          />
        </div>
      </SettingControl>
      <SettingControl settingKey={`${def.key}_req`}>
        <Chip
          label="★ Must"
          tip={`Require ${def.label}: every captured clip must match this filter`}
          selected={!!required}
          onToggle={toggleRequired}
        />
      </SettingControl>
      {hasExclude && (
        <SettingControl settingKey={`${def.key}_exclude`}>
          <div data-action="G2" style={{ display: "contents" }}>
            <Chip
              label="Exclude"
              tip={`Exclude ${def.label}: remove clips matching this filter from results`}
              selected={!!excluded}
              onToggle={() => setExcluded(!excluded)}
            />
          </div>
        </SettingControl>
      )}
      {children}
      {alwaysShow && def.tip && (
        <div className="persistent-tip filter-row-tip">
          {def.untested ? `${def.tip}\nUNTESTED: ${def.untested}` : def.tip}
        </div>
      )}
    </div>
  );
}
