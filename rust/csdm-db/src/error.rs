//! Errors of the database layer. `Display` is the one English sentence the screen shows
//! (same sentences as 3.5 `csdm/errors.py`); the driver detail goes to the journal.
// Merge note (T0): local type until csdm-core's error/journal conventions land.

use std::fmt;

/// Where the user fixes the connection (`errors.py` `WHERE["db"]`).
pub const WHERE_DB: &str = "SETTINGS › PostgreSQL Connection, then click Test & Reload";

/// Why a connection attempt failed, decided by SQLSTATE or by the network error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectCause {
    Credentials,
    NoDatabase,
    Unreachable,
    Other,
}

#[derive(Debug)]
pub enum DbError {
    /// pg_* settings absent from the config.
    MissingSettings(Vec<&'static str>),
    /// `pg_port` is not a number.
    BadPort(String),
    Connect { server: String, db: String, user: String, cause: ConnectCause, detail: String },
    /// The connection dropped while a query ran.
    Lost { detail: String },
    /// A table or column this app reads is missing (SQLSTATE 42P01 / 42703).
    Schema { detail: String },
    /// Any other error the server reported (a refused write included).
    Server { detail: String },
    /// Programming error: a query names a table the discovery does not probe.
    TableOutsideDiscovery { table: String },
    /// A result column whose SQL type this layer does not decode.
    UnsupportedType { column: String, type_name: String },
    /// A parameter value that cannot be sent as the type the server expects.
    BadParam { index: usize, type_name: String, detail: String },
}

impl DbError {
    /// The technical detail for the journal (never shown on screen).
    pub fn detail(&self) -> String {
        match self {
            DbError::Connect { detail, .. }
            | DbError::Lost { detail }
            | DbError::Schema { detail }
            | DbError::Server { detail } => detail.clone(),
            DbError::BadParam { index, type_name, detail } => format!("parameter ${index} as {type_name}: {detail}"),
            other => other.to_string(),
        }
    }

    /// Classifies a driver error raised while connecting.
    pub(crate) fn connect(e: &postgres::Error, server: String, db: String, user: String) -> Self {
        use postgres::error::SqlState;
        let cause = match e.code() {
            Some(c) if *c == SqlState::INVALID_PASSWORD || *c == SqlState::INVALID_AUTHORIZATION_SPECIFICATION => ConnectCause::Credentials,
            Some(c) if *c == SqlState::INVALID_CATALOG_NAME => ConnectCause::NoDatabase,
            Some(_) => ConnectCause::Other,
            None if is_network(e) => ConnectCause::Unreachable,
            None => ConnectCause::Other,
        };
        let err = DbError::Connect { server, db, user, cause, detail: full_text(e) };
        log::error!(target: "csdm_db", "connect failed: {}", err.detail());
        err
    }

    /// Classifies a driver error raised by a query.
    pub(crate) fn query(e: &postgres::Error, sql: &str) -> Self {
        use postgres::error::SqlState;
        let detail = first_line(e);
        let err = match e.code() {
            Some(c) if *c == SqlState::UNDEFINED_TABLE || *c == SqlState::UNDEFINED_COLUMN => DbError::Schema { detail },
            Some(_) => DbError::Server { detail },
            None if e.is_closed() || is_network(e) => DbError::Lost { detail },
            None => DbError::Server { detail },
        };
        log::error!(target: "csdm_db", "query failed: {} -- {} -- sql: {sql}", err.detail(), full_text(e));
        err
    }
}

fn is_network(e: &postgres::Error) -> bool {
    let mut src = std::error::Error::source(e);
    while let Some(s) = src {
        if s.is::<std::io::Error>() {
            return true;
        }
        src = s.source();
    }
    e.is_closed()
}

/// The server's own message (`relation "x" does not exist`), like `errors.py` `_first_line`.
fn first_line(e: &postgres::Error) -> String {
    match e.as_db_error() {
        Some(db) => db.message().to_string(),
        None => full_text(e).lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or_default().to_string(),
    }
}

fn full_text(e: &postgres::Error) -> String {
    let mut text = e.to_string();
    let mut src = std::error::Error::source(e);
    while let Some(s) = src {
        text.push_str(": ");
        text.push_str(&s.to_string());
        src = s.source();
    }
    text
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::MissingSettings(keys) => write!(
                f,
                "Not connected to the database yet (missing: {}). Fill in the connection in {WHERE_DB}.",
                keys.join(", ")
            ),
            DbError::BadPort(p) => write!(f, "The database port '{p}' is not a number. Fix Port in {WHERE_DB}."),
            DbError::Connect { server, db, user, cause, detail } => {
                let at = format!("{server} (database '{db}')");
                match cause {
                    ConnectCause::Credentials => write!(
                        f,
                        "PostgreSQL at {at} refused user '{user}' with this password. Check User and Pass in {WHERE_DB}."
                    ),
                    ConnectCause::NoDatabase => write!(
                        f,
                        "The database '{db}' does not exist on {server}. Check Base in {WHERE_DB} -- it must be the database CS Demo Manager uses."
                    ),
                    ConnectCause::Unreachable => write!(
                        f,
                        "Cannot reach PostgreSQL at {at}. Check that CS Demo Manager's database server is running, and check Host and Port in {WHERE_DB}."
                    ),
                    ConnectCause::Other => {
                        let first = detail.lines().next().unwrap_or_default();
                        write!(f, "Could not connect to PostgreSQL at {at}: {first}. Check {WHERE_DB}.")
                    }
                }
            }
            DbError::Lost { .. } => write!(
                f,
                "Lost the connection to PostgreSQL. Check that the database server is still running, then try again ({WHERE_DB})."
            ),
            DbError::Schema { detail } => write!(
                f,
                "The CS Demo Manager database is missing something this app reads ({detail}). Check that Base in {WHERE_DB} is CS Demo Manager's database, and that CS Demo Manager is up to date."
            ),
            DbError::Server { detail } => write!(
                f,
                "The database reported an error: {detail}. Try again; if it keeps happening, attach the error log to a bug report."
            ),
            DbError::TableOutsideDiscovery { table } => write!(
                f,
                "Internal error: a query reads the table '{table}', which the database discovery does not cover. Please report this bug."
            ),
            DbError::UnsupportedType { column, type_name } => write!(
                f,
                "The database column '{column}' has the type '{type_name}', which this app cannot read. Please report this bug."
            ),
            DbError::BadParam { .. } => write!(
                f,
                "Internal error: a value sent to the database does not match the column it is compared with. Please report this bug."
            ),
        }
    }
}

impl std::error::Error for DbError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentences_name_what_to_fix() {
        let c = |cause| DbError::Connect {
            server: "h:5432".into(),
            db: "csdm".into(),
            user: "u".into(),
            cause,
            detail: "boom\nmore".into(),
        };
        assert!(c(ConnectCause::Credentials).to_string().starts_with("PostgreSQL at h:5432 (database 'csdm') refused user 'u'"));
        assert!(c(ConnectCause::NoDatabase).to_string().starts_with("The database 'csdm' does not exist on h:5432."));
        assert!(c(ConnectCause::Unreachable).to_string().starts_with("Cannot reach PostgreSQL at h:5432 (database 'csdm')."));
        assert_eq!(
            c(ConnectCause::Other).to_string(),
            format!("Could not connect to PostgreSQL at h:5432 (database 'csdm'): boom. Check {WHERE_DB}.")
        );
        assert!(DbError::Schema { detail: "relation \"kills\" does not exist".into() }
            .to_string()
            .contains("(relation \"kills\" does not exist)"));
        assert_eq!(
            DbError::MissingSettings(vec!["pg_host", "pg_db"]).to_string(),
            format!("Not connected to the database yet (missing: pg_host, pg_db). Fill in the connection in {WHERE_DB}.")
        );
    }
}
