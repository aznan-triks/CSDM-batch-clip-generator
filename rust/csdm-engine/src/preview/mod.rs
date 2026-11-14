//! The preview: 3.5 `_preview_worker` and everything it calls, ported for the same clip list
//! (T3, `.scratch/rust-rewrite/issues/04-t3-apercu.md`; golden bench `examples/t3_golden.rs`).
//!
//! Stages, in 3.5 order: `sql` (database query, shared modifiers, date filter, database
//! post-filters, clutch) → `dp2` (demo-file filters, Mate POV, ★ gate) → `clips` (sequences,
//! cameras, summary, empty-result funnel, export). `worker` chains them.

pub mod cfg;
pub mod clips;
pub mod ctx;
pub mod dates;
pub mod dp2;
pub mod event;
pub mod sql;
pub mod worker;

pub use ctx::{CollectPorts, Ctx, NoPorts, Ports};
pub use event::{Arena, DemoEvents, Event, EventId};
