"""Registered players (`saved_players`, the ★ favourites) must survive.

Found live: the user's favourites kept vanishing. Causes guarded here:
  * the test suite's Tkinter window test rewrote the REAL settings file with
    only the keys that window knows (no `saved_players`) on every pytest run;
  * that window's auto-save wrote its own keys INSTEAD of the file, not over it;
  * the old window's csdm_players.json was never imported into `saved_players`;
  * a full preset snapshot carried `saved_players` (and credentials, layout...)
    and put an old copy back on load.
"""
import json
from pathlib import Path

import pytest

import csdm.config as c

PACKAGE_ROOT = Path(c.__file__).resolve().parent.parent
LEGACY = [
    {"steam_id": "76561198972603349", "name": "CHEVRE", "label": "CHEVRE  (76561198972603349)"},
    {"steam_id": "76561198987729644", "name": "TROIS SHOT GOOD", "label": "x"},
    {"steam_id": "76561198972603349", "name": "CHEVRE", "label": "duplicate"},
]


@pytest.fixture()
def profile(tmp_path, monkeypatch):
    monkeypatch.setattr(c, "_ROOT", tmp_path)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    monkeypatch.setattr(c, "_ACTIVE_DIR", None)
    folder = tmp_path / c.CONFIG_SUBDIR
    folder.mkdir()
    return folder


def _write(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")


# -- the suite never touches the real profile ---------------------------------
def test_suite_runs_on_a_throwaway_profile():
    """conftest's session fixture: nothing a test does reaches <repo>/CSDM-batch-clip_config."""
    assert PACKAGE_ROOT not in c._default_dir().parents
    assert PACKAGE_ROOT not in c._file_dir().parents


# -- the Tkinter window's auto-save -------------------------------------------
def test_tk_auto_save_keeps_the_keys_it_does_not_know(profile):
    from csdm_batch_clips_generator import App

    starred = [{"steam_id": "1", "name": "A"}]
    _write(profile / "csdm_config.json", {"saved_players": starred, "ui_card_style": "tiles", "pg_db": "old"})

    class FakeWindow:
        def _collect_config(self):
            return {"pg_db": "csdm"}  # the window's own keys only

        def after(self, *_):
            pass

        def _auto_save(self):
            pass

    App._auto_save(FakeWindow())
    saved = json.loads((profile / "csdm_config.json").read_text(encoding="utf-8"))
    assert saved["saved_players"] == starred
    assert saved["ui_card_style"] == "tiles"
    assert saved["pg_db"] == "csdm"


# -- one-time import of the old window's registered players --------------------
def test_legacy_players_are_imported_once_deduplicated(profile):
    _write(profile / "csdm_config.json", {"saved_players": []})
    _write(profile / "csdm_players.json", LEGACY)
    cfg = c.load_config()
    assert cfg["saved_players"] == [
        {"steam_id": "76561198972603349", "name": "CHEVRE"},
        {"steam_id": "76561198987729644", "name": "TROIS SHOT GOOD"},
    ]
    assert cfg["saved_players_imported"] is True


def test_legacy_players_imported_when_the_key_is_absent(profile):
    _write(profile / "csdm_config.json", {"pg_db": "csdm"})
    _write(profile / "csdm_players.json", LEGACY)
    assert len(c.load_config()["saved_players"]) == 2


def test_a_list_emptied_on_purpose_is_never_refilled(profile):
    _write(profile / "csdm_config.json", {"saved_players": [], "saved_players_imported": True})
    _write(profile / "csdm_players.json", LEGACY)
    assert c.load_config()["saved_players"] == []


def test_existing_favourites_are_never_replaced_by_the_import(profile):
    mine = [{"steam_id": "9", "name": "Mine"}]
    _write(profile / "csdm_config.json", {"saved_players": mine})
    _write(profile / "csdm_players.json", LEGACY)
    cfg = c.load_config()
    assert cfg["saved_players"] == mine
    assert cfg["saved_players_imported"] is True


def test_no_legacy_file_means_an_empty_list(profile):
    cfg = c.load_config()
    assert cfg["saved_players"] == []
    assert cfg["saved_players_imported"] is True


# -- presets never carry personal / app state ----------------------------------
PERSONAL = {"saved_players": [{"steam_id": "1", "name": "Old"}], "saved_players_imported": True,
            "pg_pass": "secret", "pg_host": "h", "csdm_exe": "C:/old.exe", "config_dir": "appdata",
            "ui_sections": {"x": 1}, "ui_card_style": "tiles", "theme_accent": "red"}


def test_full_preset_save_strips_personal_state():
    preset = c.build_preset({**PERSONAL, "perspective": "pov", "steam_ids": ["7"]}, ["full"])
    assert preset["cats"] == ["full"]
    assert preset["data"] == {"perspective": "pov", "steam_ids": ["7"]}


def test_old_full_preset_load_strips_personal_state():
    data, keys, _ = c.preset_payload({"cats": ["full"], "data": {**PERSONAL, "perspective": "pov"}})
    assert keys is None
    assert data == {"perspective": "pov"}
    listed = c.normalize_presets({"p": {"cats": ["full"], "data": {**PERSONAL, "perspective": "pov"}}})
    assert listed["p"]["data"] == {"perspective": "pov"}
