# Vendored demo parser

Copy of `src/parser` and `src/csgoproto` from https://github.com/LaihoE/demoparser, tag `v0.41.4`, commit `db3ba5f7a1b02b8cb27d0063d52649883a98469c`.
MIT licence: `LICENSE-demoparser` (upstream file, unchanged).

Written by `rust/tools/update-parser.ps1`; never edit these folders by hand, rerun the tool with another tag.

Removed from the copy:
- `src/parser/build.rs`
- `src/csgoproto/build.rs`
- `src/parser/test_demo.dem`
- `src/parser/src/e2e_test.rs`

Why: the build scripts clone the CS2 protobufs from an unpinned branch and need `protoc` and the network;
the generated `csgoproto/src/protobuf.rs` shipped in the tag is used as is. The test demo (about 60 MB) and the
test module that reads it are only compiled for the parser's own tests, which this project never runs.

These crates are not workspace members (`exclude` in `rust/Cargo.toml`), so `cargo clippy --workspace` does not lint them.
