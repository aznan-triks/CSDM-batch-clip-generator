import { useState } from "react";

import ActionButton from "./ActionButton";
import Card from "./Card";
import Chip from "./Chip";
import Field from "./Field";
import Segmented from "./Segmented";
import { Tab, TabBar } from "./Tab";
import "./Gallery.css";

/** Minimal inline icon set, just enough to prove `icon` slots render. */
function IconCapture() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="6.5" />
    </svg>
  );
}
function IconTags() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M2 12 12 2h10v10L12 22z" />
    </svg>
  );
}
function IconVideo() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M2 4h14v16H2zM16 9l6-4v14l-6-4z" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M2 6h20v3H2zM2 11h20v3H2zM2 16h20v3H2z" />
    </svg>
  );
}
function IconPlayer() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="7" r="4.5" />
      <path d="M2 22c0-5 4.5-9 10-9s10 4 10 9z" />
    </svg>
  );
}
function IconWeapon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M2 8h13v8H2zM15 8l8 4-8 4z" />
    </svg>
  );
}
function IconFilter() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M2 3h20L14 13v8l-4-2.5V13z" />
    </svg>
  );
}
function IconRun() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M5 3 21 12 5 21z" />
    </svg>
  );
}
function IconPreview() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M12 4C5 4 1 12 1 12s4 8 11 8 11-8 11-8-4-8-11-8zm0 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" />
    </svg>
  );
}
function IconStop() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" />
    </svg>
  );
}
function IconKill() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M12 1 23 12 12 23 1 12z" />
    </svg>
  );
}

const TABS = ["Capture", "Tags", "Video", "Settings"] as const;
const TAB_ICONS = [IconCapture, IconTags, IconVideo, IconSettings];

const WEAPONS = ["AK-47", "AWP", "M4A4", "Deagle", "USP-S"];
const HS_OPTIONS = ["Any", "Only HS", "No HS"] as const;

/**
 * Demo route for the six primitive components, wired with CS2-flavoured
 * content so the pieces can be looked at together the way they will be used.
 */
export default function Gallery() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Capture");
  const [steamId, setSteamId] = useState("76561198042315890");
  const [autoDetect, setAutoDetect] = useState(true);
  const [weapons, setWeapons] = useState<Record<string, boolean>>({
    "AK-47": true,
    AWP: true,
    M4A4: false,
    Deagle: true,
    "USP-S": false,
  });
  const [hsFilter, setHsFilter] = useState<(typeof HS_OPTIONS)[number]>("Only HS");
  const [highVelocity, setHighVelocity] = useState(true);
  const [multiKill, setMultiKill] = useState(true);
  const [armed, setArmed] = useState(false);

  function toggleWeapon(name: string) {
    setWeapons((previous) => ({ ...previous, [name]: !previous[name] }));
  }

  return (
    <div className="gallery">
      <TabBar>
        {TABS.map((label, index) => {
          const Icon = TAB_ICONS[index];
          return (
            <Tab
              key={label}
              label={label}
              icon={<Icon />}
              active={label === activeTab}
              onSelect={() => setActiveTab(label)}
            />
          );
        })}
      </TabBar>

      <div className="gallery-panels">
        <Card title="Player" icon={<IconPlayer />}>
          <Field
            id="steam-id"
            label="Steam ID"
            mono
            value={steamId}
            onChange={setSteamId}
            placeholder="76561198…"
          />
          <Chip label="Auto-detect" selected={autoDetect} onToggle={() => setAutoDetect((v) => !v)} />
        </Card>

        <Card title="Weapon filter" icon={<IconWeapon />}>
          {WEAPONS.map((name) => (
            <Chip key={name} label={name} selected={weapons[name]} onToggle={() => toggleWeapon(name)} />
          ))}
        </Card>

        <Card title="Kill filters" icon={<IconFilter />}>
          <Segmented
            label="Headshot filter"
            options={HS_OPTIONS}
            value={hsFilter}
            onChange={(value) => setHsFilter(value as (typeof HS_OPTIONS)[number])}
          />
          <Chip
            label="High velocity"
            selected={highVelocity}
            onToggle={() => setHighVelocity((v) => !v)}
          />
          <Chip label="Multi-kill" selected={multiKill} onToggle={() => setMultiKill((v) => !v)} />
        </Card>
      </div>

      <div className="gallery-actions">
        <ActionButton label="Run" icon={<IconRun />} variant="run" onClick={() => {}} />
        <ActionButton label="Preview" icon={<IconPreview />} variant="preview" onClick={() => {}} />
        <ActionButton
          label="Stop"
          icon={<IconStop />}
          variant="stop"
          armed={armed}
          onClick={() => setArmed((v) => !v)}
        />
        <ActionButton label="Kill" icon={<IconKill />} variant="kill" onClick={() => {}} />
      </div>
    </div>
  );
}
