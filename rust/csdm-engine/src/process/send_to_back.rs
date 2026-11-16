//! Keeps CS2 behind every other window while the CLI records (3.5 `_start_cs2_send_to_back_watcher`,
//! setting `cs2_send_to_back`): waits for a CS2 window, then pushes every CS2 window to the bottom
//! of the Z-order at a steady pace until the CLI ends.

use super::win;
use crate::event::Level;
use crate::preview::Ports;
use csdm_core::batch::{CS2_EXE_MARK, CS2_WINDOW_TITLES, IMAGE_NAME_CHARS, SEND_TO_BACK_POLL_MS, SEND_TO_BACK_WAIT_MS};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// How CS2 windows are found and how long the watcher waits. Tests use a mark no real program has.
#[derive(Clone, Debug)]
pub struct WatchSpec {
    pub exe_mark: String,
    pub titles: Vec<String>,
    pub wait: Duration,
    pub poll: Duration,
}

impl Default for WatchSpec {
    fn default() -> Self {
        WatchSpec {
            exe_mark: CS2_EXE_MARK.into(),
            titles: CS2_WINDOW_TITLES.iter().map(|t| t.to_string()).collect(),
            wait: Duration::from_millis(SEND_TO_BACK_WAIT_MS),
            poll: Duration::from_millis(SEND_TO_BACK_POLL_MS),
        }
    }
}

/// 3.5 `_is_cs2`: by the program's file name when it can be read, else by the window title.
pub fn is_cs2(exe_path: &str, title: &str, spec: &WatchSpec) -> bool {
    if !exe_path.is_empty() {
        let file = std::path::Path::new(exe_path).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
        return file.contains(&spec.exe_mark);
    }
    let title = title.to_lowercase();
    spec.titles.iter().any(|t| title.contains(t.as_str()))
}

fn find(spec: &WatchSpec) -> Vec<isize> {
    // An enumeration that fails finds nothing this round; the next round tries again (3.5 too).
    win::visible_windows()
        .unwrap_or_default()
        .into_iter()
        .filter(|w| is_cs2(&win::image_name(w.pid, IMAGE_NAME_CHARS), &w.title, spec))
        .map(|w| w.hwnd)
        .collect()
}

/// Runs until `done`; returns when the CLI has ended or no CS2 window came in time.
pub fn watch(ports: &dyn Ports, spec: &WatchSpec, done: &AtomicBool) {
    let deadline = Instant::now() + spec.wait;
    let mut found = Vec::new();
    while Instant::now() < deadline {
        if done.load(Ordering::SeqCst) {
            return;
        }
        found = find(spec);
        if !found.is_empty() {
            ports.log("  🔙 CS2 found — keeping behind other windows.", Level::Dim);
            break;
        }
        std::thread::sleep(spec.poll);
    }
    if found.is_empty() {
        ports.log(&format!("  ⚠ cs2_send_to_back: CS2 window not found within {} s.", spec.wait.as_secs()), Level::Warn);
        return;
    }
    let mut refused = false;
    while !done.load(Ordering::SeqCst) {
        for hwnd in find(spec) {
            // A window closing between the list and the call refuses it; said once, not per round.
            if let Err(e) = win::send_to_back(hwnd) {
                if !refused {
                    refused = true;
                    ports.log(&format!("  ⚠ cs2_send_to_back: Windows refused to move a CS2 window ({e})."), Level::Warn);
                }
            }
        }
        std::thread::sleep(spec.poll);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cs2_is_found_by_program_name_then_by_title() {
        let spec = WatchSpec::default();
        assert!(is_cs2(r"c:\steam\game\bin\win64\cs2.exe", "", &spec));
        assert!(!is_cs2(r"c:\cs2 tools\notepad.exe", "cs2 notes", &spec), "the program name decides when it is known");
        assert!(is_cs2("", "Counter-Strike 2", &spec));
        assert!(!is_cs2("", "Notepad", &spec));
    }
}
