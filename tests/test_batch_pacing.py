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


# ── automatic timeout (HC.1: factor and floor live in DEFAULT_CONFIG) ────────

def test_auto_timeout_defaults_keep_the_old_formula():
    host = _Host()
    assert host._auto_recording_timeout_s({}, 100) == 300   # 100 s x 3
    assert host._auto_recording_timeout_s({}, 5) == 60      # floor


def test_auto_timeout_follows_its_settings():
    host = _Host()
    cfg = {"recording_timeout_auto_factor": 2, "recording_timeout_auto_floor_s": 30}
    assert host._auto_recording_timeout_s(cfg, 100) == 200
    assert host._auto_recording_timeout_s(cfg, 5) == 30


def test_no_timeout_literal_left_in_the_batch_loop():
    src = CORE.read_text(encoding="utf-8")
    assert "* 3), 60)" not in src


# ── AIRBORNE threshold (HC.1) ────────────────────────────────────────────────

def test_airborne_shot_uses_the_configured_vertical_speed():
    host = _Host()
    shot = {"player_velocity_z": 5.0}
    assert host._event_airborne(shot, None) is True                  # default 1.0
    assert host._event_airborne({"player_velocity_z": 0.0}, None) is False
    assert host._event_airborne(shot, None, {"airborne_shot_speed_z": 10}) is False
