//! Read-only connection to CS Demo Manager's PostgreSQL.
//! Two locks, both always on: the session starts with `default_transaction_read_only=on`
//! and every query runs inside its own `READ ONLY` transaction.

use crate::error::DbError;
use crate::guard::check_tables;
use crate::value::{decode, DbValue, Param, Raw, Row};
use postgres::types::ToSql;
use postgres::{Client, Config, NoTls};
use std::time::Duration;

/// 3.5 passes `connect_timeout=5` to psycopg2 (`core.py` `_pg_connect`).
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// The session option that makes every transaction read-only unless asked otherwise.
const READ_ONLY_SESSION: &str = "-c default_transaction_read_only=on";

/// The five pg_* settings (`core.py` `PG_PARAM_KEYS`). An empty password is allowed.
#[derive(Clone)]
pub struct PgParams {
    pub host: String,
    pub port: String,
    pub user: String,
    pub pass: String,
    pub db: String,
}

impl std::fmt::Debug for PgParams {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print the password.
        write!(f, "PgParams {{ host: {:?}, port: {:?}, user: {:?}, db: {:?} }}", self.host, self.port, self.user, self.db)
    }
}

impl PgParams {
    /// Reads the five keys from a config object (numbers accepted, as 3.5 `int()` does).
    pub fn from_settings(cfg: &serde_json::Map<String, serde_json::Value>) -> Result<Self, DbError> {
        const KEYS: [&str; 5] = ["pg_host", "pg_port", "pg_user", "pg_pass", "pg_db"];
        let missing: Vec<&'static str> = KEYS.into_iter().filter(|k| !cfg.contains_key(*k)).collect();
        if !missing.is_empty() {
            return Err(DbError::MissingSettings(missing));
        }
        let get = |k: &str| match &cfg[k] {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Null => String::new(),
            other => other.to_string(),
        };
        Ok(PgParams { host: get("pg_host"), port: get("pg_port"), user: get("pg_user"), pass: get("pg_pass"), db: get("pg_db") })
    }

    fn port_number(&self) -> Result<u16, DbError> {
        self.port.trim().parse().map_err(|_| DbError::BadPort(self.port.clone()))
    }
}

/// A statement and its parameters (`$1…$n`, in order).
#[derive(Debug, Clone, PartialEq)]
pub struct Query {
    pub sql: String,
    pub params: Vec<DbValue>,
}

impl Query {
    pub fn new(sql: impl Into<String>, params: Vec<DbValue>) -> Self {
        Query { sql: sql.into(), params }
    }
}

/// One executed query, kept when tracing is on (golden bench).
#[derive(Debug, Clone)]
pub struct Executed {
    pub query: Query,
    pub columns: Vec<String>,
    pub rows: Vec<Row>,
}

pub struct Db {
    client: Client,
    trace: Option<Vec<Executed>>,
}

impl Db {
    pub fn connect(p: &PgParams) -> Result<Db, DbError> {
        // shortcut: no TLS (libpq "prefer" tried TLS first); CSDM's server sits on the LAN.
        // Upgrade with postgres-native-tls if a server ever requires TLS.
        let client = session_config(p)?
            .connect(NoTls)
            .map_err(|e| DbError::connect(&e, format!("{}:{}", p.host, p.port), p.db.clone(), p.user.clone()))?;
        Ok(Db { client, trace: None })
    }

    /// Keeps every executed query and its rows until `take_trace`.
    pub fn start_trace(&mut self) {
        self.trace = Some(Vec::new());
    }

    pub fn take_trace(&mut self) -> Vec<Executed> {
        self.trace.take().unwrap_or_default()
    }

    /// Runs one read in its own READ ONLY transaction; every cell decoded by its SQL type.
    pub fn run(&mut self, q: &Query) -> Result<Vec<Row>, DbError> {
        check_tables(&q.sql)?;
        let mut tx = self
            .client
            .build_transaction()
            .read_only(true)
            .start()
            .map_err(|e| DbError::query(&e, &q.sql))?;
        let stmt = tx.prepare(&q.sql).map_err(|e| DbError::query(&e, &q.sql))?;
        let params: Vec<Param> = q.params.iter().map(Param).collect();
        let refs: Vec<&(dyn ToSql + Sync)> = params.iter().map(|p| p as &(dyn ToSql + Sync)).collect();
        let rows = tx.query(&stmt, &refs).map_err(|e| match bad_param(&e, &stmt) {
            Some(err) => err,
            None => DbError::query(&e, &q.sql),
        })?;
        let columns: Vec<String> = stmt.columns().iter().map(|c| c.name().to_string()).collect();
        let mut out = Vec::with_capacity(rows.len());
        for row in &rows {
            let mut cells = Vec::with_capacity(columns.len());
            for (i, col) in row.columns().iter().enumerate() {
                let raw: Raw = row.try_get(i).map_err(|e| DbError::query(&e, &q.sql))?;
                let cell = match raw.0 {
                    None => DbValue::Null,
                    Some(bytes) => match decode(col.type_(), bytes) {
                        Ok(Some(v)) => v,
                        Ok(None) => {
                            return Err(DbError::UnsupportedType { column: col.name().into(), type_name: col.type_().name().into() })
                        }
                        Err(e) => {
                            return Err(DbError::Server { detail: format!("cannot decode column '{}': {e}", col.name()) })
                        }
                    },
                };
                cells.push(cell);
            }
            out.push(cells);
        }
        tx.rollback().map_err(|e| DbError::query(&e, &q.sql))?;
        if let Some(t) = self.trace.as_mut() {
            t.push(Executed { query: q.clone(), columns, rows: out.clone() });
        }
        Ok(out)
    }
}

/// The session every connection opens: read-only by default, 3.5's timeout.
pub(crate) fn session_config(p: &PgParams) -> Result<Config, DbError> {
    let port = p.port_number()?;
    let mut cfg = Config::new();
    cfg.host(&p.host)
        .port(port)
        .user(&p.user)
        .password(&p.pass)
        .dbname(&p.db)
        .options(READ_ONLY_SESSION)
        .connect_timeout(CONNECT_TIMEOUT);
    Ok(cfg)
}

/// A parameter the driver refused to encode (no SQLSTATE, conversion error).
fn bad_param(e: &postgres::Error, stmt: &postgres::Statement) -> Option<DbError> {
    if e.code().is_some() || e.is_closed() {
        return None;
    }
    let text = e.to_string();
    let idx: usize = text.split("parameter ").nth(1)?.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()?;
    let ty = stmt.params().get(idx).map(|t| t.name().to_string()).unwrap_or_default();
    let detail = std::error::Error::source(e).map(|s| s.to_string()).unwrap_or(text);
    log::error!(target: "csdm_db", "parameter ${} refused: {detail}", idx + 1);
    Some(DbError::BadParam { index: idx + 1, type_name: ty, detail })
}
