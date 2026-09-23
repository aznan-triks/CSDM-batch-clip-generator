"""code-fauna-codex is the scanner — what it outputs must be coherent for this project."""
from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CODEX_OUT = ROOT / "codex.json"

_IGNORE = [
    "electron/node_modules/**",
    ".claude/**",
    "electron/dist-app/**",
    "VAULT/**",
]


@pytest.fixture(scope="module")
def codex():
    from code_fauna_codex.index_store import load_json, save_json
    from code_fauna_codex.scan import build_codex

    previous = load_json(CODEX_OUT, {})
    result = build_codex(ROOT, ignore_globs=_IGNORE, previous=previous)
    save_json(CODEX_OUT, result)
    return result


def test_scan_found_a_substantial_project(codex):
    assert len(codex["symbols"].get("python_functions", [])) > 100
    assert len(codex["symbols"].get("python_classes", [])) > 10


def test_every_symbol_has_required_fields(codex):
    for section, symbols in codex["symbols"].items():
        for s in symbols:
            assert s["name"], s
            assert s["file"], s
            assert s["line"] > 0, s


def test_every_symbol_points_at_a_real_line(codex):
    for entry in codex["symbols"].get("python_functions", [])[:50]:
        path = ROOT / entry["file"]
        assert path.exists(), entry
        lines = path.read_text(encoding="utf-8").splitlines()
        assert 0 < entry["line"] <= len(lines), entry
        assert entry["name"].split(".")[-1] in lines[entry["line"] - 1], entry


def test_typescript_files_are_indexed(codex):
    ts_files = {f for f in codex["files"] if f.endswith((".ts", ".tsx"))}
    assert ts_files, "no TypeScript files found in codex"


def test_scan_is_reproducible(codex):
    from code_fauna_codex.scan import build_codex

    result2 = build_codex(ROOT, ignore_globs=_IGNORE, previous=codex)
    assert result2["symbols"] == codex["symbols"]
