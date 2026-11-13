//! Every table a query reads must be one the discovery probed (pitfall 2026-09-15:
//! a table outside discovery breaks silently on another CSDM schema).

use crate::error::DbError;

/// Tables probed when reading the CSDM schema, in probe order (`core.py` `DISCOVERY_TABLES`).
pub const DISCOVERY_TABLES: [&str; 11] = [
    "kills", "matches", "demos", "rounds", "players", "tags",
    "checksum_tags", "match_tags", "damages", "shots", "clutches",
];

/// The catalog view the discovery itself reads.
const CATALOG_TABLE: &str = "information_schema.columns";

/// Refuses `sql` if it names a table outside the discovery.
pub fn check_tables(sql: &str) -> Result<(), DbError> {
    match tables_named(sql).into_iter().find(|t| !is_allowed(t)) {
        Some(table) => Err(DbError::TableOutsideDiscovery { table }),
        None => Ok(()),
    }
}

fn is_allowed(table: &str) -> bool {
    table == CATALOG_TABLE || DISCOVERY_TABLES.contains(&table)
}

/// Lower-cased table names that follow FROM, JOIN, INTO or UPDATE (comma lists included).
/// Quoted identifiers are unquoted; string literals are skipped.
pub(crate) fn tables_named(sql: &str) -> Vec<String> {
    let tokens = tokenize(sql);
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let kw = tokens[i].to_ascii_lowercase();
        i += 1;
        if !matches!(kw.as_str(), "from" | "join" | "into" | "update") {
            continue;
        }
        // A table, an optional alias, then "," for another table of the same FROM list.
        while i < tokens.len() && tokens[i] != "(" {
            out.push(tokens[i].to_ascii_lowercase());
            i += 1;
            if tokens.get(i).is_some_and(|t| t.eq_ignore_ascii_case("as")) {
                i += 1;
            }
            if tokens.get(i).is_some_and(|t| is_word(t) && !is_keyword(t)) {
                i += 1;
            }
            if tokens.get(i).map(String::as_str) == Some(",") {
                i += 1;
            } else {
                break;
            }
        }
    }
    out
}

fn is_word(t: &str) -> bool {
    t.chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_')
}

fn is_keyword(t: &str) -> bool {
    const KEYWORDS: [&str; 14] = [
        "where", "join", "left", "right", "inner", "outer", "full", "cross", "on",
        "order", "group", "limit", "having", "using",
    ];
    KEYWORDS.iter().any(|k| t.eq_ignore_ascii_case(k))
}

/// Words (dotted names kept whole, quotes removed), "(" "," and other symbols one by one.
fn tokenize(sql: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = sql.chars().peekable();
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut Vec<String>| {
        if !word.is_empty() {
            out.push(std::mem::take(word));
        }
    };
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                flush(&mut word, &mut out);
                // Skip a string literal ('' is an escaped quote inside it).
                while let Some(c) = chars.next() {
                    if c == '\'' && chars.peek() != Some(&'\'') {
                        break;
                    }
                    if c == '\'' {
                        chars.next();
                    }
                }
            }
            '"' => {
                for c in chars.by_ref() {
                    if c == '"' {
                        break;
                    }
                    word.push(c);
                }
            }
            c if c.is_alphanumeric() || c == '_' || c == '.' || c == '$' => word.push(c),
            c if c.is_whitespace() => flush(&mut word, &mut out),
            c => {
                flush(&mut word, &mut out);
                out.push(c.to_string());
            }
        }
    }
    flush(&mut word, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_outside_discovery_is_refused() {
        let err = check_tables(r#"SELECT u."name" FROM users u WHERE u.id = $1"#).unwrap_err();
        assert!(matches!(err, DbError::TableOutsideDiscovery { ref table } if table == "users"));
        assert!(check_tables(r#"SELECT 1 FROM kills k JOIN "secret" s ON s.a = k.b"#).is_err());
        assert!(check_tables("SELECT 1 FROM matches m, accounts a").is_err());
        assert!(check_tables("INSERT INTO audit (a) VALUES ($1)").is_err());
    }

    #[test]
    fn discovered_tables_pass() {
        let sql = r#"SELECT m."demo_path", k."tick" FROM kills k JOIN matches m ON m."checksum"=k."match_checksum" LEFT JOIN demos d ON d."checksum" = m."checksum" WHERE k."weapon_name" IN ($1) AND m."x" = 'from users' ORDER BY m."demo_path""#;
        assert_eq!(tables_named(sql), ["kills", "matches", "demos"]);
        check_tables(sql).unwrap();
        check_tables(r#"SELECT DISTINCT m."demo_path" FROM "checksum_tags" ct JOIN matches m ON m."checksum"=ct."checksum""#).unwrap();
        check_tables(r#"SELECT jt."a" FROM "checksum_tags" AS jt LEFT JOIN matches AS m ON m."c"=jt."a""#).unwrap();
        check_tables(r#"SELECT COUNT(DISTINCT "date") FROM (SELECT "date" FROM matches  WHERE "date" IS NOT NULL LIMIT 30) sub"#).unwrap();
        check_tables("SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1").unwrap();
        check_tables(r#"SELECT 1 FROM rounds r WHERE r."m" IN (SELECT p."m" FROM players p WHERE p.steam_id IN ($1))"#).unwrap();
    }
}
