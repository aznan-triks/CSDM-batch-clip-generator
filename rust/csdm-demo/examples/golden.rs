//! Golden bench: the five csdm-demo calls against demoparser2 (Python) on real demos (read only).
//!
//! References come from rust/tools/dp2_reference.py (same calls as 3.5.x, rows in event order).
//! Usage: golden <demos.txt> <reference dir>
//! Prints every demo and every call; exits 1 when a value differs for a reason not listed in
//! `expected_deviation`. Reals are compared after the round trip f32 -> JSON -> f32, bit for bit.

use csdm_demo::{Demo, DemoError, PlayerDeath, PlayerHurt, PlayerInfo, PlayerTick, WeaponFire};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

/// Same column order as COLUMNS in dp2_reference.py.
fn fire_row(r: &WeaponFire) -> Vec<Value> {
    vec![json!(r.tick), json!(r.weapon), sid(r.player_steamid), sid(r.user_steamid), real(r.accuracy_penalty),
         json!(r.is_scoped), real(r.velocity_x), real(r.velocity_y)]
}
fn death_row(r: &PlayerDeath) -> Vec<Value> {
    vec![json!(r.tick), sid(r.attacker_steamid), sid(r.user_steamid), json!(r.weapon), json!(r.headshot),
         json!(r.noscope), json!(r.thrusmoke), json!(r.attackerblind), json!(r.attackerinair), json!(r.penetrated),
         real(r.attacker_pitch), real(r.attacker_yaw), real(r.user_pitch), real(r.user_yaw),
         real(r.assister_pitch), real(r.assister_yaw)]
}
fn hurt_row(r: &PlayerHurt) -> Vec<Value> {
    vec![json!(r.tick), sid(r.attacker_steamid), sid(r.user_steamid)]
}
fn player_row(r: &PlayerInfo) -> Vec<Value> {
    vec![sid(r.steamid), json!(r.name), json!(r.team_number)]
}
fn tick_row(r: &PlayerTick) -> Vec<Value> {
    vec![json!(r.tick), sid(r.steamid), json!(r.name), real(r.x), real(r.y), real(r.z), real(r.pitch), real(r.yaw),
         json!(r.team_num), json!(r.health)]
}
fn sid(v: Option<u64>) -> Value {
    v.map_or(Value::Null, |s| json!(s.to_string()))
}
/// NaN is "no value" on the Python side (pandas).
fn real(v: Option<f32>) -> Value {
    v.filter(|f| !f.is_nan()).map_or(Value::Null, |f| json!(f as f64))
}

const COLUMNS: &[(&str, &[&str])] = &[
    ("weapon_fire", &["tick", "weapon", "user_player_steamid", "user_steamid", "user_accuracy_penalty", "user_is_scoped", "user_velocity_X", "user_velocity_Y"]),
    ("player_death", &["tick", "attacker_steamid", "user_steamid", "weapon", "headshot", "noscope", "thrusmoke", "attackerblind", "attackerinair", "penetrated", "attacker_pitch", "attacker_yaw", "user_pitch", "user_yaw", "assister_pitch", "assister_yaw"]),
    ("player_hurt", &["tick", "attacker_steamid", "user_steamid"]),
    ("players", &["steamid", "name", "team_number"]),
    ("player_ticks", &["tick", "steamid", "name", "X", "Y", "Z", "pitch", "yaw", "team_num", "health"]),
];
const REALS: &[&str] = &["user_accuracy_penalty", "user_velocity_X", "user_velocity_Y", "attacker_pitch", "attacker_yaw", "user_pitch", "user_yaw", "assister_pitch", "assister_yaw", "X", "Y", "Z", "pitch", "yaw"];

fn same(column: &str, py: &Value, rs: &Value) -> bool {
    if REALS.contains(&column) {
        return match (py.as_f64(), rs.as_f64()) {
            (Some(p), Some(r)) => (p as f32).to_bits() == (r as f32).to_bits(),
            _ => py.is_null() && rs.is_null(),
        };
    }
    py == rs
}

/// Differences known in advance, each with its reason. None = unexpected.
/// (The "SteamID as float" case foreseen in research/02 §5 did not show up: on the two demos where the
/// fire column is float64 it holds no value at all, on both sides, so the rows compare equal.)
fn expected_deviation(_column: &str, py: &Value, rs: &Value) -> Option<&'static str> {
    // pandas stores an integer column that has missing values as float64: 100 becomes 100.0.
    if py.is_f64() && (rs.is_i64() || rs.is_u64()) && py.as_f64() == rs.as_f64() {
        return Some("integer column with gaps carried as float64 by pandas; same value");
    }
    None
}

struct Tally {
    unexpected: usize,
    expected: BTreeMap<&'static str, usize>,
}

fn compare_call(name: &str, reference: &Value, ours: Result<Vec<Vec<Value>>, DemoError>, ms: u128, tally: &mut Tally) {
    let columns = COLUMNS.iter().find(|(n, _)| *n == name).unwrap().1;
    let py_error = reference["error"].as_str();
    let ours = match (py_error, ours) {
        (Some(p), Err(r)) => return println!("   {name}: both refuse | python: {p} | rust: {r}"),
        (Some(p), Ok(rows)) => {
            tally.unexpected += 1;
            return println!("   {name}: DIFFERENT: python refuses ({p}), rust reads {} rows", rows.len());
        }
        (None, Err(r)) => {
            tally.unexpected += 1;
            return println!("   {name}: DIFFERENT: rust refuses ({r}), python reads {} rows", reference["rows"].as_array().map_or(0, |a| a.len()));
        }
        (None, Ok(rows)) => rows,
    };
    let theirs = reference["rows"].as_array().expect("reference rows");
    let absent: Vec<&str> = reference["absent_columns"].as_array().map_or(vec![], |a| a.iter().filter_map(|v| v.as_str()).collect());
    if theirs.len() != ours.len() {
        tally.unexpected += 1;
        return println!("   {name}: DIFFERENT: {} rows python, {} rows rust", theirs.len(), ours.len());
    }
    let (mut bad, mut shown, mut cells, mut reals) = (0usize, 0, 0usize, 0usize);
    let mut why: BTreeMap<&'static str, usize> = BTreeMap::new();
    for (i, (py, rs)) in theirs.iter().zip(&ours).enumerate() {
        let py = py.as_array().expect("reference row");
        for (j, column) in columns.iter().enumerate() {
            cells += 1;
            if REALS.contains(column) && !py[j].is_null() {
                reals += 1;
            }
            if same(column, &py[j], &rs[j]) {
                continue;
            }
            if let Some(reason) = expected_deviation(column, &py[j], &rs[j]) {
                *why.entry(reason).or_default() += 1;
                continue;
            }
            bad += 1;
            if shown < 5 {
                shown += 1;
                println!("   {name}: row {i} column {column}: python {} / rust {}", py[j], rs[j]);
            }
        }
    }
    tally.unexpected += bad;
    for (reason, n) in &why {
        *tally.expected.entry(reason).or_default() += n;
    }
    let absent = if absent.is_empty() { String::new() } else { format!(", columns absent on both sides' python frame: {absent:?}") };
    println!(
        "   {name}: {} ({} rows, {cells} values of which {reals} reals, {ms} ms rust / {} ms python{absent}){}",
        if bad == 0 { "same" } else { "DIFFERENT" },
        ours.len(),
        reference["ms"],
        if why.is_empty() { String::new() } else { format!(", expected deviations: {why:?}") }
    );
}

fn timed<T>(f: impl FnOnce() -> Result<Vec<T>, DemoError>, row: fn(&T) -> Vec<Value>) -> (Result<Vec<Vec<Value>>, DemoError>, u128) {
    let t0 = Instant::now();
    let out = f().map(|rows| rows.iter().map(row).collect());
    (out, t0.elapsed().as_millis())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, listing, refs] = &args[..] else {
        eprintln!("usage: golden <demos.txt> <reference dir>");
        std::process::exit(2);
    };
    // Keep the panic text in our error only; the default hook would print it twice.
    std::panic::set_hook(Box::new(|_| {}));
    let mut tally = Tally { unexpected: 0, expected: BTreeMap::new() };
    let demos = std::fs::read_to_string(listing).expect("demo list");
    let mut count = 0;
    for demo in demos.lines().map(|l| l.trim_start_matches('\u{feff}').trim()).filter(|l| !l.is_empty()) {
        count += 1;
        let path = Path::new(demo);
        let name = path.file_name().unwrap().to_string_lossy();
        println!("== {name}");
        let reference: Value = serde_json::from_str(
            &std::fs::read_to_string(Path::new(refs).join(format!("{name}.json"))).expect("reference file"),
        )
        .expect("reference JSON");
        let opened = Demo::open(path);
        if reference["source1"].as_bool() == Some(true) {
            match opened {
                Err(e @ DemoError::Source1 { .. }) => println!("   CS:GO demo refused on both sides | rust: {}", e.user_message("<releases page>")),
                _ => {
                    tally.unexpected += 1;
                    println!("   DIFFERENT: python saw a CS:GO demo, rust did not refuse it");
                }
            }
            continue;
        }
        let demo = match opened {
            Ok(d) => d,
            Err(e) => {
                tally.unexpected += 1;
                println!("   DIFFERENT: rust cannot open: {e}");
                continue;
            }
        };
        let calls = &reference["calls"];
        let (r, ms) = timed(|| demo.weapon_fires(), fire_row);
        compare_call("weapon_fire", &calls["weapon_fire"], r, ms, &mut tally);
        let (r, ms) = timed(|| demo.player_deaths(), death_row);
        compare_call("player_death", &calls["player_death"], r, ms, &mut tally);
        let (r, ms) = timed(|| demo.player_hurts(), hurt_row);
        compare_call("player_hurt", &calls["player_hurt"], r, ms, &mut tally);
        let (r, ms) = timed(|| demo.players(), player_row);
        compare_call("players", &calls["players"], r, ms, &mut tally);
        let wanted: Vec<i32> = calls["player_ticks"]["wanted"].as_array().expect("wanted ticks").iter().map(|t| t.as_i64().unwrap() as i32).collect();
        let (r, ms) = timed(|| demo.player_ticks(&wanted), tick_row);
        compare_call("player_ticks", &calls["player_ticks"], r, ms, &mut tally);
        // A tick past the end of the demo yields an empty table (Python: empty DataFrame), not an error.
        match demo.player_ticks(&[i32::MAX]) {
            Ok(rows) if rows.is_empty() => println!("   player_ticks past the end: empty, as in python"),
            other => {
                tally.unexpected += 1;
                println!("   player_ticks past the end: DIFFERENT: {other:?}");
            }
        }
    }
    println!("== {count} demos; unexpected differences: {}; expected deviations: {:?}", tally.unexpected, tally.expected);
    println!("RESULT: {}", if tally.unexpected == 0 { "identical (apart from the expected deviations)" } else { "DIFFERENCES" });
    std::process::exit(if tally.unexpected == 0 { 0 } else { 1 });
}
