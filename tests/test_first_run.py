"""A brand-new install must work on a machine that is not the author's.

Audit axis E (first run, 2026-09-25): the shipped defaults pointed CS Demo
Manager at C:\\Users\\<author>\\... and the raw clips at an H: drive, so a
new user's first RUN failed on paths nobody else has.
"""
import os
import re
from pathlib import Path

import pytest

from csdm import config
from csdm.config import DEFAULT_CONFIG, clips_root, csdm_cli_candidates, default_clips_dir
from csdm.engine.core import EngineMixin

_ABSOLUTE = re.compile(r"^[A-Za-z]:[\\/]|[\\/]Users[\\/]", re.IGNORECASE)


def test_default_config_holds_no_machine_specific_path():
    offenders = {k: v for k, v in DEFAULT_CONFIG.items()
                 if isinstance(v, str) and _ABSOLUTE.search(v)}
    assert offenders == {}


def test_clips_root_defaults_to_the_users_videos_folder():
    assert clips_root({}) == str(default_clips_dir())
    assert clips_root({"output_dir_clips": "  "}) == str(default_clips_dir())
    assert Path(default_clips_dir()).parent == Path.home() / "Videos"


def test_clips_root_honours_the_setting_then_the_legacy_key(tmp_path):
    assert clips_root({"output_dir_clips": str(tmp_path)}) == os.path.abspath(tmp_path)
    assert clips_root({"output_dir": str(tmp_path)}) == os.path.abspath(tmp_path)


def test_cli_candidates_live_under_local_appdata(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert all(str(c).startswith(str(tmp_path)) for c in csdm_cli_candidates())


class _Engine(EngineMixin):
    def __init__(self):
        self.logs, self.states = [], []

    def log(self, msg, tag=""):
        self.logs.append((tag, msg))

    def state(self, name, payload=None):
        self.states.append(name)


def test_empty_csdm_exe_finds_the_standard_install(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    cli = tmp_path / "Programs" / "cs-demo-manager" / "csdm.CMD"
    cli.parent.mkdir(parents=True)
    cli.write_text("@echo off")
    assert _Engine()._resolve_cli("") == str(cli)


def test_empty_csdm_exe_without_install_falls_back_to_path(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr("shutil.which", lambda name: None)
    assert _Engine()._resolve_cli("") == "csdm"


def test_output_dir_uses_the_default_folder_when_unset(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "default_clips_dir", lambda: tmp_path / "clips")
    od = EngineMixin._bj_output_dir("C:/demos/match.dem", {"subfolder_per_demo": True})
    assert Path(od).parent == tmp_path / "clips"
    assert Path(od).is_dir()


def _run_worker(monkeypatch, tmp_path, cfg):
    cli = tmp_path / "csdm.CMD"
    cli.write_text("@echo off")
    engine = _Engine()
    base = {"csdm_exe": str(cli), "steam_ids": ["1"]}
    engine._worker({**base, **cfg})
    return engine


def test_missing_cli_says_where_to_fix_it(tmp_path, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: None)
    engine = _Engine()
    engine._worker({"csdm_exe": str(tmp_path / "nowhere" / "csdm.CMD")})
    errors = [m for tag, m in engine.logs if tag == "err"]
    assert errors and "SETTINGS" in errors[0] and "CSDM Executable" in errors[0]
    assert engine.states[-1] == "buttons_idle"


def test_unusable_clips_folder_stops_before_any_work(monkeypatch, tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")  # a FILE where a folder must be created
    engine = _run_worker(monkeypatch, tmp_path, {"output_dir_clips": str(blocker / "sub")})
    errors = [m for tag, m in engine.logs if tag == "err"]
    assert errors and "Raw clips folder" in errors[0] and "SETTINGS" in errors[0]
    assert engine.states[-1] == "buttons_idle"


def test_no_player_message_points_to_the_player_card():
    problem = EngineMixin.run_inputs_problem({"steam_ids": []})
    assert "CAPTURE" in problem and "Player" in problem
