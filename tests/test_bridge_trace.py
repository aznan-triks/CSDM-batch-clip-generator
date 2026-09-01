"""The engine half of the diagnostic recorder.

A trace kept only in the renderer cannot tell "the engine never received the
command" from "the engine received it and answered nothing" -- and those are
two different bugs with two different fixes. So the engine reports, under the
SAME command id the renderer already holds, that it received the command and
that it finished it.

What is checked here: the switch defaults to off and costs nothing while off,
the two ends of a command are reported under one id, a failure is still
reported (a command that raises is exactly when the trace matters most), and
the trace never leaves the one writer allowed to touch the pipe.
"""
import unittest

from csdm.bridge import host
from csdm.bridge.protocol import MSG_TRACE


class RecordingWriter:
    """Stands in for `LineWriter`: same `send`, keeps what went through."""

    def __init__(self):
        self.sent = []

    def send(self, obj):
        self.sent.append(obj)

    def traces(self):
        return [m for m in self.sent if m.get("type") == MSG_TRACE]

    def results(self):
        return [m for m in self.sent if m.get("type") == "result"]


class TraceSwitchTest(unittest.TestCase):
    def setUp(self):
        host.set_trace_enabled(False)
        self.addCleanup(host.set_trace_enabled, False)
        self.writer = RecordingWriter()

    def test_off_by_default(self):
        self.assertFalse(host.trace_enabled())

    def test_nothing_is_traced_while_off(self):
        host._run_command(None, self.writer, {"id": "1", "name": "ping"})
        self.assertEqual(self.writer.traces(), [])
        self.assertEqual(len(self.writer.results()), 1)

    def test_the_set_debug_command_flips_the_switch(self):
        host._run_command(None, self.writer, {"id": "1", "name": "set_debug", "on": True})
        self.assertTrue(host.trace_enabled())
        host._run_command(None, self.writer, {"id": "2", "name": "set_debug", "on": False})
        self.assertFalse(host.trace_enabled())

    def test_set_debug_reports_the_state_it_reached(self):
        host._run_command(None, self.writer, {"id": "1", "name": "set_debug", "on": True})
        result = self.writer.results()[0]
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"], {"debug": True})


class TraceContentTest(unittest.TestCase):
    def setUp(self):
        host.set_trace_enabled(True)
        self.addCleanup(host.set_trace_enabled, False)
        self.writer = RecordingWriter()

    def test_both_ends_of_a_command_are_reported_under_one_id(self):
        host._run_command(None, self.writer, {"id": "42", "name": "ping"})
        traces = self.writer.traces()
        self.assertEqual([t["phase"] for t in traces], ["recv", "done"])
        self.assertEqual({t["id"] for t in traces}, {"42"})
        self.assertEqual({t["name"] for t in traces}, {"ping"})

    def test_the_done_line_carries_how_long_the_command_took(self):
        host._run_command(None, self.writer, {"id": "42", "name": "ping"})
        done = self.writer.traces()[1]
        self.assertIsInstance(done["ms"], float)
        self.assertGreaterEqual(done["ms"], 0.0)

    def test_a_failing_command_is_still_traced_with_its_reason(self):
        host._run_command(None, self.writer, {"id": "9", "name": "save_config"})
        done = self.writer.traces()[1]
        self.assertIn("cfg", done["detail"])
        self.assertEqual(len(self.writer.results()), 1)
        self.assertFalse(self.writer.results()[0]["ok"])

    def test_an_unknown_command_is_traced_rather_than_vanishing(self):
        host._run_command(None, self.writer, {"id": "3", "name": "no_such_command"})
        phases = [t["phase"] for t in self.writer.traces()]
        self.assertIn("recv", phases)
        self.assertIn("done", phases)

    def test_the_trace_line_never_carries_the_password(self):
        host._run_command(
            None, self.writer,
            {"id": "5", "name": "no_such_command", "pg": {"host": "h", "pass": "hunter2"}},
        )
        for message in self.writer.traces():
            self.assertNotIn("hunter2", repr(message))


class TraceIsProtocolTest(unittest.TestCase):
    """The trace is a message type both ends agree on, not an ad-hoc string."""

    def test_the_type_string_is_a_protocol_constant(self):
        self.assertEqual(MSG_TRACE, "trace")

    def test_set_debug_is_a_registered_command(self):
        self.assertIn("set_debug", host.COMMANDS)


if __name__ == "__main__":
    unittest.main()
