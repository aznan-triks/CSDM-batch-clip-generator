/**
 * Every card that can be drawn in the three card styles, by its layout id
 * (its `SectionSpec` id). Settings > UI Theme > Per-card style lists exactly
 * these, in this order. A card listed here that does not read its style yet
 * simply ignores its override.
 */
export const STYLED_CARDS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "player", title: "Player" },
  { id: "demo-selection", title: "Demo Selection" },
  { id: "weapon-filter", title: "Weapon Filter" },
  { id: "capture-timing", title: "Capture & Timing" },
  { id: "timing-retries", title: "Timing & Retries" },
  { id: "kill-filters", title: "Kill Filters" },
  { id: "damage-filters", title: "Damage Filters" },
  { id: "shot-filters", title: "Shot Filters" },
  { id: "match-types", title: "Match Types" },
  { id: "map-filter", title: "Map Filter" },
  { id: "final-assembly", title: "Final Assembly" },
  { id: "resolution", title: "Resolution, Framerate & Window" },
  { id: "recording-system", title: "Recording System" },
  { id: "hlae-options", title: "HLAE Options" },
  { id: "in-game-options", title: "In-Game Options" },
  { id: "cs2-effects", title: "CS2 Effects" },
  { id: "encoding", title: "Encoding" },
];
