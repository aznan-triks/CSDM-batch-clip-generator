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
