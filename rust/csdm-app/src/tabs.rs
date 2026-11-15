//! The five tabs, as data (3.5 `shell/tabs.ts`). The fixed frame of the app: never renamed,
//! never removed; a sixth cannot appear without touching this table.

pub mod tags;
pub mod settings;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TabId { Capture, Editing, Tags, Video, Settings }

pub struct TabSpec {
    pub id: TabId,
    /// Key in `ui_sections` and in the backdrop table.
    pub key: &'static str,
    pub label: &'static str,
    /// Glyph of `icons_data` (3.5 `tabs.ts::icon`).
    pub icon: &'static str,
    pub tip: &'static str,
}

pub const TABS: [TabSpec; 5] = [
    TabSpec { id: TabId::Capture, key: "capture", label: "CAPTURE", icon: "capture", tip: "Clip capture configuration: events, players, dates, weapons, and demo filtering" },
    TabSpec { id: TabId::Editing, key: "editing", label: "EDITING", icon: "editing", tip: "Clip editing parameters: camera perspective, slow motion, transitions, and timing" },
    TabSpec { id: TabId::Tags, key: "tags", label: "TAGS", icon: "tags", tip: "Database demo tags management, tag filtering, and demo labeling" },
    TabSpec { id: TabId::Video, key: "video", label: "VIDEO", icon: "video", tip: "Video resolution, framerate, encoding codecs, HLAE options, and CS2 effects" },
    TabSpec { id: TabId::Settings, key: "settings", label: "SETTINGS", icon: "settings", tip: "CSDM database connection, application paths, UI theme, and preferences" },
];

pub fn spec(id: TabId) -> &'static TabSpec {
    TABS.iter().find(|t| t.id == id).expect("every tab is in the table")
}

pub fn index(id: TabId) -> usize {
    TABS.iter().position(|t| t.id == id).expect("every tab is in the table")
}
