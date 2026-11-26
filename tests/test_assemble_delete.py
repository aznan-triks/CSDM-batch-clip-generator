"""The "delete sources after assembly" option removes only the assembled clips.

Defect found 2026-11-13: the cleanup ran a recursive delete on every clip
folder, then on its parent, so other sessions of the same demo (and any
non-clip file) were wiped along with the assembled clips.
"""
import os

from csdm.engine import core
from csdm.engine.core import EngineMixin
from csdm.engine.state import EngineStateMixin


class _Host(EngineStateMixin, EngineMixin):
    def __init__(self):
        self.init_engine_state()
        self.logs = []
        self.log = lambda message, level="": self.logs.append((level, message))

    def _exec(self, cmd, cfg):
        open(cmd[-1], "wb").close()  # stand-in for FFmpeg writing the output
        return True, 0, [], None


def _run(tmp_path, monkeypatch, produced, since=0.0):
    monkeypatch.setattr(core.shutil, "which", lambda name: "ffmpeg")
    cfg = {"output_dir_clips": str(tmp_path / "clips"),
           "output_dir_assembled": str(tmp_path / "assembled"),
           "delete_after_assemble": True, "video_container": "mp4"}
    host = _Host()
    host._assemble_clips(cfg, [str(d) for d in produced], since)
    return host


def _touch(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    return path


def test_other_session_of_same_demo_survives(tmp_path, monkeypatch):
    mine = _touch(tmp_path / "clips" / "demo" / "sessA" / "a.mp4")
    other = _touch(tmp_path / "clips" / "demo" / "sessB" / "b.mp4")
    _run(tmp_path, monkeypatch, [mine.parent])
    assert not mine.exists()
    assert other.exists()
    assert not mine.parent.exists()  # emptied folder is tidied
    assert (tmp_path / "assembled" / "assembled.mp4").exists()


def test_non_clip_file_keeps_its_folder(tmp_path, monkeypatch):
    mine = _touch(tmp_path / "clips" / "demo" / "sessA" / "a.mp4")
    keep = _touch(tmp_path / "clips" / "demo" / "sessA" / "notes.json")
    _run(tmp_path, monkeypatch, [mine.parent])
    assert not mine.exists()
    assert keep.exists()


def test_empty_folders_removed_up_to_but_not_including_root(tmp_path, monkeypatch):
    mine = _touch(tmp_path / "clips" / "demo" / "sessA" / "a.mp4")
    _run(tmp_path, monkeypatch, [mine.parent])
    assert not (tmp_path / "clips" / "demo").exists()
    assert (tmp_path / "clips").is_dir()


def test_clips_from_earlier_runs_are_neither_assembled_nor_deleted(tmp_path, monkeypatch):
    # One folder per demo (or the bare root): earlier runs' clips sit beside this run's.
    old = _touch(tmp_path / "clips" / "demo" / "old.mp4")
    os.utime(old, (1_000_000, 1_000_000))
    mine = _touch(tmp_path / "clips" / "demo" / "new.mp4")
    host = _run(tmp_path, monkeypatch, [mine.parent], since=2_000_000)
    assert not mine.exists()
    assert old.exists()
    assert any("1 clip(s) to assemble" in m for _, m in host.logs)
