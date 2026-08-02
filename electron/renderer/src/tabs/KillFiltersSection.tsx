/**
 * The KILL FILTERS section and the CLUTCH block.
 *
 * Ported from the "KILL FILTERS" `Sec` in csdm_batch_clips_generator.py: the
 * Suicides/TK/Headshots row, the three registry-driven groups (Mods,
 * demoparser2 modifiers, Situation/DB), and the CLUTCH block below them.
 *
 * The 19 visible rows all go through `FilterRow` (tâche 2): a row built by
 * hand once lost its Exclude box (v207, FERRARI PEEK) and clips went missing
 * with no error anywhere. `tables.filters` -- never a hardcoded list -- is
 * the only source of which filters exist and in what order (D20 / R1).
 */
import Chip from "../components/Chip";
import Field from "../components/Field";
import Segmented from "../components/Segmented";
import FilterRow from "../settings/FilterRow";
import SettingControl from "../settings/SettingControl";
import { useSetting, useSettingsBatch } from "../settings/store";
import { useTables } from "../settings/useTables";
import type { FilterDef, Tables } from "../settings/useTables";
import "./KillFiltersSection.css";

/** Suicides / TK: the window's own three-way choice. */
const SUICIDE_TK_MODES = ["include", "exclude", "only"] as const;

/**
 * Headshots: a DIFFERENT three-way choice from suicides/TK.
 *
 * `cfg.get("headshots_mode", "all")` is what the engine reads (core.py
 * lines 589, 843, 3362) -- "all" / "only" / "exclude", never "include". A
 * shared `FILTER_MODES` constant across all three radios would silently
 * default this one to a value the engine does not recognise.
 */
const HEADSHOT_MODES = ["all", "only", "exclude"] as const;

/** The window's own order for the 1v1 .. 1v5 size chips. */
const CLUTCH_SIZES = [1, 2, 3, 4, 5] as const;

/**
 * `clutch_mode`'s two real values (core.py line 1462, 3378): "kills_only" /
 * "full_clutch" -- not "full_round".
 */
const CLUTCH_MODES = ["kills_only", "full_clutch"] as const;

/** Widget bounds for the two "N kills" segmented pickers, not motion. */
const KILL_COUNT_OPTIONS = ["2", "3", "4", "5"] as const;

/**
 * Registry entries whose Exclude box this task does not build.
 *
 * `kill_mod_trois_tap`: `${key}_exclude` was never added to DEFAULT_CONFIG.
 * `kill_mod_high_velocity`: the key exists, but `coverage-ledger.ts`'s
 * `NO_CONTROL_BY_DESIGN` records that FERRARI PEEK never had an Exclude box
 * in the Tkinter window -- building one here would make that ledger entry
 * stale, and the coverage guard's "no stale ledger entry" test exists
 * specifically to catch that.
 */
const NO_EXCLUDE_BOX = new Set<string>(["kill_mod_trois_tap", "kill_mod_high_velocity"]);

/** Read a setting that should be a number, tolerating text-field strings. */
function asText(value: unknown, fallback: number): string {
  return value === undefined || value === null || value === "" ? String(fallback) : String(value);
}

/** The category groups, in the window's own order. */
const CATEGORY_ORDER: FilterDef["category"][] = ["mods", "dp2", "db"];
const CATEGORY_HEADING: Record<FilterDef["category"], string> = {
  mods: "Mods — none checked = all kills",
  dp2: "demoparser2 modifiers",
  db: "Situation (DB)",
};

/** The extras a filter row carries beyond Enable / Must / Exclude, if any. */
function FilterExtras({ filterKey }: { filterKey: string }) {
  const [highVelocity] = useSetting<boolean>("kill_mod_high_velocity");
  const [hvOneShot, setHvOneShot] = useSetting<boolean>("kill_mod_hv_one_shot");
  const [hvThreshold, setHvThreshold] = useSetting<string>("kill_mod_high_vel_thr");
  const [flickDeg, setFlickDeg] = useSetting<string>("kill_mod_flick_deg");
  const [oneTapS, setOneTapS] = useSetting<string>("kill_mod_one_tap_s");
  const [multiKillN, setMultiKillN] = useSetting<string>("kill_mod_multi_kill_n");
  const [multiKillS, setMultiKillS] = useSetting<string>("kill_mod_multi_kill_s");
  const [bullyN, setBullyN] = useSetting<string>("kill_mod_bully_n");

  switch (filterKey) {
    case "kill_mod_high_velocity":
      // FERRARI PEEK: the sub-panel exists only while the filter is enabled.
      if (!highVelocity) return null;
      return (
        <div className="kf-extra">
          <SettingControl settingKey="kill_mod_hv_one_shot">
            <Chip
              label="One-shot"
              selected={!!hvOneShot}
              onToggle={() => setHvOneShot(!hvOneShot)}
            />
          </SettingControl>
          <SettingControl settingKey="kill_mod_high_vel_thr">
            <Field
              id="kill-mod-high-vel-thr"
              value={asText(hvThreshold, 100)}
              onChange={setHvThreshold}
              mono
            />
          </SettingControl>
          <span className="kf-suffix">u/s</span>
        </div>
      );

    case "kill_mod_flick":
      return (
        <div className="kf-extra">
          <span className="lab">Min angle</span>
          <SettingControl settingKey="kill_mod_flick_deg">
            <Field
              id="kill-mod-flick-deg"
              value={asText(flickDeg, 50)}
              onChange={setFlickDeg}
              mono
            />
          </SettingControl>
          <span className="kf-suffix">°</span>
        </div>
      );

    case "kill_mod_one_tap":
      return (
        <div className="kf-extra">
          <span className="lab">Window</span>
          <SettingControl settingKey="kill_mod_one_tap_s">
            <Field
              id="kill-mod-one-tap-s"
              value={asText(oneTapS, 2)}
              onChange={setOneTapS}
              mono
            />
          </SettingControl>
          <span className="kf-suffix">s</span>
        </div>
      );

    case "kill_mod_multi_kill":
      return (
        <div className="kf-extra">
          <span className="lab">Min kills</span>
          <SettingControl settingKey="kill_mod_multi_kill_n">
            <Segmented
              options={KILL_COUNT_OPTIONS}
              value={asText(multiKillN, 3)}
              onChange={setMultiKillN}
              label="Min kills"
            />
          </SettingControl>
          <span className="lab">within</span>
          <SettingControl settingKey="kill_mod_multi_kill_s">
            <Field
              id="kill-mod-multi-kill-s"
              value={asText(multiKillS, 12)}
              onChange={setMultiKillS}
              mono
            />
          </SettingControl>
          <span className="kf-suffix">s</span>
        </div>
      );

    case "kill_mod_bully":
      return (
        <div className="kf-extra">
          <span className="lab">From kill #</span>
          <SettingControl settingKey="kill_mod_bully_n">
            <Segmented
              options={KILL_COUNT_OPTIONS}
              value={asText(bullyN, 3)}
              onChange={setBullyN}
              label="From kill #"
            />
          </SettingControl>
        </div>
      );

    default:
      return null;
  }
}

function ClutchBlock() {
  const [enabled, setEnabled] = useSetting<boolean>("clutch_enabled");
  const [winsOnly, setWinsOnly] = useSetting<boolean>("clutch_wins_only");
  const [mode, setMode] = useSetting<string>("clutch_mode");
  // Five fixed keys, called unconditionally and in the same order every
  // render (never in a loop): `useSetting` is a hook, and CLUTCH_SIZES never
  // changes shape, but the calls themselves must stay literal for the
  // rules-of-hooks to hold.
  const [v1, setV1] = useSetting<boolean>("clutch_1v1");
  const [v2, setV2] = useSetting<boolean>("clutch_1v2");
  const [v3, setV3] = useSetting<boolean>("clutch_1v3");
  const [v4, setV4] = useSetting<boolean>("clutch_1v4");
  const [v5, setV5] = useSetting<boolean>("clutch_1v5");
  const sizeSettings: [boolean | undefined, (v: boolean) => void][] = [
    [v1, setV1],
    [v2, setV2],
    [v3, setV3],
    [v4, setV4],
    [v5, setV5],
  ];

  return (
    <div className="kf-clutch">
      <SettingControl settingKey="clutch_enabled">
        <Chip label="🎯 CLUTCH" selected={!!enabled} onToggle={() => setEnabled(!enabled)} />
      </SettingControl>
      {enabled && (
        <div className="kf-clutch-options">
          <SettingControl settingKey="clutch_wins_only">
            <Chip
              label="Wins only"
              selected={!!winsOnly}
              onToggle={() => setWinsOnly(!winsOnly)}
            />
          </SettingControl>
          <SettingControl settingKey="clutch_mode">
            <Segmented
              options={CLUTCH_MODES}
              value={mode ?? CLUTCH_MODES[0]}
              onChange={setMode}
              label="Clutch mode"
            />
          </SettingControl>
          <div className="kf-clutch-sizes">
            {CLUTCH_SIZES.map((n, i) => {
              const [value, set] = sizeSettings[i];
              return (
                <SettingControl key={n} settingKey={`clutch_1v${n}`}>
                  <Chip label={`1v${n}`} selected={!!value} onToggle={() => set(!value)} />
                </SettingControl>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function buildClearChanges(tables: Tables): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const def of tables.filters) {
    changes[def.key] = false;
    changes[`${def.key}_req`] = false;
  }
  return changes;
}

export default function KillFiltersSection() {
  const { tables } = useTables();
  const setMany = useSettingsBatch();
  const [suicidesMode, setSuicidesMode] = useSetting<string>("suicides_mode");
  const [teamkillsMode, setTeamkillsMode] = useSetting<string>("teamkills_mode");
  const [headshotsMode, setHeadshotsMode] = useSetting<string>("headshots_mode");
  const [oneTap] = useSetting<boolean>("kill_mod_one_tap");
  const [troisTap] = useSetting<boolean>("kill_mod_trois_tap");

  if (!tables) {
    return <p className="capture-hint">Loading filters…</p>;
  }

  // A one-tap kill is already a headshot constraint; combining it with a
  // headshot choice would silently match nothing, so the window greys the
  // radios out rather than hide the rule.
  const headshotsDisabled = !!oneTap || !!troisTap;

  return (
    <div className="kill-filters">
      <div className="row">
        <SettingControl settingKey="suicides_mode">
          <div className="kf-top-group">
            <span className="lab">Suicides</span>
            <Segmented
              options={SUICIDE_TK_MODES}
              value={suicidesMode ?? SUICIDE_TK_MODES[0]}
              onChange={setSuicidesMode}
              label="Suicides"
            />
          </div>
        </SettingControl>
        <SettingControl settingKey="teamkills_mode">
          <div className="kf-top-group">
            <span className="lab">TK</span>
            <Segmented
              options={SUICIDE_TK_MODES}
              value={teamkillsMode ?? SUICIDE_TK_MODES[0]}
              onChange={setTeamkillsMode}
              label="Teamkills"
            />
          </div>
        </SettingControl>
        <SettingControl settingKey="headshots_mode">
          <div className="kf-top-group">
            <span className="lab">Headshots</span>
            <Segmented
              options={HEADSHOT_MODES}
              value={headshotsMode ?? HEADSHOT_MODES[0]}
              onChange={setHeadshotsMode}
              label="Headshots"
              disabled={headshotsDisabled}
            />
          </div>
        </SettingControl>
      </div>

      <div className="row">
        <span className="lab">Mods + demoparser2</span>
        <button
          type="button"
          className="chip push-right"
          data-action="G3" onClick={() => setMany(buildClearChanges(tables))}
        >
          Clear
        </button>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const defs = tables.filters.filter((f) => f.category === category && !f.hidden);
        if (defs.length === 0) return null;
        return (
          <div key={category} className="kf-group">
            <span className="lab">{CATEGORY_HEADING[category]}</span>
            {defs.map((def) => (
              <FilterRow key={def.key} def={def} hasExclude={!NO_EXCLUDE_BOX.has(def.key)}>
                <FilterExtras filterKey={def.key} />
              </FilterRow>
            ))}
          </div>
        );
      })}

      <ClutchBlock />
    </div>
  );
}
