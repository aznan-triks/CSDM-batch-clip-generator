"""Config folder location tests (v3.0.1).

Covers the `config_dir` mechanism end to end:
  * resolve_config_dir: script subfolder / Local AppData / custom parent
  * legacy migration: flat files beside the entry point -> default subfolder
  * bootstrap pointer: the default-location config records the live location
  * probe: current status, conflicts, same-target detection
  * apply: copy never move, timestamped backup on conflict, pointer update
  * save_config / load_presets follow the active directory
"""
import json
import os
import shutil

import pytest

import csdm.config as c


@pytest.fixture()
def isolated(tmp_path, monkeypatch):
    """Point the module at a scratch project; reset the cached active dir."""
    project = tmp_path / "project"
    project.mkdir()
    appdata = tmp_path / "appdata"
    appdata.mkdir()
    monkeypatch.setattr(c, "_ROOT", project)
    monkeypatch.setenv("LOCALAPPDATA", str(appdata))
    monkeypatch.setattr(c, "_ACTIVE_DIR", None)
    return {"project": project, "appdata": appdata}


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _seed_legacy(project, host="legacy-host"):
    for name in c.CONFIG_FILENAMES:
        payload = {"pg_host": host} if name == "csdm_config.json" else {"seeded": True}
        _write(project / name, payload)


# ── resolve_config_dir ──────────────────────────────────────────────────────

def test_resolve_default_is_script_subfolder(isolated):
    assert c.resolve_config_dir("") == isolated["project"] / c.CONFIG_SUBDIR


def test_resolve_appdata_sentinel(isolated):
    assert c.resolve_config_dir("appdata") == isolated["appdata"] / c.CONFIG_SUBDIR


def test_resolve_custom_creates_subfolder_inside(isolated):
    from pathlib import Path
    assert c.resolve_config_dir("D:/x") == Path("D:/x") / c.CONFIG_SUBDIR


# ── legacy migration ────────────────────────────────────────────────────────

def test_legacy_flat_files_are_copied_into_subfolder_never_moved(isolated):
    _seed_legacy(isolated["project"])
    cfg = c.load_config()
    assert cfg["pg_host"] == "legacy-host"
    sub = isolated["project"] / c.CONFIG_SUBDIR
    assert (sub / "csdm_config.json").exists()
    assert (sub / "csdm_presets.json").exists()
    # The originals stay: copy, never move.
    assert (isolated["project"] / "csdm_config.json").exists()


def test_migration_is_idempotent(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    first = _read(isolated["project"] / c.CONFIG_SUBDIR / "csdm_config.json")
    c.load_config()
    second = _read(isolated["project"] / c.CONFIG_SUBDIR / "csdm_config.json")
    assert first == second


def test_no_legacy_files_yields_defaults(isolated):
    cfg = c.load_config()
    assert cfg["config_dir"] == ""
    assert cfg["pg_host"] == "127.0.0.1"


# ── bootstrap pointer ───────────────────────────────────────────────────────

def test_load_follows_pointer_to_appdata(isolated):
    _seed_legacy(isolated["project"])
    c.apply_config_dir("appdata")
    c._ACTIVE_DIR = None  # simulate a fresh process
    cfg = c.load_config()
    assert cfg["config_dir"] == "appdata"
    assert cfg["pg_host"] == "legacy-host"


def test_bootstrap_falls_back_when_pointed_folder_missing(isolated):
    _seed_legacy(isolated["project"])
    c.apply_config_dir("appdata")
    # Wipe the pointed-to folder: next launch must land on the default subfolder.
    shutil.rmtree(isolated["appdata"] / c.CONFIG_SUBDIR)
    c._ACTIVE_DIR = None
    cfg = c.load_config()
    assert cfg["config_dir"] == "appdata"  # the pointer value, but from the default copy
    assert cfg["pg_host"] == "legacy-host"


# ── probe ───────────────────────────────────────────────────────────────────

def test_probe_status_read(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    p = c.probe_config_dir()
    assert p["same"] is True
    assert p["conflicts"] == []
    assert p["current"] == str(isolated["project"] / c.CONFIG_SUBDIR)


def test_probe_lists_conflicts_at_target(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    target = isolated["appdata"] / c.CONFIG_SUBDIR
    target.mkdir(parents=True)
    _write(target / "csdm_config.json", {"foreign": True})
    p = c.probe_config_dir("appdata")
    assert p["same"] is False
    assert "csdm_config.json" in p["conflicts"]
    assert "csdm_presets.json" not in p["conflicts"]


# ── apply: copy never move, backup, pointer ─────────────────────────────────

def test_apply_copies_and_keeps_source(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    c.apply_config_dir("appdata")
    target = isolated["appdata"] / c.CONFIG_SUBDIR
    assert (target / "csdm_config.json").exists()
    assert (target / "csdm_presets.json").exists()
    # The default location keeps its files: copy, never move.
    assert (isolated["project"] / c.CONFIG_SUBDIR / "csdm_config.json").exists()
    assert (isolated["project"] / c.CONFIG_SUBDIR / "csdm_presets.json").exists()


def test_apply_records_location_in_live_and_pointer_copy(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    c.apply_config_dir("appdata")
    live = _read(isolated["appdata"] / c.CONFIG_SUBDIR / "csdm_config.json")
    pointer = _read(isolated["project"] / c.CONFIG_SUBDIR / "csdm_config.json")
    assert live["config_dir"] == "appdata"
    assert pointer["config_dir"] == "appdata"
    assert live["pg_host"] == "legacy-host"


def test_apply_backs_up_conflicting_target_files(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    target = isolated["appdata"] / c.CONFIG_SUBDIR
    target.mkdir(parents=True)
    _write(target / "csdm_config.json", {"pg_host": "foreign"})
    _write(target / "csdm_presets.json", {"keep": "me"})
    c.apply_config_dir("appdata")
    backups = list(target.glob("backup-*"))
    assert len(backups) == 1
    saved = _read(backups[0] / "csdm_config.json")
    assert saved["pg_host"] == "foreign"
    assert (backups[0] / "csdm_presets.json").exists()
    # The live copy now holds the source's values, not the foreign ones.
    assert _read(target / "csdm_config.json")["pg_host"] == "legacy-host"


def test_apply_back_to_default_resets_pointer(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    c.apply_config_dir("appdata")
    c.apply_config_dir("")
    default_cfg = _read(isolated["project"] / c.CONFIG_SUBDIR / "csdm_config.json")
    assert default_cfg["config_dir"] == ""
    assert default_cfg["pg_host"] == "legacy-host"
    # The appdata copy stays behind as a snapshot with its old location value.
    appdata_cfg = _read(isolated["appdata"] / c.CONFIG_SUBDIR / "csdm_config.json")
    assert appdata_cfg["config_dir"] == "appdata"


def test_apply_to_same_target_is_noop(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    before = sorted(p.name for p in (isolated["project"] / c.CONFIG_SUBDIR).iterdir())
    p = c.apply_config_dir("")
    assert p["same"] is True
    after = sorted(p.name for p in (isolated["project"] / c.CONFIG_SUBDIR).iterdir())
    assert before == after


def test_apply_creates_custom_subfolder(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    custom = isolated["project"] / "user-choice"
    c.apply_config_dir(str(custom))
    assert (custom / c.CONFIG_SUBDIR / "csdm_config.json").exists()
    cfg = _read(custom / c.CONFIG_SUBDIR / "csdm_config.json")
    assert cfg["config_dir"] == str(custom)
    assert _read(isolated["project"] / c.CONFIG_SUBDIR / "csdm_config.json")["config_dir"] == str(custom)


# ── dynamic loaders / savers ────────────────────────────────────────────────

def test_save_config_writes_to_resolved_dir(isolated):
    _seed_legacy(isolated["project"])
    cfg = c.load_config()
    cfg["config_dir"] = "appdata"
    c.save_config(cfg)
    live = _read(isolated["appdata"] / c.CONFIG_SUBDIR / "csdm_config.json")
    assert live["config_dir"] == "appdata"
    assert live["pg_host"] == "legacy-host"


def test_presets_follow_active_dir(isolated):
    _seed_legacy(isolated["project"])
    c.load_config()
    c.save_presets({"alpha": {"cats": ["full"], "data": {}}})
    assert (isolated["project"] / c.CONFIG_SUBDIR / "csdm_presets.json").exists()
    c.apply_config_dir("appdata")
    c.save_presets({"beta": {"cats": ["full"], "data": {}}})
    assert (isolated["appdata"] / c.CONFIG_SUBDIR / "csdm_presets.json").exists()
    assert c.load_presets() == {"beta": {"cats": ["full"], "data": {}}}
