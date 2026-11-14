//! Headless render of every tab (wgpu, no window) from the app's own start-up scenario:
//! the capture the app's real window is compared with (`imgdiff.py`, ticket 07).
//! `CSDM_RENDER_OUT=<folder>` saves one PNG per tab there.

mod common;

use common::rig_with;
use csdm_app::Motion;
use egui_kittest::kittest::Queryable;

const BOOT: &str = include_str!("../scenarios/boot.json");
const TABS: [&str; 5] = ["CAPTURE", "EDITING", "TAGS", "VIDEO", "SETTINGS"];

#[test]
fn every_tab_renders_headless_at_the_window_size() {
    let mut r = rig_with(BOOT, Motion::Still, None, true);
    let out = std::env::var_os("CSDM_RENDER_OUT").map(std::path::PathBuf::from);
    for label in TABS {
        r.h.get_by_label(label).click();
        r.h.run();
        let img = r.h.render().expect("headless render");
        assert_eq!((img.width(), img.height()), (common::SIZE.x as u32, common::SIZE.y as u32));
        if let Some(dir) = &out {
            img.save(dir.join(format!("test-{}.png", label.to_lowercase()))).expect("save png");
        }
    }
}
