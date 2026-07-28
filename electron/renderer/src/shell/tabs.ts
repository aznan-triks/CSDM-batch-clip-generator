/**
 * The application's four tabs, as data.
 *
 * The window builds them in `_tab_capturer` / `_tab_tags` / `_tab_video` /
 * `_tab_outils`; the labels here are the ones it shows. Keeping them in a
 * table means the coverage test can walk every tab without knowing the
 * markup, and a fifth tab cannot appear without touching this file.
 */
export interface TabSpec {
  id: "capture" | "tags" | "video" | "settings";
  label: string;
}

export const TABS: readonly TabSpec[] = [
  { id: "capture", label: "CAPTURE" },
  { id: "tags", label: "TAGS" },
  { id: "video", label: "VIDEO" },
  { id: "settings", label: "SETTINGS" },
] as const;
