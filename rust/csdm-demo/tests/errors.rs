//! How a demo that cannot be read is reported: a typed error with a clear message, never a crash.
//! Real CS2 demos are covered by the golden bench (examples/golden.rs), not here: they are user data.

use csdm_demo::{Demo, DemoError, PARSER_VERSION};
use std::path::PathBuf;

const RELEASES: &str = "https://example.invalid/releases";

/// A throwaway file holding `bytes`, removed when dropped.
struct TempDemo(PathBuf);
impl TempDemo {
    fn new(name: &str, bytes: &[u8]) -> Self {
        let path = std::env::temp_dir().join(format!("csdm-demo-test-{}-{name}", std::process::id()));
        std::fs::write(&path, bytes).unwrap();
        TempDemo(path)
    }
}
impl Drop for TempDemo {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[test]
fn a_missing_demo_is_reported_as_not_found() {
    let path = std::env::temp_dir().join("csdm-demo-test-does-not-exist.dem");
    let err = Demo::open(&path).err().expect("opening a missing file must fail");
    assert!(matches!(err, DemoError::NotFound { .. }), "{err:?}");
    let msg = err.user_message(RELEASES);
    assert!(msg.contains("csdm-demo-test-does-not-exist.dem") && msg.contains("not found"), "{msg}");
}

#[test]
fn a_csgo_demo_is_refused_with_a_clear_message() {
    // Source 1 demos start with this 8-byte magic; the rest does not matter.
    let demo = TempDemo::new("old.dem", b"HL2DEMO\0\x04\x00\x00\x00some old CS:GO content");
    let err = Demo::open(&demo.0).err().expect("a CS:GO demo must be refused");
    assert!(matches!(err, DemoError::Source1 { .. }), "{err:?}");
    let msg = err.user_message(RELEASES);
    assert!(msg.contains("CS:GO") && msg.contains("only CS2 demos"), "{msg}");
}

#[test]
fn an_unreadable_demo_tells_the_user_to_update_the_app() {
    let demo = TempDemo::new("garbage.dem", b"this is not a demo file at all, just text");
    let opened = Demo::open(&demo.0).expect("opening only maps the file");
    let err = opened.players().err().expect("reading garbage must fail");
    assert!(matches!(err, DemoError::Unreadable { .. }), "{err:?}");
    let msg = err.user_message(RELEASES);
    for part in ["garbage.dem", "could not be read", PARSER_VERSION, "newer version of the app", RELEASES] {
        assert!(msg.contains(part), "missing {part:?} in {msg}");
    }
    assert!(!PARSER_VERSION.is_empty() && !PARSER_VERSION.contains('\n'), "{PARSER_VERSION:?}");
}

/// The parser slices the 16-byte header without checking the length (first_pass/parser.rs,
/// `handle_short_header` call): a CS2 magic alone makes it panic. Every call must turn that into an error.
#[test]
fn a_parser_panic_becomes_an_error_on_every_call() {
    let demo = TempDemo::new("truncated.dem", b"PBDEMS2\0");
    let opened = Demo::open(&demo.0).expect("opening only maps the file");
    let errors = [
        opened.weapon_fires().err(),
        opened.player_deaths().err(),
        opened.player_hurts().err(),
        opened.players().err(),
        opened.player_ticks(&[100]).err(),
    ];
    for err in errors {
        let err = err.expect("a truncated demo must fail");
        assert!(matches!(err, DemoError::Panicked { .. }), "{err:?}");
        assert!(err.to_string().contains("range end index 16"), "panic text kept for the log: {err}");
        assert!(err.user_message(RELEASES).contains("could not be read"), "{}", err.user_message(RELEASES));
    }
}
