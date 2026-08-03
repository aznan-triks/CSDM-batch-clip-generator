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
}

export const TABS: readonly TabSpec[] = [
  { id: "capture", label: "CAPTURE", icon: "capture" },
  { id: "editing", label: "EDITING", icon: "editing" },
  { id: "tags", label: "TAGS", icon: "tags" },
  { id: "video", label: "VIDEO", icon: "video" },
  { id: "settings", label: "SETTINGS", icon: "settings" },
] as const;
