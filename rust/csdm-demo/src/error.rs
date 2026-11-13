//! Errors of the demo layer. No variant yet: T2 adds them (unreadable or
//! unsupported demo → a sentence `csdm-engine` shows, ticket 07 « Erreurs »).

use std::fmt;

#[derive(Debug)]
pub enum DemoError {}

impl fmt::Display for DemoError {
    fn fmt(&self, _: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {}
    }
}

impl std::error::Error for DemoError {}
