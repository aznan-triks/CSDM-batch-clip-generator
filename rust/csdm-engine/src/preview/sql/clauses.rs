//! WHERE fragments of the preview queries, one builder per concern (3.5 `_qe_*`,
//! `_build_team_filter_sql`, `_nonkill_where_sql`, `_mod_sql_expr`). Fragments use 3.5's `%s`
//! markers; `super::run` numbers them.

use super::{behaviour, marks, param, text_setting, Ctx};
use crate::event::Level;
use crate::preview::cfg;
use csdm_core::preview::preview;
use csdm_core::preview::sql::{DATE_COL_HINTS, DATE_COL_TYPES};
use csdm_core::registries::{registries, FilterDef};
use csdm_core::Settings;
use csdm_db::DbValue;
use serde_json::Value;

/// The integer mod column (`> 0` / `= 0`); every other mod column is boolean.
const INT_MOD_COL: &str = "penetrated_objects";

/// `_qe_match_type_sql`: `None` (no filter) or the clause and its values.
pub fn match_type(cx: &Ctx, cfg: &Settings) -> Option<(String, Vec<DbValue>)> {
    if !cfg::on(cfg, "match_type_filter_enabled") {
        return None;
    }
    let Some(gm) = cx.disc.find_col("matches", &["game_mode_str", "game_mode"]) else {
        cx.log("⚠ Match type filter: game_mode_str column not found — filter ignored.", Level::Warn);
        return None;
    };
    let vals: Vec<DbValue> = registries()
        .match_types
        .iter()
        .filter(|mt| cfg::on(cfg, &mt.key))
        .flat_map(|mt| mt.db_values.iter().map(|v| DbValue::text(v.clone())))
        .collect();
    if vals.is_empty() {
        return None; // none checked = no filter
    }
    Some((format!(r#" AND m."{gm}" IN ({})"#, marks(vals.len())), vals))
}

/// `_qe_headshot_sql`: (headshot column, clause).
pub fn headshot(cx: &Ctx, cfg: &Settings) -> (Option<String>, String) {
    let mode = text_setting(cfg, "headshots_mode", "all");
    let (only, exclude) = (mode == Some("only"), mode == Some("exclude"));
    let hc = cx.disc.find_col("kills", &["is_headshot", "headshot", "is_hs", "hs"]);
    let mut hsql = String::new();
    match &hc {
        None if only || exclude => cx.log("⚠ Headshots filter: column not found in kills — filter ignored.", Level::Warn),
        Some(c) if only => hsql = format!(r#" AND k."{c}" = TRUE"#),
        Some(c) if exclude => hsql = format!(r#" AND k."{c}" = FALSE"#),
        _ => {}
    }
    // A filter that implies a headshot (ONE TAP) forces it, unless the user chose a mode.
    for f in registries().kill_filters.iter().filter(|f| behaviour::of(&f.key).forces_headshot && cfg::on(cfg, &f.key)) {
        match &hc {
            Some(c) if !exclude && !only => hsql = format!(r#" AND k."{c}" = TRUE"#),
            Some(_) => {}
            None => cx.log(&format!("⚠ {}: headshot column not found — HS enforcement skipped.", short_label(f)), Level::Warn),
        }
    }
    (hc, hsql)
}

/// "One Tap" from `kill_mod_one_tap` (3.5 wrote the name in the warning).
fn short_label(f: &FilterDef) -> String {
    let words: Vec<String> = f
        .key
        .trim_start_matches("kill_mod_")
        .split('_')
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|h| h.to_uppercase().chain(c).collect()).unwrap_or_default()
        })
        .collect();
    words.join(" ")
}

/// `_build_team_filter_sql`: (clause, whether it reads the team columns).
pub fn team(cx: &Ctx, cfg: &Settings, alias: &str, table: &str) -> (String, bool) {
    let ally = cfg.get("_events_ally").or_else(|| cfg.get("event_ally")).is_some_and(csdm_core::migrate::truthy);
    let enemy = match cfg.get("_events_enemy").or_else(|| cfg.get("event_enemy")) {
        Some(v) => csdm_core::migrate::truthy(v),
        None => true,
    };
    if ally && enemy {
        return (String::new(), false);
    }
    if !ally && !enemy {
        return (" AND 1=0".into(), false);
    }
    // `kills` names the acting side `killer_*`, `damages` names it `attacker_*`.
    let at = cx.disc.find_col(table, &["attacker_team_name", "killer_team_name", "attacker_team", "killer_team"]);
    let vt = cx.disc.find_col(table, &["victim_team_name", "victim_team"]);
    let (Some(at), Some(vt)) = (at, vt) else {
        cx.log(&format!("⚠ Ally / Enemy filter ignored: no team columns in {table}."), Level::Warn);
        return (String::new(), false);
    };
    let op = if ally { "=" } else { "!=" };
    (format!(r#" AND {alias}."{at}" {op} {alias}."{vt}""#), true)
}

/// `SUICIDE_WEAPONS` as parameters.
pub fn suicide_weapons() -> Vec<DbValue> {
    preview()["suicide_weapons"]
        .as_array()
        .expect("suicide_weapons is a list")
        .iter()
        .map(param)
        .collect()
}

/// `_qe_suicide_sql` (its parameters are `suicide_weapons()`, appended by the caller).
pub fn suicide(cfg: &Settings, weapon_col: Option<&str>, alias: &str) -> String {
    let mode = text_setting(cfg, "suicides_mode", "include");
    let Some(wc) = weapon_col else { return String::new() };
    let n = suicide_weapons().len();
    if mode == Some("exclude") {
        format!(r#" AND {alias}."{wc}" NOT IN ({})"#, marks(n))
    } else if mode == Some("only") {
        format!(r#" AND {alias}."{wc}" IN ({})"#, marks(n))
    } else {
        String::new()
    }
}

/// `cfg.get("weapons", [])` as parameters.
pub fn weapons(cfg: &Settings) -> Vec<DbValue> {
    match cfg.get("weapons") {
        Some(Value::Array(a)) => a.iter().map(param).collect(),
        _ => Vec::new(),
    }
}

/// `_nonkill_where_sql`: the kills query's scope filters, where a damages / shots table can
/// answer them. The caller joins `matches m` and the map join.
pub fn nonkill_where(cx: &Ctx, cfg: &Settings, alias: &str, table: &str) -> (String, Vec<DbValue>) {
    let mut clause = String::new();
    let mut params = Vec::new();
    let wc = cx.disc.find_col(table, &["weapon_name", "weapon", "weapon_type"]);
    let weapons = weapons(cfg);
    if let (false, Some(wc)) = (weapons.is_empty(), &wc) {
        clause += &format!(r#" AND {alias}."{wc}" IN ({})"#, marks(weapons.len()));
        params.extend(weapons);
    }
    let s = suicide(cfg, wc.as_deref(), alias);
    if !s.is_empty() {
        clause += &s;
        params.extend(suicide_weapons());
    }
    let hs_mode = text_setting(cfg, "headshots_mode", "all");
    if let Some(hg) = cx.disc.find_col(table, &["hitgroup"]) {
        if hs_mode == Some("only") {
            clause += &format!(r#" AND {alias}."{hg}" = 1"#);
        } else if hs_mode == Some("exclude") {
            clause += &format!(r#" AND {alias}."{hg}" IS DISTINCT FROM 1"#);
        }
    }
    if let Some((mt, vals)) = match_type(cx, cfg) {
        clause += &mt;
        params.extend(vals);
    }
    let (mf, raw) = map_filter(cx, cfg);
    if !mf.is_empty() {
        clause += &mf;
        params.extend(raw);
    }
    (clause, params)
}

/// `_mod_sql_expr`.
pub fn mod_sql_expr(col: &str, positive: bool) -> String {
    match (col == INT_MOD_COL, positive) {
        (true, true) => format!(r#"k."{col}" > 0"#),
        (true, false) => format!(r#"(k."{col}" IS NULL OR k."{col}" = 0)"#),
        (false, true) => format!(r#"k."{col}" = TRUE"#),
        (false, false) => format!(r#"k."{col}" IS NOT TRUE"#),
    }
}

/// `KILL_FILTER_SQL_COLS`: the filters read from a `kills` column, in registry order.
pub fn sql_mods() -> impl Iterator<Item = &'static FilterDef> {
    registries().kill_filters.iter().filter(|f| f.category == "mods" && f.sql_cols.as_ref().is_some_and(|c| !c.is_empty()))
}

/// The `kills` column of a SQL mod, when the database has one.
pub fn mod_col(cx: &Ctx, f: &FilterDef) -> Option<String> {
    let cands: Vec<&str> = f.sql_cols.iter().flatten().map(String::as_str).collect();
    cx.disc.find_col("kills", &cands)
}

/// `_qe_mod_sql`: (clause, active SQL mods, return_empty). `return_empty` = every checked mod
/// is missing from the database (no clip rather than every clip).
pub fn mod_sql(cx: &mut Ctx, cfg: &Settings) -> (String, Vec<&'static FilterDef>, bool) {
    let active: Vec<&FilterDef> = sql_mods().filter(|f| cfg::on(cfg, &f.key)).collect();
    let excl: Vec<String> = sql_mods()
        .filter(|f| cfg::on(cfg, &format!("{}_exclude", f.key)))
        .filter_map(|f| mod_col(cx, f).map(|c| mod_sql_expr(&c, false)))
        .collect();
    let excl_sql = if excl.is_empty() { String::new() } else { format!(" AND {}", excl.join(" AND ")) };
    let mut modsql = String::new();
    if !active.is_empty() {
        let mut clauses = Vec::new();
        let mut missing = Vec::new();
        for f in &active {
            match mod_col(cx, f) {
                Some(c) => clauses.push((f.key.as_str(), mod_sql_expr(&c, true))),
                None => missing.push(f.key.clone()),
            }
        }
        if !missing.is_empty() {
            let set: std::collections::BTreeSet<String> = missing.iter().cloned().collect();
            let labels = missing.iter().map(|m| m.replace("kill_mod_", "").replace('_', " ")).collect::<Vec<_>>().join(", ");
            let fresh = set != cx.sql.warned_missing_mods;
            if clauses.is_empty() {
                if fresh {
                    cx.log(&format!("⛔ Modifiers not found in DB: {labels}. No clips returned — uncheck these modifiers or check the schema."), Level::Err);
                    cx.sql.warned_missing_mods = set;
                }
                return (String::new(), active, true);
            }
            if fresh {
                cx.log(&format!("⚠ Modifiers not found in DB: {labels} — ignored. Only the others are applied."), Level::Warn);
                cx.sql.warned_missing_mods = set;
            }
        }
        // Required (★) mods are AND-ed; optional ones never narrow the query, they only tag.
        let req: Vec<&str> = clauses.iter().filter(|(k, _)| cfg::on(cfg, &format!("{k}_req"))).map(|(_, c)| c.as_str()).collect();
        if !req.is_empty() {
            modsql = format!(" AND ({})", req.join(" AND "));
        }
    }
    modsql += &excl_sql; // exclusions always AND NOT, last
    (modsql, active, false)
}

/// `_qe_detect_date_col`: the discovered match date column, else one detected from the types.
pub fn detect_date_col(cx: &Ctx) -> Option<String> {
    if cx.disc.date_col.is_some() || !cx.disc.has_table("matches") {
        return cx.disc.date_col.clone();
    }
    let types = cx.disc.col_types.iter().find(|(t, _)| t == "matches").map(|(_, ty)| ty.as_slice()).unwrap_or(&[]);
    let cols = cx.disc.columns("matches");
    types
        .iter()
        .find(|(_, t)| DATE_COL_TYPES.contains(&t.to_lowercase().as_str()))
        .map(|(c, _)| c.clone())
        .or_else(|| cols.iter().find(|c| DATE_COL_HINTS.contains(&c.to_lowercase().as_str())).cloned())
        .or_else(|| cols.iter().find(|c| c.to_lowercase().contains("date") && !c.to_lowercase().contains("analyze")).cloned())
}

/// `_qe_map_filter_sql`: (clause, raw map names as parameters).
pub fn map_filter(cx: &Ctx, cfg: &Settings) -> (String, Vec<DbValue>) {
    let Some(mc) = cx.disc.map_col.as_deref().filter(|_| cfg::on(cfg, "map_filter_enabled")) else {
        return (String::new(), Vec::new());
    };
    let sel: Vec<&Value> = match cfg.get("map_filter") {
        Some(Value::Array(a)) => a.iter().collect(),
        _ => Vec::new(),
    };
    let raw: Vec<DbValue> = cx
        .disc
        .maps
        .iter()
        .filter(|(dk, _)| sel.iter().any(|s| s.as_str() == Some(dk.as_str())))
        .flat_map(|(_, rvs)| rvs.iter().map(|rv| DbValue::text(rv.clone())))
        .collect();
    if raw.is_empty() {
        return (String::new(), raw);
    }
    (format!(r#" AND {}."{mc}" IN ({})"#, cx.disc.map_alias, marks(raw.len())), raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_wall_bang_reads_the_integer_column() {
        let users: Vec<&str> = registries()
            .kill_filters
            .iter()
            .filter(|f| f.sql_cols.iter().flatten().any(|c| c == INT_MOD_COL))
            .map(|f| f.key.as_str())
            .collect();
        assert_eq!(users, ["kill_mod_wall_bang"], "3.5 keyed the integer test on this filter and column");
        assert_eq!(mod_sql_expr(INT_MOD_COL, false), r#"(k."penetrated_objects" IS NULL OR k."penetrated_objects" = 0)"#);
        assert_eq!(mod_sql_expr("is_no_scope", true), r#"k."is_no_scope" = TRUE"#);
    }

    #[test]
    fn suicide_clause_follows_the_mode() {
        let cfg = |m: &str| -> Settings { serde_json::from_value(serde_json::json!({"suicides_mode": m})).unwrap() };
        assert_eq!(suicide(&cfg("include"), Some("weapon_name"), "k"), "");
        assert!(suicide(&cfg("exclude"), Some("weapon_name"), "k").contains("NOT IN"));
        assert!(suicide(&cfg("only"), Some("weapon_name"), "dg").starts_with(r#" AND dg."weapon_name" IN ("#));
        assert_eq!(suicide(&cfg("only"), None, "k"), "");
        assert_eq!(short_label(registries().kill_filters.iter().find(|f| f.key == "kill_mod_one_tap").unwrap()), "One Tap");
    }
}
