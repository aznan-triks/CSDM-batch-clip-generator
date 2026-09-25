/**
 * The Kill Filters card's ONE data model.
 *
 * Ported from the "KILL FILTERS" `Sec` of the Tkinter window: the Suicides /
 * Headshots choices, the three registry-driven groups (Mods, demoparser2
 * modifiers, Situation/DB), Clear, and the CLUTCH block. Every style draws
 * this and nothing else.
 *
 * `tables.filters` -- never a hardcoded list -- decides which rows exist, in
 * what order, and which card they land in (`applies_to`): a filter that
 * judges kills is here, damage / shot filters have their own cards (D20 / R1).
 */
import {
  asText,
  buildFilterRows,
  type FilterExtraModel,
  type FilterRowModel,
  type FilterToggle,
} from "../../components/cardstyle/filterRows";
import { appliesTo } from "../../settings/appliesTo";
import { useAllSettings, useSettingsBatch } from "../../settings/store";
import { useTables, type EventCategory, type FilterDef } from "../../settings/useTables";

/** Suicides: the window's own three-way choice. */
export const SUICIDE_MODES = ["include", "exclude", "only"] as const;

/**
 * Headshots: a DIFFERENT three-way choice. `cfg.get("headshots_mode", "all")`
 * is what the engine reads -- "all" / "only" / "exclude", never "include".
 */
export const HEADSHOT_MODES = ["all", "only", "exclude"] as const;

/** The window's own order for the 1v1 .. 1v5 size chips. */
const CLUTCH_SIZES = [1, 2, 3, 4, 5] as const;

/** `clutch_mode`'s two real values: "kills_only" / "full_clutch". */
export const CLUTCH_MODES = ["kills_only", "full_clutch"] as const;

/** Widget bounds for the two "N kills" pickers, not motion. */
const KILL_COUNT_OPTIONS = ["2", "3", "4", "5"] as const;

/**
 * Registry entries with no Exclude box: `kill_mod_trois_tap_exclude` was
 * never added to DEFAULT_CONFIG (`_NO_AUTO_EXCLUDE` in csdm/static_data.py).
 */
const NO_EXCLUDE_BOX: ReadonlySet<string> = new Set(["kill_mod_trois_tap"]);

type GroupId = Exclude<FilterDef["category"], "event">;

/** The category groups, in the window's own order. */
const GROUPS: { id: GroupId; heading: string; short: string }[] = [
  { id: "mods", heading: "Mods — none checked = all kills", short: "Mods" },
  { id: "dp2", heading: "demoparser2 modifiers", short: "demoparser2" },
  { id: "db", heading: "Situation (DB)", short: "Situation" },
];

/** How the "also …" mention names each non-kill category a filter judges. */
const ALSO_NAME: Record<Exclude<EventCategory, "kill">, string> = {
  damage: "damage",
  shot: "shots",
  round: "rounds",
};

export const TIPS = {
  suicides: "Include, exclude, or capture only clips where a suicide occurred",
  headshots: "Headshot filter (all/only/exclude); disabled when One Tap or Trois Tap is on",
  clear: "Resets Enable/Must for every filter below, including Situation (DB), not just Mods/dp2",
  clutch: "Detects clutch situations: player is the last alive on their team",
  winsOnly: "Only capture clutches the player's team went on to win",
  clutchMode: "Kills only = just the frags; Full clutch = whole round from the 1vX moment",
  clutchSize: "Clutch size to capture: number of opponents alive when it started",
} as const;

export interface ChoiceSetting {
  key: string;
  label: string;
  options: readonly string[];
  value: string;
  disabled: boolean;
  tip: string;
  set: (value: string) => void;
}

export interface KillFiltersModel {
  ready: boolean;
  suicides: ChoiceSetting;
  headshots: ChoiceSetting;
  groups: { id: GroupId; heading: string; short: string; rows: FilterRowModel[] }[];
  /** Every row of the card, in group order. */
  rows: FilterRowModel[];
  clear: { tip: string; run: () => void };
  clutch: {
    enabled: FilterToggle;
    winsOnly: FilterToggle;
    mode: ChoiceSetting;
    sizes: (FilterToggle & { n: number })[];
  };
  /** Header count: "3 active" / "none". */
  count: string;
}

/** The filters this card shows: the ones that judge kills. */
function judgesKills(def: FilterDef): boolean {
  return appliesTo(def).includes("kill");
}

function alsoWords(def: FilterDef): string[] {
  return appliesTo(def)
    .filter((c): c is Exclude<EventCategory, "kill"> => c !== "kill")
    .map((c) => ALSO_NAME[c]);
}

/** The extras a kill filter carries beyond Enable / Must / Exclude. */
function killExtras(
  def: FilterDef,
  s: Record<string, unknown>,
  write: (changes: Record<string, unknown>) => void,
): FilterExtraModel[] {
  const num = (key: string, label: string, unit: string, fallback: number, tip: string): FilterExtraModel => ({
    kind: "number",
    key,
    label,
    unit,
    tip,
    value: asText(s[key], fallback),
    set: (v) => write({ [key]: v }),
  });
  const count = (key: string, label: string, fallback: number, tip: string): FilterExtraModel => ({
    kind: "choice",
    key,
    label,
    unit: "",
    tip,
    options: KILL_COUNT_OPTIONS,
    value: asText(s[key], fallback),
    set: (v) => write({ [key]: v }),
  });
  switch (def.key) {
    case "kill_mod_high_velocity":
      // FERRARI PEEK: the sub-panel exists only while the filter is enabled.
      if (!s.kill_mod_high_velocity) return [];
      return [
        {
          kind: "toggle",
          key: "kill_mod_hv_one_shot",
          label: "One-shot",
          tip: "Require exactly one shot for Ferrari Peek (movement-speed kill)",
          on: !!s.kill_mod_hv_one_shot,
          toggle: () => write({ kill_mod_hv_one_shot: !s.kill_mod_hv_one_shot }),
        },
        num(
          "kill_mod_high_vel_thr",
          "",
          "u/s",
          100,
          "Minimum approach speed to qualify, in game units/sec (AWP~200, AK~215)",
        ),
      ];
    case "kill_mod_flick":
      return [num("kill_mod_flick_deg", "Min angle", "°", 50, "Minimum view-angle change (degrees) right before the kill to count as a flick")];
    case "kill_mod_one_tap":
      return [num("kill_mod_one_tap_s", "Window", "s", 2, "Seconds around the kill with no other shot, to count as an isolated one-tap")];
    case "kill_mod_multi_kill":
      return [
        count("kill_mod_multi_kill_n", "Min kills", 3, "Minimum kills in one round to qualify as a multi-kill"),
        num("kill_mod_multi_kill_s", "within", "s", 12, "Time window (seconds) the multi-kill count must happen within"),
      ];
    case "kill_mod_bully":
      return [count("kill_mod_bully_n", "From kill #", 3, "Captures the Nth+ kill against the same opponent this match")];
    default:
      return [];
  }
}

export function useKillFilters(): KillFiltersModel {
  const { tables } = useTables();
  const s = useAllSettings();
  const write = useSettingsBatch();
  const set = (key: string) => (value: unknown) => write({ [key]: value });
  const flip = (key: string, tip: string): FilterToggle => ({
    key,
    on: !!s[key],
    tip,
    toggle: () => write({ [key]: !s[key] }),
  });

  const defs = (tables?.filters ?? []).filter((f) => !f.hidden && judgesKills(f));
  const groups = GROUPS.map((g) => ({
    ...g,
    rows: buildFilterRows(
      defs.filter((f) => f.category === g.id),
      { settings: s, write, noExclude: NO_EXCLUDE_BOX, also: alsoWords, extras: (def) => killExtras(def, s, write) },
    ),
  })).filter((g) => g.rows.length > 0);
  const rows = groups.flatMap((g) => g.rows);

  // A one-tap kill is already a headshot constraint; combining it with a
  // headshot choice would silently match nothing, so the choice is greyed.
  const headshotsDisabled = !!s.kill_mod_one_tap || !!s.kill_mod_trois_tap;

  return {
    ready: tables != null,
    suicides: {
      key: "suicides_mode",
      label: "Suicides",
      options: SUICIDE_MODES,
      value: typeof s.suicides_mode === "string" ? s.suicides_mode : SUICIDE_MODES[0],
      disabled: false,
      tip: TIPS.suicides,
      set: set("suicides_mode"),
    },
    headshots: {
      key: "headshots_mode",
      label: "Headshots",
      options: HEADSHOT_MODES,
      value: typeof s.headshots_mode === "string" ? s.headshots_mode : HEADSHOT_MODES[0],
      disabled: headshotsDisabled,
      tip: TIPS.headshots,
      set: set("headshots_mode"),
    },
    groups,
    rows,
    clear: {
      tip: TIPS.clear,
      // Only the rows this card shows: Clear must not reach into the Damage /
      // Shot Filters cards, which the user cannot see from here.
      run: () => {
        const changes: Record<string, unknown> = {};
        for (const def of defs) {
          changes[def.key] = false;
          changes[`${def.key}_req`] = false;
        }
        write(changes);
      },
    },
    clutch: {
      enabled: flip("clutch_enabled", TIPS.clutch),
      winsOnly: flip("clutch_wins_only", TIPS.winsOnly),
      mode: {
        key: "clutch_mode",
        label: "Clutch mode",
        options: CLUTCH_MODES,
        value: typeof s.clutch_mode === "string" ? s.clutch_mode : CLUTCH_MODES[0],
        disabled: false,
        tip: TIPS.clutchMode,
        set: set("clutch_mode"),
      },
      sizes: CLUTCH_SIZES.map((n) => ({ n, ...flip(`clutch_1v${n}`, TIPS.clutchSize) })),
    },
    count: (() => {
      const on = rows.filter((r) => r.enable.on || r.exclude?.on).length + (s.clutch_enabled ? 1 : 0);
      return on ? `${on} active` : "all kills";
    })(),
  };
}
