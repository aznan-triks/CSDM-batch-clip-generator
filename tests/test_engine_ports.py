"""Tests des trois prises du moteur (chantier 1, tache 1)."""
import threading
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

    def test_log_parts_records_segments_in_order_with_levels(self):
        p = CollectingPorts()
        p.log_parts([("  Timeout: ", "dim"), ("3m00s", "info")])
        self.assertEqual(p.log_parts_calls,
                         [[("  Timeout: ", "dim"), ("3m00s", "info")]])


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


class TestAppStateRouting(unittest.TestCase):
    """L'aiguilleur d'etat traduit un evenement en appel d'interface, sans Tk."""

    def _app(self):
        from csdm_batch_clips_generator import App
        app = App.__new__(App)          # pas de fenetre Tk : on teste l'aiguillage seul
        app._calls = []
        app._reset_btns = lambda: app._calls.append(("reset", None))
        app._show_preview = lambda e, c, t=None: app._calls.append(("preview", (e, c, t)))
        app._emit_demo_log_entry = lambda **kw: app._calls.append(("entry", kw))
        return app

    def test_buttons_idle_calls_reset(self):
        app = self._app()
        app._on_state_main("buttons_idle", {})
        self.assertEqual(app._calls, [("reset", None)])

    def test_preview_ready_forwards_three_arguments(self):
        app = self._app()
        app._on_state_main("preview_ready", {"events": {"a": 1}, "cfg": {"b": 2},
                                             "timings": None})
        self.assertEqual(app._calls, [("preview", ({"a": 1}, {"b": 2}, None))])

    def test_demo_entry_forwards_payload_as_keywords(self):
        app = self._app()
        app._on_state_main("demo_entry", {"demo_name": "x.dem", "seq_count": 3})
        self.assertEqual(app._calls, [("entry", {"demo_name": "x.dem", "seq_count": 3})])

    def test_unknown_event_raises(self):
        app = self._app()
        with self.assertRaises(KeyError):
            app._on_state_main("nope", {})


class TestDp2ExcludePathRuns:
    """The dp2 exclude branch read `_NO_AUTO_EXCLUDE`, a name the engine no longer had.

    Guard the behaviour, not just the name: this is the branch that made both
    PREVIEW and RUN raise NameError as soon as one Exclude checkbox was ticked.
    """

    def test_exclude_branch_does_not_raise(self):
        from csdm.engine.core import EngineMixin
        from csdm.engine.ports import CollectingPorts

        ports = CollectingPorts()

        class Host(EngineMixin):
            def __init__(self):
                self.log = ports.log
                self.log_parts = ports.log_parts
                self.state = ports.state
                self.ask = ports.ask
                self._dp2_cache = {}
                self._dp2_cache_lock = threading.Lock()

        host = Host()
        cfg = {"kill_mod_wallbang": False, "kill_mod_wallbang_exclude": True}

        # No events in, so no dp2 parse happens; we only need the branch that
        # builds the exclude key list to be reachable.
        result = host._apply_dp2_filters_to_events({}, cfg)
        assert result == {}


if __name__ == "__main__":
    unittest.main()
