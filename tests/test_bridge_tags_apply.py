"""`tags_apply` / `tags_remove` / `tag_create` / `tag_delete`: the tag
mutation bridge commands.

Same e2e pattern as `test_bridge_tags_search.py`: runs the real
`BridgeHost`/`COMMANDS` chain, only `psycopg2.connect` is mocked. The tag
schema/list are adopted directly onto the host, mirroring what
`connect_db` -> `apply_discovery` would set (see `test_db_discovery.py`
for the discovery SQL itself, out of scope here).
"""
import unittest
from unittest import mock

from csdm.bridge.host import BridgeHost, COMMANDS


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows
        self._last = []

    def execute(self, sql, params=None):
        self._last = self._rows

    def fetchall(self):
        return self._last

    def fetchone(self):
        return self._last[0] if self._last else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _FakeConn:
    def __init__(self, rows):
        self._rows = rows

    def cursor(self):
        return _FakeCursor(self._rows)

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


TAGS_SCHEMA = {
    "table": "tags", "id_col": "id", "id_col_type": "bigint",
    "name_col": "name", "color_col": "color",
    "junction_table": "checksum_tags", "jt_tag_col": "tag_id",
    "jt_match_col": "checksum", "jt_col_types": {},
}


def _tagged_host(tags_schema=TAGS_SCHEMA, tags_list=None):
    """A BridgeHost with tag schema/db schema adopted directly, no live DB."""
    host = BridgeHost(_Ports())
    host.set_pg_params({"pg_host": "h", "pg_port": 5432, "pg_user": "u",
                        "pg_pass": "p", "pg_db": "d"})
    host._tags_schema = tags_schema
    host._tags_list = tags_list if tags_list is not None else [
        (1, "Ace", "#ff0000"), (2, "Clutch", "#00ff00")]
    host._db_schema = {"matches": ["checksum", "demo_path", "match_date"]}
    return host


class TestTagsApply(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tags_apply", COMMANDS)

    def test_requires_demo_paths(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_apply"](host, {"id": "c1", "name": "tags_apply",
                                           "tag_names": ["Ace"], "demo_paths": []})

    def test_requires_tag_names(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_apply"](host, {"id": "c2", "name": "tags_apply",
                                           "tag_names": [], "demo_paths": ["a.dem"]})

    def test_applies_tags_to_demos(self):
        host = _tagged_host()
        host._demo_checksums = {"a.dem": "chk-a", "b.dem": "chk-b"}
        with mock.patch("csdm.engine.core.psycopg2.connect",
                         return_value=_FakeConn([])):
            result = COMMANDS["tags_apply"](
                host, {"id": "c3", "name": "tags_apply",
                       "tag_names": ["Ace", "Clutch"],
                       "demo_paths": ["a.dem", "b.dem"]})

        data = result["data"]
        self.assertEqual(data["total"], 4)
        self.assertEqual(data["ok_count"], 4)
        self.assertEqual(data["first_error"], "")

    def test_reports_first_error_when_checksum_missing(self):
        host = _tagged_host()
        host._demo_checksums = {}
        with mock.patch("csdm.engine.core.psycopg2.connect",
                         return_value=_FakeConn([])):
            result = COMMANDS["tags_apply"](
                host, {"id": "c4", "name": "tags_apply",
                       "tag_names": ["Ace"], "demo_paths": ["missing.dem"]})

        data = result["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["ok_count"], 0)
        self.assertIn("Checksum not found", data["first_error"])


class TestTagsRemove(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tags_remove", COMMANDS)

    def test_requires_demo_paths(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_remove"](host, {"id": "c1", "name": "tags_remove",
                                            "tag_names": ["Ace"], "demo_paths": []})

    def test_requires_tag_names(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_remove"](host, {"id": "c2", "name": "tags_remove",
                                            "tag_names": [], "demo_paths": ["a.dem"]})

    def test_removes_tags_from_demos(self):
        host = _tagged_host()
        host._demo_checksums = {"a.dem": "chk-a"}
        with mock.patch("csdm.engine.core.psycopg2.connect",
                         return_value=_FakeConn([])):
            result = COMMANDS["tags_remove"](
                host, {"id": "c3", "name": "tags_remove",
                       "tag_names": ["Ace", "Clutch"], "demo_paths": ["a.dem"]})

        data = result["data"]
        self.assertEqual(data["total"], 2)
        self.assertEqual(data["ok_count"], 2)
        self.assertEqual(data["first_error"], "")

    def test_reports_first_error_when_tag_unknown(self):
        host = _tagged_host()
        host._demo_checksums = {"a.dem": "chk-a"}
        with mock.patch("csdm.engine.core.psycopg2.connect",
                         return_value=_FakeConn([])):
            result = COMMANDS["tags_remove"](
                host, {"id": "c4", "name": "tags_remove",
                       "tag_names": ["Nope"], "demo_paths": ["a.dem"]})

        data = result["data"]
        self.assertEqual(data["ok_count"], 0)
        self.assertIn("not found", data["first_error"])


class TestTagCreate(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tag_create", COMMANDS)

    def test_requires_a_name(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tag_create"](host, {"id": "c1", "name": "tag_create",
                                           "tag_name": "", "color": "#fff"})

    def test_creates_a_tag_and_returns_its_id(self):
        host = _tagged_host()
        with mock.patch("csdm.engine.core.psycopg2.connect",
                         return_value=_FakeConn([])):
            result = COMMANDS["tag_create"](
                host, {"id": "c2", "name": "tag_create",
                       "tag_name": "Wallbang", "color": "#123456"})

        data = result["data"]
        self.assertEqual(data["tag_name"], "Wallbang")
        self.assertIn("tag_id", data)
        self.assertTrue(any(t[1] == "Wallbang" for t in host._tags_list))


class TestTagDelete(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tag_delete", COMMANDS)

    def test_requires_a_tag_id(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tag_delete"](host, {"id": "c1", "name": "tag_delete", "tag_id": None})

    def test_deletes_a_tag(self):
        host = _tagged_host()
        with mock.patch("csdm.engine.core.psycopg2.connect",
                         return_value=_FakeConn([])):
            result = COMMANDS["tag_delete"](
                host, {"id": "c2", "name": "tag_delete", "tag_id": 1})

        self.assertEqual(result["data"], {"ok": True})
        self.assertFalse(any(t[0] == 1 for t in host._tags_list))


class TestEngineModuleStillTkinterFree(unittest.TestCase):
    def test_engine_module_imports_no_tkinter(self):
        import pathlib
        source = pathlib.Path("csdm/engine/core.py").read_text(encoding="utf-8")
        self.assertNotIn("tkinter", source)


if __name__ == "__main__":
    unittest.main()
