"""The engine must run with no window and no Tkinter anywhere in the process.

Chantier 1 proved the engine does not *import* Tkinter. That is not the same as
proving it *runs* without one: it still needed ~26 methods and ~23 attributes
that only `App` provided, so no host without a window could actually drive it.
This file is the difference between the two claims.

If a test here fails on a missing attribute or method, that is a hole in the
host contract -- fill it in `csdm/engine/state.py` or move the missing method
into the engine. Never patch it into `HeadlessHost`: that would hand the host
back the very burden this chantier removes.
"""
import subprocess
import sys
import textwrap
import unittest

from csdm.config import DEFAULT_CONFIG
from csdm.engine.core import EngineMixin
from csdm.engine.ports import CollectingPorts
from csdm.engine.state import EngineStateMixin


class HeadlessHost(EngineStateMixin, EngineMixin):
    """Everything an engine host needs, and nothing else.

    No Tk, no widgets, no window, no main loop -- the shape Electron will use.
    """

    def __init__(self, ports):
        self.init_engine_state()
        self.log, self.log_parts = ports.log, ports.log_parts
        self.state, self.ask = ports.state, ports.ask


class TestHeadlessHost(unittest.TestCase):
    def setUp(self):
        self.ports = CollectingPorts()
        self.host = HeadlessHost(self.ports)

    def test_filter_chain_runs_end_to_end(self):
        cfg = {"kill_mod_wallbang": False, "kill_mod_wallbang_exclude": True}
        evts = self.host._apply_dp2_filters_to_events({}, cfg)
        gated = self.host._apply_global_filter_gate_dict(evts, cfg)
        self.assertEqual(gated, {})

    def test_summary_helpers_run(self):
        line = self.host._fmt_summary(*self.host._calc_summary({}, {}))
        self.assertIsInstance(line, str)
        self.assertTrue(line)

    def test_sql_fragment_helpers_run(self):
        self.host._db_schema = {"matches": ["game_mode_str"]}
        self.assertIsNotNone(self.host._qe_epoch_bounds({}))
        # Must not raise -- they warn through the log port when a column is absent.
        self.host._qe_match_type_sql({})
        self.host._qe_headshot_sql({})
        self.host._qe_teamkill_sql({})

    def test_filter_helpers_run(self):
        events = [{"type": "kill", "tick": 1, "killer_sid": "7"}]
        self.host._stamp_mf(events, "kill_mod_wallbang")
        self.assertIn("kill_mod_wallbang", events[0]["_mf"])
        self.assertEqual(
            self.host._split_required_optional({}, ["kill_mod_wallbang"]),
            ([], ["kill_mod_wallbang"]))

    def test_engine_output_reaches_the_ports_only(self):
        """Whatever the engine says, it says through the sockets -- nowhere else."""
        self.host._apply_filter_to_events(
            {"d.dem": [{"type": "kill", "tick": 1, "killer_sid": "7"}]},
            {"kill_mod_wallbang": True}, "kill_mod_wallbang",
            lambda dp, evts, cfg: evts, "WALLBANG")
        self.assertTrue(self.ports.logs, "the engine logged nothing through the port")


class TestStopKillAndPreviewCancellation(unittest.TestCase):
    """The three actions a window used to own. An Electron host needs them too."""

    def setUp(self):
        self.ports = CollectingPorts()
        self.host = HeadlessHost(self.ports)
        self.host.cfg = dict(DEFAULT_CONFIG)
        self.host.cfg["process_exit_poll_interval"] = 0.0

    def test_stop_and_kill_work_without_a_window(self):
        self.host._running = True
        self.host.request_stop()
        self.assertIs(self.host._stop_after_current, True)
        self.assertIs(self.host._running, False)

        ports2 = CollectingPorts()
        host2 = HeadlessHost(ports2)
        host2.cfg = dict(self.host.cfg)
        host2._running = True
        host2.request_kill(probe=lambda name: False)      # already gone
        self.assertIs(host2._kill_triggered, True)
        self.assertIn(("process_exited", {"name": "cs2.exe"}), ports2.states)

    def test_stop_during_a_preview_cancels_the_preview_instead(self):
        self.host._previewing = True
        self.host.request_stop()
        self.assertTrue(self.host._preview_cancel.is_set())
        self.assertIs(self.host._previewing, False)
        self.assertIs(self.host._stop_after_current, False, "a preview is not a run")

    def test_stop_with_nothing_running_does_nothing(self):
        self.host.request_stop()
        self.assertIs(self.host._stop_after_current, False)
        self.assertFalse(self.host._preview_cancel.is_set())


class TestTkinterIsNeverImported(unittest.TestCase):
    def test_engine_pulls_in_no_tkinter(self):
        """Run in a SUBPROCESS: pytest itself may import Tk for other tests.

        Asserting on `sys.modules` inside this process would prove nothing.
        """
        script = textwrap.dedent("""
            import sys
            from csdm.engine.core import EngineMixin
            from csdm.engine.ports import CollectingPorts
            from csdm.engine.state import EngineStateMixin

            class H(EngineStateMixin, EngineMixin):
                def __init__(self, p):
                    self.init_engine_state()
                    self.log, self.log_parts = p.log, p.log_parts
                    self.state, self.ask = p.state, p.ask

            h = H(CollectingPorts())
            h._apply_global_filter_gate_dict(h._apply_dp2_filters_to_events({}, {}), {})
            h._fmt_summary(*h._calc_summary({}, {}))
            h._qe_epoch_bounds({})

            leaked = [m for m in sys.modules if m == "tkinter" or m.startswith("tkinter.")]
            assert not leaked, f"engine pulled in Tkinter: {leaked}"
            print("OK")
        """)
        r = subprocess.run([sys.executable, "-c", script],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("OK", r.stdout)


if __name__ == "__main__":
    unittest.main()
