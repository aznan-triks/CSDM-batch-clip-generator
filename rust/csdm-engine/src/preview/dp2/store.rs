//! Demo sections: the store kept across previews (one entry per demo file and section) and one
//! preview's view of it, which is 3.5's `_dp2_cache` as a first preview after connecting sees it
//! (T3 Conception). The readers turn `csdm_demo` rows into the dicts 3.5 built from the
//! demoparser2 frames, with the text forms pandas gave each id column.

use super::Stage;
use crate::event::Level;
use csdm_core::preview::dp2::DP2_WEAPON_PREFIX;
use csdm_core::preview::RELEASES_URL;
use csdm_core::settings::def;
use csdm_demo::{Demo, DemoError, PlayerDeath, PlayerHurt, PlayerInfo, WeaponFire};
use indexmap::IndexMap;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::SystemTime;

/// Setting that caps the demos the store keeps beyond the current query.
pub(super) const CACHE_CAP_KEY: &str = "dp2_cache_max_demos";
/// Python's float repr switches to the exponent form from here (`7.6e+16`).
const PY_EXPONENT_FROM: f64 = 1e16;

/// A part of a demo 3.5 parsed on its own, in 3.5's parse order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Section {
    Fire,
    Death,
    Hurt,
    Names,
    Positions,
}

impl Section {
    pub fn name(self) -> &'static str {
        match self {
            Section::Fire => "fire",
            Section::Death => "death",
            Section::Hurt => "hurt",
            Section::Names => "names",
            Section::Positions => "positions",
        }
    }
}

pub type Sections = BTreeSet<Section>;

/// What a filter reads when the pre-parse did not read its demo (3.5 `_dp2_parse_demo` default).
pub fn default_sections() -> Sections {
    [Section::Fire, Section::Death, Section::Hurt, Section::Names].into()
}

/// One shot of 3.5 `fire_detail`: tick, accuracy penalty, scoped, horizontal speed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shot {
    pub tick: i64,
    pub acc: f64,
    pub scoped: bool,
    pub vel: f64,
}

/// (shooter id, weapon without `weapon_`): 3.5's key of `fire_detail` and `fire_ticks`.
pub type ShotKey = (String, String);

/// Section "fire": `fire_detail` (groups in first-shot order, which decides ties) and `fire_ticks`.
#[derive(Debug, Default)]
pub struct Fire {
    pub detail: IndexMap<ShotKey, Vec<Shot>>,
    pub ticks: HashMap<ShotKey, Vec<i64>>,
}

/// The `player_death` flags 3.5 kept for one (tick, attacker); `None` = no value in the frame.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct DeathFlags {
    pub noscope: Option<bool>,
    pub thrusmoke: Option<bool>,
    pub attackerblind: Option<bool>,
    pub penetrated: Option<i64>,
    pub attackerinair: Option<bool>,
}

/// Section "death": `view_angles` (attacker → (tick, yaw, pitch), by tick) and `death_flags`.
#[derive(Debug, Default)]
pub struct Death {
    pub view_angles: HashMap<String, Vec<(i64, f64, f64)>>,
    pub flags: HashMap<(i64, String), DeathFlags>,
}

/// Section "hurt": victim → (tick, attacker), by tick.
pub type Hurt = HashMap<String, Vec<(i64, String)>>;
/// Section "names": SteamID → in-demo player name.
pub type Names = HashMap<String, String>;

/// One player at one tick, for Mate POV (3.5 `mate_positions[tick][sid]`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MatePlayer {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub yaw: f64,
    pub pitch: f64,
    pub team: i64,
    pub health: i64,
}

/// Tick → players in frame order (3.5 dict order, which decides ties).
pub type MatePositions = HashMap<i64, IndexMap<String, MatePlayer>>;

/// One section of one demo file: its data, or the sentence saying why it could not be read.
#[derive(Debug, Clone)]
pub(super) enum Got {
    Fire(Arc<Fire>),
    Death(Arc<Death>),
    Hurt(Arc<Hurt>),
    Names(Arc<Names>),
    Failed(String),
}

/// A demo file as it is now: a replaced file (other size or date) is read again.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct FileKey {
    path: String,
    size: u64,
    modified: Option<SystemTime>,
}

#[derive(Debug, Default)]
struct StoreInner {
    /// File → its sections, oldest file first (3.5 `_dp2_cache_order`).
    files: IndexMap<FileKey, HashMap<Section, Got>>,
    /// Demos of the current query, never evicted (3.5 `_dp2_cache_pinned`).
    pinned: HashSet<String>,
    /// `dp2_cache_max_demos` of the last pin; `None` before any pin (the table default then).
    cap: Option<usize>,
}

/// Parsed demo sections, kept across previews (keyed by path, size, modification time, section).
/// Shared by the engine's threads. A preview sees only the sections it asked for (T3 Conception).
#[derive(Debug, Default)]
pub struct DemoStore {
    inner: Mutex<StoreInner>,
}

impl DemoStore {
    fn lock(&self) -> MutexGuard<'_, StoreInner> {
        self.inner.lock().expect("demo store lock")
    }

    /// 3.5 `_dp2_cache_pin`: the demos of the current query are never evicted; `cap` (≥ 1) bounds
    /// what earlier queries leave behind.
    pub fn pin(&self, demo_paths: &[String], cap: usize) {
        let mut g = self.lock();
        g.pinned = demo_paths.iter().cloned().collect();
        g.cap = Some(cap.max(1));
    }

    /// Demo files held.
    pub fn len(&self) -> usize {
        self.lock().files.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn get(&self, key: &FileKey, s: Section) -> Option<Got> {
        self.lock().files.get(key).and_then(|m| m.get(&s)).cloned()
    }

    /// 3.5 `_dp2_cache_put_locked`: store, then evict the oldest unpinned demos beyond the cap.
    fn put(&self, key: FileKey, s: Section, got: Got) {
        let mut g = self.lock();
        if !g.files.contains_key(&key) {
            // The same path under another size or date is a replaced file: its sections are stale.
            g.files.retain(|k, _| k.path != key.path);
        }
        g.files.entry(key).or_default().insert(s, got);
        let cap = g.cap.unwrap_or_else(|| {
            let default = def(CACHE_CAP_KEY).and_then(|d| d.default.as_u64()).expect("dp2_cache_max_demos is an integer setting");
            usize::try_from(default).unwrap_or(usize::MAX).max(1)
        });
        let mut excess = g.files.len().saturating_sub(cap);
        if excess == 0 {
            return;
        }
        let pinned = std::mem::take(&mut g.pinned);
        g.files.retain(|k, _| {
            let evict = excess > 0 && !pinned.contains(&k.path);
            excess -= usize::from(evict);
            !evict
        });
        g.pinned = pinned;
    }
}

/// One entry of the view: the sections this preview asked for, and what they hold.
#[derive(Debug, Default)]
pub(super) struct Entry {
    pub(super) sections: Sections,
    pub(super) fire: Option<Arc<Fire>>,
    pub(super) death: Option<Arc<Death>>,
    pub(super) hurt: Option<Arc<Hurt>>,
    pub(super) names: Option<Arc<Names>>,
    pub(super) mate: Option<MatePositions>,
}

/// What this stage keeps for the length of one preview: 3.5 `_dp2_cache` (demo → sections read,
/// their data, Mate POV positions). A section that failed or was never read reads as empty.
#[derive(Debug, Default)]
pub struct Cache {
    pub(super) demos: HashMap<String, Entry>,
}

impl Cache {
    /// `demo_path in self._dp2_cache`.
    pub fn contains(&self, demo_path: &str) -> bool {
        self.demos.contains_key(demo_path)
    }

    /// `_dp2_cache[demo_path]["_sections"]`.
    pub fn sections(&self, demo_path: &str) -> Sections {
        self.demos.get(demo_path).map(|e| e.sections.clone()).unwrap_or_default()
    }

    pub fn fire(&self, demo_path: &str) -> Option<Arc<Fire>> {
        self.demos.get(demo_path).and_then(|e| e.fire.clone())
    }

    pub fn death(&self, demo_path: &str) -> Option<Arc<Death>> {
        self.demos.get(demo_path).and_then(|e| e.death.clone())
    }

    pub fn hurt(&self, demo_path: &str) -> Option<Arc<Hurt>> {
        self.demos.get(demo_path).and_then(|e| e.hurt.clone())
    }

    /// In-demo player names (3.5 `_dp2_cache[dp]["demo_names"]`), read by the camera segments and
    /// the clip JSON before the database names.
    pub fn demo_names(&self, demo_path: &str) -> Option<&Names> {
        self.demos.get(demo_path).and_then(|e| e.names.as_deref())
    }

    pub(super) fn mate_positions(&self, demo_path: &str) -> Option<&MatePositions> {
        self.demos.get(demo_path).and_then(|e| e.mate.as_ref())
    }

    pub(super) fn set_mate_positions(&mut self, demo_path: &str, positions: MatePositions) {
        self.demos.entry(demo_path.to_string()).or_default().mate = Some(positions);
    }
}

/// What reading some sections of one demo gave.
#[derive(Debug)]
pub(super) enum Outcome {
    /// Not a file: marked read with no data, nothing logged.
    Absent,
    /// Cannot be opened (CS:GO demo, file locked or gone): marked read with no data, the line logged.
    Unopened(String),
    /// Each asked section, read or failed.
    Read(Vec<(Section, Got)>),
}

/// Reads `needed` sections of `path`, through the store (3.5 `_dp2_parse_demo` up to its merge).
/// Thread-safe: touches only the store.
pub(super) fn read(store: &DemoStore, path: &str, needed: &Sections) -> Outcome {
    let p = Path::new(path);
    if !p.is_file() {
        return Outcome::Absent;
    }
    let meta = match std::fs::metadata(p) {
        Ok(m) => m,
        Err(e) => return Outcome::Unopened(DemoError::NotFound { path: p.into(), detail: e.to_string() }.user_message(RELEASES_URL)),
    };
    let key = FileKey { path: path.to_string(), size: meta.len(), modified: meta.modified().ok() };
    let mut got = Vec::new();
    let mut demo: Option<Demo> = None;
    for &s in needed {
        // "positions": CS2 demos carry no player_positions event (T2), so 3.5 always got nothing.
        let Some(reader) = reader(s) else { continue };
        if let Some(g) = store.get(&key, s) {
            got.push((s, g));
            continue;
        }
        let d = match &demo {
            Some(d) => d,
            None => match Demo::open(p) {
                Ok(d) => demo.insert(d),
                Err(e) => return Outcome::Unopened(e.user_message(RELEASES_URL)),
            },
        };
        let g = reader(d);
        store.put(key.clone(), s, g.clone());
        got.push((s, g));
    }
    Outcome::Read(got)
}

fn failed(e: DemoError) -> Got {
    Got::Failed(e.user_message(RELEASES_URL))
}

fn reader(s: Section) -> Option<fn(&Demo) -> Got> {
    match s {
        Section::Fire => Some(|d| d.weapon_fires().map_or_else(failed, |r| Got::Fire(Arc::new(fire_of(&r))))),
        Section::Death => Some(|d| d.player_deaths().map_or_else(failed, |r| Got::Death(Arc::new(death_of(&r))))),
        Section::Hurt => Some(|d| d.player_hurts().map_or_else(failed, |r| Got::Hurt(Arc::new(hurt_of(&r))))),
        Section::Names => Some(|d| d.players().map_or_else(failed, |r| names_of(&r, d.path()).map_or_else(Got::Failed, |n| Got::Names(Arc::new(n))))),
        Section::Positions => None,
    }
}

/// Puts what `read` gave into the view (3.5 `_dp2_parse_demo` merge, `_dp2_mark_unreadable`).
pub(super) fn apply(st: &mut Stage, path: &str, required: &Sections, outcome: Outcome) {
    let got = match outcome {
        Outcome::Absent => Vec::new(),
        Outcome::Unopened(message) => {
            st.log(&format!("  ⚠ {message}"), Level::Warn);
            Vec::new()
        }
        Outcome::Read(got) => got,
    };
    let entry = st.cache.demos.entry(path.to_string()).or_default();
    let mut failures = Vec::new();
    for (s, g) in got {
        match g {
            Got::Fire(f) => entry.fire = Some(f),
            Got::Death(d) => entry.death = Some(d),
            Got::Hurt(h) => entry.hurt = Some(h),
            Got::Names(n) => entry.names = Some(n),
            Got::Failed(message) => {
                // 3.5 emptied a failed section, except the names, which it only ever added to.
                match s {
                    Section::Fire => entry.fire = None,
                    Section::Death => entry.death = None,
                    Section::Hurt => entry.hurt = None,
                    Section::Names | Section::Positions => {}
                }
                failures.push((s, message));
            }
        }
    }
    entry.sections.extend(required.iter().copied());
    if let Some((_, first)) = failures.first() {
        let names: Vec<&str> = failures.iter().map(|(s, _)| s.name()).collect();
        st.log(&format!("  ⚠ {first} [{}]", names.join(", ")), Level::Warn);
    }
}

/// 3.5 `_dp2_parse_demo(demo_path, required_sections)`: reads what this preview has not read yet.
pub(super) fn parse_demo(st: &mut Stage, path: &str, required: &Sections) {
    let needed: Sections = required.difference(&st.cache.sections(path)).copied().collect();
    if needed.is_empty() {
        return;
    }
    let outcome = read(st.demos, path, &needed);
    apply(st, path, required, outcome);
}

/// pandas `fillna(0)` on a real column: no value and NaN both read 0.
fn filled(v: Option<f32>) -> f64 {
    v.filter(|f| !f.is_nan()).map_or(0.0, f64::from)
}

/// Python `str()` of an integral float: an id pandas carried as float64 (`7.656119805037565e+16`).
fn py_float_text(f: f64) -> String {
    if f.abs() < PY_EXPONENT_FROM {
        format!("{f:.1}")
    } else {
        format!("{f:e}").replacen('e', "e+", 1)
    }
}

/// Section "fire" (3.5 `weapon_fire` frame, correction (c): the shooter is the event's
/// `user_steamid`, else the `user_player_steamid` prop).
fn fire_of(rows: &[WeaponFire]) -> Fire {
    // A prop column with a gap is float64 in pandas, so its ids print as Python floats.
    let prop_gaps = rows.iter().any(|r| r.player_steamid.is_none());
    let mut shots: Vec<(ShotKey, Shot)> = rows
        .iter()
        .map(|r| {
            let weapon = r.weapon.as_deref().unwrap_or("").to_lowercase();
            let weapon = weapon.strip_prefix(DP2_WEAPON_PREFIX).unwrap_or(&weapon).to_string();
            let sid = match (r.user_steamid, r.player_steamid) {
                (Some(u), _) => u.to_string(),
                (None, Some(p)) if prop_gaps => py_float_text(p as f64),
                (None, Some(p)) => p.to_string(),
                (None, None) => String::new(),
            };
            let (vx, vy) = (filled(r.velocity_x), filled(r.velocity_y));
            let shot = Shot { tick: i64::from(r.tick), acc: filled(r.accuracy_penalty), scoped: r.is_scoped.unwrap_or(false), vel: (vx * vx + vy * vy).sqrt() };
            ((sid, weapon), shot)
        })
        .collect();
    // shortcut: pandas sorted with an unstable quicksort; two shots of one player and weapon on one tick never occur.
    shots.sort_by_key(|(_, s)| s.tick);
    let mut fire = Fire::default();
    for (key, shot) in shots {
        fire.ticks.entry(key.clone()).or_default().push(shot.tick);
        fire.detail.entry(key).or_default().push(shot);
    }
    fire
}

/// Section "death" (3.5 `player_death` frame, correction (b): the attacker's own view angles).
fn death_of(rows: &[PlayerDeath]) -> Death {
    let mut d = Death::default();
    for r in rows {
        // 3.5 skipped a death without attacker, or keyed it "nan" (all-empty column), which no kill matches.
        let Some(attacker) = r.attacker_steamid else { continue };
        let sid = attacker.to_string();
        let t = i64::from(r.tick);
        // `float(v or 0)`: a missing angle is NaN, and NaN is truthy, so it stays NaN.
        let angle = |v: Option<f32>| v.map_or(f64::NAN, f64::from);
        d.view_angles.entry(sid.clone()).or_default().push((t, angle(r.attacker_yaw), angle(r.attacker_pitch)));
        let flags = DeathFlags {
            noscope: r.noscope,
            thrusmoke: r.thrusmoke,
            attackerblind: r.attackerblind,
            penetrated: r.penetrated.map(i64::from),
            attackerinair: r.attackerinair,
        };
        if flags != DeathFlags::default() {
            d.flags.insert((t, sid), flags);
        }
    }
    for angles in d.view_angles.values_mut() {
        angles.sort_by_key(|a| a.0);
    }
    d
}

/// Section "hurt" (3.5 `player_hurt` frame): rows with both ids, by tick, grouped by victim.
fn hurt_of(rows: &[PlayerHurt]) -> Hurt {
    let mut kept: Vec<(i64, String, String)> =
        rows.iter().filter_map(|r| Some((i64::from(r.tick), r.attacker_steamid?.to_string(), r.user_steamid?.to_string()))).collect();
    kept.sort_by_key(|r| r.0);
    let mut hurt = Hurt::new();
    for (t, attacker, victim) in kept {
        hurt.entry(victim).or_default().push((t, attacker));
    }
    hurt
}

/// Section "names" (3.5 `parse_player_info` frame).
fn names_of(rows: &[PlayerInfo], path: &Path) -> Result<Names, String> {
    // 3.5's `fillna("")` fails on the pyarrow id column as soon as one player has no id: no names.
    if rows.iter().any(|r| r.steamid.is_none()) {
        let name = path.file_name().map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned());
        return Err(format!("Demo {name}: a player has no SteamID, so the in-demo player names are not used."));
    }
    Ok(rows
        .iter()
        .filter_map(|r| {
            let name = r.name.clone().unwrap_or_default();
            (!name.is_empty()).then(|| (r.steamid.map(|s| s.to_string()).unwrap_or_default(), name))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fire_row(tick: i32, weapon: &str, user: Option<u64>, prop: Option<u64>) -> WeaponFire {
        WeaponFire {
            tick,
            weapon: Some(weapon.into()),
            player_steamid: prop,
            user_steamid: user,
            accuracy_penalty: Some(0.25),
            is_scoped: None,
            velocity_x: Some(3.0),
            velocity_y: Some(f32::NAN),
        }
    }

    #[test]
    fn shots_are_keyed_on_the_event_shooter_then_the_prop_with_its_pandas_text() {
        let rows = [fire_row(20, "weapon_AK47", Some(7), Some(8)), fire_row(10, "weapon_deagle", None, Some(76561198050375650)), fire_row(15, "weapon_ak47", Some(7), None)];
        let fire = fire_of(&rows);
        // The prop column has a gap (third row): pandas made it float64 (fact seen on 2026-11-14).
        let keys: Vec<&ShotKey> = fire.detail.keys().collect();
        assert_eq!(keys, [&("7.656119805037565e+16".to_string(), "deagle".to_string()), &("7".to_string(), "ak47".to_string())]);
        assert_eq!(fire.ticks[&("7".to_string(), "ak47".to_string())], [15, 20]);
        let shot = fire.detail[&("7".to_string(), "ak47".to_string())][0];
        assert_eq!((shot.acc, shot.scoped, shot.vel), (0.25, false, 3.0));
        let whole = fire_of(&[fire_row(1, "weapon_awp", None, Some(76561198050375650))]);
        assert!(whole.detail.contains_key(&("76561198050375650".to_string(), "awp".to_string())));
        assert_eq!(fire_of(&[fire_row(1, "weapon_awp", None, None)]).detail.keys().next().unwrap().0, "");
    }

    #[test]
    fn deaths_keep_the_attacker_angles_and_the_flags_that_have_a_value() {
        let row = |tick, attacker, yaw, inair| PlayerDeath {
            tick,
            attacker_steamid: attacker,
            user_steamid: Some(9),
            weapon: None,
            headshot: None,
            noscope: None,
            thrusmoke: None,
            attackerblind: None,
            attackerinair: inair,
            penetrated: None,
            attacker_pitch: None,
            attacker_yaw: yaw,
            user_pitch: Some(1.0),
            user_yaw: Some(2.0),
            assister_pitch: Some(3.0),
            assister_yaw: Some(4.0),
        };
        let d = death_of(&[row(50, Some(5), Some(90.0), Some(true)), row(10, Some(5), None, None), row(30, None, Some(1.0), Some(true))]);
        let angles = &d.view_angles["5"];
        assert_eq!(angles.iter().map(|a| a.0).collect::<Vec<_>>(), [10, 50]);
        assert!(angles[0].1.is_nan() && angles[0].2.is_nan());
        assert_eq!(angles[1].1, 90.0);
        assert_eq!(d.flags.len(), 1);
        assert_eq!(d.flags[&(50, "5".to_string())].attackerinair, Some(true));
    }

    #[test]
    fn hurts_need_both_ids_and_names_need_every_id() {
        let h = hurt_of(&[
            PlayerHurt { tick: 9, attacker_steamid: Some(1), user_steamid: Some(2) },
            PlayerHurt { tick: 3, attacker_steamid: Some(4), user_steamid: Some(2) },
            PlayerHurt { tick: 5, attacker_steamid: None, user_steamid: Some(2) },
        ]);
        assert_eq!(h["2"], [(3, "4".to_string()), (9, "1".to_string())]);
        let p = |steamid, name: &str| PlayerInfo { steamid, name: Some(name.into()), team_number: None };
        let names = names_of(&[p(Some(1), "a"), p(Some(2), "")], Path::new("x.dem")).unwrap();
        assert_eq!(names.len(), 1);
        assert_eq!(names["1"], "a");
        assert!(names_of(&[p(Some(1), "a"), p(None, "b")], Path::new("x.dem")).is_err());
    }

    #[test]
    fn the_store_evicts_the_oldest_unpinned_demo_and_replaced_files() {
        let store = DemoStore::default();
        let key = |p: &str, size| FileKey { path: p.into(), size, modified: None };
        store.pin(&["b".to_string()], 2);
        store.put(key("a", 1), Section::Fire, Got::Failed(String::new()));
        store.put(key("b", 1), Section::Fire, Got::Failed(String::new()));
        store.put(key("c", 1), Section::Fire, Got::Failed(String::new()));
        assert!(store.get(&key("a", 1), Section::Fire).is_none());
        assert_eq!(store.len(), 2);
        store.put(key("c", 2), Section::Hurt, Got::Failed(String::new()));
        assert!(store.get(&key("c", 1), Section::Fire).is_none());
        assert!(store.get(&key("c", 2), Section::Hurt).is_some());
    }
}
