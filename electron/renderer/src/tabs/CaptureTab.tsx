/**
 * The Capture tab -- first slice: the window's "CAPTURE & TIMING" section.
 *
 * Ported from `_tab_capturer` in csdm_batch_clips_generator.py (the section
 * opened at "CAPTURE & TIMING"). Every control wears a `SettingControl` so
 * the coverage guard can see it; a control rendered without one counts as
 * missing, which is the point.
 *
 * Capture & Timing is its own component (captureTiming/CaptureTimingCard):
 * one data model drawn in three card styles; so is Timing & Retries
 * (timingRetries/TimingRetriesCard). Each reads its own style live.
 */
import Card from "../components/Card";
import { ICONS } from "../icons";
import SectionList, { type SectionSpec } from "../shell/SectionList";
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
import TimingRetriesCard from "./timingRetries/TimingRetriesCard";
import "./CaptureTab.css";

export default function CaptureTab() {
  // Header counters (the mock's `.sh .cnt`). Read-only: they summarise what
  // the section already holds, they never become a second source of truth.
  const [steamIdsRaw] = useSetting<string[]>("steam_ids");
  const [weaponsRaw] = useSetting<string[]>("weapons");
  const steamIds = Array.isArray(steamIdsRaw) ? steamIdsRaw : [];
  const weapons = Array.isArray(weaponsRaw) ? weaponsRaw : [];


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
    { id: "timing-retries", element: <TimingRetriesCard /> },
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
