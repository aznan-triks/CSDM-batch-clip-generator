"""A process is announced dead only when the task list says it is gone.

The interface stages a charge that beeps until `process_exited` arrives and
detonates on that event alone. A timer here would let the animation lie about
the real state of the game (D17, D18), so these tests pin the wait open.
"""
import inspect
import unittest

from csdm import core_utils
from csdm.config import DEFAULT_CONFIG
from csdm.engine.core import EngineMixin
from csdm.engine.ports import CollectingPorts
from csdm.engine.state import EngineStateMixin


class _CollectingHost(EngineStateMixin, EngineMixin):
    """A host with no window, carrying a config like every real host does."""

    def __init__(self):
        self.init_engine_state()
        self.cfg = dict(DEFAULT_CONFIG)
        self.cfg["process_exit_poll_interval"] = 0.0   # no real sleeping in a test
        self.ports = CollectingPorts()
        self.log, self.log_parts = self.ports.log, self.ports.log_parts
        self.state, self.ask = self.ports.state, self.ports.ask


class TestAwaitProcessExit(unittest.TestCase):
    def test_await_returns_true_when_the_process_disappears(self):
        host = _CollectingHost()
        seen = {"calls": 0}

        def fake_probe(name):
            seen["calls"] += 1
            return seen["calls"] < 3          # alive twice, then gone

        self.assertIs(host._await_process_exit("cs2.exe", probe=fake_probe), True)
        self.assertIn(("process_exited", {"name": "cs2.exe"}), host.ports.states)

    def test_no_event_is_emitted_while_the_process_refuses_to_die(self):
        """D17/D18: the wait is open, never a timer. This is THE test.

        The timeout is shortened here so the suite stays fast; what is proven
        is that no matter how many times the probe answers "still alive", the
        exit event never fires on elapsed time alone.
        """
        host = _CollectingHost()
        host.cfg["process_exit_timeout"] = 0.2
        polls = {"n": 0}

        def always_alive(name):
            polls["n"] += 1
            return True

        self.assertIs(host._await_process_exit("cs2.exe", probe=always_alive), False)
        self.assertGreater(polls["n"], 1, "the wait gave up after a single look")
        self.assertFalse([s for s in host.ports.states if s[0] == "process_exited"])

    def test_the_probe_never_writes_to_stdout(self):
        """Under the bridge, stdout belongs to the protocol alone."""
        source = inspect.getsource(core_utils.process_is_running)
        self.assertIn("stdout=", source, "the subprocess call must set stdout explicitly")

    def test_a_process_that_does_not_exist_reads_as_gone(self):
        self.assertIs(core_utils.process_is_running("csdm_no_such_process.exe"), False)


if __name__ == "__main__":
    unittest.main()
