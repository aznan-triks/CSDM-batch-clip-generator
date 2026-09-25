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
  // TAGS
  { id: "tag-grid", title: "Tags" },
  { id: "tag-range", title: "Tag Range" },
  { id: "operations", title: "Operations" },
  // SETTINGS
  { id: "postgresql", title: "PostgreSQL Connection" },
  { id: "paths", title: "Paths" },
  { id: "config-folder", title: "Configuration Folder" },
  { id: "presets", title: "Presets" },
  { id: "ui-theme", title: "UI Theme" },
  { id: "ui-layout", title: "UI Layout" },
  { id: "performance", title: "Performance" },
  { id: "injection-preview", title: "Injection Preview" },
];
