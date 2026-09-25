/**
 * The Capture tab -- first slice: the window's "CAPTURE & TIMING" section.
 *
 * Ported from `_tab_capturer` in csdm_batch_clips_generator.py (the section
 * opened at "CAPTURE & TIMING"). Every control wears a `SettingControl` so
 * the coverage guard can see it; a control rendered without one counts as
 * missing, which is the point.
 *
 * Capture & Timing is its own component (captureTiming/CaptureTimingCard):
 * one data model drawn in three card styles. Timing & Retries is split into
 * two titled groups (If a recording fails / Between demos), ending in plain
 * words drawn from the values.
 */
import Card from "../components/Card";
import Field from "../components/Field";
import FormGroup from "../components/FormGroup";
import { ICONS } from "../icons";
import Segmented from "../components/Segmented";
import SectionList, { type SectionSpec } from "../shell/SectionList";
import SettingControl from "../settings/SettingControl";
import { asNumber } from "../settings/asNumber";
import { useSetting } from "../settings/store";
import { TablesProvider } from "../settings/useTables";
import DemoSelectionSection from "./DemoSelectionSection";
import EventFiltersSection from "./EventFiltersSection";
import KillFiltersSection from "./KillFiltersSection";
import MapFilterSection from "./MapFilterSection";
import MatchTypesSection from "./MatchTypesSection";
import PlayerSection from "./PlayerSection";
import WeaponFilterSection from "./WeaponFilterSection";
import CaptureTimingCard from "./captureTiming/CaptureTimingCard";
import { pacingSummary } from "./clipWindow";
import "./CaptureTab.css";

/** Demo processing order, exactly as the engine reads them. */
const CLIP_ORDERS = ["chrono", "random"] as const;

/**
 * A whole, non-negative number: a count of retries, seconds or minutes.
 * An empty box keeps `fallback` (the current value) rather than jumping to 0.
 */
function asCount(value: unknown, fallback: number): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  return Math.max(0, Math.round(asNumber(value, fallback)));
}

export default function CaptureTab() {
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

  const retries = asCount(retryCount, 0);
  const retrySeconds = asCount(retryDelay, 0);
  const demoPauseSeconds = asCount(demoPause, 0);
  const timeoutMinutes = asCount(recordingTimeout, 0);
  const pacing = {
    retries,
    retryDelay: retrySeconds,
    demoPause: demoPauseSeconds,
    timeoutMin: timeoutMinutes,
    order: clipOrder ?? CLIP_ORDERS[0],
  };

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
    // One data model drawn in the user's card style (Settings > UI Theme).
    { id: "capture-timing", element: <CaptureTimingCard /> },
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
