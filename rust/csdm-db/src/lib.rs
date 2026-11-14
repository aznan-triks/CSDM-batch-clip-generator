//! Database access: CS Demo Manager's PostgreSQL, read like the 3.5 engine (T1, ticket 11).
//! Read-only by construction (`conn.rs`); tag writes go through the separate `TagWriter` (`tags.rs`, T5).

mod conn;
mod discovery;
mod error;
mod guard;
pub mod reads;
pub mod tags;
mod value;

pub use conn::{Db, Executed, PgParams, Query, CONNECT_TIMEOUT};
pub use discovery::{detect_map_col, players_plain_query, tags_query, Dict, Discovery, Player, Tag, TagsSchema};
pub use error::{ConnectCause, DbError, WHERE_DB};
pub use guard::{check_tables, DISCOVERY_TABLES};
pub use value::{DbValue, Row};

mod live_tests;
