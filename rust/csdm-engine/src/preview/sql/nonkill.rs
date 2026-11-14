//! Non-kill events of the database query: damages (3.5 `_query_damages`) and shots
//! (`_query_shots`).

use csdm_db::reads::{CHILD_MATCH_KEY_COLS, DEMO_PATH_COLS, MATCH_KEY_COLS};
use super::{clauses, int_db, marks, run, tie, val, Ctx};
use crate::preview::cfg;
use crate::preview::event::Event;
use crate::preview::DemoEvents;
use crate::EngineError;
use csdm_core::Settings;
use csdm_db::{DbValue, Row};

const COL_PATH: usize = 0;
const COL_TICK: usize = 1;
const COL_ACTOR: usize = 2;
/// `damages`: demo path, tick, attacker, victim, then the optional columns.
const COL_VICTIM: usize = 3;
const DAMAGE_OPTIONAL_FROM: usize = 4;
/// `shots`: demo path, tick, shooter, then weapon and motion columns.
const SHOT_EXTRA_FROM: usize = 3;

/// Damage event fields, each read from the first column of its list that exists.
const DAMAGE_OPTIONAL: [(&str, &[&str]); 9] = [
    ("weapon", &["weapon_name", "weapon"]),
    ("hitgroup", &["hitgroup"]),
    ("health_damage", &["health_damage", "hp_damage"]),
    ("armor_damage", &["armor_damage"]),
    ("victim_new_health", &["victim_new_health"]),
    ("attacker_side", &["attacker_side"]),
    ("victim_side", &["victim_side"]),
    ("weapon_type", &["weapon_type"]),
    ("weapon_unique_id", &["weapon_unique_id"]),
];
/// Movement and recoil at the shot tick (AIRBORNE, RUN & GUN, LONG SPRAY read them).
const SHOT_MOTION: [&str; 4] = ["player_velocity_z", "player_velocity_x", "player_velocity_y", "recoil_index"];
/// A knife "shot" is a swing, not a gun shot (E3).
const KNIFE: &str = "knife";

/// `str(cell or "")`.
fn text_or_empty(v: &DbValue) -> String {
    if v.is_truthy() { v.py_str() } else { String::new() }
}

fn push(cx: &mut Ctx, results: &mut DemoEvents, row: &Row, e: Event) {
    let id = cx.arena.add(e);
    results.entry(row[COL_PATH].py_str()).or_default().push(id);
}

/// `cfg.get(key, default)` truthiness.
fn flag(cfg: &Settings, key: &str, default: bool) -> bool {
    cfg.get(key).map_or(default, csdm_core::migrate::truthy)
}

/// `_query_damages`: `damage_actor` (a tracked player hits) / `damage_target` (is hit) events.
pub fn damages(cx: &mut Ctx, cfg: &Settings, sids: &[String], results: &mut DemoEvents) -> Result<(), EngineError> {
    if !(cfg::on(cfg, "_events_non_lethal") && cx.disc.has_table("damages")) {
        return Ok(());
    }
    let d = cx.disc;
    let dc = d.find_col("matches", &["demo_path", "demo_file_path", "share_code"]);
    let mkk = d.find_col("damages", &["match_checksum", "match_id"]);
    let mkm = d.find_col("matches", &MATCH_KEY_COLS);
    let tc = d.find_col("damages", &["tick"]);
    let ak = d.find_col("damages", &["attacker_steam_id", "attacker_steamid"]);
    let vk = d.find_col("damages", &["victim_steam_id", "victim_steamid"]);
    let optional: Vec<(&str, String)> = DAMAGE_OPTIONAL.iter().filter_map(|(field, cands)| d.find_col("damages", cands).map(|c| (*field, c))).collect();
    let (Some(dc), Some(mkk), Some(mkm), Some(tc), Some(ak), Some(vk)) = (dc, mkk, mkm, tc, ak, vk) else {
        return Ok(());
    };
    let actor_on = flag(cfg, "_events_actor", true);
    let target_on = flag(cfg, "_events_target", false);

    let mut cols = vec![format!(r#"m."{dc}""#), format!(r#"dg."{tc}""#), format!(r#"dg."{ak}""#), format!(r#"dg."{vk}""#)];
    cols.extend(optional.iter().map(|(_, c)| format!(r#"dg."{c}""#)));
    let sid_ph = marks(sids.len());
    let mut conds = Vec::new();
    let mut params: Vec<DbValue> = Vec::new();
    for (on, col) in [(actor_on, &ak), (target_on, &vk)] {
        if on {
            conds.push(format!(r#"dg."{col}" IN ({sid_ph})"#));
            params.extend(sids.iter().map(|s| DbValue::text(s.clone())));
        }
    }
    if conds.is_empty() {
        return Ok(());
    }
    let team = clauses::team(cx, cfg, "dg", "damages").0;
    let psql = format!("({})", conds.join(" OR "));
    let (scope, scope_params) = clauses::nonkill_where(cx, cfg, "dg", "damages");
    params.extend(scope_params);
    // (a) alias `dg`: `d` collided with the map join `demos d`.
    let sql = format!(
        r#"SELECT {} FROM damages dg JOIN matches m ON m."{mkm}"=dg."{mkk}" {} WHERE {psql}{team}{scope} ORDER BY m."{dc}",dg."{tc}"{}"#,
        cols.join(","),
        cx.disc.map_join,
        tie(cx, "damages", "dg")
    );
    for row in run(cx, &sql, params)? {
        if !row[COL_PATH].is_truthy() || row[COL_TICK].is_null() {
            continue;
        }
        let attacker = row[COL_ACTOR].py_str();
        let et = if sids.contains(&attacker) { "damage_actor" } else { "damage_target" };
        let mut e = Event::default();
        e.set("tick", int_db(&row[COL_TICK], "damage tick")?);
        e.set("type", et);
        e.set("attacker_sid", attacker);
        e.set("victim_sid", row[COL_VICTIM].py_str());
        for (i, (field, _)) in optional.iter().enumerate() {
            if let Some(v) = row.get(DAMAGE_OPTIONAL_FROM + i) {
                e.set(field, val(v));
            }
        }
        if let Some(i) = optional.iter().position(|(f, _)| *f == "weapon") {
            e.set("weapon", text_or_empty(&row[DAMAGE_OPTIONAL_FROM + i]));
        }
        push(cx, results, &row, e);
    }
    Ok(())
}

/// `_query_shots`: one `shot` (or `knife_swing`) event per shot fired by a tracked player.
/// A shot is an actor action: only with the actor perspective.
pub fn shots(cx: &mut Ctx, cfg: &Settings, sids: &[String], results: &mut DemoEvents) -> Result<(), EngineError> {
    if !cfg::on(cfg, "_events_other") || !cx.disc.has_table("shots") || !flag(cfg, "_events_actor", true) {
        return Ok(());
    }
    let d = cx.disc;
    let dc = d.find_col("matches", &DEMO_PATH_COLS);
    let mkk = d.find_col("shots", &CHILD_MATCH_KEY_COLS);
    let mkm = d.find_col("matches", &MATCH_KEY_COLS);
    let tc = d.find_col("shots", &["tick"]);
    let pk = d.find_col("shots", &["player_steam_id", "attacker_steam_id", "shooter_steam_id", "steam_id"]);
    let wc = d.find_col("shots", &["weapon_name", "weapon", "weapon_type"]);
    let motion: Vec<(&str, String)> = SHOT_MOTION.iter().filter_map(|f| d.find_col("shots", &[f]).map(|c| (*f, c))).collect();
    let (Some(dc), Some(mkk), Some(mkm), Some(tc), Some(pk)) = (dc, mkk, mkm, tc, pk) else {
        return Ok(());
    };
    let mut extra = wc.as_ref().map_or(String::new(), |c| format!(r#",s."{c}""#));
    extra += &motion.iter().map(|(_, c)| format!(r#",s."{c}""#)).collect::<String>();
    let (scope, scope_params) = clauses::nonkill_where(cx, cfg, "s", "shots");
    let sql = format!(
        r#"SELECT m."{dc}",s."{tc}",s."{pk}"{extra} FROM shots s JOIN matches m ON m."{mkm}"=s."{mkk}" {} WHERE s."{pk}" IN ({}){scope} ORDER BY m."{dc}",s."{tc}"{}"#,
        cx.disc.map_join,
        marks(sids.len()),
        tie(cx, "shots", "s")
    );
    let mut params: Vec<DbValue> = sids.iter().map(|s| DbValue::text(s.clone())).collect();
    params.extend(scope_params);
    for row in run(cx, &sql, params)? {
        if !row[COL_PATH].is_truthy() || row[COL_TICK].is_null() {
            continue;
        }
        let mut e = Event::default();
        e.set("tick", int_db(&row[COL_TICK], "shot tick")?);
        e.set("type", "shot");
        e.set("attacker_sid", row[COL_ACTOR].py_str());
        let mut ci = SHOT_EXTRA_FROM;
        if wc.is_some() {
            let w = text_or_empty(&row[ci]);
            ci += 1;
            if w.trim().to_lowercase() == KNIFE {
                e.set("type", "knife_swing");
            }
            e.set("weapon", w);
        }
        for (field, _) in &motion {
            if let Some(v) = row.get(ci) {
                e.set(field, val(v));
            }
            ci += 1;
        }
        push(cx, results, &row, e);
    }
    Ok(())
}
