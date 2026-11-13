//! Demo reading: the vendored demoparser core (rust/vendor) behind the five calls the engine makes.
//!
//! Each call reproduces, setting for setting, what demoparser2's Python binding does at the vendored tag
//! (`src/python/src/lib.rs`), so results match 3.5.x (golden bench: examples/golden.rs). Each call runs
//! the whole file through the parser again, like 3.5.x did; a call never panics, never stops the app:
//! a parser error or panic comes back as a [`DemoError`] and the caller moves on to the next demo.

mod error;
mod rows;

pub use error::DemoError;
pub use rows::{PlayerDeath, PlayerHurt, PlayerInfo, PlayerTick, WeaponFire};

use ahash::AHashMap;
use memmap2::Mmap;
use parser::first_pass::parser_settings::{create_mmap, rm_user_friendly_names, ParserInputs};
use parser::parse_demo::{DemoOutput, Parser, ParsingMode};
use parser::second_pass::parser_settings::create_huffman_lookup_table;
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Tag of the vendored parser, shown in error messages (written by rust/tools/update-parser.ps1).
pub const PARSER_VERSION: &str = include_str!("../../vendor/PARSER_TAG");

/// Player props asked for on `weapon_fire` (3.5.x section "fire").
const FIRE_PLAYER_PROPS: &[&str] = &["is_scoped", "velocity_X", "velocity_Y", "accuracy_penalty", "player_steamid"];
/// Props asked for on `player_death` (3.5.x section "death"). The "other" names are not props of the
/// game; the parser passes them through unchanged. Kept so the parse is the exact same as 3.5.x.
const DEATH_PLAYER_PROPS: &[&str] = &["pitch", "yaw"];
const DEATH_OTHER_PROPS: &[&str] =
    &["attacker_steamid", "noscope", "thrusmoke", "attackerblind", "penetrated", "attackerinair"];
/// Props asked for on `player_hurt` (3.5.x section "hurt"), same remark.
const HURT_OTHER_PROPS: &[&str] = &["attacker_steamid", "userid_steamid"];
/// Props read at chosen ticks for Mate POV (3.5.x `_parse_mate_positions`).
const TICK_PROPS: &[&str] = &["X", "Y", "Z", "pitch", "yaw", "team_num", "health"];

/// Built once: the same table for every demo.
fn huffman() -> &'static Vec<(u8, u8)> {
    static TABLE: OnceLock<Vec<(u8, u8)>> = OnceLock::new();
    TABLE.get_or_init(create_huffman_lookup_table)
}

/// What one parse asks for; everything else is the binding's fixed setting.
struct Wanted<'s> {
    events: &'s [&'s str],
    player_props: &'s [&'s str],
    other_props: &'s [&'s str],
    ticks: &'s [i32],
    parse_ents: bool,
}

/// A demo file opened for reading (memory-mapped, never written).
pub struct Demo {
    path: PathBuf,
    mmap: Mmap,
}

impl Demo {
    /// Opens a demo. Fails on a missing file and on a CS:GO (Source 1) demo; anything else is only
    /// found out by the calls, since telling a valid CS2 demo apart needs a full parse.
    pub fn open(path: &Path) -> Result<Demo, DemoError> {
        let not_found = |e: std::io::Error| DemoError::NotFound { path: path.to_path_buf(), detail: e.to_string() };
        let mut magic = Vec::new();
        std::fs::File::open(path).map_err(not_found)?.take(8).read_to_end(&mut magic).map_err(not_found)?;
        // Format invariant: CS:GO demos start with HL2DEMO, CS2 demos with PBDEMS2.
        if magic.starts_with(b"HL2DEMO") {
            return Err(DemoError::Source1 { path: path.to_path_buf() });
        }
        let mmap = create_mmap(path.to_string_lossy().into_owned())
            .map_err(|e| DemoError::NotFound { path: path.to_path_buf(), detail: e.to_string() })?;
        Ok(Demo { path: path.to_path_buf(), mmap })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Every `weapon_fire` event (Python: `parse_event("weapon_fire", player=[...])`).
    pub fn weapon_fires(&self) -> Result<Vec<WeaponFire>, DemoError> {
        let wanted = Wanted { events: &["weapon_fire"], player_props: FIRE_PLAYER_PROPS, other_props: &[], ticks: &[], parse_ents: true };
        self.call("weapon_fire", &wanted, |out| out.game_events.iter().map(WeaponFire::from_event).collect())
    }

    /// Every `player_death` event.
    pub fn player_deaths(&self) -> Result<Vec<PlayerDeath>, DemoError> {
        let wanted = Wanted {
            events: &["player_death"],
            player_props: DEATH_PLAYER_PROPS,
            other_props: DEATH_OTHER_PROPS,
            ticks: &[],
            parse_ents: true,
        };
        self.call("player_death", &wanted, |out| out.game_events.iter().map(PlayerDeath::from_event).collect())
    }

    /// Every `player_hurt` event.
    pub fn player_hurts(&self) -> Result<Vec<PlayerHurt>, DemoError> {
        let wanted =
            Wanted { events: &["player_hurt"], player_props: &[], other_props: HURT_OTHER_PROPS, ticks: &[], parse_ents: true };
        self.call("player_hurt", &wanted, |out| out.game_events.iter().map(PlayerHurt::from_event).collect())
    }

    /// End-of-match player list (Python: `parse_player_info()`, header only, no entities).
    pub fn players(&self) -> Result<Vec<PlayerInfo>, DemoError> {
        let wanted = Wanted { events: &[], player_props: &[], other_props: &[], ticks: &[], parse_ents: false };
        self.call("players", &wanted, |out| Ok(out.player_md.iter().map(PlayerInfo::from_metadata).collect()))
    }

    /// Position, view angles, team and health of every player at the given ticks
    /// (Python: `parse_ticks(["X","Y","Z","pitch","yaw","team_num","health"], ticks=...)`).
    pub fn player_ticks(&self, ticks: &[i32]) -> Result<Vec<PlayerTick>, DemoError> {
        let wanted = Wanted { events: &[], player_props: TICK_PROPS, other_props: &[], ticks, parse_ents: true };
        self.call("player_ticks", &wanted, rows::player_ticks)
    }

    /// One parse with the binding's settings, then `read` on the output; a parser error, a panic or an
    /// output this crate does not understand all become [`DemoError`] (`call` names the call in the log).
    fn call<T>(
        &self,
        call: &'static str,
        wanted: &Wanted,
        read: impl FnOnce(&DemoOutput) -> Result<Vec<T>, String>,
    ) -> Result<Vec<T>, DemoError> {
        let path = &self.path;
        let run = || -> Result<Vec<T>, String> {
            let output = self.parse(wanted).map_err(|e| e.to_string())?;
            read(&output)
        };
        guarded(run).map_err(|failure| match failure {
            Failure::Error(detail) => DemoError::Unreadable { path: path.clone(), call, detail },
            Failure::Panic(detail) => DemoError::Panicked { path: path.clone(), call, detail },
        })
    }

    fn parse(&self, wanted: &Wanted) -> Result<DemoOutput, parser::first_pass::read_bits::DemoParserError> {
        let owned = |names: &[&str]| names.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let (player, other) = (owned(wanted.player_props), owned(wanted.other_props));
        let real_player = rm_user_friendly_names(&player)?;
        let real_other = rm_user_friendly_names(&other)?;
        let mut real_name_to_og_name = AHashMap::default();
        for (real, friendly) in real_player.iter().zip(&player).chain(real_other.iter().zip(&other)) {
            real_name_to_og_name.insert(real.clone(), friendly.clone());
        }
        let inputs = ParserInputs {
            real_name_to_og_name,
            wanted_players: vec![],
            wanted_player_props: real_player,
            wanted_other_props: real_other,
            wanted_prop_states: AHashMap::default(),
            wanted_ticks: wanted.ticks.to_vec(),
            wanted_events: owned(wanted.events),
            parse_ents: wanted.parse_ents,
            parse_projectiles: false,
            parse_grenades: false,
            parse_weapons: false,
            only_header: true,
            only_convars: false,
            huffman_lookup_table: huffman(),
            order_by_steamid: false,
            list_props: false,
            fallback_bytes: None,
        };
        Parser::new(inputs, ParsingMode::Normal).parse_demo(&self.mmap)
    }
}

enum Failure {
    Error(String),
    Panic(String),
}

/// Runs `f`, turning a panic (on this thread or a parser worker thread) into [`Failure::Panic`].
fn guarded<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, Failure> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(Failure::Error),
        Err(payload) => Err(Failure::Panic(
            payload
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic without a message".to_string()),
        )),
    }
}
