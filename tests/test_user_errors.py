"""What the user sees when something fails (audit 2026-09-25, axis D).

Principle 4: zero Python traceback on screen, a readable sentence that says
what to do, and the full traceback kept in the error log for bug reports.
Every boundary -- bridge command, preview thread, run thread -- goes through
`csdm.errors.report`, so these tests pin the mapping and the boundaries.
"""
import io
import json
import re
from pathlib import Path
from unittest import mock

import psycopg2
import pytest

import csdm.config as config
from csdm.bridge.host import BridgeHost, PREVIEW_CFG_KEYS, _run_command, for_pipe
from csdm.bridge.protocol import LineWriter
from csdm.config import DEFAULT_CONFIG
from csdm.engine.core import EngineMixin
from csdm.engine.ports import CollectingPorts
from csdm.engine.state import EngineStateMixin
from csdm.errors import UserError, db_connect_message, report, user_message

PG = {"pg_host": "10.0.0.9", "pg_port": "5432", "pg_user": "trois",
      "pg_pass": "s3cret-pass", "pg_db": "csdm"}

# What a Python traceback or a raw exception repr looks like on screen.
RAW = re.compile(r"Traceback|File \".*\", line \d+|\b[A-Z]\w*(Error|Exception)\b: |^'\w+'$")


class _Host(EngineStateMixin, EngineMixin):
    def __init__(self, ports):
        self.init_engine_state()
        self.log, self.log_parts = ports.log, ports.log_parts
        self.state, self.ask = ports.state, ports.ask


def _host():
    ports = CollectingPorts()
    return _Host(ports.as_ports()), ports


def _cfg(**over):
    return {**DEFAULT_CONFIG, "steam_ids": ["1"], **PG, **over}


# -- the mapping ---------------------------------------------------------------

def test_user_error_text_passes_through_and_is_not_logged(_isolated_error_log):
    assert report(UserError("Pick a folder."), "doing x") == "Pick a folder."
    assert not _isolated_error_log.exists()


def test_unknown_exception_gets_a_generic_sentence_and_its_traceback_is_logged(
        _isolated_error_log):
    try:
        {}["steam_id"]
    except KeyError as exc:
        message = report(exc, "computing the preview")
    assert message.startswith("Unexpected error while computing the preview.")
    assert str(_isolated_error_log) in message
    assert "steam_id" not in message and not RAW.search(message)
    logged = _isolated_error_log.read_text(encoding="utf-8")
    assert "Traceback" in logged and "KeyError: 'steam_id'" in logged


def test_an_unwritable_log_never_replaces_the_real_problem(monkeypatch):
    monkeypatch.setattr(config, "error_log_path",
                        lambda: Path("Q:/no_such_drive/csdm_errors.log"))
    message = report(RuntimeError("boom"), "doing x")
    assert message == "Unexpected error while doing x."


@pytest.mark.parametrize("driver_text, expected", [
    ('FATAL:  password authentication failed for user "trois"', "Check User and Pass"),
    ('FATAL:  database "nope" does not exist', "Check Base"),
    ("Connection refused (0x0000274D/10061)", "Check that CS Demo Manager's database server"),
    ("timeout expired", "Check that CS Demo Manager's database server"),
    ("something new", "something new"),
])
def test_db_connect_failures_name_the_field_to_fix(driver_text, expected):
    message = db_connect_message(PG, psycopg2.OperationalError(driver_text))
    assert expected in message
    assert "10.0.0.9:5432" in message
    assert "SETTINGS › PostgreSQL Connection" in message
    assert PG["pg_pass"] not in message


def test_os_errors_name_the_file_and_the_settings_card():
    denied = PermissionError(13, "Access is denied", r"H:\CS\out")
    missing = FileNotFoundError(2, "No such file", r"C:\nope\x.json")
    assert r"H:\CS\out" in user_message(denied, "x") and "SETTINGS › Paths" in user_message(denied, "x")
    assert r"C:\nope\x.json" in user_message(missing, "x")
    assert not RAW.search(user_message(denied, "x"))


def test_a_missing_table_points_at_the_database_setting():
    exc = psycopg2.errors.UndefinedTable('relation "kills" does not exist\nLINE 1: ...')
    message = user_message(exc, "x")
    assert 'relation "kills" does not exist' in message and "LINE 1" not in message
    assert "Check that Base" in message


def test_a_connection_lost_mid_query_says_so():
    message = user_message(psycopg2.OperationalError("server closed the connection"), "x")
    assert message.startswith("Lost the connection to PostgreSQL")


# -- bridge commands -------------------------------------------------------------

def _command_result(host, command):
    out = io.StringIO()
    _run_command(host, LineWriter(out), command)
    return [json.loads(line) for line in out.getvalue().splitlines()][-1]


def test_a_crashing_command_shows_a_clean_sentence(_isolated_error_log):
    host = BridgeHost(mock.MagicMock())
    with mock.patch.object(BridgeHost, "list_all_demos", side_effect=KeyError("dc")):
        result = _command_result(host, {"type": "command", "id": "7", "name": "list_demos"})
    assert result["ok"] is False
    assert result["error"].startswith("Unexpected error while loading the demo list.")
    assert not RAW.search(result["error"])
    assert "KeyError: 'dc'" in _isolated_error_log.read_text(encoding="utf-8")


def test_a_refused_connection_reaches_the_card_as_an_actionable_sentence():
    host = BridgeHost(mock.MagicMock())
    with mock.patch("csdm.engine.core.psycopg2.connect",
                    side_effect=psycopg2.OperationalError(
                        'FATAL:  password authentication failed for user "trois"')):
        result = _command_result(host, {"type": "command", "id": "1", "name": "connect_db",
                                        "pg": PG})
    assert result["ok"] is False
    assert "Check User and Pass" in result["error"]
    assert not RAW.search(result["error"])


# -- preview and run threads -----------------------------------------------------

def _names(ports):
    return [name for name, _ in ports.states]


def test_a_failing_preview_shows_no_traceback_and_ends_busy(_isolated_error_log):
    host, ports = _host()
    host._previewing = True
    with mock.patch.object(_Host, "_query_events", side_effect=KeyError("tick")):
        host._preview_worker(_cfg())
    errors = [m for m, level in ports.logs if level == "err"]
    assert len(errors) == 1 and errors[0].startswith("✗ Preview failed: Unexpected error")
    assert not RAW.search(errors[0])
    assert ("summary", {"text": "  Preview failed — see the console.", "level": "err"}) in ports.states
    assert _names(ports)[-1] == "buttons_idle"
    assert "Traceback" in _isolated_error_log.read_text(encoding="utf-8")


def test_a_preview_that_matches_nothing_says_so():
    host, ports = _host()
    with mock.patch.object(_Host, "_query_events", return_value={}), \
            mock.patch.object(_Host, "_preparse_dp2"):
        host._preview_worker(_cfg())
    # The empty-result funnel (axis A) is what says so now.
    assert any("No clips" in m and level == "warn" for m, level in ports.logs)
    assert any(name == "summary" and "No clips" in p["text"] for name, p in ports.states)
    assert "preview_ready" in _names(ports) and _names(ports)[-1] == "buttons_idle"


def test_a_cancelled_preview_ends_busy_and_says_cancelled():
    host, ports = _host()
    host._previewing = True

    def cancel_during_query(cfg):
        host.cancel_preview()
        return {}
    with mock.patch.object(_Host, "_query_events", side_effect=cancel_during_query):
        host._preview_worker(_cfg())
    assert ("summary", {"text": "  Preview cancelled.", "level": "muted"}) in ports.states
    assert "preview_ready" not in _names(ports)
    assert _names(ports)[-1] == "buttons_idle"


def test_a_crashing_run_reports_cleanly_and_can_start_again(_isolated_error_log):
    host, ports = _host()
    host._running = True
    with mock.patch.object(_Host, "_run_batch",
                           side_effect=PermissionError(13, "Access is denied", r"H:\CS\out")):
        host._worker(_cfg())
    errors = [m for m, level in ports.logs if level == "err"]
    assert errors == ["\n✗ Run stopped: Windows refused access to H:\\CS\\out. Pick a folder "
                      "you can write to in SETTINGS › Paths, or close the program that is "
                      "using it."]
    assert _names(ports)[-1] == "buttons_idle"
    assert host._running is False
    assert "PermissionError" in _isolated_error_log.read_text(encoding="utf-8")


def test_a_run_that_ends_normally_is_no_longer_running():
    host, _ = _host()
    host._running = True
    with mock.patch.object(_Host, "_run_batch"):
        host._worker(_cfg())
    assert host._running is False


def test_a_missing_csdm_executable_names_the_setting(monkeypatch):
    host, ports = _host()
    monkeypatch.setattr("csdm.engine.core.shutil.which", lambda _: None)
    host._worker(_cfg(csdm_exe=r"C:\nope\csdm.CMD"))
    errors = [m for m, level in ports.logs if level == "err"]
    assert len(errors) == 1 and "set CSDM Executable in SETTINGS › Paths" in errors[0]
    assert _names(ports)[-1] == "buttons_idle"


# -- no password in the preview message ------------------------------------------

def test_preview_ready_carries_only_what_the_renderer_reads():
    payload = {"events": {}, "sequences": {}, "timings": None, "cfg": _cfg()}
    piped = for_pipe("preview_ready", payload)
    assert set(piped["cfg"]) == set(PREVIEW_CFG_KEYS)
    assert "pg_pass" not in json.dumps(piped)
    assert payload["cfg"]["pg_pass"] == PG["pg_pass"], "the engine's own cfg is untouched"


def test_the_bridge_host_never_writes_the_password_to_the_pipe():
    out = io.StringIO()
    from csdm.bridge.ports import PipePorts
    host = BridgeHost(PipePorts(LineWriter(out)))
    with mock.patch.object(BridgeHost, "_query_events", return_value={"d.dem": []}), \
            mock.patch.object(BridgeHost, "_preparse_dp2"):
        host._preview_worker(_cfg())
    assert '"preview_ready"' in out.getvalue()
    assert PG["pg_pass"] not in out.getvalue()


def test_every_state_that_carries_the_run_cfg_is_stripped():
    piped = for_pipe("demo_entry", {"demo_name": "d", "cfg": _cfg()})
    assert "pg_pass" not in json.dumps(piped) and piped["demo_name"] == "d"


def test_other_states_pass_through_unchanged():
    payload = {"text": "x", "level": "ok"}
    assert for_pipe("summary", payload) is payload


# -- settings that cannot be saved -----------------------------------------------

def test_an_unwritable_settings_folder_is_reported_not_swallowed(monkeypatch):
    with pytest.raises(UserError) as info:
        config._save_json(r"Q:\no_such_drive\csdm_config.json", {"a": 1})
    assert "Your changes are not saved" in str(info.value)


def test_moving_settings_to_a_missing_drive_says_what_to_do():
    with pytest.raises(UserError) as info:
        config.apply_config_dir(r"Q:\no_such_drive")
    assert "Choose a folder on a drive that exists" in str(info.value)
    assert "WinError" not in str(info.value)


def test_a_missing_tags_file_says_what_to_pick():
    with pytest.raises(UserError) as info:
        EngineMixin._read_tags_import_file(r"C:\nope\tags.json")
    assert "Pick an existing tags export file." in str(info.value)
    assert "Errno" not in str(info.value)


# -- regression guard -------------------------------------------------------------

def test_no_engine_or_bridge_code_formats_a_traceback_for_the_screen():
    root = Path(__file__).resolve().parent.parent / "csdm"
    offenders = [str(p) for p in [*root.glob("engine/*.py"), *root.glob("bridge/*.py")]
                 if re.search(r"traceback\.(format_exc|print_exc|format_exception)",
                              p.read_text(encoding="utf-8"))]
    assert offenders == []
