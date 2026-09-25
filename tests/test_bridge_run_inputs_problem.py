"""`run_inputs_problem`: the RUN / PREVIEW refusal, asked before the click.

The renderer greys the buttons out with the engine's own sentence. This pins
that the command answers with exactly what `start_run` / `start_preview`
would refuse on -- one rule source, read through the same `build_run_cfg`.
"""
import unittest

from csdm.bridge.host import COMMANDS, BridgeHost, command_action
from csdm.config import DEFAULT_CONFIG


class _Writer:
    def send(self, message):
        pass


class _Ports:
    def __init__(self):
        self.asked = []

    def log(self, message, level=""):
        pass

    def log_parts(self, parts):
        pass

    def state(self, name, payload=None):
        pass

    def ask(self, kind, message, options):
        self.asked.append((kind, message))
        return "ok"


class RunInputsProblemCommandTests(unittest.TestCase):
    def setUp(self):
        self.ports = _Ports()
        self.host = BridgeHost(self.ports)

    def check(self, cfg):
        return COMMANDS["run_inputs_problem"](self.host, {"cfg": cfg})["problem"]

    def test_no_player_is_the_same_sentence_start_preview_refuses_with(self):
        cfg = {**DEFAULT_CONFIG, "steam_ids": []}
        problem = self.check(cfg)
        self.assertIsNotNone(problem)
        started = COMMANDS["start_preview"](self.host, {"cfg": cfg})["started"]
        self.assertFalse(started)
        self.assertEqual(self.ports.asked, [("error", problem)])

    def test_usable_settings_have_no_problem(self):
        self.assertIsNone(self.check({**DEFAULT_CONFIG, "steam_ids": ["76561198000000000"]}))

    def test_a_missing_cfg_is_refused_loudly(self):
        with self.assertRaises(ValueError):
            COMMANDS["run_inputs_problem"](self.host, {})

    def test_its_failure_sentence_names_what_it_was_doing(self):
        self.assertEqual(command_action("run_inputs_problem"), "checking the run settings")


if __name__ == "__main__":
    unittest.main()
