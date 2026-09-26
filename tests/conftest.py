"""Suite-wide isolation.

`csdm.errors.report` writes unexpected errors to a log in the active settings
folder. Tests raise such errors on purpose; none of them may land in the real
settings folder (context_guide.md §1 P11), so every test gets its own log.
"""
import pytest


@pytest.fixture(autouse=True, scope="session")
def _isolated_profile(tmp_path_factory):
    """No test may read or write the user's real settings folder.

    The Tkinter window test (test_ui_filter_rows) builds the real `App`, whose
    auto-save rewrote <repo>/CSDM-batch-clip_config/csdm_config.json with only
    the keys that window knows -- every `python -m pytest` run from the main
    checkout erased the Electron window's favourites (`saved_players`), its
    layout and its config folder choice. Session scope, so it is in place
    before any unittest `setUpClass`; the env vars reach bridge subprocesses.
    """
    import csdm.config as c

    root = tmp_path_factory.mktemp("profile")
    patch = pytest.MonkeyPatch()
    patch.setenv("CSDM_PROFILE_ROOT", str(root))
    patch.setenv("LOCALAPPDATA", str(root / "appdata"))
    patch.setattr(c, "_ROOT", root)
    patch.setattr(c, "_ACTIVE_DIR", None)
    yield root
    patch.undo()


@pytest.fixture(autouse=True)
def _isolated_error_log(tmp_path, monkeypatch):
    log = tmp_path / "csdm_errors.log"
    monkeypatch.setattr("csdm.config.error_log_path", lambda: log)
    return log
