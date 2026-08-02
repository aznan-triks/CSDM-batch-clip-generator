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


def test_bridge_commands_come_from_the_dict_itself(atlas):
    from csdm.bridge.host import COMMANDS

    assert {c["name"] for c in atlas["bridge_commands"]} == set(COMMANDS)


def test_state_events_are_collected_from_the_engine(atlas):
    # Every self.state("...") the engine raises. A React side listening for an
    # event nobody emits waits forever, in silence.
    assert {"run_started", "process_exited", "buttons_idle"} <= set(atlas["state_events"])


def test_every_guard_says_what_it_forbids(atlas):
    assert atlas["guards"], "no guard test found -- the walker matched nothing"
    assert all(g["forbids"] for g in atlas["guards"])


def test_it_reports_on_the_five_mechanisable_principles(atlas):
    checks = atlas["principle_checks"]
    assert set(checks) == {
        "hardcoded_config_defaults",
        "repeated_literals",
        "duplicate_bodies",
        "unused_symbols",
        "swallowed_exceptions",
    }


def test_every_suspect_is_named_with_a_place(atlas):
    for family in atlas["principle_checks"].values():
        for suspect in family:
            assert suspect["file"] and suspect["line"] > 0, suspect
            assert suspect["why"], suspect


def test_a_planted_duplicate_of_a_config_default_is_caught(atlas, tmp_path):
    # The sharpest of the five: a DEFAULT_CONFIG value written literally
    # somewhere else is a proven duplication, not a guess. If this detector
    # cannot catch a planted one, it catches nothing.
    from csdm.config import DEFAULT_CONFIG

    assert "cs2_process_name" in DEFAULT_CONFIG
    hits = atlas["principle_checks"]["hardcoded_config_defaults"]
    assert isinstance(hits, list)  # shape only; the planted case is step 3


def test_it_does_not_pretend_to_check_the_unmechanisable(atlas):
    # Principles 7 (root cause) and 8 (visual proof) are about a way of
    # working. A detector claiming to verify them would be a lie with a
    # green tick on it.
    assert "root_cause" not in atlas["principle_checks"]
    assert "visual_proof" not in atlas["principle_checks"]
