"""atlas-kit is the scanner — what it outputs must be coherent for this project."""
from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ATLAS_OUT = ROOT / "atlas.json"

_IGNORE = [
    "electron/node_modules/**",
    ".claude/**",
    "electron/dist-app/**",
]


@pytest.fixture(scope="module")
def atlas():
    from atlas_kit.index_store import load_json, save_json
    from atlas_kit.scan import build_atlas

    previous = load_json(ATLAS_OUT, {})
    result = build_atlas(ROOT, ignore_globs=_IGNORE, previous=previous)
    save_json(ATLAS_OUT, result)
    return result


def test_scan_found_a_substantial_project(atlas):
    assert len(atlas["symbols"].get("python_functions", [])) > 100
    assert len(atlas["symbols"].get("python_classes", [])) > 10


def test_every_symbol_has_required_fields(atlas):
    for section, symbols in atlas["symbols"].items():
        for s in symbols:
            assert s["name"], s
            assert s["file"], s
            assert s["line"] > 0, s


def test_every_symbol_points_at_a_real_line(atlas):
    for entry in atlas["symbols"].get("python_functions", [])[:50]:
        path = ROOT / entry["file"]
        assert path.exists(), entry
        lines = path.read_text(encoding="utf-8").splitlines()
        assert 0 < entry["line"] <= len(lines), entry
        assert entry["name"].split(".")[-1] in lines[entry["line"] - 1], entry


def test_typescript_files_are_indexed(atlas):
    ts_files = {f for f in atlas["files"] if f.endswith((".ts", ".tsx"))}
    assert ts_files, "no TypeScript files found in atlas"


def test_scan_is_reproducible(atlas):
    from atlas_kit.scan import build_atlas

    result2 = build_atlas(ROOT, ignore_globs=_IGNORE, previous=atlas)
    assert result2["symbols"] == atlas["symbols"]
