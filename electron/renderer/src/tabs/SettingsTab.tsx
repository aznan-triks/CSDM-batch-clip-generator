/**
 * The Settings tab: POSTGRESQL CONNECTION, PATHS, CONFIGURATION FOLDER,
 * PRESETS, UI THEME, UI LAYOUT, PERFORMANCE and INJECTION PREVIEW.
 *
 * Ported from `_tab_outils` in csdm_batch_clips_generator.py. Each card is one
 * data model drawn in its card style (`settingsCards/`, and `PresetSection`
 * for the presets); this file only lays them on the grid.
 */
import SectionList, { type SectionSpec } from "../shell/SectionList";
import PresetSection from "./PresetSection";
import ConfigFolderCard from "./settingsCards/ConfigFolderCard";
import InjectionPreviewCard from "./settingsCards/InjectionPreviewCard";
import PathsCard from "./settingsCards/PathsCard";
import PerformanceCard from "./settingsCards/PerformanceCard";
import PostgresCard from "./settingsCards/PostgresCard";
import UiLayoutCard from "./settingsCards/UiLayoutCard";
import UiThemeCard from "./settingsCards/UiThemeCard";
import "./SettingsTab.css";

const SECTIONS: SectionSpec[] = [
  { id: "postgresql", element: <PostgresCard className="wide" /> },
  { id: "paths", element: <PathsCard className="wide" /> },
  { id: "config-folder", element: <ConfigFolderCard className="wide" /> },
  { id: "presets", element: <PresetSection /> },
  { id: "ui-theme", element: <UiThemeCard /> },
  { id: "ui-layout", element: <UiLayoutCard /> },
  { id: "performance", element: <PerformanceCard /> },
  { id: "injection-preview", element: <InjectionPreviewCard /> },
];

export default function SettingsTab() {
  return (
    <div className="bento settings-tab">
      <SectionList tabId="settings" sections={SECTIONS} />
    </div>
  );
}
