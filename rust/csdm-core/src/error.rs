//! Errors of the data layer.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    /// A stored document does not have the shape the app reads (`what` names it for the user).
    InvalidShape { what: String, expected: &'static str },
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::InvalidShape { what, expected } => write!(f, "{what} is not {expected}"),
        }
    }
}

impl std::error::Error for CoreError {}
