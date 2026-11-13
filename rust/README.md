# CSDM Batch Clips Generator 5 — Rust workspace

Native rewrite of the 3.5.x app (Electron + Python) in Rust, on branch `v5`.
Nothing here ships yet; 3.5.x stays the released version until the switch (T13).

## Crates

| Crate | Role | May depend on |
|---|---|---|
| `csdm-core` | Pure data: settings table, 3.5 migrations, presets, registries, card grid. No I/O. The only place for tunable values. | `serde`, `serde_json` |
| `csdm-db` | PostgreSQL of CS Demo Manager (T1). | `csdm-core` |
| `csdm-demo` | Demo reading, vendored demoparser2 (T2). | `csdm-core` |
| `csdm-engine` | Orchestration: `Command` in, `EngineEvent` out; 3.5 import, journal, scripted engine for UI tests. | `csdm-core`, `csdm-db`, `csdm-demo` |
| `csdm-app` | The window (egui, T6). Talks to the engine only through `csdm_engine::Engine`. | `csdm-engine`, `csdm-core` |

The layer rules are enforced by `csdm-app/tests/layers.rs` (crate graph from
`cargo metadata`, plus forbidden `std` modules per layer).

## Verify (one command, before any "done")

```powershell
$env:CSDM_REFERENCE_PYTHON = "<python with the 3.5 requirements>"   # e.g. C:/Python314/python.exe
./verify.ps1
```

`verify.ps1` runs, and stops at the first failure:

1. `cargo clippy --workspace --all-targets -- -D warnings`
2. `cargo test --workspace`, which includes:
   - `csdm-app/tests/layers.rs` — layer rules;
   - `csdm-app/tests/hardcode.rs` — hardcode guard: outside `csdm-core`, a number
     other than 0, 1, 2, a path or an address only in a `const`/`static`, a
     generated file (`@generated` on line 1), tests, or a line marked
     `// allow-hardcode: <reason>`;
   - `csdm-core/tests/parity.rs` — settings keys, defaults, types, owners and
     registries equal to the 3.5 Python source (runs `tools/export_reference.py`);
   - `csdm-engine/tests/surface.rs` — commands and states equal to the 3.5 bridge and engine.

The golden bench (Python 3.5 vs Rust on real data, read-only) joins this
command with T1.

## Data exported from 3.5

`csdm-core/data/settings.json` and `registries.json` were exported from the
3.5 source by `tools/export_reference.py` and are the Rust source of truth.
While 3.5 lives, a 3.5 change is carried over by
`python tools/export_reference.py .. --write`, reviewed, then committed; the
parity test fails until then. At T13 the exporter and the parity tests retire
with Python.

## Hand-run proof: import of real 3.5 settings

```powershell
$env:CSDM_REAL_SETTINGS_DIRS = "<folder>;<folder>"
cargo test -p csdm-engine --test import_real -- --ignored --nocapture
```

Copies each folder's four JSON files to a temporary folder, imports the
copies, checks the originals' SHA-256 are unchanged and that no preset keeps
a credential. Prints counts only.

## Throwaway profile

`CSDM_PROFILE_ROOT` names a root whose `CSDM-batch-clip_config` folder is the
only place searched for settings (no fallback to the real ones). Every test
and scripted launch uses a temporary folder. Traps: [PIEGES.md](PIEGES.md).
