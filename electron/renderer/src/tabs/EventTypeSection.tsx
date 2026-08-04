/**
 * The EVENT TYPE section -- the 2-axis capture model.
 *
 * Replaces the flat Kills / Deaths / Rounds block with two independent axes
 * (events-beyond-kill, Task 6):
 *
 *   Perspective  : Actor (I act) / Target (I am acted upon)
 *   Action type  : Lethal (kill & death) / Non-lethal (damage) / Other
 *   Team         : Ally / Enemy
 *
 * Every key here is the boolean `event_*` in DEFAULT_CONFIG, written through
 * the same `useSetting` bridge the rest of the tab uses -- never a local
 * state shadow of the config.
 *
 * Lethal is not a stored key: it is derived (`event_actor || event_target`),
 * which is exactly what `derive_event_flags_v2` does with `_events_lethal`.
 * It is shown as an always-on, dimmed chip rather than a checkbox, because
 * there is nothing to toggle off while a perspective is selected.
 */
import Chip from "../components/Chip";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import "./EventTypeSection.css";

/** Read a boolean setting, defaulting to the engine's own default. */
function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export default function EventTypeSection() {
  const [actor, setActor] = useSetting<boolean>("event_actor");
  const [target, setTarget] = useSetting<boolean>("event_target");
  const [ally, setAlly] = useSetting<boolean>("event_ally");
  const [enemy, setEnemy] = useSetting<boolean>("event_enemy");
  const [nonLethal, setNonLethal] = useSetting<boolean>("event_non_lethal");
  const [other, setOther] = useSetting<boolean>("event_other");

  const actorOn = asBool(actor, true);
  const targetOn = asBool(target, false);
  // Lethal is derived: any selected perspective implies a lethal clip set.
  const lethalOn = actorOn || targetOn;
  // "Other" (shots, jumps) only makes sense from the actor's own camera.
  const otherEnabled = actorOn;

  return (
    <div className="evt">
      <div className="row">
        <span className="lab">Perspective</span>
        <SettingControl settingKey="event_actor">
          <Chip label="Actor" selected={actorOn} onToggle={() => setActor(!actorOn)} />
        </SettingControl>
        <SettingControl settingKey="event_target">
          <Chip label="Target" selected={targetOn} onToggle={() => setTarget(!targetOn)} />
        </SettingControl>
      </div>

      <div className="row">
        <span className="lab">Action type</span>
        {/* Lethal has no stored key; it follows the perspective axis. */}
        <Chip label="Lethal" selected={lethalOn} disabled onToggle={() => {}} />
        <SettingControl settingKey="event_non_lethal">
          <Chip
            label="Non-lethal"
            selected={asBool(nonLethal, false)}
            onToggle={() => setNonLethal(!asBool(nonLethal, false))}
          />
        </SettingControl>
        <SettingControl settingKey="event_other">
          <Chip
            label="Other"
            selected={asBool(other, false)}
            onToggle={() => setOther(!asBool(other, false))}
            disabled={!otherEnabled}
          />
        </SettingControl>
      </div>

      <div className="row">
        <span className="lab">Team</span>
        <SettingControl settingKey="event_ally">
          <Chip label="Ally" selected={asBool(ally, false)} onToggle={() => setAlly(!asBool(ally, false))} />
        </SettingControl>
        <SettingControl settingKey="event_enemy">
          <Chip label="Enemy" selected={asBool(enemy, true)} onToggle={() => setEnemy(!asBool(enemy, true))} />
        </SettingControl>
      </div>
    </div>
  );
}
