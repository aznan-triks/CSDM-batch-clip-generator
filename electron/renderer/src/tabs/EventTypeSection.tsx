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
 * Lethal is now a proper config toggle (event_lethal, default True).
 * It requires a selected perspective; unchecking it disables kill/death clips
 * while keeping damage/shots active.
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
  const [lethal, setLethal] = useSetting<boolean>("event_lethal");
  const [ally, setAlly] = useSetting<boolean>("event_ally");
  const [enemy, setEnemy] = useSetting<boolean>("event_enemy");
  const [nonLethal, setNonLethal] = useSetting<boolean>("event_non_lethal");
  const [other, setOther] = useSetting<boolean>("event_other");

  const actorOn = asBool(actor, true);
  const targetOn = asBool(target, false);
  // Lethal requires at least one perspective to make sense.
  const lethalEnabled = actorOn || targetOn;
  // "Other" (shots, jumps) only makes sense from the actor's own camera.
  const otherEnabled = actorOn;

  return (
    <div className="evt">
      <div className="row">
        <span className="lab">Perspective</span>
        <SettingControl settingKey="event_actor">
          <Chip
            label="Actor"
            tip="Capture events where the selected player performs the action (e.g. the kill)"
            selected={actorOn}
            onToggle={() => setActor(!actorOn)}
          />
        </SettingControl>
        <SettingControl settingKey="event_target">
          <Chip
            label="Target"
            tip="Capture events where the selected player is on the receiving end (e.g. gets killed)"
            selected={targetOn}
            onToggle={() => setTarget(!targetOn)}
          />
        </SettingControl>
      </div>

      <div className="row">
        <span className="lab">Action type</span>
        <SettingControl settingKey="event_lethal">
          <Chip
            label="Lethal"
            tip="Include kill and death moments. Requires Actor or Target to be selected"
            selected={asBool(lethal, true)}
            onToggle={() => setLethal(!asBool(lethal, true))}
            disabled={!lethalEnabled}
          />
        </SettingControl>
        <SettingControl settingKey="event_non_lethal">
          <Chip
            label="Non-lethal"
            tip="Include damage-dealt or damage-taken moments, without a kill"
            selected={asBool(nonLethal, false)}
            onToggle={() => setNonLethal(!asBool(nonLethal, false))}
          />
        </SettingControl>
        <SettingControl settingKey="event_other">
          <Chip
            label="Other"
            tip="Include other actions like shots fired or jumps. Actor perspective only"
            selected={asBool(other, false)}
            onToggle={() => setOther(!asBool(other, false))}
            disabled={!otherEnabled}
          />
        </SettingControl>
      </div>

      <div className="row">
        <span className="lab">Team</span>
        <SettingControl settingKey="event_ally">
          <Chip
            label="Ally"
            tip="Include events where the other player involved is a teammate"
            selected={asBool(ally, false)}
            onToggle={() => setAlly(!asBool(ally, false))}
          />
        </SettingControl>
        <SettingControl settingKey="event_enemy">
          <Chip
            label="Enemy"
            tip="Include events where the other player involved is an opponent"
            selected={asBool(enemy, true)}
            onToggle={() => setEnemy(!asBool(enemy, true))}
          />
        </SettingControl>
      </div>
    </div>
  );
}
