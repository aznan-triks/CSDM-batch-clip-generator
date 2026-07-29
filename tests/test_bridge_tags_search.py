"""`tags_search` / `tags_calc_range` / `tags_set_active`: the tag-search,
date-range and active-tag-selection bridge commands.

Runs the real `BridgeHost`/`COMMANDS` chain (same pattern as
`test_bridge_list_demos.py`): only `psycopg2.connect` is mocked, everything
else -- `_find_col`, the tag SQL, the date-range math -- is the real engine
code. `_query_events` (the config-filtered search path) is mocked directly on
the host instance instead of faked through SQL: it is its own already-tested
collaborator (`start_run`/`start_preview` already exercise it), and faking its
multi-table SQL here would test `_query_events` a second time instead of the
new tag-search logic this file is about.

Demo "files" are real temporary files with a controlled mtime, same as
`test_bridge_list_demos.py`'s `_touch`: `_get_demo_ts` falls back to the
file's mtime once no `.info` sidecar exists.
"""
import os
import tempfile
import unittest
from datetime import datetime
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


def _touch(tmp_path, name, mtime):
    path = os.path.join(tmp_path, name)
    with open(path, "wb"):
        pass
    ts = mtime.timestamp()
    os.utime(path, (ts, ts))
    return path


TAGS_SCHEMA = {
    "table": "tags", "id_col": "id", "id_col_type": "bigint",
    "name_col": "name", "color_col": "color",
    "junction_table": "checksum_tags", "jt_tag_col": "tag_id",
    "jt_match_col": "checksum", "jt_col_types": {},
}


def _tagged_host(tags_schema=TAGS_SCHEMA, tags_list=None, date_col="match_date"):
    """A BridgeHost with tag schema/db schema adopted directly, no live DB.

    Mirrors what `connect_db` -> `apply_discovery` would set, without going
    through the full discovery SQL (out of scope here -- see
    `test_db_discovery.py` for that).
    """
    host = BridgeHost(_Ports())
    host.set_pg_params({"pg_host": "h", "pg_port": 5432, "pg_user": "u",
                        "pg_pass": "p", "pg_db": "d"})
    host._tags_schema = tags_schema
    host._tags_list = tags_list if tags_list is not None else [
        (1, "Ace", "#ff0000"), (2, "Clutch", "#00ff00")]
    host._db_schema = {"matches": ["checksum", "demo_path", "match_date"]}
    host._date_col = date_col
    return host


class TestTagsSearch(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tags_search", COMMANDS)

    def test_by_tag_search_needs_at_least_one_tag(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_search"](host, {"id": "c1", "name": "tags_search", "tag_ids": []})

    def test_by_tag_search_returns_demos_and_tag_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            dp = _touch(tmp, "a.dem", datetime(2025, 1, 1))
            host = _tagged_host()
            with mock.patch("csdm.engine.core.psycopg2.connect",
                             return_value=_FakeConn([(dp, "chk1")])):
                result = COMMANDS["tags_search"](
                    host, {"id": "c2", "name": "tags_search", "tag_ids": [1]})

            data = result["data"]
            self.assertEqual(len(data["demos"]), 1)
            self.assertEqual(data["demos"][0]["path"], dp)
            self.assertEqual(data["demos"][0]["n_events"], 0)
            self.assertEqual(data["demos"][0]["n_seq"], 0)
            self.assertEqual(data["tag_names"], ["Ace"])
            self.assertEqual(host._demo_checksums[dp], "chk1")

    def test_by_tag_search_errors_on_incomplete_schema(self):
        host = _tagged_host(tags_schema={"junction_table": None})
        with self.assertRaises(ValueError):
            COMMANDS["tags_search"](host, {"id": "c3", "name": "tags_search", "tag_ids": [1]})

    def test_config_search_requires_steam_ids(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_search"](host, {"id": "c4", "name": "tags_search", "tag_ids": [],
                                            "cfg": {"events": ["Kills"]}})

    def test_config_search_requires_events(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_search"](host, {"id": "c5", "name": "tags_search", "tag_ids": [],
                                            "cfg": {"steam_ids": ["1"]}})

    def test_config_search_without_tags_returns_every_matching_demo(self):
        with tempfile.TemporaryDirectory() as tmp:
            dp = _touch(tmp, "b.dem", datetime(2025, 2, 1))
            host = _tagged_host()
            cfg = {"steam_ids": ["1"], "events": ["Kills"], "tickrate": 64,
                   "before": 5, "after": 5}
            with mock.patch.object(
                    host, "_query_events",
                    return_value={dp: [{"tick": 100, "type": "kill"}]}):
                result = COMMANDS["tags_search"](
                    host, {"id": "c6", "name": "tags_search", "tag_ids": [], "cfg": cfg})

            demos = result["data"]["demos"]
            self.assertEqual(len(demos), 1)
            self.assertEqual(demos[0]["path"], dp)
            self.assertEqual(demos[0]["n_events"], 1)
            self.assertEqual(demos[0]["n_seq"], 1)

    def test_config_search_with_tags_intersects_tagged_checksums(self):
        with tempfile.TemporaryDirectory() as tmp:
            dp_tagged = _touch(tmp, "tagged.dem", datetime(2025, 3, 1))
            dp_other = _touch(tmp, "other.dem", datetime(2025, 3, 2))
            host = _tagged_host()
            cfg = {"steam_ids": ["1"], "events": ["Kills"], "tickrate": 64,
                   "before": 5, "after": 5}
            evts = {
                dp_tagged: [{"tick": 100, "type": "kill"}],
                dp_other: [{"tick": 200, "type": "kill"}],
            }
            with mock.patch("csdm.engine.core.psycopg2.connect",
                             return_value=_FakeConn([("chk-tagged",)])), \
                 mock.patch.object(host, "_query_events", return_value=evts), \
                 mock.patch.object(host, "_get_demo_checksum",
                                    side_effect=lambda dp: "chk-tagged" if dp == dp_tagged
                                    else "chk-other"):
                result = COMMANDS["tags_search"](
                    host, {"id": "c7", "name": "tags_search", "tag_ids": [1], "cfg": cfg})

            demos = result["data"]["demos"]
            self.assertEqual([d["path"] for d in demos], [dp_tagged])


class TestTagsCalcRange(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tags_calc_range", COMMANDS)

    def test_needs_at_least_one_tag(self):
        host = _tagged_host()
        with self.assertRaises(ValueError):
            COMMANDS["tags_calc_range"](host, {"id": "c1", "name": "tags_calc_range", "tag_ids": []})

    def test_computes_start_end_and_after(self):
        with tempfile.TemporaryDirectory() as tmp:
            dp_first = _touch(tmp, "first.dem", datetime(2025, 1, 1))
            dp_last = _touch(tmp, "last.dem", datetime(2025, 1, 10))
            host = _tagged_host()
            with mock.patch("csdm.engine.core.psycopg2.connect",
                             return_value=_FakeConn(
                                 [(dp_first, "c1", None), (dp_last, "c2", None)])):
                result = COMMANDS["tags_calc_range"](
                    host, {"id": "c2", "name": "tags_calc_range", "tag_ids": [1]})

            data = result["data"]
            self.assertEqual(data["date_start"], "01-01-2025")
            self.assertEqual(data["date_end"], "10-01-2025")
            self.assertEqual(data["date_after"], "11-01-2025")
            self.assertEqual(data["demo_count"], 2)

    def test_no_tagged_demos_returns_zero_count(self):
        host = _tagged_host()
        with mock.patch("csdm.engine.core.psycopg2.connect", return_value=_FakeConn([])):
            result = COMMANDS["tags_calc_range"](
                host, {"id": "c3", "name": "tags_calc_range", "tag_ids": [1]})

        data = result["data"]
        self.assertEqual(data["demo_count"], 0)
        self.assertIsNone(data["date_start"])

    def test_errors_on_incomplete_schema(self):
        host = _tagged_host(tags_schema={"junction_table": None})
        with self.assertRaises(ValueError):
            COMMANDS["tags_calc_range"](host, {"id": "c4", "name": "tags_calc_range",
                                                "tag_ids": [1]})

    def test_does_not_store_result_as_engine_state(self):
        """Design decision: the response carries the range, engine state does not."""
        with tempfile.TemporaryDirectory() as tmp:
            dp = _touch(tmp, "only.dem", datetime(2025, 1, 1))
            host = _tagged_host()
            with mock.patch("csdm.engine.core.psycopg2.connect",
                             return_value=_FakeConn([(dp, "c1", None)])):
                COMMANDS["tags_calc_range"](host, {"id": "c5", "name": "tags_calc_range",
                                                    "tag_ids": [1]})
            self.assertFalse(hasattr(host, "_plage_date_start"))
            self.assertFalse(hasattr(host, "_plage_date_end"))


class TestTagsSetActive(unittest.TestCase):
    def test_registered_as_a_command(self):
        self.assertIn("tags_set_active", COMMANDS)

    def test_sets_the_active_selection(self):
        host = _tagged_host()
        result = COMMANDS["tags_set_active"](
            host, {"id": "c1", "name": "tags_set_active", "tag_ids": [1, 2]})

        self.assertEqual(host._tags_active, {1, 2})
        self.assertEqual(result["data"]["active_tag_ids"], [1, 2])
        self.assertEqual(sorted(result["data"]["active_tag_names"]), ["Ace", "Clutch"])

    def test_empty_list_deselects_all(self):
        host = _tagged_host()
        host._tags_active = {1, 2}
        result = COMMANDS["tags_set_active"](
            host, {"id": "c2", "name": "tags_set_active", "tag_ids": []})

        self.assertEqual(host._tags_active, set())
        self.assertEqual(result["data"]["active_tag_ids"], [])
        self.assertEqual(result["data"]["active_tag_names"], [])


class TestEngineModuleStillTkinterFree(unittest.TestCase):
    def test_engine_module_imports_no_tkinter(self):
        import pathlib
        source = pathlib.Path("csdm/engine/core.py").read_text(encoding="utf-8")
        self.assertNotIn("tkinter", source)


if __name__ == "__main__":
    unittest.main()
