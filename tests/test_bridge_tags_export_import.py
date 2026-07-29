"""`tags_export` / `tags_import_scan` / `tags_import_apply`: the tag
export/import bridge commands.

Same e2e pattern as `test_bridge_tags_apply.py`: runs the real
`BridgeHost`/`COMMANDS` chain, only `psycopg2.connect` is mocked. The export
and import files are real temporary files -- these commands do real
`Path.read_text`/`Path.write_text` work, so faking the filesystem here would
leave that part of the port unverified.

The blocking `TagImportMissingDialog` the original `_tags_import_worker`
used is gone by design: `tags_import_scan` reports what is missing without
writing anything, and `tags_import_apply` creates whatever the caller
decided to create and replays the assignments. No `ask` round trip.
"""
import json
import os
import tempfile
import unittest
from unittest import mock

from csdm.bridge.host import BridgeHost, COMMANDS


class _FakeCursor:
    """Dispatches on SQL content: tag rows for `FROM tags`, assignment rows
    for the junction table, and a generic "found" row for anything else
    (checksum-in-db checks, duplicate-link checks) unless told otherwise."""

    def __init__(self, tag_rows=None, assignment_rows=None, found=True):
        self._tag_rows = tag_rows or []
        self._assignment_rows = assignment_rows or []
        self._found = found
        self._rows = []

    def execute(self, sql, params=None):
        if "FROM tags" in sql and "INSERT" not in sql:
            self._rows = self._tag_rows
        elif "checksum_tags" in sql and "SELECT" in sql:
            self._rows = self._assignment_rows
        elif "FROM matches" in sql:
            self._rows = [(1,)] if self._found else []
        else:
            self._rows = []

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _FakeConn:
    def __init__(self, tag_rows=None, assignment_rows=None, found=True):
        self._tag_rows = tag_rows
        self._assignment_rows = assignment_rows
        self._found = found

    def cursor(self):
        return _FakeCursor(self._tag_rows, self._assignment_rows, self._found)

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


def _tagged_host(tags_list=None):
    host = BridgeHost(_Ports())
    host.set_pg_params({"pg_host": "h", "pg_port": 5432, "pg_user": "u",
                        "pg_pass": "p", "pg_db": "d"})
    host._tags_schema = TAGS_SCHEMA
    host._tags_list = tags_list if tags_list is not None else [
        (1, "Ace", "#ff0000"), (2, "Clutch", "#00ff00")]
    host._db_schema = {"matches": ["checksum", "demo_path", "match_date"]}
    return host


class TestTagsExport(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tags_export", COMMANDS)

    def test_writes_a_json_file_with_tags_and_assignments(self):
        host = _tagged_host()
        tag_rows = [(1, "Ace", "#ff0000"), (2, "Clutch", "#00ff00")]
        assignment_rows = [
            ("chk-a", 1, "path/a.dem"),
            ("chk-a", 2, "path/a.dem"),
            ("chk-b", 1, "path/b.dem"),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            out_path = os.path.join(tmp, "export.json")
            with mock.patch(
                "csdm.engine.core.psycopg2.connect",
                return_value=_FakeConn(tag_rows, assignment_rows)):
                result = COMMANDS["tags_export"](
                    host, {"id": "c1", "name": "tags_export",
                           "path": out_path, "tag_ids": None})

            data = result["data"]
            self.assertEqual(data["tag_count"], 2)
            self.assertEqual(data["demo_count"], 2)
            self.assertEqual(data["path"], out_path)

            written = json.loads(open(out_path, encoding="utf-8").read())
            self.assertEqual(written["version"], 1)
            self.assertEqual(len(written["tags"]), 2)
            by_chk = {a["checksum"]: a for a in written["assignments"]}
            self.assertEqual(set(by_chk["chk-a"]["tags"]), {"Ace", "Clutch"})
            self.assertEqual(by_chk["chk-b"]["tags"], ["Ace"])

    def test_requires_a_path(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_export"](host, {"id": "c1", "name": "tags_export", "path": ""})

    def test_filters_by_tag_ids_when_given(self):
        host = _tagged_host()
        tag_rows = [(1, "Ace", "#ff0000"), (2, "Clutch", "#00ff00")]
        assignment_rows = [("chk-a", 1, "path/a.dem")]
        with tempfile.TemporaryDirectory() as tmp:
            out_path = os.path.join(tmp, "export.json")
            with mock.patch(
                "csdm.engine.core.psycopg2.connect",
                return_value=_FakeConn(tag_rows, assignment_rows)):
                result = COMMANDS["tags_export"](
                    host, {"id": "c1", "name": "tags_export",
                           "path": out_path, "tag_ids": [1]})
            self.assertEqual(result["data"]["tag_count"], 1)


class TestTagsImportScan(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tags_import_scan", COMMANDS)

    def test_requires_a_path(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_import_scan"](host, {"id": "c1", "name": "tags_import_scan", "path": ""})

    def test_reports_missing_tags_without_writing_anything(self):
        host = _tagged_host(tags_list=[(1, "Ace", "#ff0000")])
        with tempfile.TemporaryDirectory() as tmp:
            in_path = os.path.join(tmp, "import.json")
            payload = {
                "version": 1,
                "tags": [{"name": "Ace", "color": "#ff0000"},
                         {"name": "Wallbang", "color": "#00ffff"}],
                "assignments": [
                    {"checksum": "chk-a", "demo_name": "a.dem", "tags": ["Ace", "Wallbang"]},
                    {"checksum": "chk-b", "demo_name": "b.dem", "tags": ["Ace"]},
                ],
            }
            with open(in_path, "w", encoding="utf-8") as f:
                json.dump(payload, f)

            result = COMMANDS["tags_import_scan"](
                host, {"id": "c1", "name": "tags_import_scan", "path": in_path})

            data = result["data"]
            self.assertEqual(data["assignment_count"], 2)
            self.assertEqual(len(data["missing_tags"]), 1)
            self.assertEqual(data["missing_tags"][0]["name"], "Wallbang")
            self.assertEqual(data["missing_tags"][0]["color"], "#00ffff")
            # No tag was created as a side effect of scanning.
            self.assertEqual(len(host._tags_list), 1)

    def test_rejects_a_file_that_is_not_a_tags_export(self):
        host = _tagged_host()
        with tempfile.TemporaryDirectory() as tmp:
            in_path = os.path.join(tmp, "not-a-tags-file.json")
            with open(in_path, "w", encoding="utf-8") as f:
                json.dump({"foo": "bar"}, f)
            with self.assertRaises(ValueError):
                COMMANDS["tags_import_scan"](
                    host, {"id": "c1", "name": "tags_import_scan", "path": in_path})


class TestTagsImportApply(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tags_import_apply", COMMANDS)

    def test_requires_a_path(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_import_apply"](host, {"id": "c1", "name": "tags_import_apply", "path": ""})

    def test_creates_requested_tags_and_applies_assignments(self):
        host = _tagged_host(tags_list=[(1, "Ace", "#ff0000")])
        with tempfile.TemporaryDirectory() as tmp:
            in_path = os.path.join(tmp, "import.json")
            payload = {
                "version": 1,
                "tags": [{"name": "Ace", "color": "#ff0000"},
                         {"name": "Wallbang", "color": "#00ffff"}],
                "assignments": [
                    {"checksum": "chk-a", "demo_name": "a.dem", "tags": ["Ace", "Wallbang"]},
                ],
            }
            with open(in_path, "w", encoding="utf-8") as f:
                json.dump(payload, f)

            with mock.patch(
                "csdm.engine.core.psycopg2.connect",
                return_value=_FakeConn(found=True)):
                result = COMMANDS["tags_import_apply"](
                    host, {"id": "c1", "name": "tags_import_apply", "path": in_path,
                           "tags_to_create": [{"name": "Wallbang", "color": "#00ffff"}]})

            data = result["data"]
            self.assertEqual(data["ok_count"], 2)
            self.assertEqual(data["skip_count"], 0)
            self.assertEqual(data["fail_count"], 0)
            self.assertTrue(any(t[1] == "Wallbang" for t in host._tags_list))

    def test_skips_assignments_whose_checksum_is_not_in_the_db(self):
        host = _tagged_host(tags_list=[(1, "Ace", "#ff0000")])
        with tempfile.TemporaryDirectory() as tmp:
            in_path = os.path.join(tmp, "import.json")
            payload = {
                "version": 1,
                "tags": [{"name": "Ace", "color": "#ff0000"}],
                "assignments": [
                    {"checksum": "chk-gone", "demo_name": "a.dem", "tags": ["Ace"]},
                ],
            }
            with open(in_path, "w", encoding="utf-8") as f:
                json.dump(payload, f)

            with mock.patch(
                "csdm.engine.core.psycopg2.connect",
                return_value=_FakeConn(found=False)):
                result = COMMANDS["tags_import_apply"](
                    host, {"id": "c1", "name": "tags_import_apply", "path": in_path,
                           "tags_to_create": []})

            data = result["data"]
            self.assertEqual(data["ok_count"], 0)
            self.assertEqual(data["skip_count"], 1)
            self.assertEqual(data["fail_count"], 0)

    def test_rejects_a_file_that_is_not_a_tags_export(self):
        host = _tagged_host()
        with tempfile.TemporaryDirectory() as tmp:
            in_path = os.path.join(tmp, "not-a-tags-file.json")
            with open(in_path, "w", encoding="utf-8") as f:
                json.dump({"foo": "bar"}, f)
            with self.assertRaises(ValueError):
                COMMANDS["tags_import_apply"](
                    host, {"id": "c1", "name": "tags_import_apply", "path": in_path,
                           "tags_to_create": []})


class TestEngineModuleStillTkinterFree(unittest.TestCase):
    def test_engine_module_imports_no_tkinter(self):
        import pathlib
        source = pathlib.Path("csdm/engine/core.py").read_text(encoding="utf-8")
        self.assertNotIn("tkinter", source)


if __name__ == "__main__":
    unittest.main()
