"""The static tables must cross the pipe, never be retyped in TypeScript."""
import json
import subprocess
import sys
import unittest


def _run(commands, timeout=30):
    proc = subprocess.run(
        [sys.executable, "-m", "csdm.bridge"],
        input="".join(json.dumps(c) + "\n" for c in commands),
        capture_output=True, text=True, timeout=timeout, encoding="utf-8")
    return proc, [json.loads(l) for l in proc.stdout.split("\n") if l.strip()]


class TestDescribeFilters(unittest.TestCase):
    def test_every_registry_entry_travels(self):
        from csdm.static_data import KILL_FILTER_REGISTRY

        _, msgs = _run([{"type": "command", "id": "1", "name": "describe_filters"}])
        result = [m for m in msgs if m["type"] == "result"][0]
        self.assertTrue(result["ok"], result.get("error"))
        sent = {f["key"] for f in result["data"]["filters"]}
        self.assertEqual(sent, {f.key for f in KILL_FILTER_REGISTRY})

    def test_hidden_rows_are_flagged_not_dropped(self):
        # The window hides two rows; dropping them here would make the renderer
        # unable to tell "hidden" from "does not exist".
        _, msgs = _run([{"type": "command", "id": "1", "name": "describe_filters"}])
        data = [m for m in msgs if m["type"] == "result"][0]["data"]
        hidden = {f["key"] for f in data["filters"] if f["hidden"]}
        self.assertEqual(hidden, {"kill_mod_no_trois_shot", "kill_mod_mate_pov"})

    def test_every_match_type_travels_in_order(self):
        from csdm.static_data import MATCH_TYPE_DEFS

        _, msgs = _run([{"type": "command", "id": "1", "name": "describe_filters"}])
        data = [m for m in msgs if m["type"] == "result"][0]["data"]
        self.assertEqual([m["key"] for m in data["match_types"]],
                         [cfg_key for _db, cfg_key, _label in MATCH_TYPE_DEFS])

    def test_video_tables_travel(self):
        from csdm.static_data import FRAMERATES, RESOLUTIONS, VIDEO_CODECS

        _, msgs = _run([{"type": "command", "id": "1", "name": "describe_filters"}])
        data = [m for m in msgs if m["type"] == "result"][0]["data"]
        self.assertEqual(data["framerates"], list(FRAMERATES))
        self.assertEqual(data["video_codecs"], list(VIDEO_CODECS))
        self.assertEqual(len(data["resolutions"]), len(RESOLUTIONS))

    def test_preset_categories_travel(self):
        from csdm.config import _PRESET_ALL_CATS

        _, msgs = _run([{"type": "command", "id": "1", "name": "describe_filters"}])
        data = [m for m in msgs if m["type"] == "result"][0]["data"]
        self.assertEqual(data["preset_categories"], ["full"] + list(_PRESET_ALL_CATS))
        # The two backward-compat aliases (old preset-file format) are never
        # shown as checkboxes -- the original Tkinter dialog didn't render them.
        self.assertNotIn("player", data["preset_categories"])
        self.assertNotIn("video", data["preset_categories"])

    def test_tables_module_imports_no_tkinter(self):
        import pathlib
        source = pathlib.Path("csdm/bridge/tables.py").read_text(encoding="utf-8")
        self.assertNotIn("tkinter", source)


if __name__ == "__main__":
    unittest.main()
