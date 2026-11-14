//! Engine errors and the sentence the user reads for each (never a trace on screen;
//! the full detail goes to the journal).

use csdm_core::CoreError;
use csdm_db::DbError;
use csdm_demo::DemoError;
use std::fmt;
use std::path::PathBuf;

#[derive(Debug)]
pub enum EngineError {
    /// No 3.5 settings folder was found in any searched place.
    NoSettingsFound { searched: Vec<PathBuf> },
    /// A file exists but could not be read (rights, lock, device).
    Unreadable { path: PathBuf, reason: String },
    /// A settings file is not valid JSON. It is left exactly as it is.
    Damaged { path: PathBuf, reason: String },
    /// Valid JSON with a shape the app does not read.
    Invalid { path: PathBuf, error: CoreError },
    /// The journal could not be written.
    Journal { path: PathBuf, reason: String },
    /// The interface stopped listening to the engine.
    Disconnected,
    /// A scripted scenario (UI tests) did not match what the UI sent.
    Scenario(String),
    /// A database read failed (its own sentence, `DbError`).
    Db(DbError),
    /// A demo file could not be read (its own sentence, `DemoError`).
    Demo(DemoError),
    /// A refusal the user can act on, already worded for them (3.5 `UserError`).
    User(String),
}

impl From<DbError> for EngineError {
    fn from(e: DbError) -> Self {
        EngineError::Db(e)
    }
}

impl From<DemoError> for EngineError {
    fn from(e: DemoError) -> Self {
        EngineError::Demo(e)
    }
}

impl EngineError {
    /// What the user reads: what happened and what to do.
    pub fn user_message(&self) -> String {
        match self {
            EngineError::NoSettingsFound { .. } => {
                "No settings from CSDM Batch Clips Generator 3.5 were found. Choose the folder that holds csdm_config.json, or start with the default settings.".into()
            }
            EngineError::Unreadable { path, .. } => format!(
                "Could not read {}. Close any program using it and check that you can open it, then try again.",
                path.display()
            ),
            EngineError::Damaged { path, .. } => format!(
                "{} is damaged and could not be read. It was left untouched: repair it or move it aside, then try again.",
                path.display()
            ),
            EngineError::Invalid { path, error } => {
                format!("{} could not be used: {error}. It was left untouched.", path.display())
            }
            EngineError::Journal { path, .. } => {
                format!("Could not write the error log {}. Check that the settings folder can be written to.", path.display())
            }
            EngineError::Disconnected => "The window stopped listening to the engine.".into(),
            EngineError::Scenario(what) => format!("Test scenario mismatch: {what}"),
            EngineError::Db(e) => e.to_string(),
            EngineError::Demo(e) => e.user_message(csdm_core::preview::RELEASES_URL),
            EngineError::User(text) => text.clone(),
        }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::Unreadable { reason, .. } | EngineError::Damaged { reason, .. } | EngineError::Journal { reason, .. } => {
                write!(f, "{} ({reason})", self.user_message())
            }
            _ => f.write_str(&self.user_message()),
        }
    }
}

impl std::error::Error for EngineError {}
