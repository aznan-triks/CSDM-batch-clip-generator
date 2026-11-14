//! Pure data: settings model, 3.5 migrations, registries, card grid. No I/O.
//!
//! The only crate where tunable values and paths may be written as literals
//! (`values`, `data/*.json`); every other crate names them from here
//! (hardcode guard: csdm-app/tests/hardcode.rs).

pub mod card_layout;
pub mod editing;
pub mod error;
pub mod grid;
pub mod import35;
pub mod migrate;
pub mod presets;
pub mod preview;
pub mod registries;
pub mod settings;
pub mod theme_v12;
pub mod ui_values;
pub mod values;

pub use error::CoreError;
pub use settings::Settings;
