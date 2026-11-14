//! The engine's reads (research/03 §1.3), each built from the discovered schema exactly as
//! `core.py` builds it. A builder returns `None` where 3.5 gives up (column missing, no key).
//! Reads 1-7 live in `discovery.rs`. Reads 8-11 (preview: kills, rounds, damages, shots) are
//! built by the filter chain (T3) and run through `Db::run`.

use crate::conn::Query;
use crate::discovery::{tags_query, Discovery};
use crate::value::DbValue;

pub const DEMO_PATH_COLS: [&str; 4] = ["demo_path", "demo_file_path", "demo_filepath", "share_code"];
/// Wider list used by the clutch and tag code paths.
const DEMO_PATH_COLS_WIDE: [&str; 6] = ["demo_path", "demo_file_path", "demo_filepath", "share_code", "file_path", "path"];
/// `export_tags` list (no share_code).
const DEMO_PATH_COLS_EXPORT: [&str; 5] = ["demo_path", "demo_file_path", "demo_filepath", "file_path", "path"];
pub const MATCH_KEY_COLS: [&str; 3] = ["checksum", "id", "match_id"];
pub const CHILD_MATCH_KEY_COLS: [&str; 3] = ["match_checksum", "match_id", "checksum"];
/// Rows shown when a demo path is not found (`_get_demo_checksum` diagnostic).
const SAMPLE_ROWS: u32 = 5;

/// `IN (...)` placeholders `$from…$from+n-1`.
fn placeholders(from: usize, n: usize) -> String {
    (from..from + n).map(|i| format!("${i}")).collect::<Vec<_>>().join(",")
}

/// What `all_kills_for_demos` and `native_clutches` select demos by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DemoKey {
    Path,
    Checksum,
}

/// Junction table of the tags: (table, tag column, match column).
fn junction(d: &Discovery) -> Option<(&str, &str, &str)> {
    let ts = d.tags_schema.as_ref()?;
    Some((ts.junction_table.as_deref()?, ts.jt_tag_col.as_deref()?, ts.jt_match_col.as_deref()?))
}

/// LIKE pattern "ends with `name`": `_`, `%` and `\` escaped (3.5 defect, research/03 §8:
/// an unescaped `_` matched any character).
pub fn ends_with_pattern(name: &str) -> String {
    let mut p = String::from("%");
    for c in name.chars() {
        if matches!(c, '\\' | '_' | '%') {
            p.push('\\');
        }
        p.push(c);
    }
    p
}

/// `os.path.basename` on Windows paths and forward-slash paths alike.
pub fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Reads 12-13 (`_fetch_all_kills_for_demos`): every kill of the given demos.
/// Columns: demo path, tick, killer, victim, then killer team, victim team, round when present.
pub fn all_kills_for_demos(d: &Discovery, by: DemoKey, keys: &[DbValue]) -> Option<Query> {
    if keys.is_empty() {
        return None;
    }
    let dc = d.find_col("matches", &DEMO_PATH_COLS_WIDE)?;
    let mkk = d.find_col("kills", &CHILD_MATCH_KEY_COLS)?;
    let mkm = d.find_col("matches", &MATCH_KEY_COLS)?;
    let tc = d.find_col("kills", &["tick", "killer_tick", "round_tick"])?;
    let kc = d.find_col("kills", &["killer_steam_id", "attacker_steam_id"])?;
    let vc = d.find_col("kills", &["victim_steam_id", "killed_steam_id"])?;
    let mut sql = format!(r#"SELECT m."{dc}", k."{tc}", k."{kc}", k."{vc}""#);
    for cands in [
        &["killer_team_name", "killer_side", "killer_team"][..],
        &["victim_team_name", "victim_side", "victim_team"],
        &["round_number", "round_num", "round"],
    ] {
        if let Some(c) = d.find_col("kills", cands) {
            sql.push_str(&format!(r#", k."{c}""#));
        }
    }
    let where_col = match by {
        DemoKey::Path => &dc,
        DemoKey::Checksum => &mkm,
    };
    sql.push_str(&format!(
        r#" FROM kills k JOIN matches m ON m."{mkm}"=k."{mkk}" WHERE m."{where_col}" IN ({}) ORDER BY m."{dc}", k."{tc}""#,
        placeholders(1, keys.len())
    ));
    Some(Query::new(sql, keys.to_vec()))
}

/// Read 14: players per (match, team), to spot ghost players in clutches.
pub fn roster_sizes(d: &Discovery, checksums: &[DbValue]) -> Option<Query> {
    if checksums.is_empty() {
        return None;
    }
    let mk = d.find_col("players", &CHILD_MATCH_KEY_COLS)?;
    let team = d.find_col("players", &["team_name", "side", "team"])?;
    let sid = d.find_col("players", &["steam_id", "player_steam_id"])?;
    Some(Query::new(
        format!(
            r#"SELECT "{mk}", "{team}", COUNT(DISTINCT "{sid}") FROM players WHERE "{mk}" IN ({}) GROUP BY "{mk}", "{team}""#,
            placeholders(1, checksums.len())
        ),
        checksums.to_vec(),
    ))
}

/// Read 15 (`_fetch_native_clutches`): CSDM's clutches joined to their round.
/// Columns: demo path, match, round, tick, clutcher, won, opponents, round start, end, max end.
pub fn native_clutches(d: &Discovery, by: DemoKey, keys: &[DbValue]) -> Option<Query> {
    if !d.has_table("clutches") || keys.is_empty() {
        return None;
    }
    let c = |cands: &[&str]| d.find_col("clutches", cands);
    let (cm, cr, ct) = (c(&CHILD_MATCH_KEY_COLS)?, c(&["round_number", "round_num", "round"])?, c(&["tick"])?);
    let (cs, cw, co) = (c(&["clutcher_steam_id", "steam_id"])?, c(&["won", "has_won"])?, c(&["opponent_count", "opponents"])?);
    let dc = d.find_col("matches", &DEMO_PATH_COLS_WIDE)?;
    let mkm = d.find_col("matches", &MATCH_KEY_COLS)?;
    let rmk = d.find_col("rounds", &CHILD_MATCH_KEY_COLS)?;
    let rnum = d.find_col("rounds", &["number", "round_number"])?;
    let rst = d.find_col("rounds", &["start_tick"])?;
    let ren = d.find_col("rounds", &["end_tick"])?;
    let round_max = match d.find_col("rounds", &["end_officially_tick"]) {
        Some(reo) => format!(r#"COALESCE(r."{reo}", r."{ren}")"#),
        None => format!(r#"r."{ren}""#),
    };
    let where_col = match by {
        DemoKey::Checksum => format!(r#"m."{mkm}""#),
        DemoKey::Path => format!(r#"m."{dc}""#),
    };
    Some(Query::new(
        format!(
            r#"SELECT m."{dc}", c."{cm}", c."{cr}", c."{ct}", c."{cs}", c."{cw}", c."{co}", r."{rst}", r."{ren}", {round_max} FROM clutches c JOIN matches m ON m."{mkm}" = c."{cm}" JOIN rounds r ON r."{rmk}" = c."{cm}" AND r."{rnum}" = c."{cr}" WHERE c."{co}" >= 1 AND {where_col} IN ({}) ORDER BY m."{dc}", c."{cr}", c."{ct}""#,
            placeholders(1, keys.len())
        ),
        keys.to_vec(),
    ))
}

/// Read 16 (`_run_batch`, already-tagged check): match keys carrying one tag.
pub fn matches_with_tag(d: &Discovery, tag_id: &DbValue) -> Option<Query> {
    let (jt, jt_tag, jt_match) = junction(d)?;
    Some(Query::new(format!(r#"SELECT "{jt_match}" FROM "{jt}" WHERE "{jt_tag}"=$1"#), vec![tag_id.clone()]))
}

/// Read 17 (`_run_batch`, tag rollback): a tag id by name. Built from the discovered schema;
/// 3.5 wrote `tags.id` / `tags.name` by hand (research/03 §8), same columns on CSDM.
pub fn tag_id_by_name(d: &Discovery, name: &str) -> Option<Query> {
    let ts = d.tags_schema.as_ref()?;
    let (id, name_col) = (ts.id_col.as_deref()?, ts.name_col.as_deref()?);
    Some(Query::new(format!(r#"SELECT "{id}" FROM tags WHERE "{name_col}" = $1 LIMIT 1"#), vec![DbValue::text(name)]))
}

/// Read 19 (`list_all_demos`): every demo with its checksum, date and map when known.
pub fn all_demos(d: &Discovery) -> Option<Query> {
    let dc = d.find_col("matches", &DEMO_PATH_COLS)?;
    let mut sql = format!(r#"SELECT m."{dc}""#);
    if let Some(mkm) = d.find_col("matches", &MATCH_KEY_COLS) {
        sql.push_str(&format!(r#",m."{mkm}""#));
    }
    if let Some(dt) = &d.date_col {
        sql.push_str(&format!(r#",m."{dt}""#));
    }
    if let Some(mc) = &d.map_col {
        sql.push_str(&format!(r#",{}."{mc}""#, d.map_alias));
    }
    sql.push_str(&format!(" FROM matches m {} ", d.map_join));
    if let Some(dt) = &d.date_col {
        sql.push_str(&format!(r#"ORDER BY m."{dt}" DESC"#));
    }
    Some(Query::new(sql, vec![]))
}

fn path_and_key(d: &Discovery) -> Option<(String, String)> {
    Some((d.find_col("matches", &DEMO_PATH_COLS_WIDE)?, d.find_col("matches", &MATCH_KEY_COLS)?))
}

/// Read 20 (`_get_demo_checksum`): the checksum of one exact path spelling.
pub fn checksum_by_path(d: &Discovery, path: &str) -> Option<Query> {
    let (dc, mkm) = path_and_key(d)?;
    Some(Query::new(format!(r#"SELECT "{mkm}" FROM matches WHERE "{dc}"=$1 LIMIT 1"#), vec![DbValue::text(path)]))
}

/// Reads 21 and 25 (`_get_demo_checksum`, `_untag_demo`): the checksum of a path ending in `name`.
pub fn checksum_by_file_name(d: &Discovery, name: &str) -> Option<Query> {
    let (dc, mkm) = path_and_key(d)?;
    Some(Query::new(format!(r#"SELECT "{mkm}" FROM matches WHERE "{dc}" LIKE $1 LIMIT 1"#), vec![DbValue::text(ends_with_pattern(name))]))
}

/// Read 22: a few (path, checksum) rows for the "not found" diagnostic.
pub fn sample_demos(d: &Discovery) -> Option<Query> {
    let (dc, mkm) = path_and_key(d)?;
    Some(Query::new(format!(r#"SELECT "{dc}","{mkm}" FROM matches LIMIT {SAMPLE_ROWS}"#), vec![]))
}

/// Reads 23 and 27 (`_tag_demo`, `_tag_by_checksum`): is this tag already on this match?
pub fn tag_link_exists(d: &Discovery, checksum: &DbValue, tag_id: &DbValue) -> Option<Query> {
    let (jt, jt_tag, jt_match) = junction(d)?;
    Some(Query::new(
        format!(r#"SELECT 1 FROM "{jt}" WHERE "{jt_match}"=$1 AND "{jt_tag}"=$2 LIMIT 1"#),
        vec![checksum.clone(), tag_id.clone()],
    ))
}

/// Read 29 (`_checksum_in_db`).
pub fn checksum_exists(d: &Discovery, checksum: &DbValue) -> Option<Query> {
    let mkm = d.find_col("matches", &MATCH_KEY_COLS)?;
    Some(Query::new(format!(r#"SELECT 1 FROM matches WHERE "{mkm}"=$1 LIMIT 1"#), vec![checksum.clone()]))
}

/// Read 30 (`search_tagged_demos` without a config): demos carrying any of the tags.
pub fn demos_with_tags(d: &Discovery, tag_ids: &[DbValue]) -> Option<Query> {
    let (jt, jt_tag, jt_match) = junction(d)?;
    let (dc, mkm) = path_and_key(d)?;
    if tag_ids.is_empty() {
        return None;
    }
    Some(Query::new(
        format!(
            r#"SELECT DISTINCT m."{dc}", m."{mkm}" FROM "{jt}" ct JOIN matches m ON m."{mkm}"=ct."{jt_match}" WHERE ct."{jt_tag}" IN ({}) ORDER BY m."{dc}""#,
            placeholders(1, tag_ids.len())
        ),
        tag_ids.to_vec(),
    ))
}

/// Read 31 (`search_tagged_demos` with a config): match keys carrying any of the tags.
pub fn matches_with_tags(d: &Discovery, tag_ids: &[DbValue]) -> Option<Query> {
    let (jt, jt_tag, jt_match) = junction(d)?;
    if tag_ids.is_empty() {
        return None;
    }
    Some(Query::new(
        format!(r#"SELECT DISTINCT "{jt_match}" FROM "{jt}" WHERE "{jt_tag}" IN ({})"#, placeholders(1, tag_ids.len())),
        tag_ids.to_vec(),
    ))
}

/// Read 32 (`calc_tag_date_range`): tagged demos with their date.
pub fn tagged_demo_dates(d: &Discovery, tag_ids: &[DbValue]) -> Option<Query> {
    let (jt, jt_tag, jt_match) = junction(d)?;
    let (dc, mkm) = path_and_key(d)?;
    if tag_ids.is_empty() {
        return None;
    }
    let date_sel = d.date_col.as_ref().map(|c| format!(r#", m."{c}""#)).unwrap_or_default();
    Some(Query::new(
        format!(
            r#"SELECT DISTINCT m."{dc}", m."{mkm}"{date_sel} FROM "{jt}" ct JOIN matches m ON m."{mkm}"=ct."{jt_match}" WHERE ct."{jt_tag}" IN ({})"#,
            placeholders(1, tag_ids.len())
        ),
        tag_ids.to_vec(),
    ))
}

/// Read 36 (`export_tags`): the tag list, same statement as discovery read 7.
pub fn export_tag_list(d: &Discovery) -> Option<Query> {
    let ts = d.tags_schema.as_ref()?;
    Some(tags_query(ts.id_col.as_deref()?, ts.name_col.as_deref()?, ts.color_col.as_deref()))
}

/// Reads 37-38 (`export_tags`): tag links, with the demo path when `matches` can say it.
/// `tag_ids` empty = every tag.
pub fn export_tag_links(d: &Discovery, tag_ids: &[DbValue]) -> Option<Query> {
    let (jt, jt_tag, jt_match) = junction(d)?;
    let filter = if tag_ids.is_empty() {
        String::new()
    } else {
        format!(r#" WHERE jt."{jt_tag}" IN ({})"#, placeholders(1, tag_ids.len()))
    };
    let mkm = d.find_col("matches", &MATCH_KEY_COLS);
    let dc = d.find_col("matches", &DEMO_PATH_COLS_EXPORT);
    let sql = match (dc, mkm) {
        (Some(dc), Some(mkm)) => format!(
            r#"SELECT jt."{jt_match}", jt."{jt_tag}", m."{dc}" FROM "{jt}" AS jt LEFT JOIN matches AS m ON m."{mkm}"=jt."{jt_match}"{filter}"#
        ),
        _ => format!(r#"SELECT jt."{jt_match}", jt."{jt_tag}" FROM "{jt}" AS jt{filter}"#),
    };
    Some(Query::new(sql, tag_ids.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discovery::{Dict, TagsSchema};
    use crate::guard::check_tables;

    /// The column names of CSDM's real schema that the builders look for.
    fn csdm() -> Discovery {
        let t = |name: &str, cols: &[&str]| (name.to_string(), cols.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        Discovery {
            schema: vec![
                t("kills", &["match_checksum", "tick", "killer_steam_id", "victim_steam_id", "killer_team_name", "victim_team_name", "round_number"]),
                t("matches", &["checksum", "demo_path", "date"]),
                t("demos", &["checksum", "map_name"]),
                t("rounds", &["match_checksum", "number", "start_tick", "end_tick", "end_officially_tick"]),
                t("players", &["match_checksum", "steam_id", "team_name"]),
                t("tags", &["id", "name", "color"]),
                t("checksum_tags", &["checksum", "tag_id"]),
                t("clutches", &["match_checksum", "round_number", "tick", "clutcher_steam_id", "won", "opponent_count"]),
            ],
            date_col: Some("date".into()),
            map_col: Some("map_name".into()),
            map_alias: "d".into(),
            map_join: r#"LEFT JOIN demos d ON d."checksum" = m."checksum""#.into(),
            tags_schema: Some(TagsSchema {
                id_col: Some("id".into()),
                id_col_type: "bigint".into(),
                name_col: Some("name".into()),
                color_col: Some("color".into()),
                junction_table: Some("checksum_tags".into()),
                jt_tag_col: Some("tag_id".into()),
                jt_match_col: Some("checksum".into()),
                jt_col_types: Dict::new(),
            }),
            ..Default::default()
        }
    }

    /// Every statement this crate builds names only discovered tables (pitfall 2026-09-15).
    #[test]
    fn every_read_stays_inside_the_discovery() {
        let d = csdm();
        let k = [DbValue::text("a"), DbValue::text("b")];
        let one = DbValue::Int(1);
        let all = [
            all_kills_for_demos(&d, DemoKey::Path, &k),
            all_kills_for_demos(&d, DemoKey::Checksum, &k),
            roster_sizes(&d, &k),
            native_clutches(&d, DemoKey::Checksum, &k),
            native_clutches(&d, DemoKey::Path, &k),
            matches_with_tag(&d, &one),
            tag_id_by_name(&d, "x"),
            all_demos(&d),
            checksum_by_path(&d, "p"),
            checksum_by_file_name(&d, "n"),
            sample_demos(&d),
            tag_link_exists(&d, &k[0], &one),
            checksum_exists(&d, &k[0]),
            demos_with_tags(&d, std::slice::from_ref(&one)),
            matches_with_tags(&d, std::slice::from_ref(&one)),
            tagged_demo_dates(&d, std::slice::from_ref(&one)),
            export_tag_list(&d),
            export_tag_links(&d, std::slice::from_ref(&one)),
            export_tag_links(&d, &[]),
            Some(crate::discovery::players_plain_query()),
        ];
        for q in all {
            let q = q.expect("CSDM's schema has every column these reads need");
            check_tables(&q.sql).unwrap_or_else(|e| panic!("{e}: {}", q.sql));
            let n = q.sql.matches('$').count();
            assert_eq!(n, q.params.len(), "placeholders vs params in {}", q.sql);
        }
    }

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(ends_with_pattern("match_1%.dem"), r"%match\_1\%.dem");
        assert_eq!(basename(r"C:\demos\a_b.dem"), "a_b.dem");
        assert_eq!(basename("/x/y.dem"), "y.dem");
    }

    #[test]
    fn statements_match_the_3_5_text() {
        let d = csdm();
        assert_eq!(
            all_demos(&d).unwrap().sql,
            r#"SELECT m."demo_path",m."checksum",m."date",d."map_name" FROM matches m LEFT JOIN demos d ON d."checksum" = m."checksum" ORDER BY m."date" DESC"#
        );
        assert_eq!(
            export_tag_links(&d, &[]).unwrap().sql,
            r#"SELECT jt."checksum", jt."tag_id", m."demo_path" FROM "checksum_tags" AS jt LEFT JOIN matches AS m ON m."checksum"=jt."checksum""#
        );
        assert!(all_kills_for_demos(&d, DemoKey::Path, &[]).is_none());
    }
}
