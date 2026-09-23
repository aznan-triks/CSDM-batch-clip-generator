/**
 * The application's four tabs, as data.
 *
 * The window builds them in `_tab_capturer` / `_tab_tags` / `_tab_video` /
 * `_tab_outils`; the labels here are the ones it shows. Keeping them in a
 * table means the coverage test can walk every tab without knowing the
 * markup, and a fifth tab cannot appear without touching this file.
 */
import type { IconName } from "../icons";

export interface TabSpec {
  id: "capture" | "tags" | "video" | "settings" | "editing";
  label: string;
  icon: IconName;
  tip?: string;
}

export const TABS: readonly TabSpec[] = [
  { id: "capture", label: "CAPTURE", icon: "capture", tip: "Clip capture configuration: events, players, dates, weapons, and demo filtering" },
  { id: "editing", label: "EDITING", icon: "editing", tip: "Clip editing parameters: camera perspective, slow motion, transitions, and timing" },
  { id: "tags", label: "TAGS", icon: "tags", tip: "Database demo tags management, tag filtering, and demo labeling" },
  { id: "video", label: "VIDEO", icon: "video", tip: "Video resolution, framerate, encoding codecs, HLAE options, and CS2 effects" },
  { id: "settings", label: "SETTINGS", icon: "settings", tip: "CSDM database connection, application paths, UI theme, and preferences" },
] as const;
