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
 * (timingRetries/TimingRetriesCard), Match Types and Map Filter
 * (matchTypes/, mapFilter/). Each reads its own style live.
 */
import Card from "../components/Card";
import { ICONS } from "../icons";
import SectionList, { type SectionSpec } from "../shell/SectionList";
import { useSetting } from "../settings/store";
import { TablesProvider } from "../settings/useTables";
import DemoSelectionSection from "./DemoSelectionSection";
import PlayerSection from "./PlayerSection";
import CaptureTimingCard from "./captureTiming/CaptureTimingCard";
import TimingRetriesCard from "./timingRetries/TimingRetriesCard";
import MapFilterCard from "./mapFilter/MapFilterCard";
import MatchTypesCard from "./matchTypes/MatchTypesCard";
import { EventFiltersCard, KillFiltersCard } from "./filterCards/FilterCards";
import WeaponFilterCard from "./weaponFilter/WeaponFilterCard";
import "./CaptureTab.css";

export default function CaptureTab() {
  // Header counters (the mock's `.sh .cnt`). Read-only: they summarise what
  // the section already holds, they never become a second source of truth.
  const [steamIdsRaw] = useSetting<string[]>("steam_ids");
  const steamIds = Array.isArray(steamIdsRaw) ? steamIdsRaw : [];


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
    // The filter cards: one data model each, drawn in the card's own style.
    { id: "weapon-filter", element: <WeaponFilterCard className="wide" /> },
    // One data model drawn in the user's card style (Settings > UI Theme).
    { id: "capture-timing", element: <CaptureTimingCard /> },
    { id: "timing-retries", element: <TimingRetriesCard /> },
    { id: "kill-filters", element: <KillFiltersCard /> },
    { id: "damage-filters", element: <EventFiltersCard category="damage" /> },
    { id: "shot-filters", element: <EventFiltersCard category="shot" /> },
    { id: "match-types", element: <MatchTypesCard /> },
    { id: "map-filter", element: <MapFilterCard /> },
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
