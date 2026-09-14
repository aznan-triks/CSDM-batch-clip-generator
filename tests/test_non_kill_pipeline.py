"""The non-lethal / "other" pipeline must work on the path the app really takes.

Audit 2026-09-15 (E13, E14, E5). The older suite injected a hand-written
`_db_schema` that already listed `damages` and `shots`, so it could never see
that discovery did not read them. These tests check the real seams instead.
"""
import ast
import pathlib
import re

from csdm.engine.core import DISCOVERY_TABLES, EngineMixin
from csdm.engine.state import EngineStateMixin

ROOT = pathlib.Path(__file__).resolve().parent.parent
CORE = ROOT / "csdm" / "engine" / "core.py"


def test_every_table_the_engine_reads_is_discovered():
    src = CORE.read_text(encoding="utf-8")
    read = set(re.findall(r'_find_col\(\s*"([a-z_]+)"', src))
    read |= set(re.findall(r'_db_schema(?:\.get\(|\[)\s*"([a-z_]+)"', src))
    read |= set(re.findall(r'\btable="([a-z_]+)"', src))
    missing = sorted(read - set(DISCOVERY_TABLES))
    assert missing == [], f"read by the engine but never discovered: {missing}"


class _Host(EngineStateMixin, EngineMixin):
    """A windowless host recording what the engine emits."""

    def __init__(self):
        self.init_engine_state()
        self.states, self.logs = [], []
        self.log = lambda message, level="": self.logs.append((level, message))
        self.log_parts = lambda parts: None
        self.state = lambda name, payload=None: self.states.append(name)
        self.ask = lambda kind, message, options: None


def test_no_static_method_references_self():
    offenders = []
    files = list((ROOT / "csdm").rglob("*.py")) + [ROOT / "csdm_batch_clips_generator.py"]
    for path in files:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not any(isinstance(d, ast.Name) and d.id == "staticmethod"
                       for d in node.decorator_list):
                continue
            if any(isinstance(sub, ast.Name) and sub.id == "self" for sub in ast.walk(node)):
                offenders.append(f"{path.relative_to(ROOT)}::{node.name}")
    assert offenders == [], offenders


def test_required_sections_survive_non_lethal_events():
    assert EngineMixin._dp2_required_sections({"_events_non_lethal": True}) == set()


def test_required_sections_ask_positions_for_a_position_modifier_on_other_events():
    cfg = {"_events_other": True, "kill_mod_no_scope_exclude": True}
    assert EngineMixin._dp2_required_sections(cfg) == {"positions", "names"}


def test_preparse_with_non_lethal_events_returns_quietly_without_demo_files():
    host = _Host()
    host._preparse_dp2({"_events_non_lethal": True, "kill_mod_no_scope": True},
                       ["does-not-exist.dem"])
    assert not any(level == "err" for level, _ in host.logs)
