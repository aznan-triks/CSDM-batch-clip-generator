"""The atlas is generated, never transcribed -- so what it claims must be true."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ATLAS_JSON = ROOT / "PROJECT_ATLAS.json"


@pytest.fixture(scope="module")
def atlas():
    subprocess.run([sys.executable, "scripts/build_atlas.py"], cwd=ROOT, check=True)
    return json.loads(ATLAS_JSON.read_text(encoding="utf-8"))


def test_it_found_a_substantial_project(atlas):
    # A walker that silently matches nothing would make every lookup answer
    # "does not exist" -- the exact failure this tool is built to prevent.
    assert len(atlas["python_functions"]) > 100
    assert len(atlas["python_classes"]) > 10


def test_every_symbol_points_at_a_real_line(atlas):
    for entry in atlas["python_functions"][:50]:
        path = ROOT / entry["file"]
        assert path.exists(), entry
        lines = path.read_text(encoding="utf-8").splitlines()
        assert 0 < entry["line"] <= len(lines), entry
        assert entry["name"] in lines[entry["line"] - 1], entry


def test_config_keys_match_python_exactly(atlas):
    from csdm.config import DEFAULT_CONFIG

    assert {k["name"] for k in atlas["config_keys"]} == set(DEFAULT_CONFIG)


def test_check_mode_agrees_right_after_a_build(atlas):
    done = subprocess.run(
        [sys.executable, "scripts/build_atlas.py", "--check"], cwd=ROOT
    )
    assert done.returncode == 0


def test_check_mode_notices_a_stale_atlas(atlas, tmp_path):
    original = ATLAS_JSON.read_text(encoding="utf-8")
    try:
        ATLAS_JSON.write_text('{"python_functions": []}', encoding="utf-8")
        done = subprocess.run(
            [sys.executable, "scripts/build_atlas.py", "--check"], cwd=ROOT
        )
        # A --check that cannot fail is a --check that guards nothing.
        assert done.returncode != 0
    finally:
        ATLAS_JSON.write_text(original, encoding="utf-8")


def test_it_found_the_react_half(atlas):
    names = {c["name"] for c in atlas["react_components"]}
    # Named, not counted: a count would drift, these three will not vanish
    # without someone noticing.
    assert {"Card", "ActionButton", "AppShell"} <= names


def test_component_props_are_captured(atlas):
    button = next(c for c in atlas["react_components"] if c["name"] == "ActionButton")
    assert "label" in button["props"] and "variant" in button["props"]


def test_the_mock_owns_a_global_class_namespace(atlas):
    # section 10: naming an internal class that the mock already styles has cost
    # two bugs. This list is how the next one gets caught before it is written.
    owned = set(atlas["mock_css_classes"])
    assert {"shell", "sec", "chip", "btn"} <= owned
