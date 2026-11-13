//! Schema discovery (reads 1-7, `core.py` `discover_database`): which tables and columns
//! exist, the match date column, players, weapons, match types, maps and tags.

use crate::conn::{Db, Query};
use crate::error::DbError;
use crate::guard::DISCOVERY_TABLES;
use crate::value::DbValue;
use serde_json::{json, Map, Value};

/// SQL types that can carry a match date (`DISCOVERY_DATE_TYPES`).
const DATE_TYPES: [&str; 5] = ["date", "timestamp", "timestamp with time zone", "timestamp without time zone", "timestamptz"];
/// `DISCOVERY_INT_TYPES` (matched as substrings of the type, like 3.5).
const INT_TYPES: [&str; 8] = ["bigint", "integer", "int", "int4", "int8", "smallint", "int2", "numeric"];
/// Types the players query accepts for the last-seen date (`core.py` inline set).
const PLAYER_DATE_TYPES: [&str; 10] = [
    "date", "timestamp", "timestamp with time zone", "timestamp without time zone", "timestamptz",
    "bigint", "integer", "int", "int4", "int8",
];
/// Date-looking names that record bookkeeping, not play time, and their score penalty.
const SUSPECT_NAMES: [&str; 5] = ["analyze", "created", "import", "added", "updated"];
const SUSPECT_PENALTY: i64 = 5;
/// Rows sampled per date candidate to count distinct values.
const DATE_SAMPLE_ROWS: u32 = 30;
/// Map prefixes stripped to build the display key (`MAP_NAME_PREFIXES`).
const MAP_PREFIXES: [&str; 6] = ["de_", "cs_", "ar_", "gg_", "dz_", "tr_"];
const MAP_COL_CANDIDATES: [&str; 5] = ["map_name", "game_map", "map", "level_name", "server_map"];
const JUNCTION_TABLES: [&str; 2] = ["checksum_tags", "match_tags"];

/// A Python dict with string keys: insertion order of the first write, value of the last.
pub type Dict<T> = Vec<(String, T)>;

fn dict_set<T>(d: &mut Dict<T>, k: &str, v: T) {
    match d.iter_mut().find(|(key, _)| key == k) {
        Some(slot) => slot.1 = v,
        None => d.push((k.to_string(), v)),
    }
}

fn dict_get<'a, T>(d: &'a Dict<T>, k: &str) -> Option<&'a T> {
    d.iter().find(|(key, _)| key == k).map(|(_, v)| v)
}

/// Where the tags live (`_tags_schema`).
#[derive(Debug, Clone, PartialEq)]
pub struct TagsSchema {
    pub id_col: Option<String>,
    pub id_col_type: String,
    pub name_col: Option<String>,
    pub color_col: Option<String>,
    pub junction_table: Option<String>,
    pub jt_tag_col: Option<String>,
    pub jt_match_col: Option<String>,
    pub jt_col_types: Dict<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Player {
    pub label: String,
    pub steam_id: String,
    pub name: String,
    pub last_seen: DbValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tag {
    pub id: DbValue,
    pub name: DbValue,
    pub color: DbValue,
}

/// Everything `discover_database` returns, same fields and order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Discovery {
    pub players: Vec<Player>,
    /// steam_id → name.
    pub names: Dict<String>,
    pub date_col: Option<String>,
    pub date_col_type: String,
    pub weapons: Vec<String>,
    /// Table → columns, in `DISCOVERY_TABLES` order, only tables that exist.
    pub schema: Dict<Vec<String>>,
    pub col_types: Dict<Dict<String>>,
    pub tags: Vec<Tag>,
    pub tags_schema: Option<TagsSchema>,
    pub match_types: Vec<String>,
    /// Display key → raw map names.
    pub maps: Vec<(String, Vec<String>)>,
    pub map_col: Option<String>,
    /// "m" (matches) or "d" (demos).
    pub map_alias: String,
    pub map_join: String,
}

impl Discovery {
    /// `_find_col`: the first candidate present in the table.
    pub fn find_col(&self, table: &str, candidates: &[&str]) -> Option<String> {
        let cols = dict_get(&self.schema, table)?;
        candidates.iter().find(|c| cols.iter().any(|col| col == *c)).map(|c| c.to_string())
    }

    pub fn columns(&self, table: &str) -> &[String] {
        dict_get(&self.schema, table).map_or(&[], Vec::as_slice)
    }

    pub fn has_table(&self, table: &str) -> bool {
        !self.columns(table).is_empty()
    }

    /// `discovery_to_json`: the shape the 3.5 renderer received, key for key.
    pub fn to_json(&self) -> Value {
        let s = |o: &Option<String>| o.as_ref().map_or(Value::Null, |v| Value::String(v.clone()));
        let dict = |d: &Dict<String>| Value::Object(d.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect());
        let mut tags_schema = Map::new();
        if let Some(t) = &self.tags_schema {
            tags_schema.insert("table".into(), json!("tags"));
            tags_schema.insert("id_col".into(), s(&t.id_col));
            tags_schema.insert("id_col_type".into(), json!(t.id_col_type));
            tags_schema.insert("name_col".into(), s(&t.name_col));
            tags_schema.insert("color_col".into(), s(&t.color_col));
            tags_schema.insert("junction_table".into(), s(&t.junction_table));
            tags_schema.insert("jt_tag_col".into(), s(&t.jt_tag_col));
            tags_schema.insert("jt_match_col".into(), s(&t.jt_match_col));
            tags_schema.insert("jt_col_types".into(), dict(&t.jt_col_types));
        }
        let mut m = Map::new();
        m.insert(
            "players".into(),
            self.players.iter().map(|p| json!([p.label, p.steam_id, p.name, p.last_seen.to_json_scalar()])).collect(),
        );
        m.insert("names".into(), dict(&self.names));
        m.insert("date_col".into(), s(&self.date_col));
        m.insert("date_col_type".into(), json!(self.date_col_type));
        m.insert("weapons".into(), json!(self.weapons));
        m.insert("schema".into(), Value::Object(self.schema.iter().map(|(k, v)| (k.clone(), json!(v))).collect()));
        m.insert("col_types".into(), Value::Object(self.col_types.iter().map(|(k, v)| (k.clone(), dict(v))).collect()));
        m.insert(
            "tags".into(),
            self.tags
                .iter()
                .map(|t| json!([t.id.to_json_scalar(), t.name.to_json_scalar(), t.color.to_json_scalar()]))
                .collect(),
        );
        m.insert("tags_schema".into(), Value::Object(tags_schema));
        m.insert("match_types".into(), json!(self.match_types));
        m.insert("maps".into(), self.maps.iter().map(|(k, v)| json!([k, v])).collect());
        m.insert("map_col".into(), s(&self.map_col));
        m.insert("map_alias".into(), json!(self.map_alias));
        m.insert("map_join".into(), json!(self.map_join));
        Value::Object(m)
    }
}

/// `_detect_map_col`: (column, alias, join) for the map name; it lives in `demos` on CSDM.
pub fn detect_map_col(schema: &Dict<Vec<String>>) -> (Option<String>, String, String) {
    let empty = Vec::new();
    let matches_cols = dict_get(schema, "matches").unwrap_or(&empty);
    let demos_cols = dict_get(schema, "demos").unwrap_or(&empty);
    let pick = |cols: &Vec<String>| {
        MAP_COL_CANDIDATES
            .iter()
            .find(|c| cols.iter().any(|x| x == *c))
            .map(|c| c.to_string())
            .or_else(|| cols.iter().find(|c| c.to_lowercase().contains("map")).cloned())
    };
    if let Some(c) = pick(matches_cols) {
        return (Some(c), "m".into(), String::new());
    }
    if !demos_cols.is_empty() {
        let ck = |cols: &Vec<String>| cols.iter().find(|c| c.to_lowercase() == "checksum").cloned();
        if let (Some(dck), Some(mck)) = (ck(demos_cols), ck(matches_cols)) {
            let join = format!(r#"LEFT JOIN demos d ON d."{dck}" = m."{mck}""#);
            if let Some(c) = pick(demos_cols) {
                return (Some(c), "d".into(), join);
            }
        }
    }
    (None, "m".into(), String::new())
}

/// The players query without dates (reads 2b/2c, `core.py:218`/`:224`, same text).
pub fn players_plain_query() -> Query {
    Query::new(
        "SELECT DISTINCT p.name, p.steam_id FROM players p WHERE p.name IS NOT NULL AND p.steam_id IS NOT NULL AND p.name!='' AND p.steam_id!='' ORDER BY p.name",
        vec![],
    )
}

/// The tag list (read 7, and read 36 of `export_tags`, same text).
pub fn tags_query(id_col: &str, name_col: &str, color_col: Option<&str>) -> Query {
    let mut sel = format!(r#""{id_col}","{name_col}""#);
    if let Some(c) = color_col {
        sel.push_str(&format!(r#","{c}""#));
    }
    Query::new(format!(r#"SELECT {sel} FROM tags ORDER BY "{name_col}""#), vec![])
}

fn map_display_key(raw: &str) -> String {
    let low = raw.to_lowercase();
    match MAP_PREFIXES.iter().find(|p| low.starts_with(*p)) {
        Some(p) => low[p.len()..].to_string(),
        None => low,
    }
}

/// A best-effort read whose failure 3.5 replaces by a fallback: the failure goes to the journal.
fn soft<T>(what: &str, r: Result<T, DbError>) -> Option<T> {
    match r {
        Ok(v) => Some(v),
        Err(e) => {
            log::warn!(target: "csdm_db", "discovery: {what} unavailable, fallback used: {}", e.detail());
            None
        }
    }
}

impl Db {
    /// `discover_database`. Reads only; every query passes the discovery-table guard.
    pub fn discover(&mut self) -> Result<Discovery, DbError> {
        let mut d = Discovery { map_alias: "m".into(), ..Default::default() };

        // 1. Columns of each probed table.
        for t in DISCOVERY_TABLES {
            let rows = self.run(&Query::new(
                "SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position",
                vec![DbValue::text(t)],
            ))?;
            if rows.is_empty() {
                continue;
            }
            let mut types = Dict::new();
            let mut cols = Vec::new();
            for r in &rows {
                let name = r[0].py_str();
                dict_set(&mut types, &name, r[1].py_str());
                cols.push(name);
            }
            d.schema.push((t.to_string(), cols));
            d.col_types.push((t.to_string(), types));
        }
        let empty = Dict::new();
        let m_types = dict_get(&d.col_types, "matches").unwrap_or(&empty).clone();
        let m_cols = d.columns("matches").to_vec();
        let type_of = |c: &str| dict_get(&m_types, c).map(|t| t.to_lowercase()).unwrap_or_default();

        // 2. Players, with their last-seen match date when the schema allows it.
        let date_for_players = m_cols
            .iter()
            .find(|c| PLAYER_DATE_TYPES.contains(&type_of(c).as_str()) && !c.to_lowercase().contains("analyze"));
        let pick_lower = |table: &str, names: &[&str]| d.columns(table).iter().find(|c| names.contains(&c.to_lowercase().as_str())).cloned();
        let pmk = pick_lower("players", &["match_checksum", "match_id", "checksum"]);
        let mmk = pick_lower("matches", &["checksum", "id", "match_id"]);
        let gm = pick_lower("matches", &["game_mode_str"]).or_else(|| pick_lower("matches", &["game_mode"]));
        let dated = match (date_for_players, &pmk, &mmk) {
            (Some(dc), Some(pmk), Some(mmk)) => soft(
                "players with dates",
                self.run(&Query::new(
                    format!(
                        r#"SELECT DISTINCT ON (p.steam_id) p.name, p.steam_id, MAX(m."{dc}") as last_seen FROM players p LEFT JOIN matches m ON m."{mmk}" = p."{pmk}" WHERE p.name IS NOT NULL AND p.steam_id IS NOT NULL AND p.name!='' AND p.steam_id!='' GROUP BY p.steam_id, p.name ORDER BY p.steam_id, last_seen DESC NULLS LAST"#
                    ),
                    vec![],
                )),
            ),
            _ => None,
        };
        let player_rows = match dated {
            Some(rows) => rows,
            None => self.run(&players_plain_query())?.into_iter().map(|mut r| {
                r.push(DbValue::Null);
                r
            }).collect(),
        };

        // 3. Match date column: the candidate with the most distinct values in a sample.
        let mut best: (Option<String>, i64) = (None, -1);
        for c in &m_cols {
            let t = type_of(c);
            let low = c.to_lowercase();
            let candidate = DATE_TYPES.contains(&t.as_str())
                || (INT_TYPES.iter().any(|it| t.contains(it)) && (low.contains("date") || low.contains("time") || low.contains("played")))
                || (t.contains("text") && (low.contains("date") || low.contains("time")));
            if !candidate {
                continue;
            }
            let q = Query::new(
                format!(r#"SELECT COUNT(DISTINCT "{c}") FROM (SELECT "{c}" FROM matches  WHERE "{c}" IS NOT NULL LIMIT {DATE_SAMPLE_ROWS}) sub"#),
                vec![],
            );
            let n = match soft("date column sample", self.run(&q)) {
                Some(rows) => match rows.first().and_then(|r| r.first()) {
                    Some(DbValue::Int(n)) => *n,
                    _ => 0,
                },
                None => 0,
            };
            let penalty = if SUSPECT_NAMES.iter().any(|s| low.contains(s)) { SUSPECT_PENALTY } else { 0 };
            if n - penalty > best.1 {
                best = (Some(c.clone()), n - penalty);
            }
        }
        d.date_col_type = best.0.as_deref().map(type_of).unwrap_or_default();
        d.date_col = best.0;

        // 4. Weapons.
        d.weapons = self
            .run(&Query::new(
                "SELECT DISTINCT weapon_name FROM kills WHERE weapon_name IS NOT NULL AND weapon_name!='' ORDER BY weapon_name",
                vec![],
            ))?
            .into_iter()
            .map(|r| r[0].py_str())
            .collect();

        // 5. Match types (game_mode_str, else the numeric game_mode).
        if let Some(gm) = gm {
            let q = Query::new(format!(r#"SELECT DISTINCT "{gm}" FROM matches WHERE "{gm}" IS NOT NULL ORDER BY "{gm}""#), vec![]);
            if let Some(rows) = soft("match types", self.run(&q)) {
                d.match_types = rows.iter().filter(|r| r[0].is_truthy()).map(|r| r[0].py_str()).collect();
            }
        }

        // 6. Maps, grouped by display key.
        let (map_col, map_alias, map_join) = detect_map_col(&d.schema);
        if let Some(mc) = &map_col {
            let table = if map_alias == "d" { "demos" } else { "matches" };
            let q = Query::new(format!(r#"SELECT DISTINCT "{mc}" FROM {table} WHERE "{mc}" IS NOT NULL ORDER BY "{mc}""#), vec![]);
            if let Some(rows) = soft("maps", self.run(&q)) {
                let mut groups: Vec<(String, Vec<String>)> = Vec::new();
                for r in rows.iter().filter(|r| r[0].is_truthy()) {
                    let raw = r[0].py_str().trim().to_string();
                    let key = map_display_key(&raw);
                    match groups.iter_mut().find(|(k, _)| *k == key) {
                        Some((_, v)) => v.push(raw),
                        None => groups.push((key, vec![raw])),
                    }
                }
                groups.sort_by(|a, b| a.0.cmp(&b.0));
                d.maps = groups;
            }
        }
        d.map_col = map_col;
        d.map_alias = map_alias;
        d.map_join = map_join;

        // 7. Tags and their junction table.
        if d.has_table("tags") {
            d.tags_schema = Some(tags_schema(&d));
            let ts = d.tags_schema.as_ref().expect("just set");
            if let (Some(id), Some(name)) = (&ts.id_col, &ts.name_col) {
                let color = ts.color_col.clone();
                for r in self.run(&tags_query(id, name, color.as_deref()))? {
                    let mut it = r.into_iter();
                    let id = it.next().unwrap_or(DbValue::Null);
                    let name = it.next().unwrap_or(DbValue::Null);
                    let color = if color.is_some() { it.next().unwrap_or(DbValue::Null) } else { DbValue::text("") };
                    d.tags.push(Tag { id, name, color });
                }
            }
        }

        for r in player_rows {
            let (name, sid, seen) = (r[0].py_str(), r[1].py_str(), r[2].clone());
            dict_set(&mut d.names, &sid, name.clone());
            d.players.push(Player { label: format!("{name}  ({sid})"), steam_id: sid, name, last_seen: seen });
        }
        Ok(d)
    }
}

fn tags_schema(d: &Discovery) -> TagsSchema {
    let tc = d.columns("tags");
    let empty = Dict::new();
    let tt = dict_get(&d.col_types, "tags").unwrap_or(&empty);
    let id_col = tc.iter().find(|c| *c == "id" || *c == "tag_id").or(tc.first()).cloned();
    let id_col_type = id_col.as_deref().and_then(|c| dict_get(tt, c).cloned()).unwrap_or_else(|| "bigint".into());
    let name_col = tc.iter().find(|c| *c == "name" || *c == "tag_name").cloned();
    let color_col = tc.iter().find(|c| *c == "color" || *c == "tag_color").cloned();

    let mut found: Option<(String, String, String)> = None; // (table, tag col, match col)
    for jt in JUNCTION_TABLES {
        let cols = d.columns(jt);
        if cols.is_empty() {
            continue;
        }
        let (mut tag, mut mat) = (None, None);
        for c in cols {
            let cl = c.to_lowercase();
            if cl.contains("tag") && !cl.contains("checksum") && !cl.contains("match") {
                tag = Some(c.clone());
            } else if ["checksum", "match", "demo"].iter().any(|k| cl.contains(k)) {
                mat = Some(c.clone());
            }
        }
        if let (Some(t), Some(m)) = (tag, mat) {
            found = Some((jt.to_string(), t, m));
            break;
        }
    }
    if found.is_none() {
        found = JUNCTION_TABLES
            .iter()
            .map(|jt| (jt, d.columns(jt)))
            .find(|(_, cols)| cols.len() >= 2)
            .map(|(jt, cols)| (jt.to_string(), cols[1].clone(), cols[0].clone()));
    }
    let (junction_table, jt_tag_col, jt_match_col, jt_col_types) = match found {
        Some((t, tag, m)) => {
            let types = dict_get(&d.col_types, &t).cloned().unwrap_or_default();
            (Some(t), Some(tag), Some(m), types)
        }
        None => (None, None, None, Dict::new()),
    };
    TagsSchema { id_col, id_col_type, name_col, color_col, junction_table, jt_tag_col, jt_match_col, jt_col_types }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema(tables: &[(&str, &[&str])]) -> Dict<Vec<String>> {
        tables.iter().map(|(t, c)| (t.to_string(), c.iter().map(|s| s.to_string()).collect())).collect()
    }

    #[test]
    fn map_column_lives_in_demos_on_csdm() {
        let s = schema(&[("matches", &["checksum", "demo_path"]), ("demos", &["checksum", "map_name"])]);
        let (c, a, j) = detect_map_col(&s);
        assert_eq!((c.as_deref(), a.as_str()), (Some("map_name"), "d"));
        assert_eq!(j, r#"LEFT JOIN demos d ON d."checksum" = m."checksum""#);
        let s = schema(&[("matches", &["checksum", "game_map"])]);
        assert_eq!(detect_map_col(&s), (Some("game_map".into()), "m".into(), String::new()));
    }

    #[test]
    fn junction_columns_found_by_name_then_by_position() {
        let mut d = Discovery {
            schema: schema(&[("tags", &["id", "name", "color"]), ("checksum_tags", &["checksum", "tag_id"])]),
            ..Default::default()
        };
        let t = tags_schema(&d);
        assert_eq!((t.junction_table.as_deref(), t.jt_tag_col.as_deref(), t.jt_match_col.as_deref()), (Some("checksum_tags"), Some("tag_id"), Some("checksum")));
        assert_eq!(t.id_col_type, "bigint");
        d.schema = schema(&[("tags", &["id", "name"]), ("match_tags", &["a", "b"])]);
        let t = tags_schema(&d);
        assert_eq!((t.jt_match_col.as_deref(), t.jt_tag_col.as_deref()), (Some("a"), Some("b")));
    }

    #[test]
    fn map_keys_drop_one_known_prefix() {
        assert_eq!(map_display_key("de_Dust2"), "dust2");
        assert_eq!(map_display_key("cs_office"), "office");
        assert_eq!(map_display_key("workshop_x"), "workshop_x");
    }
}
