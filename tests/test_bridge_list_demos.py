"""`list_demos`: the manual-mode "load ALL demos from DB" bridge command.

Runs the real `BridgeHost`/`COMMANDS` chain (same pattern as
`test_connect_db_on_a_real_bridge_host_wires_discovered_state_end_to_end` in
test_bridge_e2e.py): only `psycopg2.connect` is mocked, everything else --
discovery, `_find_col`, the demo-picker formatting -- is the real engine
code. A full subprocess round trip (`describe_filters`'s pattern) cannot work
here: there is no real PostgreSQL server in CI to spawn a `python -m
csdm.bridge` process against, so mocking the one network call this deep is
the honest middle ground.

Demo "files" are real temporary files with a controlled mtime: `_get_demo_ts`
falls back to the file's mtime once no `.info` sidecar exists, so this is the
only way to make the compat check's timestamp comparison deterministic
without reaching into engine internals.
"""
import os
import tempfile
import unittest
from datetime import datetime
from unittest import mock

from csdm.bridge.host import BridgeHost, COMMANDS

MATCHES_SCHEMA = [("checksum", "text"), ("demo_path", "text"), ("match_date", "timestamp")]


class _FakeCursor:
    def __init__(self, demo_rows):
        self._demo_rows = demo_rows
        self._rows = []

    def execute(self, sql, params=None):
        if "information_schema.columns" in sql:
            table = params[0] if params else None
            self._rows = MATCHES_SCHEMA if table == "matches" else []
        elif "FROM matches m" in sql:
            self._rows = self._demo_rows
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
    def __init__(self, demo_rows):
        self._demo_rows = demo_rows

    def cursor(self):
        return _FakeCursor(self._demo_rows)

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


def _touch(tmp_path, name, mtime):
    """Create a real file whose mtime is `mtime` (a `datetime`), and return its path."""
    path = os.path.join(tmp_path, name)
    with open(path, "wb"):
        pass
    ts = mtime.timestamp()
    os.utime(path, (ts, ts))
    return path


def _connected_host(demo_rows):
    """A BridgeHost that already ran `connect_db` against a fake connection."""
    host = BridgeHost(_Ports())
    with mock.patch("csdm.engine.core.psycopg2.connect", return_value=_FakeConn([])):
        COMMANDS["connect_db"](host, {"id": "c1", "name": "connect_db",
                                      "pg": {"pg_host": "127.0.0.1"}})
    return host


class TestListDemos(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("list_demos", COMMANDS)

    def test_refuses_before_a_connection_exists(self):
        host = BridgeHost(_Ports())
        with self.assertRaises(ValueError):
            COMMANDS["list_demos"](host, {"id": "c1", "name": "list_demos"})

    def test_returns_one_row_per_demo_with_a_formatted_date_and_map(self):
        with tempfile.TemporaryDirectory() as tmp:
            demo_path = _touch(tmp, "recent.dem", datetime(2025, 8, 1, 10, 30))
            host = _connected_host([])
            host._demo_map_cache[demo_path] = "de_mirage"
            with mock.patch("csdm.engine.core.psycopg2.connect",
                             return_value=_FakeConn([(demo_path, "chk1", None)])):
                result = COMMANDS["list_demos"](host, {"id": "c2", "name": "list_demos"})

            demos = result["data"]["demos"]
            self.assertEqual(len(demos), 1)
            self.assertEqual(demos[0]["path"], demo_path)
            self.assertEqual(demos[0]["map"], "mirage")
            self.assertEqual(demos[0]["date"], "01-08-2025 10:30")
            self.assertEqual(demos[0]["compat"]["status"], "ok")

    def test_flags_a_demo_recorded_before_the_most_recent_cs2_breaking_update(self):
        # Sorted newest-first (core.py's `_CS2_DEMO_BREAKS`), so a demo old
        # enough to predate BOTH cutoffs is reported against the more recent
        # one (AnimGraph2, Jul 2025) -- the same "match the most recent break
        # first" rule the Tkinter window's own `_check_demo_compat` used.
        with tempfile.TemporaryDirectory() as tmp:
            demo_path = _touch(tmp, "old.dem", datetime(2024, 1, 1))
            host = _connected_host([])
            with mock.patch("csdm.engine.core.psycopg2.connect",
                             return_value=_FakeConn([(demo_path, "chk2", None)])):
                result = COMMANDS["list_demos"](host, {"id": "c3", "name": "list_demos"})

            demo = result["data"]["demos"][0]
            self.assertEqual(demo["compat"]["status"], "warn")
            self.assertEqual(demo["compat"]["break"], "AnimGraph2")
            self.assertIn("AnimGraph2", demo["compat"]["tip"])

    def test_drops_rows_with_no_demo_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            demo_path = _touch(tmp, "kept.dem", datetime(2025, 1, 1))
            host = _connected_host([])
            with mock.patch("csdm.engine.core.psycopg2.connect",
                             return_value=_FakeConn([(None, "chk3", None), (demo_path, "chk4", None)])):
                result = COMMANDS["list_demos"](host, {"id": "c4", "name": "list_demos"})

            demos = result["data"]["demos"]
            self.assertEqual([d["path"] for d in demos], [demo_path])

    def test_engine_module_imports_no_tkinter(self):
        import pathlib
        source = pathlib.Path("csdm/engine/core.py").read_text(encoding="utf-8")
        self.assertNotIn("tkinter", source)


if __name__ == "__main__":
    unittest.main()
