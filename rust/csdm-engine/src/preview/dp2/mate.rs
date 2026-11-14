//! Mate POV (3.5 `_parse_mate_positions`, `_find_sid_in_tick`, `_fuzzy_sid_in_set`,
//! `_find_best_mate_sid`, `_mate_pov_filter`): a kill is filmed from the victim's teammate who
//! looks at the victim most squarely; the chosen id goes in `_mate_pov_sid`, read by the cameras.
//! Line of sight is judged on angles and distances only, as 3.5 (no map geometry).

use super::store::{MatePlayer, MatePositions};
use super::{is_kill, Stage};
use crate::event::Level;
use crate::preview::cfg::{on, sids};
use crate::preview::event::EventId;
use crate::EngineError;
use csdm_core::preview::dp2::MATE_POV_KEYS_SHOWN;
use csdm_core::preview::{preview, RELEASES_URL};
use csdm_core::Settings;
use csdm_demo::Demo;
use indexmap::IndexMap;
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

/// CPython's `math.degrees` / `math.radians` factors, so angles round as in 3.5.
const DEG_PER_RAD: f64 = 180.0 / std::f64::consts::PI;
const RAD_PER_DEG: f64 = std::f64::consts::PI / 180.0;
/// 3.5's health when the column is absent ("unknown, let it through").
const HEALTH_UNKNOWN: i64 = -1;

fn mate_table(key: &str) -> f64 {
    preview()["mate_pov"][key].as_f64().unwrap_or_else(|| panic!("preview.json mate_pov.{key} is a number"))
}

fn tolerance() -> i128 {
    i128::from(preview()["mate_pov"]["sid_tolerance"].as_i64().expect("preview.json mate_pov.sid_tolerance is an integer"))
}

/// `int(text)` for an id (`None` where Python raises).
fn id_number(text: &str) -> Option<i128> {
    text.trim().parse().ok()
}

/// `_parse_mate_positions`: positions, view angles, team and health of every player at the kill
/// ticks this preview has not read yet, merged into the view.
fn parse_mate_positions(st: &mut Stage, dp: &str, kill_ticks: &[i64]) {
    if kill_ticks.is_empty() || !Path::new(dp).is_file() {
        return;
    }
    let mut cached = st.cache.mate_positions(dp).cloned().unwrap_or_default();
    let needed: Vec<i32> = kill_ticks.iter().filter(|t| !cached.contains_key(t)).filter_map(|&t| i32::try_from(t).ok()).collect();
    if needed.is_empty() {
        return;
    }
    let rows = match Demo::open(Path::new(dp)).and_then(|d| d.player_ticks(&needed)) {
        Ok(rows) => rows,
        Err(e) => {
            st.log(&format!("  ⚠ Mate POV: {}", e.user_message(RELEASES_URL)), Level::Warn);
            return;
        }
    };
    if rows.is_empty() {
        st.log("  ⚠ Mate POV: no player position at the kill ticks of this demo.", Level::Warn);
        return;
    }
    // An id column with a gap is float64 in pandas: `astype("Int64")` then keeps the rounded float.
    let gaps = rows.iter().any(|r| r.steamid.is_none());
    let real = |v: Option<f32>| v.filter(|f| !f.is_nan()).map_or(0.0, f64::from);
    for r in &rows {
        let Some(id) = r.steamid else { continue };
        let sid = if gaps { ((id as f64) as u64).to_string() } else { id.to_string() };
        let t = i64::from(r.tick);
        if t == 0 || sid == "0" {
            continue;
        }
        let player = MatePlayer {
            x: real(r.x),
            y: real(r.y),
            z: real(r.z),
            yaw: real(r.yaw),
            pitch: real(r.pitch),
            team: r.team_num.map_or(0, i64::from),
            health: r.health.map_or(0, i64::from),
        };
        cached.entry(t).or_default().insert(sid, player);
    }
    st.cache.set_mate_positions(dp, cached);
}

/// `_find_sid_in_tick`: the dp2 key standing for a database SteamID, exact or within the tolerance
/// (the closest, the first of equals).
pub(super) fn find_sid_in_tick(tick_data: &IndexMap<String, MatePlayer>, db_sid: &str) -> Option<String> {
    if tick_data.is_empty() {
        return None;
    }
    let db = id_number(db_sid)?;
    let exact = db.to_string();
    if tick_data.contains_key(&exact) {
        return Some(exact);
    }
    let tol = tolerance();
    let (mut best, mut best_diff) = (None, tol + 1);
    for k in tick_data.keys() {
        if let Some(n) = id_number(k) {
            let diff = (n - db).abs();
            if diff < best_diff {
                best_diff = diff;
                best = Some(k);
            }
        }
    }
    best.filter(|_| best_diff <= tol).cloned()
}

/// `_fuzzy_sid_in_set`.
pub(super) fn fuzzy_sid_in_set(dp2_sid: &str, db_sids: &HashSet<String>) -> bool {
    let Some(n) = id_number(dp2_sid) else { return false };
    let tol = tolerance();
    db_sids.iter().filter_map(|s| id_number(s)).any(|d| (n - d).abs() <= tol)
}

/// `_find_best_mate_sid`: (chosen teammate's dp2 key, victim's dp2 key).
fn find_best_mate_sid(st: &Stage, positions: Option<&MatePositions>, victim_sid: &str, kill_tick: i64, active: &HashSet<String>) -> (Option<String>, Option<String>) {
    let at = |t: i64| positions.and_then(|p| p.get(&t)).filter(|d| !d.is_empty());
    let Some(tick_data) = at(kill_tick).or_else(|| at(kill_tick - 1)) else { return (None, None) };
    let Some(victim_key) = find_sid_in_tick(tick_data, victim_sid) else {
        let keys: Vec<String> = tick_data.keys().take(MATE_POV_KEYS_SHOWN).map(|k| format!("'{k}'")).collect();
        st.log(&format!("  ⚠ Mate POV: victim {victim_sid} not found in tick {kill_tick} (dp2 keys: [{}])", keys.join(", ")), Level::Dim);
        return (None, None);
    };
    let victim = tick_data[&victim_key];
    let team_check = victim.team != 0;
    let (min_dist, max_dist, max_dz) = (mate_table("min_dist"), mate_table("max_dist"), mate_table("max_z_delta"));
    let (max_elevation, eye, fov_half) = (mate_table("max_elevation"), mate_table("eye_height"), mate_table("fov_half_deg"));
    let (mut best, mut best_score) = (None, f64::INFINITY);
    for (sid, p) in tick_data {
        if *sid == victim_key || (team_check && p.team != victim.team) || fuzzy_sid_in_set(sid, active) {
            continue;
        }
        if p.health != HEALTH_UNKNOWN && p.health <= 0 {
            continue;
        }
        let (dx, dy, dz) = (victim.x - p.x, victim.y - p.y, victim.z - p.z);
        let dist = (dx * dx + dy * dy).sqrt();
        if dist < min_dist || dist > max_dist || dz.abs() > max_dz {
            continue;
        }
        let dist3d = (dist * dist + dz * dz).sqrt();
        if dist3d < 1.0 {
            continue;
        }
        // Python `max(-1.0, min(1.0, x))`.
        let elevation = (-1.0f64).max(1.0f64.min(dz / dist3d)).asin() * DEG_PER_RAD;
        if elevation.abs() > max_elevation {
            continue;
        }
        let (yaw, pitch) = (p.yaw * RAD_PER_DEG, p.pitch * RAD_PER_DEG);
        let (lx, ly, lz) = (pitch.cos() * yaw.cos(), pitch.cos() * yaw.sin(), -pitch.sin());
        let (bdx, bdy, bdz) = (victim.x - p.x, victim.y - p.y, (victim.z + eye) - p.z);
        let blen = (bdx * bdx + bdy * bdy + bdz * bdz).sqrt();
        if blen < 1.0 {
            continue;
        }
        let dot = (lx * bdx + ly * bdy + lz * bdz) / blen;
        let score = (-1.0f64).max(1.0f64.min(dot)).acos() * DEG_PER_RAD;
        if score > fov_half {
            continue;
        }
        if score < best_score {
            best_score = score;
            best = Some(sid.clone());
        }
    }
    if let Some(b) = best.as_ref().filter(|b| active.contains(*b) || fuzzy_sid_in_set(b, active)) {
        st.log(&format!("  ⚠ Mate POV: best_sid {b} matched an active player — rejected."), Level::Dim);
        best = None;
    }
    (best, Some(victim_key))
}

/// `_mate_pov_filter`: stamps `_mate_pov_sid` on the kills a teammate saw; with ★ Must
/// (`kill_mod_mate_pov_req`) the other kills go. Killer perspective: nothing changes.
pub fn mate_pov(st: &mut Stage, dp: &str, events: &[EventId], cfg: &Settings) -> Result<Vec<EventId>, EngineError> {
    if !matches!(cfg.get("perspective").and_then(Value::as_str), Some("victim" | "both")) {
        return Ok(events.to_vec());
    }
    let kill_ticks: Vec<i64> = events.iter().map(|&id| st.arena.get(id)).filter(|e| is_kill(e)).map(|e| e.tick()).collect();
    if kill_ticks.is_empty() {
        return Ok(events.to_vec());
    }
    parse_mate_positions(st, dp, &kill_ticks);
    let active: HashSet<String> = sids(cfg).into_iter().collect();
    let must = on(cfg, "kill_mod_mate_pov_req");
    let positions = st.cache.mate_positions(dp).cloned();
    let mut out = Vec::new();
    for &id in events {
        let e = st.arena.get(id);
        if !is_kill(e) {
            out.push(id);
            continue;
        }
        let (victim, tick) = (e.text("victim_sid"), e.tick());
        match find_best_mate_sid(st, positions.as_ref(), &victim, tick, &active).0 {
            Some(mate) => {
                st.arena.get_mut(id).set("_mate_pov_sid", mate);
                out.push(id);
            }
            None if must => {}
            None => out.push(id),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::dp2::testkit::Kit;
    use serde_json::json;

    fn player(x: f64, y: f64, yaw: f64, team: i64) -> MatePlayer {
        MatePlayer { x, y, z: 0.0, yaw, pitch: 0.0, team, health: 100 }
    }

    fn tick(players: &[(&str, MatePlayer)]) -> IndexMap<String, MatePlayer> {
        players.iter().map(|(k, p)| (k.to_string(), *p)).collect()
    }

    #[test]
    fn steam_ids_match_exactly_or_within_sixteen() {
        let t = tick(&[("76561198000000000", player(0.0, 0.0, 0.0, 2)), ("76561198000000040", player(0.0, 0.0, 0.0, 2))]);
        assert_eq!(find_sid_in_tick(&t, "76561198000000000").as_deref(), Some("76561198000000000"));
        assert_eq!(find_sid_in_tick(&t, "76561198000000007").as_deref(), Some("76561198000000000"));
        assert_eq!(find_sid_in_tick(&t, "76561198000000020"), None);
        assert_eq!(find_sid_in_tick(&t, ""), None);
        let set: HashSet<String> = ["76561198000000050".to_string()].into();
        assert!(fuzzy_sid_in_set("76561198000000040", &set));
        assert!(!fuzzy_sid_in_set("76561198000000030", &set));
    }

    #[test]
    fn the_teammate_looking_most_squarely_at_the_victim_is_chosen() {
        let mut kit = Kit::new();
        // Victim at the origin; teammates 300 u east look west (yaw 180) more or less squarely.
        let t = tick(&[
            ("100", player(0.0, 0.0, 0.0, 3)),
            ("200", player(300.0, 0.0, 190.0, 3)),
            ("300", player(300.0, 20.0, 180.0, 3)),
            ("400", player(300.0, 0.0, 0.0, 3)),
            ("500", player(300.0, 0.0, 180.0, 2)),
            ("600", player(50.0, 0.0, 180.0, 3)),
            ("700", player(600.0, 0.0, 180.0, 3)),
            ("800", MatePlayer { health: 0, ..player(300.0, 0.0, 180.0, 3) }),
            ("900", player(300.0, 0.0, 180.0, 3)),
        ]);
        let positions: MatePositions = [(1000, t)].into();
        let active: HashSet<String> = ["900".to_string()].into();
        let st = kit.stage();
        assert_eq!(find_best_mate_sid(&st, Some(&positions), "100", 1000, &active), (Some("300".to_string()), Some("100".to_string())));
        assert_eq!(find_best_mate_sid(&st, Some(&positions), "100", 1001, &active).0, Some("300".to_string()));
        assert_eq!(find_best_mate_sid(&st, Some(&positions), "100", 1002, &active), (None, None));
    }

    #[test]
    fn must_mode_drops_kills_no_teammate_saw_and_killer_view_changes_nothing() {
        let mut kit = Kit::new();
        let seen = kit.kill(1000, "900", "100", "AK-47");
        let unseen = kit.kill(2000, "900", "100", "AK-47");
        let other = kit.event(1500, "shot");
        let t = tick(&[("100", player(0.0, 0.0, 0.0, 3)), ("300", player(300.0, 0.0, 180.0, 3))]);
        let lone = tick(&[("100", player(0.0, 0.0, 0.0, 3))]);
        let demo = kit.demo.clone();
        kit.cache.set_mate_positions(&demo, [(1000, t), (2000, lone)].into());
        let events = [seen, other, unseen];
        let mut cfg: Settings = serde_json::from_value(json!({"perspective": "killer", "steam_ids": ["900"]})).unwrap();
        assert_eq!(mate_pov(&mut kit.stage(), &demo, &events, &cfg).unwrap(), events);
        assert_eq!(kit.arena.get(seen).get("_mate_pov_sid"), None);
        cfg.insert("perspective".into(), json!("victim"));
        assert_eq!(mate_pov(&mut kit.stage(), &demo, &events, &cfg).unwrap(), events);
        assert_eq!(kit.arena.get(seen).get("_mate_pov_sid"), Some(&json!("300")));
        assert_eq!(kit.arena.get(unseen).get("_mate_pov_sid"), None);
        cfg.insert("kill_mod_mate_pov_req".into(), json!(true));
        assert_eq!(mate_pov(&mut kit.stage(), &demo, &events, &cfg).unwrap(), [seen, other]);
    }
}
