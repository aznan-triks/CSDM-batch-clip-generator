/**
 * The Capture & Timing card's ONE data model.
 *
 * Every card style (timeline, sentence, tiles) draws this model and nothing
 * else: the keys it reads, the rules between them and the tooltips live here
 * once. A view only decides where a control sits and what word it wears, so a
 * style can never write a different key, forget a rule or drift a tooltip.
 *
 * The rules are the window's own:
 *   - Lethal needs a role (Actor or Target) to mean anything;
 *   - Other (shots, swings) exists only from the actor's own camera;
 *   - the switch delay exists only in `both`, Mate POV only in `victim`/`both`;
 *   - Mate POV's Must follows its Enable (`_wire_enable_must`).
 */
import { asNumber } from "../../settings/asNumber";
import { useSetting, useSettingsBatch } from "../../settings/store";
import {
  CLIP_RANGES,
  clipWindow,
  clipWindowSummary,
  moveClipHandle,
  type ClipHandle,
  type ClipWindow,
  type ClipWindowInput,
} from "../clipWindow";

/** Perspective values, exactly as the engine reads them. */
export const PERSPECTIVES = ["killer", "victim", "both"] as const;
export type Perspective = (typeof PERSPECTIVES)[number];

/** One on/off setting, with the rule that may lock it. */
export interface ToggleSetting {
  key: string;
  on: boolean;
  disabled: boolean;
  tip: string;
  toggle: () => void;
}

/** One whole-number setting and its range. */
export interface NumberSetting {
  key: string;
  value: number;
  min: number;
  max: number;
  tip: string;
  set: (value: number) => void;
}

export interface CaptureTimingModel {
  actor: ToggleSetting;
  target: ToggleSetting;
  lethal: ToggleSetting;
  nonLethal: ToggleSetting;
  other: ToggleSetting;
  ally: ToggleSetting;
  enemy: ToggleSetting;
  rounds: ToggleSetting;
  perspective: { key: string; value: Perspective; tip: string; set: (value: Perspective) => void };
  /** Present only where the window shows it (`victim` and `both`). */
  matePov: ToggleSetting | null;
  matePovReq: ToggleSetting | null;
  feedName: { key: string; value: string; tip: string; set: (value: string) => void };
  before: NumberSetting;
  after: NumberSetting;
  /** Present only in `both`: the only camera that switches. */
  victimView: NumberSetting | null;
  clip: ClipWindow;
  /** The clip in one sentence, from the values above. */
  summary: string;
  /** Drag a drawn clip's handle to second `at`; writes every key it moves at once. */
  moveHandle: (handle: ClipHandle, at: number) => void;
}

/** The tooltips, shared by every style. */
export const TIPS = {
  actor: "Capture events where the selected player performs the action (e.g. the kill)",
  target: "Capture events where the selected player is on the receiving end (e.g. gets killed)",
  lethal: "Include kill and death moments. Requires Actor or Target to be selected",
  nonLethal: "Include damage-dealt or damage-taken moments, without a kill",
  other: "Include shots fired and knife swings, without a hit. Actor perspective only",
  ally: "Include events where the other player involved is a teammate",
  enemy: "Include events where the other player involved is an opponent",
  rounds: "Also capture full-round clips, separate from the kill/death event filters",
  perspective:
    "Whose eyes the clip is filmed through: the killer, the victim, or the killer then the victim (both)",
  matePov: "Film the victim's side from the teammate with the best view of the kill, instead of the victim",
  matePovReq: "Skip the clip when no teammate has a clear view of the kill",
  feedName: "Name shown for your player in the clips' kill feed. Empty = the name stored in the demo",
  before:
    "Seconds of footage recorded before each event. Also sets how close two events must be to share one clip",
  after: "Seconds of footage recorded after each event",
  victimView:
    "Both: the camera follows the killer, then switches to the victim this many seconds before the kill. These seconds are added to the seconds before",
} as const;

/** Read a boolean setting, defaulting to the engine's own default. */
function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** A plain boolean key, read and flipped through the store. */
function useToggle(key: string, fallback: boolean, tip: string, disabled = false): ToggleSetting {
  const [raw, set] = useSetting<boolean>(key);
  const on = asBool(raw, fallback);
  return { key, on, disabled, tip, toggle: () => set(!on) };
}

export function useCaptureTiming(): CaptureTimingModel {
  const batch = useSettingsBatch();
  const actor = useToggle("event_actor", true, TIPS.actor);
  const target = useToggle("event_target", false, TIPS.target);
  const lethal = useToggle("event_lethal", true, TIPS.lethal, !(actor.on || target.on));
  const nonLethal = useToggle("event_non_lethal", false, TIPS.nonLethal);
  const other = useToggle("event_other", false, TIPS.other, !actor.on);
  const ally = useToggle("event_ally", false, TIPS.ally);
  const enemy = useToggle("event_enemy", true, TIPS.enemy);

  // Full rounds still lives in the legacy `events` list the engine reads.
  const [events, setEvents] = useSetting<string[]>("events");
  const eventList = Array.isArray(events) ? events : [];
  const roundsOn = eventList.includes("Rounds");

  const [perspectiveRaw, setPerspective] = useSetting<string>("perspective");
  const perspective: Perspective = (PERSPECTIVES as readonly string[]).includes(perspectiveRaw ?? "")
    ? (perspectiveRaw as Perspective)
    : PERSPECTIVES[0];

  const [matePovRaw] = useSetting<boolean>("kill_mod_mate_pov");
  const [matePovReqRaw] = useSetting<boolean>("kill_mod_mate_pov_req");
  const matePovOn = !!matePovRaw;
  const matePovReqOn = !!matePovReqRaw;
  const [nameOverride, setNameOverride] = useSetting<string>("player_name_override");

  const [beforeRaw, setBefore] = useSetting<number>("before");
  const [afterRaw, setAfter] = useSetting<number>("after");
  const [victimPreRaw, setVictimPre] = useSetting<number>("victim_pre_s");
  const clipInput: ClipWindowInput = {
    before: asNumber(beforeRaw, CLIP_RANGES.before.min),
    after: asNumber(afterRaw, CLIP_RANGES.after.min),
    perspective,
    switchDelay: asNumber(victimPreRaw, CLIP_RANGES.switchDelay.min),
    matePov: matePovOn,
  };

  const hasMate = perspective === "victim" || perspective === "both";

  return {
    actor,
    target,
    lethal,
    nonLethal,
    other,
    ally,
    enemy,
    rounds: {
      key: "events",
      on: roundsOn,
      disabled: false,
      tip: TIPS.rounds,
      toggle: () => setEvents(roundsOn ? eventList.filter((e) => e !== "Rounds") : [...eventList, "Rounds"]),
    },
    perspective: { key: "perspective", value: perspective, tip: TIPS.perspective, set: setPerspective },
    // The window switches Must off with Enable, never the other way round: a
    // Must left armed under a disabled filter silently drops clips. Arming
    // Must switches Enable on by itself.
    matePov: hasMate
      ? {
          key: "kill_mod_mate_pov",
          on: matePovOn,
          disabled: false,
          tip: TIPS.matePov,
          toggle: () =>
            batch(matePovOn ? { kill_mod_mate_pov: false, kill_mod_mate_pov_req: false } : { kill_mod_mate_pov: true }),
        }
      : null,
    matePovReq: hasMate
      ? {
          key: "kill_mod_mate_pov_req",
          on: matePovReqOn,
          disabled: false,
          tip: TIPS.matePovReq,
          toggle: () =>
            batch(matePovReqOn ? { kill_mod_mate_pov_req: false } : { kill_mod_mate_pov_req: true, kill_mod_mate_pov: true }),
        }
      : null,
    feedName: { key: "player_name_override", value: nameOverride ?? "", tip: TIPS.feedName, set: setNameOverride },
    before: { key: "before", value: clipInput.before, ...CLIP_RANGES.before, tip: TIPS.before, set: setBefore },
    after: { key: "after", value: clipInput.after, ...CLIP_RANGES.after, tip: TIPS.after, set: setAfter },
    victimView:
      perspective === "both"
        ? {
            key: "victim_pre_s",
            value: clipInput.switchDelay,
            ...CLIP_RANGES.switchDelay,
            tip: TIPS.victimView,
            set: setVictimPre,
          }
        : null,
    clip: clipWindow(clipInput),
    summary: clipWindowSummary(clipInput),
    moveHandle: (handle, at) => {
      const next = moveClipHandle(handle, at, clipInput);
      const changes: Record<string, number> = {};
      if (next.before !== clipInput.before) changes.before = next.before;
      if (next.after !== clipInput.after) changes.after = next.after;
      if (next.switchDelay !== clipInput.switchDelay) changes.victim_pre_s = next.switchDelay;
      if (Object.keys(changes).length) batch(changes);
    },
  };
}
