//! Errors of the database layer. No variant yet: T1 adds them (SQLSTATE and
//! connection failures → a sentence `csdm-engine` shows, ticket 07 « Erreurs »).

use std::fmt;

#[derive(Debug)]
pub enum DbError {}

impl fmt::Display for DbError {
    fn fmt(&self, _: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {}
    }
}

impl std::error::Error for DbError {}
