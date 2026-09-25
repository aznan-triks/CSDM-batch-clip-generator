/**
 * The Capture tab -- first slice: the window's "CAPTURE & TIMING" section.
 *
 * Ported from `_tab_capturer` in csdm_batch_clips_generator.py (the section
 * opened at "CAPTURE & TIMING"). Every control wears a `SettingControl` so
 * the coverage guard can see it; a control rendered without one counts as
 * missing, which is the point.
 *
 * Capture & Timing is split into three titled groups (What to capture /
 * Camera / Clip length) and Timing & Retries into two (If a recording fails /
 * Between demos), each ending in plain words drawn from the values.
 *
 * The three conditional rows are the window's own rules, not new behaviour:
 *   - the switch delay exists only in `both` perspective;
 *   - Mate POV exists in `victim` and `both`;
 *   - Mate POV's "Must" box follows its Enable box (`_wire_enable_must`).
 */
import Card from "../components/Card";
import Chip from "../components/Chip";
import Field from "../components/Field";
import FormGroup from "../components/FormGroup";
import { ICONS } from "../icons";
import Segmented from "../components/Segmented";
import Slider from "../components/Slider";
import SectionList, { type SectionSpec } from "../shell/SectionList";
import SettingControl from "../settings/SettingControl";
import { asNumber } from "../settings/asNumber";
import { useSetting } from "../settings/store";
import { TablesProvider } from "../settings/useTables";
import DemoSelectionSection from "./DemoSelectionSection";
import EventFiltersSection from "./EventFiltersSection";
import EventTypeSection from "./EventTypeSection";
import KillFiltersSection from "./KillFiltersSection";
import MapFilterSection from "./MapFilterSection";
import MatchTypesSection from "./MatchTypesSection";
import PlayerSection from "./PlayerSection";
import WeaponFilterSection from "./WeaponFilterSection";
import ClipTimeline from "./ClipTimeline";
import { clipWindow, clipWindowSummary, pacingSummary } from "./clipWindow";
import "./CaptureTab.css";

/**
 * Perspective values, exactly as the engine reads them.
 */
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

/**
 * A whole, non-negative number: a count of retries, seconds or minutes.
 * An empty box keeps `fallback` (the current value) rather than jumping to 0.
 */
function asCount(value: unknown, fallback: number): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  return Math.max(0, Math.round(asNumber(value, fallback)));
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
  // Numbers, not the typed text: the batch loop counts and sleeps with them.
  const [retryCount, setRetryCount] = useSetting<number>("retry_count");
  const [retryDelay, setRetryDelay] = useSetting<number>("retry_delay");
  const [demoPause, setDemoPause] = useSetting<number>("delay_between_demos");
  const [recordingTimeout, setRecordingTimeout] = useSetting<number>("recording_timeout");
  const [clipOrder, setClipOrder] = useSetting<string>("clip_order");
  // Header counters (the mock's `.sh .cnt`). Read-only: they summarise what
  // the section already holds, they never become a second source of truth.
  const [steamIdsRaw] = useSetting<string[]>("steam_ids");
  const [weaponsRaw] = useSetting<string[]>("weapons");
  const steamIds = Array.isArray(steamIdsRaw) ? steamIdsRaw : [];
  const weapons = Array.isArray(weaponsRaw) ? weaponsRaw : [];

  const selectedEvents = Array.isArray(events) ? events : [];
  const beforeSeconds = asNumber(before, BEFORE_RANGE.min);
  const afterSeconds = asNumber(after, AFTER_RANGE.min);
  const switchDelay = asNumber(victimPre, SWITCH_DELAY_RANGE.min);
  const retries = asCount(retryCount, 0);
  const retrySeconds = asCount(retryDelay, 0);
  const demoPauseSeconds = asCount(demoPause, 0);
  const timeoutMinutes = asCount(recordingTimeout, 0);
  const clipInput = {
    before: beforeSeconds,
    after: afterSeconds,
    perspective: perspective ?? PERSPECTIVES[0],
    switchDelay,
  };
  const clip = clipWindow(clipInput);
  const pacing = {
    retries,
    retryDelay: retrySeconds,
    demoPause: demoPauseSeconds,
    timeoutMin: timeoutMinutes,
    order: clipOrder ?? CLIP_ORDERS[0],
  };

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
          {/* Three groups in reading order: WHAT ends up in a clip, whose
              eyes film it, how long it lasts. They used to be one flat list
              of eleven rows mixing the three. */}
          <FormGroup title="What to capture">
            <EventTypeSection />

            {/* Rounds is independent of the perspective/action-type axes; the
                engine still reads it from the legacy `events` list. */}
            <SettingControl settingKey="events">
              <div className="row">
                <span className="lab">Also</span>
                <div className="chips">
                  <Chip
                    label="Full rounds"
                    tip="Also capture full-round clips, separate from the kill/death event filters above"
                    selected={selectedEvents.includes("Rounds")}
                    onToggle={() => toggleEvent("Rounds")}
                  />
                </div>
              </div>
            </SettingControl>
          </FormGroup>

          <FormGroup title="Camera">
            {/* "Film from", under "Camera": the setting picks whose eyes the
                clip is filmed through, and Event role above already answers
                "who acts". */}
            <SettingControl settingKey="perspective">
              <div className="row">
                <span className="lab">Film from</span>
                <Segmented
                  options={PERSPECTIVES}
                  value={perspective ?? PERSPECTIVES[0]}
                  onChange={setPerspective}
                  label="Camera"
                  tip="Whose eyes the clip is filmed through: the killer, the victim, or the killer then the victim (both)"
                  optionActions={Object.fromEntries(PERSPECTIVES.map((p) => [p, "L5"]))}
                />
              </div>
            </SettingControl>

            {/* Mate POV replaces the victim camera, so it is meaningless on the killer. */}
            {(perspective === "victim" || perspective === "both") && (
              <div className="row">
                <span className="lab">Mate POV</span>
                <div className="chips">
                  <SettingControl settingKey="kill_mod_mate_pov">
                    <Chip
                      label="Enable"
                      tip="Film the victim's side from the teammate with the best view of the kill, instead of the victim"
                      selected={!!matePov}
                      onToggle={toggleMatePov}
                    />
                  </SettingControl>
                  <SettingControl settingKey="kill_mod_mate_pov_req">
                    <Chip
                      label="★ Must"
                      tip="Skip the clip when no teammate has a clear view of the kill"
                      selected={!!matePovReq}
                      onToggle={toggleMatePovReq}
                    />
                  </SettingControl>
                </div>
              </div>
            )}

            <div className="row">
              <SettingControl settingKey="player_name_override">
                <Field
                  id="player-name-override"
                  label="Feed name"
                  value={nameOverride ?? ""}
                  onChange={setNameOverride}
                  placeholder="name from the demo"
                  tip="Name shown for your player in the clips' kill feed. Empty = the name stored in the demo"
                />
              </SettingControl>
            </div>

            {/* Only `both` switches camera, so only `both` has a delay to set.
                Last in its group on purpose: it sits right above "Before",
                the seconds it is added to (the bar below shows the sum). */}
            {perspective === "both" && (
              <SettingControl settingKey="victim_pre_s">
                <Slider
                  id="victim-pre-s"
                  label="Victim view"
                  unit="s"
                  min={SWITCH_DELAY_RANGE.min}
                  max={SWITCH_DELAY_RANGE.max}
                  value={switchDelay}
                  onChange={setVictimPre}
                  tip="Both: the camera follows the killer, then switches to the victim this many seconds before the kill. These seconds are added to the seconds before"
                />
              </SettingControl>
            )}
          </FormGroup>

          <FormGroup title="Clip length">
            {/* Each slider is a row of its own (mock `.row`: label, rail,
                box). They are not columns in a grid: in a half-width card
                that left each rail 92px long against the mock's 202px, and a
                rail that short cannot be aimed. */}
            <SettingControl settingKey="before">
              <Slider
                id="seconds-before"
                label="Before"
                unit="s"
                min={BEFORE_RANGE.min}
                max={BEFORE_RANGE.max}
                value={beforeSeconds}
                onChange={setBefore}
                tip="Seconds of footage recorded before each event. Also sets how close two events must be to share one clip"
              />
            </SettingControl>
            <SettingControl settingKey="after">
              <Slider
                id="seconds-after"
                label="After"
                unit="s"
                min={AFTER_RANGE.min}
                max={AFTER_RANGE.max}
                value={afterSeconds}
                onChange={setAfter}
                tip="Seconds of footage recorded after each event"
              />
            </SettingControl>
            {/* What one clip will hold, drawn then said, from the values above. */}
            <ClipTimeline window={clip} />
            <p className="capture-hint" data-testid="clip-window-summary">
              {clipWindowSummary(clipInput)}
            </p>
          </FormGroup>
        </Card>
      ),
    },
    {
      id: "timing-retries",
      element: (
        <Card title="Timing &amp; Retries" icon={<ICONS.captureTiming />}>
          {/* Every setter stores a whole number -- the batch loop counts and
              sleeps with these. One field per row, each a narrow number box
              with its unit, under one label column. */}
          <FormGroup title="If a recording fails">
            <div className="row">
              <SettingControl settingKey="retry_count">
                <Field
                  id="retry-count"
                  label="Retries"
                  numeric
                  value={String(retries)}
                  onChange={(v) => setRetryCount(asCount(v, retries))}
                  tip="Extra attempts for a recording that fails, before the demo is marked failed. 0 = no retry"
                />
              </SettingControl>
              <span className="unit">{retries === 1 ? "time" : "times"}</span>
            </div>
            <div className="row">
              <SettingControl settingKey="retry_delay">
                <Field
                  id="retry-delay"
                  label="Wait between"
                  numeric
                  value={String(retrySeconds)}
                  onChange={(v) => setRetryDelay(asCount(v, retrySeconds))}
                  tip="Seconds to wait before each retry of a failed recording"
                />
              </SettingControl>
              <span className="unit">s</span>
            </div>
            <div className="row">
              <SettingControl settingKey="recording_timeout">
                <Field
                  id="recording-timeout"
                  label="Stop if stuck"
                  numeric
                  value={String(timeoutMinutes)}
                  onChange={(v) => setRecordingTimeout(asCount(v, timeoutMinutes))}
                  tip="A recording that runs longer than this is stopped and retried. 0 = automatic, from the length of the clips; a value here can only make the wait longer"
                />
              </SettingControl>
              <span className="unit">min{timeoutMinutes === 0 ? " (0 = automatic)" : ""}</span>
            </div>
          </FormGroup>

          <FormGroup title="Between demos">
            <div className="row">
              <SettingControl settingKey="delay_between_demos">
                <Field
                  id="demo-pause"
                  label="Pause"
                  numeric
                  value={String(demoPauseSeconds)}
                  onChange={(v) => setDemoPause(asCount(v, demoPauseSeconds))}
                  tip="Seconds to pause between two demos, giving CS2 and the recorder time to reset"
                />
              </SettingControl>
              <span className="unit">s</span>
            </div>
            <SettingControl settingKey="clip_order">
              <div className="row">
                <span className="lab">Order</span>
                <Segmented
                  options={CLIP_ORDERS}
                  value={clipOrder ?? CLIP_ORDERS[0]}
                  onChange={setClipOrder}
                  label="Demo order"
                  tip="Order in which demos are recorded: chronological by match date, or shuffled"
                />
              </div>
            </SettingControl>
            {/* What a batch does on a failure and between demos, in words. */}
            <p className="capture-hint" data-testid="pacing-summary">
              {pacingSummary(pacing)}
            </p>
          </FormGroup>
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
      id: "damage-filters",
      element: (
        <Card title="Damage Filters" icon={<ICONS.damageFilters />}>
          <EventFiltersSection category="damage" />
        </Card>
      ),
    },
    {
      id: "shot-filters",
      element: (
        <Card title="Shot Filters" icon={<ICONS.shotFilters />}>
          <EventFiltersSection category="shot" />
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
      <div className="bento capture-tab">
        <SectionList tabId="capture" sections={SECTIONS} />
      </div>
    </TablesProvider>
  );
}
