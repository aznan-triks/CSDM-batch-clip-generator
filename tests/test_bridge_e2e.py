"""Drive the bridge as a real subprocess -- the only honest way to test a pipe."""
import json
import subprocess
import sys
import unittest

import pytest


def _run(commands, timeout=30):
    """Feed JSON lines in, collect JSON messages out."""
    proc = subprocess.run(
        [sys.executable, "-m", "csdm.bridge"],
        input="".join(json.dumps(c) + "\n" for c in commands),
        capture_output=True, text=True, timeout=timeout, encoding="utf-8")
    messages = []
    for line in proc.stdout.split("\n"):
        if line.strip():
            messages.append(json.loads(line))
    return proc, messages


class TestBridgeEndToEnd(unittest.TestCase):
    def test_ping_answers_with_a_result(self):
        proc, msgs = _run([{"type": "command", "id": "1", "name": "ping"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        results = [m for m in msgs if m["type"] == "result"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], "1")
        self.assertTrue(results[0]["ok"])

    # -- configuration and presets -------------------------------------------
    # Note: save_config and save_preset write to the project's own files. None
    # of these tests calls a writing command with valid arguments, on purpose.

    def test_load_config_returns_the_saved_configuration(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "load_config"}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertTrue(results[0]["ok"], results[0].get("error"))
        self.assertIn("crf", results[0]["data"], "a real configuration has a crf key")

    def test_save_config_without_a_cfg_object_fails_with_one_sentence(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "save_config"}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertFalse(results[0]["ok"])
        self.assertIn("cfg", results[0]["error"])
        self.assertNotIn("Traceback", results[0]["error"])

    def test_list_presets_answers_with_an_object(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "list_presets"}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertTrue(results[0]["ok"], results[0].get("error"))
        self.assertIsInstance(results[0]["data"], dict)

    def test_save_preset_without_a_name_fails_readably(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "save_preset",
                         "cats": ["date"], "cfg": {}}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertFalse(results[0]["ok"])
        self.assertIn("name", results[0]["error"])

    def test_delete_preset_that_does_not_exist_fails_instead_of_rewriting(self):
        """A typo must not report a deletion that never happened."""
        _, msgs = _run([{"type": "command", "id": "1", "name": "delete_preset",
                         "preset": "no-such-preset-4a"}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertFalse(results[0]["ok"])
        self.assertIn("no-such-preset-4a", results[0]["error"])

    def test_load_preset_that_does_not_exist_fails_readably(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "load_preset",
                         "preset": "no-such-preset-4a"}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertFalse(results[0]["ok"])
        self.assertIn("no-such-preset-4a", results[0]["error"])

    # -- launching --------------------------------------------------------
    # Refusals are tested with no account and no event, on purpose: a valid
    # configuration would start a real CSDM process from the test suite.

    def test_start_run_refuses_an_empty_configuration_over_the_pipe(self):
        """No account, no event: the engine must ask, not launch.

        The refusal goes out on `ask`, which blocks the command thread until
        the renderer dismisses it -- exactly like the modal it replaces. The
        answer is queued up front, as in test_ask_round_trip_across_the_pipe.
        """
        _, msgs = _run([{"type": "command", "id": "1", "name": "start_run",
                         "cfg": {"steam_ids": [], "events": []}},
                        {"type": "answer", "id": "1", "value": None}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertTrue(results[0]["ok"], results[0].get("error"))
        self.assertFalse(results[0]["started"])
        asks = [m for m in msgs if m["type"] == "ask"]
        self.assertTrue(asks, "the refusal must travel on the ask channel")
        self.assertEqual(asks[0]["kind"], "error")

    def test_start_preview_refuses_an_empty_configuration_over_the_pipe(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "start_preview",
                         "cfg": {"steam_ids": [], "events": []}},
                        {"type": "answer", "id": "1", "value": None}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertFalse(results[0]["started"])

    def test_start_run_without_a_cfg_object_fails_with_one_sentence(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "start_run"}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertFalse(results[0]["ok"])
        self.assertIn("cfg", results[0]["error"])
        self.assertNotIn("Traceback", results[0]["error"])

    def test_every_command_the_renderer_needs_is_registered(self):
        """The shopping list for chantier 4a, checked in one place."""
        from csdm.bridge.host import COMMANDS
        for name in ("connect_db", "load_config", "save_config", "list_presets",
                     "save_preset", "load_preset", "delete_preset",
                     "start_run", "start_preview",
                     "request_stop", "request_kill", "cancel_preview"):
            self.assertIn(name, COMMANDS, name)

    def test_logs_stream_before_the_result(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "demo_logs"}])
        types = [m["type"] for m in msgs]
        self.assertIn("log", types)
        self.assertIn("log_parts", types)
        self.assertIn("state", types)
        self.assertEqual(types[-1], "result", "the result must close the exchange")

    def test_ask_round_trip_across_the_pipe(self):
        proc, msgs = _run([
            {"type": "command", "id": "1", "name": "demo_ask"},
            # The host is fed both lines at once; the answer waits in the buffer
            # until the reader gets to it, which is exactly the real case.
            {"type": "answer", "id": "1", "value": "include"},
        ])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        asks = [m for m in msgs if m["type"] == "ask"]
        self.assertEqual(len(asks), 1)
        self.assertTrue(any("include" in m.get("message", "")
                            for m in msgs if m["type"] == "log"))

    def test_a_garbage_line_does_not_kill_the_host(self):
        proc, msgs = _run(["not json", {"type": "command", "id": "2", "name": "ping"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(any(m["type"] == "result" and m["id"] == "2" for m in msgs))

    def test_unknown_command_fails_loudly_but_does_not_crash(self):
        proc, msgs = _run([{"type": "command", "id": "3", "name": "nope"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = [m for m in msgs if m["type"] == "result"][0]
        self.assertFalse(result["ok"])
        self.assertTrue(result["error"])

    def test_stop_is_reachable_over_the_pipe(self):
        """The whole point of 3.5: an interface with no window can stop a run."""
        proc, msgs = _run([{"type": "command", "id": "1", "name": "request_stop"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = [m for m in msgs if m["type"] == "result"][0]
        self.assertTrue(result["ok"], result.get("error"))

    def test_preview_cancellation_is_reachable_over_the_pipe(self):
        """Also the non-ASCII guard: this path logs "⏸ Preview cancelled.".

        On Windows the child's stdout defaults to the console codepage, which
        cannot encode that character -- the command failed and the line was
        lost. The entry point now forces UTF-8 on both ends.
        """
        proc, msgs = _run([{"type": "command", "id": "1", "name": "cancel_preview"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = [m for m in msgs if m["type"] == "result"][0]
        self.assertTrue(result["ok"], result.get("error"))
        self.assertTrue(any(m["type"] == "state" and m["name"] == "buttons" for m in msgs))

    def test_kill_reports_the_request_then_the_confirmed_exit(self):
        """The two events the interface stages its charge on, over the real pipe.

        cs2.exe is not running here, so the wait ends on the first look -- which
        is the point: the exit event is reported because the task list said so.
        """
        proc, msgs = _run([{"type": "command", "id": "1", "name": "request_kill"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        states = [m["name"] for m in msgs if m["type"] == "state"]
        self.assertIn("kill_requested", states)
        self.assertIn("process_exited", states)
        self.assertLess(states.index("kill_requested"), states.index("process_exited"))

    def test_the_child_never_imports_tkinter(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "tkinter_check"}])
        check = [m for m in msgs if m["type"] == "log" and "tkinter" in m["message"]]
        self.assertTrue(check)
        self.assertIn("none", check[0]["message"].lower())


def test_connect_db_is_a_registered_command():
    from csdm.bridge.host import COMMANDS
    assert "connect_db" in COMMANDS


def test_connect_db_adopts_the_result_and_returns_it(monkeypatch):
    """One command: read the database, adopt it, hand the payload to the renderer."""
    from csdm.bridge.host import COMMANDS

    class FakeHost:
        def __init__(self):
            self.adopted = None
            self.pg_params = None

        def set_pg_params(self, params):
            self.pg_params = params

        def discover_database(self):
            return {"date_col": "date", "players": [], "maps": []}

        def apply_discovery(self, data):
            self.adopted = data

        def discovery_to_json(self, data):
            return {"date_col": data["date_col"], "players": [], "maps": []}

    host = FakeHost()
    result = COMMANDS["connect_db"](host, {"id": "c1", "name": "connect_db"})

    assert host.adopted["date_col"] == "date"
    assert result["data"]["date_col"] == "date"
    assert host.pg_params is not None  # resolved from the saved configuration


def test_connect_db_passes_an_explicit_pg_object_through_to_set_pg_params():
    """A renderer that has no saved config yet can still supply credentials inline."""
    from csdm.bridge.host import COMMANDS

    class FakeHost:
        def __init__(self):
            self.pg_params = None

        def set_pg_params(self, params):
            self.pg_params = params

        def discover_database(self):
            return {"date_col": None, "players": [], "maps": []}

        def apply_discovery(self, data):
            pass

        def discovery_to_json(self, data):
            return data

    host = FakeHost()
    COMMANDS["connect_db"](host, {
        "id": "c1", "name": "connect_db",
        "pg": {"pg_host": "10.1.2.3", "pg_port": "5433", "pg_db": "custom"},
    })

    assert host.pg_params["pg_host"] == "10.1.2.3"
    assert host.pg_params["pg_port"] == "5433"
    assert host.pg_params["pg_db"] == "custom"
    # keys not supplied inline fall back to the saved/default configuration
    assert "pg_user" in host.pg_params and "pg_pass" in host.pg_params


def test_connect_db_reports_a_readable_error(monkeypatch):
    from csdm.bridge.host import COMMANDS

    class FailingHost:
        def set_pg_params(self, params):
            pass

        def discover_database(self):
            raise RuntimeError("could not connect to server")

    with pytest.raises(RuntimeError):
        COMMANDS["connect_db"](FailingHost(), {"id": "c2", "name": "connect_db"})


def test_connect_db_on_a_real_bridge_host_wires_discovered_state_end_to_end():
    """Finding 3 (minor): the earlier tests only drove hand-written fakes, so the
    real discover_database/apply_discovery/discovery_to_json chain, running with
    a real (empty) `_pg_params` seeded through `set_pg_params`, was never
    exercised. This is the regression guard for the critical finding: only the
    psycopg2 connection itself is mocked, everything else is the real bridge.
    """
    from unittest import mock

    from csdm.bridge.host import BridgeHost, COMMANDS

    class _FakeCursor:
        def __init__(self):
            self._rows = []

        def execute(self, sql, params=None):
            table = params[0] if params else None
            if "information_schema.columns" in sql and table == "matches":
                self._rows = [("checksum", "text"), ("match_date", "timestamp")]
            elif "information_schema.columns" in sql:
                self._rows = []
            else:
                self._rows = []

        def fetchall(self):
            return self._rows

        def fetchone(self):
            return None

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _FakeConn:
        def cursor(self):
            return _FakeCursor()

        def commit(self):
            pass

        def close(self):
            pass

        @property
        def closed(self):
            return False

    class _Ports:
        def log(self, message, level=""):
            pass

        def log_parts(self, parts):
            pass

        def state(self, name, payload=None):
            pass

        def ask(self, kind, message, options):
            return None

    host = BridgeHost(_Ports())
    with mock.patch("csdm.engine.core.psycopg2.connect", return_value=_FakeConn()):
        result = COMMANDS["connect_db"](host, {"id": "c1", "name": "connect_db",
                                                "pg": {"pg_host": "127.0.0.1"}})

    assert result["data"] is not None
    # apply_discovery actually ran against real engine state, not a fake
    assert host._db_schema.get("matches") == ["checksum", "match_date"]
    assert host._pg_params["pg_host"] == "127.0.0.1"


class TestHelloBanner(unittest.TestCase):
    """The engine says nothing on its own; `hello` is how the window asks it to.

    A banner emitted spontaneously at start-up would be written before the
    Electron window exists, and `main.js` drops anything sent to a window that
    is not there yet. Making it a command means the renderer only ever asks
    once it is already listening, so the banner cannot be lost.
    """

    def test_hello_reports_the_version(self):
        from csdm.version import APP_VERSION

        _, msgs = _run([{"type": "command", "id": "1", "name": "hello"}])
        results = [m for m in msgs if m["type"] == "result"]
        self.assertTrue(results[0]["ok"], results[0].get("error"))
        self.assertEqual(results[0]["data"]["app_version"], APP_VERSION)
        self.assertTrue(results[0]["data"]["python_version"])

    def test_hello_writes_the_banner_to_the_console(self):
        from csdm.version import APP_VERSION

        _, msgs = _run([{"type": "command", "id": "1", "name": "hello"}])
        logs = [m for m in msgs if m["type"] == "log"]
        self.assertTrue(logs, "hello must speak on the log socket, not only return")
        banner = "\n".join(m["message"] for m in logs)
        self.assertIn(APP_VERSION, banner)
        self.assertIn("engine ready", banner.lower())

    def test_hello_says_how_many_settings_it_loaded(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "hello"}])
        banner = "\n".join(m["message"] for m in msgs if m["type"] == "log")
        self.assertRegex(banner, r"\d+ settings")


class TestVersionIsReadableWithoutTkinter(unittest.TestCase):
    """`csdm/version.py` exists so both hosts can name the build.

    The bridge must never import the Tkinter entry point, so the constant
    cannot live only there -- and duplicating it would let the two copies
    drift apart.
    """

    def test_main_file_does_not_redefine_the_version(self):
        import pathlib
        import re

        source = pathlib.Path("csdm_batch_clips_generator.py").read_text(encoding="utf-8")
        self.assertIsNone(
            re.search(r'^APP_VERSION\s*=\s*["\']', source, re.M),
            "APP_VERSION must be imported from csdm.version, never redefined here")

    def test_version_module_imports_no_tkinter(self):
        import pathlib

        source = pathlib.Path("csdm/version.py").read_text(encoding="utf-8")
        self.assertNotIn("tkinter", source)


if __name__ == "__main__":
    unittest.main()
