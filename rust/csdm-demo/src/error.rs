//! Why a demo could not be read.
//! Each layer has its own error enum (T0); the engine shows `user_message` and logs `Display`.

use std::fmt;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum DemoError {
    /// The file is missing or cannot be opened.
    NotFound { path: PathBuf, detail: String },
    /// A CS:GO (Source 1) demo: the parser only reads CS2 demos.
    Source1 { path: PathBuf },
    /// The parser returned an error, usually because CS2 changed the demo format after this parser was copied.
    Unreadable { path: PathBuf, call: &'static str, detail: String },
    /// The parser panicked; caught so the app goes on with the next demo.
    Panicked { path: PathBuf, call: &'static str, detail: String },
}

fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned())
}

impl DemoError {
    /// Clear English line for the console. `releases_url` is the releases page from the config table.
    pub fn user_message(&self, releases_url: &str) -> String {
        match self {
            DemoError::NotFound { path, .. } => format!("Demo {} not found or not readable.", file_name(path)),
            DemoError::Source1 { path } => format!(
                "Demo {} is a CS:GO demo (Source 1 format): only CS2 demos can be read, so demo-based filters skip it.",
                file_name(path)
            ),
            DemoError::Unreadable { path, .. } | DemoError::Panicked { path, .. } => format!(
                "Demo {} could not be read (demo parser {}). If CS2 was updated recently, this demo may need \
                 a newer version of the app: {releases_url}",
                file_name(path),
                crate::PARSER_VERSION
            ),
        }
    }
}

/// Full detail, for the rotating log.
impl fmt::Display for DemoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DemoError::NotFound { path, detail } => write!(f, "{}: cannot open: {detail}", path.display()),
            DemoError::Source1 { path } => write!(f, "{}: Source 1 (CS:GO) demo", path.display()),
            DemoError::Unreadable { path, call, detail } => write!(f, "{}: {call}: {detail}", path.display()),
            DemoError::Panicked { path, call, detail } => write!(f, "{}: {call}: parser panicked: {detail}", path.display()),
        }
    }
}

impl std::error::Error for DemoError {}
