"""Tests des trois prises du moteur (chantier 1, tache 1)."""
import unittest

from csdm.engine.ports import EnginePorts, CollectingPorts


class TestCollectingPorts(unittest.TestCase):
    def test_log_is_recorded_with_level(self):
        p = CollectingPorts()
        p.log("hello", "info")
        self.assertEqual(p.logs, [("hello", "info")])

    def test_log_level_defaults_to_empty(self):
        p = CollectingPorts()
        p.log("plain")
        self.assertEqual(p.logs, [("plain", "")])

    def test_state_is_recorded_with_payload(self):
        p = CollectingPorts()
        p.state("progress", {"text": "3/10"})
        self.assertEqual(p.states, [("progress", {"text": "3/10"})])

    def test_state_payload_defaults_to_empty_dict(self):
        p = CollectingPorts()
        p.state("buttons_idle")
        self.assertEqual(p.states, [("buttons_idle", {})])

    def test_ask_returns_preprogrammed_answer(self):
        p = CollectingPorts(answers=["include"])
        got = p.ask("confirm", "already tagged?", ["include", "ignore", "cancel"])
        self.assertEqual(got, "include")
        self.assertEqual(p.asks, [("confirm", "already tagged?",
                                   ["include", "ignore", "cancel"])])

    def test_ask_returns_none_when_no_answer_left(self):
        p = CollectingPorts()
        self.assertIsNone(p.ask("confirm", "q", ["a", "b"]))


class TestEnginePorts(unittest.TestCase):
    def test_holds_the_three_callables(self):
        seen = []
        ports = EnginePorts(
            log=lambda m, lv="": seen.append(("log", m, lv)),
            state=lambda n, p=None: seen.append(("state", n, p)),
            ask=lambda k, m, o: "yes",
        )
        ports.log("a", "info")
        ports.state("progress", {"text": "x"})
        self.assertEqual(ports.ask("confirm", "m", ["yes"]), "yes")
        self.assertEqual(seen, [("log", "a", "info"),
                                ("state", "progress", {"text": "x"})])

    def test_is_frozen(self):
        ports = EnginePorts(log=lambda *a, **k: None,
                            state=lambda *a, **k: None,
                            ask=lambda *a, **k: None)
        with self.assertRaises(Exception):
            ports.log = None


if __name__ == "__main__":
    unittest.main()
