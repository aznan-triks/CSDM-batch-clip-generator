/**
 * The Capture tab -- first slice: the window's "CAPTURE & TIMING" section.
 *
 * Ported from `_tab_capturer` in csdm_batch_clips_generator.py (the section
 * opened at "CAPTURE & TIMING"). Every control wears a `SettingControl` so
 * the coverage guard can see it; a control rendered without one counts as
 * missing, which is the point.
 *
 * The three conditional rows are the window's own rules, not new behaviour:
 *   - the switch delay exists only in `both` perspective;
 *   - Mate POV exists in `victim` and `both`;
 *   - Mate POV's "Must" box follows its Enable box (`_wire_enable_must`).
 */
import Card from "../components/Card";
import Chip from "../components/Chip";
import Field from "../components/Field";
import { ICONS } from "../icons";
import Segmented from "../components/Segmented";
import Slider from "../components/Slider";
import SectionList, { type SectionSpec } from "../shell/SectionList";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import { DatabaseProvider } from "../settings/useDatabase";
import { TablesProvider } from "../settings/useTables";
import DemoSelectionSection from "./DemoSelectionSection";
import KillFiltersSection from "./KillFiltersSection";
import MapFilterSection from "./MapFilterSection";
import MatchTypesSection from "./MatchTypesSection";
import PlayerSection from "./PlayerSection";
import WeaponFilterSection from "./WeaponFilterSection";
import "./CaptureTab.css";

/** Event kinds, and the exact strings `cfg["events"]` carries. */
const EVENT_KINDS = [
  { value: "Kills", label: "KILLS" },
  { value: "Deaths", label: "DEATHS BY" },
  { value: "Rounds", label: "ROUNDS" },
] as const;

/** Perspective values, exactly as the engine reads them. */
const PERSPECTIVES = ["killer", "victim", "both"] as const;

/** Demo processing order, exactly as the engine reads them. */
const CLIP_ORDERS = ["chrono", "random"] as const;

/**
 * Slider bounds, copied from the window's own `tk.Scale` calls.
 *
 * Not configuration: they are the widget's range, the same category as a
 * field's width, and the engine clamps nothing on its own.
 */
const BEFORE_RANGE = { min: 1, max: 15 };
const AFTER_RANGE = { min: 1, max: 15 };
const SWITCH_DELAY_RANGE = { min: 0, max: 10 };

/** Read a setting that should be a number, tolerating the string a text field leaves behind. */
function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function CaptureTab() {
  const [events, setEvents] = useSetting<string[]>("events");
  const [perspective, setPerspective] = useSetting<string>("perspective");
  const [victimPre, setVictimPre] = useSetting<number>("victim_pre_s");
  const [matePov, setMatePov] = useSetting<boolean>("kill_mod_mate_pov");
  const [matePovReq, setMatePovReq] = useSetting<boolean>("kill_mod_mate_pov_req");
  const [nameOverride, setNameOverride] = useSetting<string>("player_name_override");
  const [before, setBefore] = useSetting<number>("before");
  const [after, setAfter] = useSetting<number>("after");
  const [retryCount, setRetryCount] = useSetting<string>("retry_count");
  const [retryDelay, setRetryDelay] = useSetting<string>("retry_delay");
  const [demoPause, setDemoPause] = useSetting<string>("delay_between_demos");
  const [timeout, setTimeout] = useSetting<string>("recording_timeout");
  const [clipOrder, setClipOrder] = useSetting<string>("clip_order");
  // Header counters (the mock's `.sh .cnt`). Read-only: they summarise what
  // the section already holds, they never become a second source of truth.
  const [steamIdsRaw] = useSetting<string[]>("steam_ids");
  const [weaponsRaw] = useSetting<string[]>("weapons");
  const steamIds = Array.isArray(steamIdsRaw) ? steamIdsRaw : [];
  const weapons = Array.isArray(weaponsRaw) ? weaponsRaw : [];

  const selectedEvents = Array.isArray(events) ? events : [];
  const beforeSeconds = asNumber(before, BEFORE_RANGE.min);
  const switchDelay = asNumber(victimPre, SWITCH_DELAY_RANGE.min);

  function toggleEvent(kind: string) {
    setEvents(
      selectedEvents.includes(kind)
        ? selectedEvents.filter((e) => e !== kind)
        : [...selectedEvents, kind],
    );
  }

  // The window switches the Must box off with its Enable box, never the other
  // way round: a Must left armed under a disabled filter silently drops clips.
  // Arming ★ Must auto-enables Enable (`_wire_enable_must` mirror).
  function toggleMatePov() {
    const next = !matePov;
    setMatePov(next);
    if (!next) setMatePovReq(false);
  }

  function toggleMatePovReq() {
    const next = !matePovReq;
    setMatePovReq(next);
    if (next && !matePov) setMatePov(true);
  }

  const SECTIONS: SectionSpec[] = [
    {
      id: "player",
      element: (
        <Card title="Player" icon={<ICONS.player />} className="wide" count={`${steamIds.length} selected`}>
          <PlayerSection />
        </Card>
      ),
    },
    {
      id: "demo-selection",
      element: (
        <Card title="Demo Selection" icon={<ICONS.demoSelection />}>
          <DemoSelectionSection />
        </Card>
      ),
    },
    {
      id: "weapon-filter",
      element: (
        <Card
          title="Weapon Filter"
          icon={<ICONS.weaponFilter />}
          className="wide"
          count={weapons.length ? `${weapons.length} active` : "all"}
        >
          <WeaponFilterSection />
        </Card>
      ),
    },
    {
      id: "capture-timing",
      element: (
        <Card title="Capture &amp; Timing" icon={<ICONS.captureTiming />} count={perspective ?? PERSPECTIVES[0]}>
          <SettingControl settingKey="events">
            <div className="row">
              <span className="lab">Capture</span>
              {EVENT_KINDS.map((kind) => (
                <Chip
                  key={kind.value}
                  label={kind.label}
                  selected={selectedEvents.includes(kind.value)}
                  onToggle={() => toggleEvent(kind.value)}
                />
              ))}
            </div>
          </SettingControl>

          <SettingControl settingKey="perspective">
            <div className="row">
              <span className="lab">Perspective</span>
              <Segmented
                options={PERSPECTIVES}
                value={perspective ?? PERSPECTIVES[0]}
                onChange={setPerspective}
                label="Perspective"
              />
            </div>
          </SettingControl>

          {/* Only `both` switches camera, so only `both` has a delay to set. */}
          {perspective === "both" && (
            <SettingControl settingKey="victim_pre_s">
              <Slider
                id="victim-pre-s"
                label="Switch delay (s)"
                min={SWITCH_DELAY_RANGE.min}
                max={SWITCH_DELAY_RANGE.max}
                value={switchDelay}
                onChange={setVictimPre}
                readout={`${switchDelay}s · total before: ${beforeSeconds + switchDelay}s`}
              />
            </SettingControl>
          )}

          {/* Mate POV replaces the victim camera, so it is meaningless on the killer. */}
          {(perspective === "victim" || perspective === "both") && (
            <div className="row">
              <span className="lab">Mate POV</span>
              <SettingControl settingKey="kill_mod_mate_pov">
                <Chip label="Enable" selected={!!matePov} onToggle={toggleMatePov} />
              </SettingControl>
              <SettingControl settingKey="kill_mod_mate_pov_req">
                <Chip
                  label="★ Must"
                  selected={!!matePovReq}
                  onToggle={toggleMatePovReq}
                />
              </SettingControl>
            </div>
          )}

          <div className="row">
            <SettingControl settingKey="player_name_override">
              <Field
                id="player-name-override"
                label="Name override"
                value={nameOverride ?? ""}
                onChange={setNameOverride}
                placeholder="name stored in the demo"
              />
            </SettingControl>
          </div>

          {/* Each slider is a row of its own (mock `.row`: label, rail,
              readout). They are not columns in a grid: in a half-width card
              that left each rail 92px long against the mock's 202px, and a
              rail that short cannot be aimed. */}
          <SettingControl settingKey="before">
            <Slider
              id="seconds-before"
              label="Seconds before"
              min={BEFORE_RANGE.min}
              max={BEFORE_RANGE.max}
              value={beforeSeconds}
              onChange={setBefore}
              readout={`${beforeSeconds}s`}
            />
          </SettingControl>
          <SettingControl settingKey="after">
            <Slider
              id="seconds-after"
              label="Seconds after"
              min={AFTER_RANGE.min}
              max={AFTER_RANGE.max}
              value={asNumber(after, AFTER_RANGE.min)}
              onChange={setAfter}
              readout={`${asNumber(after, AFTER_RANGE.min)}s`}
            />
          </SettingControl>
        </Card>
      ),
    },
    {
      id: "timing-retries",
      element: (
        <Card title="Timing &amp; Retries" icon={<ICONS.captureTiming />}>
          <div className="row">
            <SettingControl settingKey="retry_count">
              <Field
                id="retry-count"
                label="Retries"
                mono
                value={String(retryCount ?? "")}
                onChange={setRetryCount}
              />
            </SettingControl>
            <SettingControl settingKey="retry_delay">
              <Field
                id="retry-delay"
                label="Delay (s)"
                mono
                value={String(retryDelay ?? "")}
                onChange={setRetryDelay}
              />
            </SettingControl>
            <SettingControl settingKey="delay_between_demos">
              <Field
                id="demo-pause"
                label="Demo pause (s)"
                mono
                value={String(demoPause ?? "")}
                onChange={setDemoPause}
              />
            </SettingControl>
            <SettingControl settingKey="recording_timeout">
              <Field
                id="recording-timeout"
                label="Timeout (min)"
                mono
                value={String(timeout ?? "")}
                onChange={setTimeout}
              />
            </SettingControl>
          </div>

          <SettingControl settingKey="clip_order">
            <div className="row">
              <span className="lab">Order</span>
              <Segmented
                options={CLIP_ORDERS}
                value={clipOrder ?? CLIP_ORDERS[0]}
                onChange={setClipOrder}
                label="Order"
              />
            </div>
          </SettingControl>
        </Card>
      ),
    },
    {
      id: "kill-filters",
      element: (
        <Card title="Kill Filters" icon={<ICONS.killFilters />}>
          <KillFiltersSection />
        </Card>
      ),
    },
    {
      id: "match-types",
      element: (
        <Card title="Match Types" icon={<ICONS.matchTypes />}>
          <MatchTypesSection />
        </Card>
      ),
    },
    {
      id: "map-filter",
      element: (
        <Card title="Map Filter" icon={<ICONS.mapFilter />}>
          <MapFilterSection />
        </Card>
      ),
    },
  ];

  return (
    // One `describe_filters` and one `connect_db` for the whole tab: every
    // section below reads the SAME fetch through `useTables`/`useDatabase`
    // instead of each triggering its own bridge command and Python thread.
    <TablesProvider>
      <DatabaseProvider>
        <div className="bento capture-tab">
          <SectionList tabId="capture" sections={SECTIONS} />
        </div>
      </DatabaseProvider>
    </TablesProvider>
  );
}
