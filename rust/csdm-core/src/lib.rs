//! Pure data: settings model, 3.5 migrations, registries, card grid. No I/O.
//!
//! The only crate where tunable values and paths may be written as literals
//! (`values`, `data/*.json`); every other crate names them from here
//! (hardcode guard: csdm-app/tests/hardcode.rs).

pub mod error;
pub mod grid;
pub mod import35;
pub mod migrate;
pub mod presets;
pub mod registries;
pub mod settings;
pub mod values;

pub use error::CoreError;
pub use settings::Settings;
