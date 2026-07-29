/**
 * The MAP FILTER section.
 *
 * Ported from the window's own "MAP FILTER (empty = all maps)". `map_filter`
 * is ONE list config key holding display keys -- the stripped-prefix,
 * lowercased map name `connect_db`'s `maps` field carries as the first
 * element of each `[displayKey, rawValues[]]` pair (`csdm/engine/core.py`,
 * `discover_database`) -- never one boolean per map, so a single
 * `SettingControl` wraps the whole list, the same rule `weapons` follows in
 * `WeaponFilterSection`.
 *
 * `map_filter_enabled` is the section's own master switch: the engine only
 * SKIPS the map filter when it is off (core.py, `if cfg.get("map_filter_enabled")
 * and self._map_col`) -- it never removes the choice -- so the list stays on
 * screen, greyed, rather than disappearing.
 */
import Chip from "../components/Chip";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import { useDatabase } from "../settings/useDatabase";
import "./MapFilterSection.css";

export default function MapFilterSection() {
  const { database } = useDatabase();
  const [enabled, setEnabled] = useSetting<boolean>("map_filter_enabled");
  const [mapFilter, setMapFilter] = useSetting<string[]>("map_filter");

  const selected = Array.isArray(mapFilter) ? mapFilter : [];

  function toggle(display: string) {
    setMapFilter(
      selected.includes(display) ? selected.filter((m) => m !== display) : [...selected, display],
    );
  }

  return (
    <div className="map-filter">
      <div className="mf-heading-row">
        <span className="mf-section-heading">Map filter (empty = all maps)</span>
        <SettingControl settingKey="map_filter_enabled">
          <Chip label="Filter by map" selected={!!enabled} onToggle={() => setEnabled(!enabled)} />
        </SettingControl>
      </div>
      {!database ? (
        <p className="capture-hint">Waiting for DB…</p>
      ) : (
        <SettingControl settingKey="map_filter">
          <div className="map-grid">
            {database.maps.map(([display]) => (
              <Chip
                key={display}
                label={display}
                selected={selected.includes(display)}
                onToggle={() => toggle(display)}
                disabled={!enabled}
              />
            ))}
          </div>
        </SettingControl>
      )}
    </div>
  );
}
