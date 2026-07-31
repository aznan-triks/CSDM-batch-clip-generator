/**
 * The MATCH TYPES section.
 *
 * Ported from the "MATCH TYPES" `Sec` in csdm_batch_clips_generator.py: one
 * box per `tables.matchTypes` entry (tâche 1/2's `describe_filters`, never a
 * hardcoded list -- D20/R1), gated by the section's own master switch,
 * `match_type_filter_enabled`.
 *
 * The master switch does not hide the boxes when off, and the boxes do not
 * hide themselves while `connect_db` has not answered yet: the engine only
 * SKIPS the match-type filter when the switch is off (core.py, `if not
 * cfg.get("match_type_filter_enabled")`) -- it never removes the choice --
 * so a hidden box would read as a filter that does not exist.
 */
import Chip from "../components/Chip";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import { useDatabase } from "../settings/useDatabase";
import { useTables } from "../settings/useTables";
import "./MatchTypesSection.css";

function MatchTypeChip({
  matchKey,
  label,
  disabled,
}: {
  matchKey: string;
  label: string;
  disabled: boolean;
}) {
  const [selected, setSelected] = useSetting<boolean>(matchKey);
  return (
    <SettingControl settingKey={matchKey}>
      <Chip
        label={label}
        selected={!!selected}
        onToggle={() => setSelected(!selected)}
        disabled={disabled}
      />
    </SettingControl>
  );
}

export default function MatchTypesSection() {
  const { tables } = useTables();
  const { database } = useDatabase();
  const [enabled, setEnabled] = useSetting<boolean>("match_type_filter_enabled");

  if (!tables) {
    return <p className="capture-hint">Loading match types…</p>;
  }

  const boxesDisabled = !database || !enabled;

  return (
    <div className="match-types">
      <div className="mt-heading-row">
        <SettingControl settingKey="match_type_filter_enabled">
          <Chip
            label="Filter by type"
            selected={!!enabled}
            onToggle={() => setEnabled(!enabled)}
          />
        </SettingControl>
      </div>
      <div className="mt-grid">
        {tables.matchTypes.map((matchType) => (
          <MatchTypeChip
            key={matchType.key}
            matchKey={matchType.key}
            label={matchType.label}
            disabled={boxesDisabled}
          />
        ))}
      </div>
    </div>
  );
}
