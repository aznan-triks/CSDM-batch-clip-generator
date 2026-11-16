//! T4 « faux ffmpeg »: the assembly through the real runner and a fake FFmpeg found on PATH, in a
//! test binary of its own (it sets PATH for its whole process: no other test may run beside it).

#[path = "support/kit.rs"]
mod kit;

use csdm_engine::batch::assemble::assemble_clips;
use csdm_engine::preview::CollectPorts;
use csdm_engine::process::ProcessExec;
use csdm_engine::run::RunControl;
use kit::{cfg, Kit};
use serde_json::json;
use std::time::{Duration, SystemTime};

#[test]
fn fake_ffmpeg_on_path_assembles_and_only_this_runs_clips_go() {
    let kit = Kit::new(json!({"ffmpeg": {"lines": ["frame=1"], "write_last_arg": true}}));
    // Only the kit on PATH: the fake FFmpeg is the one found, never a real one.
    std::env::set_var("PATH", kit.dir.path());
    let clips = kit.path("clips");
    let old = clips.join("demo").join("old.mp4");
    std::fs::create_dir_all(old.parent().unwrap()).unwrap();
    std::fs::write(&old, b"x").unwrap();
    let since = SystemTime::now() - Duration::from_secs(1);
    std::fs::File::options().write(true).open(&old).unwrap().set_modified(since - Duration::from_secs(3600)).unwrap();
    let mine = clips.join("demo").join("sess").join("new.mp4");
    std::fs::create_dir_all(mine.parent().unwrap()).unwrap();
    std::fs::write(&mine, b"x").unwrap();

    let settings = cfg(json!({
        "output_dir_clips": clips, "delete_after_assemble": true, "video_container": "mp4",
        "assemble_output": "best #1", "cs2_send_to_back": false, "close_game_after": true
    }));
    let ports = CollectPorts::default();
    let control = RunControl::default();
    let machine = kit.machine();
    let mut exec = ProcessExec { ports: &ports, control: &control, machine: &machine };
    let produced = [mine.parent().unwrap().to_string_lossy().into_owned()];
    assemble_clips(&ports, &mut exec, &settings, &produced, since, kit.dir.path()).unwrap();

    let logs: Vec<String> = ports.logs.lock().unwrap().iter().map(|(m, _)| m.clone()).collect();
    assert!(clips.join("best #1.mp4").exists(), "{logs:?}");
    assert!(!mine.exists() && !mine.parent().unwrap().exists());
    assert!(old.exists(), "an earlier run's clip stays");
    assert!(logs.iter().any(|m| m == "  > frame=1"), "FFmpeg's output read through the pipe");
    assert_eq!(kit.pids().len(), 1);
    kit.assert_none_alive();
}
