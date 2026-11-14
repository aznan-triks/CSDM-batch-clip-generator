//! Typed rows read from the parser output. Each field is one DataFrame column 3.5.x read from
//! demoparser2 (column name in the field doc when it differs). `None` = the column held no value.
//! A value of an unexpected type is an error, never a silent `None`: it means the parser changed.

use parser::parse_demo::DemoOutput;
use parser::second_pass::game_events::GameEvent;
use parser::second_pass::parser_settings::PlayerEndMetaData;
use parser::second_pass::variants::{VarVec, Variant};

/// One shot.
#[derive(Debug, Clone, PartialEq)]
pub struct WeaponFire {
    pub tick: i32,
    pub weapon: Option<String>,
    /// `user_player_steamid` (player prop); 3.5.x keyed shots on it.
    pub player_steamid: Option<u64>,
    /// `user_steamid` (event field); 3.5.x fell back to it when the column above was absent.
    pub user_steamid: Option<u64>,
    /// `user_accuracy_penalty`
    pub accuracy_penalty: Option<f32>,
    /// `user_is_scoped`
    pub is_scoped: Option<bool>,
    /// `user_velocity_X`
    pub velocity_x: Option<f32>,
    /// `user_velocity_Y`
    pub velocity_y: Option<f32>,
}

/// One kill. The view angles exist for the three players of the event: 3.5.x read the first column
/// whose name contains "yaw"/"pitch" in alphabetical order, which is the assister's (ticket 03 journal).
#[derive(Debug, Clone, PartialEq)]
pub struct PlayerDeath {
    pub tick: i32,
    pub attacker_steamid: Option<u64>,
    pub user_steamid: Option<u64>,
    pub weapon: Option<String>,
    pub headshot: Option<bool>,
    pub noscope: Option<bool>,
    pub thrusmoke: Option<bool>,
    pub attackerblind: Option<bool>,
    pub attackerinair: Option<bool>,
    pub penetrated: Option<i32>,
    pub attacker_pitch: Option<f32>,
    pub attacker_yaw: Option<f32>,
    pub user_pitch: Option<f32>,
    pub user_yaw: Option<f32>,
    pub assister_pitch: Option<f32>,
    pub assister_yaw: Option<f32>,
}

/// One damage event.
#[derive(Debug, Clone, PartialEq)]
pub struct PlayerHurt {
    pub tick: i32,
    pub attacker_steamid: Option<u64>,
    pub user_steamid: Option<u64>,
}

/// One player of the end-of-match list.
#[derive(Debug, Clone, PartialEq)]
pub struct PlayerInfo {
    pub steamid: Option<u64>,
    pub name: Option<String>,
    pub team_number: Option<i32>,
}

/// One player at one tick.
#[derive(Debug, Clone, PartialEq)]
pub struct PlayerTick {
    pub tick: i32,
    pub steamid: Option<u64>,
    pub name: Option<String>,
    pub x: Option<f32>,
    pub y: Option<f32>,
    pub z: Option<f32>,
    pub pitch: Option<f32>,
    pub yaw: Option<f32>,
    pub team_num: Option<u32>,
    pub health: Option<i32>,
}

/// Typed access to the fields of one game event.
struct Fields<'e>(&'e GameEvent);

impl<'e> Fields<'e> {
    fn get(&self, name: &str) -> Option<&'e Variant> {
        self.0.fields.iter().find(|f| f.name == name).and_then(|f| f.data.as_ref())
    }
    fn wrong(&self, name: &str, v: &Variant) -> String {
        format!("{} event: field {name} has an unexpected type: {v:?}", self.0.name)
    }
    fn f32(&self, name: &str) -> Result<Option<f32>, String> {
        match self.get(name) {
            None => Ok(None),
            Some(Variant::F32(v)) => Ok(Some(*v)),
            Some(v) => Err(self.wrong(name, v)),
        }
    }
    fn bool(&self, name: &str) -> Result<Option<bool>, String> {
        match self.get(name) {
            None => Ok(None),
            Some(Variant::Bool(v)) => Ok(Some(*v)),
            Some(v) => Err(self.wrong(name, v)),
        }
    }
    fn i32(&self, name: &str) -> Result<Option<i32>, String> {
        match self.get(name) {
            None => Ok(None),
            Some(Variant::I32(v)) => Ok(Some(*v)),
            Some(v) => Err(self.wrong(name, v)),
        }
    }
    fn string(&self, name: &str) -> Result<Option<String>, String> {
        match self.get(name) {
            None => Ok(None),
            Some(Variant::String(v)) => Ok(Some(v.clone())),
            Some(v) => Err(self.wrong(name, v)),
        }
    }
    /// SteamID64: a number for player props, its decimal text for event fields.
    fn steamid(&self, name: &str) -> Result<Option<u64>, String> {
        match self.get(name) {
            None => Ok(None),
            Some(Variant::U64(v)) => Ok(Some(*v)),
            Some(Variant::String(s)) => s.parse().map(Some).map_err(|_| self.wrong(name, &Variant::String(s.clone()))),
            Some(v) => Err(self.wrong(name, v)),
        }
    }
    /// Every event carries the tick it happened on as a field (`find_extra`).
    fn tick(&self) -> Result<i32, String> {
        self.i32("tick")?.ok_or_else(|| format!("{} event without a tick", self.0.name))
    }
}

impl WeaponFire {
    pub(crate) fn from_event(e: &GameEvent) -> Result<Self, String> {
        let f = Fields(e);
        Ok(WeaponFire {
            tick: f.tick()?,
            weapon: f.string("weapon")?,
            player_steamid: f.steamid("user_player_steamid")?,
            user_steamid: f.steamid("user_steamid")?,
            accuracy_penalty: f.f32("user_accuracy_penalty")?,
            is_scoped: f.bool("user_is_scoped")?,
            velocity_x: f.f32("user_velocity_X")?,
            velocity_y: f.f32("user_velocity_Y")?,
        })
    }
}

impl PlayerDeath {
    pub(crate) fn from_event(e: &GameEvent) -> Result<Self, String> {
        let f = Fields(e);
        Ok(PlayerDeath {
            tick: f.tick()?,
            attacker_steamid: f.steamid("attacker_steamid")?,
            user_steamid: f.steamid("user_steamid")?,
            weapon: f.string("weapon")?,
            headshot: f.bool("headshot")?,
            noscope: f.bool("noscope")?,
            thrusmoke: f.bool("thrusmoke")?,
            attackerblind: f.bool("attackerblind")?,
            attackerinair: f.bool("attackerinair")?,
            penetrated: f.i32("penetrated")?,
            attacker_pitch: f.f32("attacker_pitch")?,
            attacker_yaw: f.f32("attacker_yaw")?,
            user_pitch: f.f32("user_pitch")?,
            user_yaw: f.f32("user_yaw")?,
            assister_pitch: f.f32("assister_pitch")?,
            assister_yaw: f.f32("assister_yaw")?,
        })
    }
}

impl PlayerHurt {
    pub(crate) fn from_event(e: &GameEvent) -> Result<Self, String> {
        let f = Fields(e);
        Ok(PlayerHurt { tick: f.tick()?, attacker_steamid: f.steamid("attacker_steamid")?, user_steamid: f.steamid("user_steamid")? })
    }
}

impl PlayerInfo {
    pub(crate) fn from_metadata(p: &PlayerEndMetaData) -> Self {
        PlayerInfo { steamid: p.steamid, name: p.name.clone(), team_number: p.team_number }
    }
}

/// Rows of the per-tick table (`DemoOutput::df`, one column per prop, all the same length).
pub(crate) fn player_ticks(out: &DemoOutput) -> Result<Vec<PlayerTick>, String> {
    if out.df.is_empty() {
        return Ok(vec![]);
    }
    let column = |name: &str| {
        out.prop_controller
            .prop_infos
            .iter()
            .find(|p| p.prop_friendly_name == name)
            .and_then(|p| out.df.get(&p.id))
            .and_then(|c| c.data.as_ref())
    };
    let wrong = |name: &str| format!("tick table: column {name} has an unexpected type");
    let ticks = match column("tick") {
        Some(VarVec::I32(v)) => v,
        Some(_) => return Err(wrong("tick")),
        None => return Err("tick table without a tick column".into()),
    };
    let rows = ticks.len();
    let sized = |name: &str, len: usize| if len == rows { Ok(()) } else { Err(format!("tick table: column {name} has {len} rows, tick has {rows}")) };
    macro_rules! col {
        ($name:expr, $variant:ident) => {
            match column($name) {
                None => None,
                Some(VarVec::$variant(v)) => {
                    sized($name, v.len())?;
                    Some(v)
                }
                Some(_) => return Err(wrong($name)),
            }
        };
    }
    let steamid = col!("steamid", U64);
    let name = col!("name", String);
    let (x, y, z) = (col!("X", F32), col!("Y", F32), col!("Z", F32));
    let (pitch, yaw) = (col!("pitch", F32), col!("yaw", F32));
    let team_num = col!("team_num", U32);
    let health = col!("health", I32);
    (0..rows)
        .map(|i| {
            let tick = ticks[i].ok_or("tick table: row without a tick")?;
            let at = |c: Option<&Vec<Option<f32>>>| c.and_then(|c| c[i]);
            Ok(PlayerTick {
                tick,
                steamid: steamid.and_then(|c| c[i]),
                name: name.and_then(|c| c[i].clone()),
                x: at(x),
                y: at(y),
                z: at(z),
                pitch: at(pitch),
                yaw: at(yaw),
                team_num: team_num.and_then(|c| c[i]),
                health: health.and_then(|c| c[i]),
            })
        })
        .collect()
}
