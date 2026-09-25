"""`export_preview` / `injection_preview`: the E10 parity bridge commands.

Runs the real `BridgeHost` and `COMMANDS` table. No database: the preview's
clip list is what the engine remembers when it emits `preview_ready`, so it is
planted through the same `_remember_preview` the preview worker calls.
"""
import json
import unittest

from csdm.bridge.host import BridgeHost, COMMANDS
from csdm.config import DEFAULT_CONFIG
from csdm.errors import UserError


class _Ports:
    def log(self, message, level=""):
        pass

    def log_parts(self, parts):
        pass

    def state(self, name, payload=None):
        pass

    def ask(self, kind, message, options):
        return None


DEMO = r"C:\demos\match_one.dem"
SEQS = {DEMO: [
    {"start_tick": 1000, "end_tick": 1640,
     "events": [{"type": "kill", "weapon": "ak47", "_mf": set()}]},
    {"start_tick": 9000, "end_tick": 9640, "events": [{"type": "damage"}]},
]}


def _host():
    return BridgeHost(_Ports())


class ExportPreviewTests(unittest.TestCase):
    def test_refuses_in_plain_words_before_any_preview(self):
        with self.assertRaises(UserError) as caught:
            COMMANDS["export_preview"](_host(), {"format": "txt"})
        self.assertIn("PREVIEW", str(caught.exception))

    def test_refuses_an_empty_preview(self):
        host = _host()
        host._remember_preview({}, {"tickrate": 64})
        with self.assertRaises(UserError):
            COMMANDS["export_preview"](host, {"format": "json"})

    def test_rejects_an_unknown_format(self):
        host = _host()
        host._remember_preview(SEQS, {"tickrate": 64})
        with self.assertRaises(ValueError):
            COMMANDS["export_preview"](host, {"format": "xml"})

    def test_json_lists_every_clip_with_its_playdemo_command(self):
        host = _host()
        host._remember_preview(SEQS, {"tickrate": 64, "player_name": "trois"})
        data = COMMANDS["export_preview"](host, {"format": "json"})["data"]
        self.assertEqual(data["filename"], "csdm_preview.json")
        body = json.loads(data["content"])
        self.assertEqual(body["nb_clips"], 2)
        self.assertEqual([c["command"] for c in body["clips"]],
                         ["playdemo match_one.dem 1000", "playdemo match_one.dem 9000"])
        self.assertEqual(body["clips"][0]["weapon"], "ak47")
        self.assertEqual(body["clips"][1]["weapon"], "—")

    def test_txt_and_html_carry_the_same_rows(self):
        host = _host()
        host._remember_preview(SEQS, {"tickrate": 64})
        txt = COMMANDS["export_preview"](host, {"format": "txt"})["data"]
        html = COMMANDS["export_preview"](host, {"format": "html"})["data"]
        self.assertIn("cmd: playdemo match_one.dem 9000", txt["content"])
        self.assertIn("2 clips", txt["content"])
        self.assertIn("<td class='mono cmd'>playdemo match_one.dem 1000</td>", html["content"])
        self.assertEqual(html["mime"], "text/html")


class InjectionPreviewTests(unittest.TestCase):
    def test_hlae_lists_extra_args(self):
        cfg = dict(DEFAULT_CONFIG, recsys="HLAE", hlae_extra_args="-novid")
        lines = COMMANDS["injection_preview"](_host(), {"cfg": cfg})["lines"]
        self.assertEqual(lines[0], ["HLAE extraArgs:", "key"])
        self.assertIn(["  -novid", "val"], lines)
        # A console command keeps its argument on its own line.
        self.assertIn(["  +sv_gravity 800", "val"], lines)

    def test_native_lists_launch_args_and_console_commands(self):
        cfg = dict(DEFAULT_CONFIG, recsys="CS")
        lines = COMMANDS["injection_preview"](_host(), {"cfg": cfg})["lines"]
        headings = [text for text, kind in lines if kind == "key"]
        self.assertEqual(headings, ["Launch args:", "Console cmds:"])
        self.assertIn(["  demo_timescale 1", "val"], lines)

    def test_needs_a_cfg(self):
        with self.assertRaises(ValueError):
            COMMANDS["injection_preview"](_host(), {})


if __name__ == "__main__":
    unittest.main()
