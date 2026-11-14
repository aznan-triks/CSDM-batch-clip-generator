//! The kills / deaths query and the rounds query of 3.5 `_query_events`.

use csdm_db::reads::{CHILD_MATCH_KEY_COLS, DEMO_PATH_COLS, MATCH_KEY_COLS};
use super::{behaviour, clauses, int_db, marks, run, tie, val, Ctx};
use crate::preview::cfg;
use crate::preview::event::Event;
use crate::preview::DemoEvents;
use crate::EngineError;
use csdm_core::preview::preview;
use csdm_core::Settings;
use csdm_db::{DbValue, Row};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};

/// Columns every query selects first: demo path, tick, match checksum.
const LEAD_COLS: usize = 3;
const COL_PATH: usize = 0;
const COL_TICK: usize = 1;
const COL_CHECKSUM: usize = 2;

/// Records the demo's checksum, date and map from a row (first row wins, as 3.5's
/// `dp not in self._demo_…` checks). `date` / `map` = whether the row carries them.
fn remember_demo(cx: &mut Ctx, dp: &str, row: &Row, date: bool, map: bool) {
    let chk = &row[COL_CHECKSUM];
    if chk.is_truthy() && !cx.host.demo_checksums.contains_key(dp) {
        cx.host.demo_checksums.insert(dp.to_string(), chk.clone());
    }
    if date && !cx.host.demo_dates.contains_key(dp) {
        if let Some(d) = row.get(LEAD_COLS).filter(|d| !d.is_null()) {
            cx.host.demo_dates.insert(dp.to_string(), d.clone());
        }
    }
    if map && !cx.host.demo_maps.contains_key(dp) {
        if let Some(m) = row.get(LEAD_COLS + usize::from(date)).filter(|m| m.is_truthy()) {
            cx.host.demo_maps.insert(dp.to_string(), m.py_str().trim().to_string());
        }
    }
}

fn push(cx: &mut Ctx, results: &mut DemoEvents, dp: String, e: Event) {
    let id = cx.arena.add(e);
    results.entry(dp).or_default().push(id);
}

/// The kills and rounds part of `_query_events`. `false` = every checked SQL mod is missing
/// from the database: 3.5 returns no event at all.
pub fn kills_and_rounds(cx: &mut Ctx, cfg: &Settings, sids: &[String], results: &mut DemoEvents) -> Result<bool, EngineError> {
    let d = cx.disc;
    let tc = d.find_col("kills", &["tick", "killer_tick", "round_tick"]);
    // Victim death tick: for grenades / molotovs the kill tick is the throw.
    let dtc = d.find_col("kills", &["victim_death_tick", "death_tick", "killed_tick", "victim_tick"]);
    let dc = d.find_col("matches", &DEMO_PATH_COLS);
    let mkk = d.find_col("kills", &CHILD_MATCH_KEY_COLS);
    let mkm = d.find_col("matches", &MATCH_KEY_COLS);
    let kc = d.find_col("kills", &["killer_steam_id", "attacker_steam_id"]);
    let mut vc = d.find_col("kills", &["victim_steam_id", "killed_steam_id"]);
    let wc = d.find_col("kills", &["weapon_name", "weapon", "weapon_type"]);
    if vc.is_none() {
        vc = d.columns("kills").iter().find(|c| c.to_lowercase().contains("victim") && c.to_lowercase().contains("steam")).cloned();
    }
    let Some(dc) = dc else {
        return Err(EngineError::User("Demo path column not found in the matches table: check the CS Demo Manager database.".into()));
    };
    let (Some(mkk), Some(mkm)) = (mkk, mkm) else {
        return Err(EngineError::User("The kills ↔ matches join column was not found: check the CS Demo Manager database.".into()));
    };

    let kills_on = cfg::on(cfg, "events_kills");
    let deaths_on = cfg::on(cfg, "events_deaths");
    let weapons = clauses::weapons(cfg);

    let mtsql = clauses::match_type(cx, cfg);
    let (hc, hsql) = clauses::headshot(cx, cfg);
    let tksql = clauses::team(cx, cfg, "k", "kills").0;
    let suicidesql = clauses::suicide(cfg, wc.as_deref(), "k");
    let (modsql, active_mods, mods_empty) = clauses::mod_sql(cx, cfg);
    if mods_empty {
        return Ok(false);
    }
    let headshots_only = super::text_setting(cfg, "headshots_mode", "all") == Some("only");
    let date_col = clauses::detect_date_col(cx);
    let (mf_sql, mf_raw) = clauses::map_filter(cx, cfg);
    let map_sel = match &cx.disc.map_col {
        Some(mc) => format!(r#",{}."{mc}""#, cx.disc.map_alias),
        None => String::new(),
    };
    let date_sel = date_col.as_ref().map_or(String::new(), |c| format!(r#",m."{c}""#));
    let map_join = cx.disc.map_join.clone();
    let has_map = cx.disc.map_col.is_some();
    let sid_ph = marks(sids.len());
    let sid_params: Vec<DbValue> = sids.iter().map(|s| DbValue::text(s.clone())).collect();

    if let (true, Some(tc), Some(kc)) = (kills_on || deaths_on, &tc, &kc) {
        let mut conds = Vec::new();
        let mut params = Vec::new();
        if kills_on {
            conds.push(format!(r#"k."{kc}" IN ({sid_ph})"#));
            params.extend(sid_params.iter().cloned());
        }
        if let (true, Some(vc)) = (deaths_on, &vc) {
            conds.push(format!(r#"k."{vc}" IN ({sid_ph})"#));
            params.extend(sid_params.iter().cloned());
        }
        let psql = format!("({})", conds.join(" OR "));
        let mut wsql = String::new();
        if let (false, Some(wc)) = (weapons.is_empty(), &wc) {
            wsql = format!(r#" AND k."{wc}" IN ({})"#, marks(weapons.len()));
            params.extend(weapons.iter().cloned());
        }
        let mut mt_clause = String::new();
        if let Some((c, vals)) = &mtsql {
            mt_clause = c.clone();
            params.extend(vals.iter().cloned());
        }

        // Extra columns, each under 3.5's short name.
        let mut extra = String::new();
        let mut names: Vec<String> = Vec::new();
        let mut add = |col: &str, name: &str| {
            extra += &format!(r#",k."{col}""#);
            names.push(name.to_string());
        };
        add(kc, "k");
        if let Some(c) = &vc {
            add(c, "v");
        }
        if let Some(c) = &wc {
            add(c, "w");
        }
        if let Some(c) = &dtc {
            add(c, "dt");
        }
        // (g) the round number, so the database post-filters group kills by round.
        let rnc = cx.disc.find_col("kills", &["round_number", "round_num", "round"]);
        if let Some(c) = &rnc {
            add(c, "_t3_rn");
        }
        // Victim weapon: only the filter that compares it (ECO FRAG) fetches it, when on.
        let vwc = if active_victim_weapon(cfg) {
            cx.disc.find_col("kills", &["victim_weapon_name", "victim_weapon", "killed_with", "weapon_victim"])
        } else {
            None
        };
        if let Some(c) = &vwc {
            add(c, "vw");
        }
        let mut mod_extra: Vec<(String, String)> = Vec::new();
        for f in &active_mods {
            if let Some(col) = clauses::mod_col(cx, f) {
                let name = format!("_mod_{}", f.key);
                add(&col, &name);
                mod_extra.push((f.key.clone(), name));
            }
        }
        if let (true, Some(c)) = (headshots_only, &hc) {
            add(c, "_hs");
        }

        let sql = format!(
            r#"SELECT m."{dc}",k."{tc}",m."{mkm}"{date_sel}{map_sel}{extra} FROM kills k JOIN matches m ON m."{mkm}"=k."{mkk}" {map_join} WHERE {psql}{wsql}{hsql}{tksql}{mt_clause}{suicidesql}{modsql}{mf_sql} ORDER BY m."{dc}",k."{tc}"{}"#,
            tie(cx, "kills", "k")
        );
        if !suicidesql.is_empty() {
            params.extend(clauses::suicide_weapons());
        }
        params.extend(mf_raw.iter().cloned());
        let rows = run(cx, &sql, params)?;

        let delayed: Vec<&str> = preview()["delayed_effect_weapons"].as_array().expect("delayed_effect_weapons is a list").iter().filter_map(Value::as_str).collect();
        let in_sids = |v: &DbValue| v.as_str().is_some_and(|s| sids.iter().any(|x| x == s));
        let offset = LEAD_COLS + usize::from(date_col.is_some()) + usize::from(has_map);
        for row in rows {
            let (dp, tick) = (&row[COL_PATH], &row[COL_TICK]);
            if !dp.is_truthy() || tick.is_null() {
                continue;
            }
            let dp = dp.py_str();
            remember_demo(cx, &dp, &row, date_col.is_some(), has_map);
            let ex: HashMap<&str, &DbValue> = names.iter().enumerate().filter_map(|(i, n)| row.get(offset + i).map(|v| (n.as_str(), v))).collect();
            let killer = ex.get("k").copied().cloned().unwrap_or_else(|| DbValue::text(""));
            let victim = ex.get("v").copied().cloned().unwrap_or_else(|| DbValue::text(""));
            let weapon = match ex.get("w") {
                Some(w) if w.is_truthy() => w.py_str(),
                _ => String::new(),
            };
            let event_tick = match ex.get("dt") {
                Some(dt) if !dt.is_null() && delayed.contains(&weapon.to_lowercase().as_str()) => int_db(dt, "death tick")?,
                _ => int_db(tick, "kill tick")?,
            };
            let et = if in_sids(&killer) {
                "kill"
            } else if in_sids(&victim) {
                "death"
            } else {
                "kill"
            };
            if (et == "kill" && !kills_on) || (et == "death" && !deaths_on) {
                continue;
            }
            let mut mf: BTreeSet<String> = mod_extra.iter().filter(|(_, n)| ex.get(n.as_str()).is_some_and(|v| v.is_truthy())).map(|(k, _)| k.clone()).collect();
            if headshots_only && ex.get("_hs").is_some_and(|v| v.is_truthy()) {
                mf.insert("headshots_mode".into());
            }
            let mut e = Event::default();
            e.set("tick", event_tick);
            e.set("type", et);
            e.set("weapon", weapon);
            e.set("killer_sid", val(&killer));
            e.set("victim_sid", val(&victim));
            if rnc.is_some() {
                e.set("_chk", val(&row[COL_CHECKSUM]));
                e.set("round_idx", ex.get("_t3_rn").map_or(Value::Null, |v| val(v)));
            }
            if let Some(vw) = ex.get("vw").filter(|v| vwc.is_some() && v.is_truthy()) {
                e.set("victim_weapon", vw.py_str().to_lowercase().trim());
            }
            if !mf.is_empty() {
                e.mf = Some(mf);
            }
            push(cx, results, dp, e);
        }
    }

    // (h) rounds follow `_events_rounds` (3.5 read `events_rounds`, never set); errors raise.
    if cfg::on(cfg, "_events_rounds") && cx.disc.has_table("rounds") {
        let rtc = cx.disc.find_col("rounds", &["start_tick", "freeze_time_end_tick", "tick", "end_tick"]);
        let rmk = cx.disc.find_col("rounds", &CHILD_MATCH_KEY_COLS);
        let pmk = cx.disc.find_col("players", &["match_checksum", "match_id"]);
        if let (Some(rtc), Some(rmk), Some(pmk)) = (rtc, rmk, pmk) {
            let mut params = sid_params.clone();
            let mut mt_clause = String::new();
            if let Some((c, vals)) = &mtsql {
                mt_clause = c.clone();
                params.extend(vals.iter().cloned());
            }
            params.extend(mf_raw.iter().cloned());
            let sql = format!(
                r#"SELECT m."{dc}",r."{rtc}",m."{mkm}"{date_sel}{map_sel} FROM rounds r JOIN matches m ON m."{mkm}"=r."{rmk}" {map_join} WHERE r."{rmk}" IN (SELECT p."{pmk}" FROM players p WHERE p.steam_id IN ({sid_ph})){mt_clause}{mf_sql} ORDER BY m."{dc}",r."{rtc}"{}"#,
                tie(cx, "rounds", "r")
            );
            for row in run(cx, &sql, params)? {
                let (dp, tick) = (&row[COL_PATH], &row[COL_TICK]);
                if !dp.is_truthy() || tick.is_null() {
                    continue;
                }
                let dp = dp.py_str();
                remember_demo(cx, &dp, &row, date_col.is_some(), has_map);
                let mut e = Event::default();
                e.set("tick", int_db(tick, "round tick")?);
                e.set("type", "round");
                e.set("weapon", "");
                push(cx, results, dp, e);
            }
        }
    }
    Ok(true)
}

/// Whether a filter that compares the victim's weapon is on (3.5 `cfg.get("kill_mod_eco_frag")`).
fn active_victim_weapon(cfg: &Settings) -> bool {
    behaviour::BEHAVIOURS.iter().any(|(k, b)| b.victim_weapon && cfg::on(cfg, k))
}
