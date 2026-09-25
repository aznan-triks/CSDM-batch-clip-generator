"""Timing & Retries values reach the batch loop as whole numbers.

Audit 2026-09-25 (axis C, capture-timing). The Electron fields stored what
was typed, a string; the batch loop did `1 + cfg["retry_count"]` and
`range(cfg["retry_delay"])`, so editing Retries crashed the run.
"""
import pathlib
import re

from csdm.config import DEFAULT_CONFIG
from csdm.engine.core import EngineMixin
from csdm.engine.state import EngineStateMixin

CORE = pathlib.Path(__file__).resolve().parent.parent / "csdm" / "engine" / "core.py"


class _Host(EngineStateMixin, EngineMixin):
    def __init__(self):
        self.init_engine_state()
        self.logs = []
        self.log = lambda message, level="": self.logs.append((level, message))


def test_typed_strings_become_ints():
    host = _Host()
    got = host._batch_pacing({"retry_count": "3", "retry_delay": "20",
                              "delay_between_demos": "2.5", "recording_timeout": " 4 "})
    assert got == {"retry_count": 3, "retry_delay": 20,
                   "delay_between_demos": 2, "recording_timeout": 4}


def test_missing_negative_or_garbage_fall_back_safely():
    host = _Host()
    got = host._batch_pacing({"retry_count": -2, "retry_delay": "abc",
                              "delay_between_demos": ""})
    assert got["retry_count"] == 0
    assert got["retry_delay"] == DEFAULT_CONFIG["retry_delay"]
    assert got["delay_between_demos"] == DEFAULT_CONFIG["delay_between_demos"]
    assert got["recording_timeout"] == DEFAULT_CONFIG["recording_timeout"]


def test_batch_loop_never_reads_pacing_keys_raw():
    src = CORE.read_text(encoding="utf-8")
    raw = [k for k in EngineMixin._BATCH_PACING_KEYS
           if re.search(r'cfg(?:\.get\(|\[)\s*"%s"' % k, src)]
    assert raw == [], f"read without _batch_pacing: {raw}"
