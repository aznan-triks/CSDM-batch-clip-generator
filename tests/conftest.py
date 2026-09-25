"""Suite-wide isolation.

`csdm.errors.report` writes unexpected errors to a log in the active settings
folder. Tests raise such errors on purpose; none of them may land in the real
settings folder (context_guide.md §1 P11), so every test gets its own log.
"""
import pytest


@pytest.fixture(autouse=True)
def _isolated_error_log(tmp_path, monkeypatch):
    log = tmp_path / "csdm_errors.log"
    monkeypatch.setattr("csdm.config.error_log_path", lambda: log)
    return log
