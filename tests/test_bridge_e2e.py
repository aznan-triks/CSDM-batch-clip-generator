"""Drive the bridge as a real subprocess -- the only honest way to test a pipe."""
import json
import subprocess
import sys
import unittest


def _run(commands, timeout=30):
    """Feed JSON lines in, collect JSON messages out."""
    proc = subprocess.run(
        [sys.executable, "-m", "csdm.bridge"],
        input="".join(json.dumps(c) + "\n" for c in commands),
        capture_output=True, text=True, timeout=timeout, encoding="utf-8")
    messages = []
    for line in proc.stdout.split("\n"):
        if line.strip():
            messages.append(json.loads(line))
    return proc, messages


class TestBridgeEndToEnd(unittest.TestCase):
    def test_ping_answers_with_a_result(self):
        proc, msgs = _run([{"type": "command", "id": "1", "name": "ping"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        results = [m for m in msgs if m["type"] == "result"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], "1")
        self.assertTrue(results[0]["ok"])

    def test_logs_stream_before_the_result(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "demo_logs"}])
        types = [m["type"] for m in msgs]
        self.assertIn("log", types)
        self.assertIn("log_parts", types)
        self.assertIn("state", types)
        self.assertEqual(types[-1], "result", "the result must close the exchange")

    def test_ask_round_trip_across_the_pipe(self):
        proc, msgs = _run([
            {"type": "command", "id": "1", "name": "demo_ask"},
            # The host is fed both lines at once; the answer waits in the buffer
            # until the reader gets to it, which is exactly the real case.
            {"type": "answer", "id": "1", "value": "include"},
        ])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        asks = [m for m in msgs if m["type"] == "ask"]
        self.assertEqual(len(asks), 1)
        self.assertTrue(any("include" in m.get("message", "")
                            for m in msgs if m["type"] == "log"))

    def test_a_garbage_line_does_not_kill_the_host(self):
        proc, msgs = _run(["not json", {"type": "command", "id": "2", "name": "ping"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(any(m["type"] == "result" and m["id"] == "2" for m in msgs))

    def test_unknown_command_fails_loudly_but_does_not_crash(self):
        proc, msgs = _run([{"type": "command", "id": "3", "name": "nope"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = [m for m in msgs if m["type"] == "result"][0]
        self.assertFalse(result["ok"])
        self.assertTrue(result["error"])

    def test_stop_is_reachable_over_the_pipe(self):
        """The whole point of 3.5: an interface with no window can stop a run."""
        proc, msgs = _run([{"type": "command", "id": "1", "name": "request_stop"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = [m for m in msgs if m["type"] == "result"][0]
        self.assertTrue(result["ok"], result.get("error"))

    def test_preview_cancellation_is_reachable_over_the_pipe(self):
        """Also the non-ASCII guard: this path logs "⏸ Preview cancelled.".

        On Windows the child's stdout defaults to the console codepage, which
        cannot encode that character -- the command failed and the line was
        lost. The entry point now forces UTF-8 on both ends.
        """
        proc, msgs = _run([{"type": "command", "id": "1", "name": "cancel_preview"}])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = [m for m in msgs if m["type"] == "result"][0]
        self.assertTrue(result["ok"], result.get("error"))
        self.assertTrue(any(m["type"] == "state" and m["name"] == "buttons" for m in msgs))

    def test_the_child_never_imports_tkinter(self):
        _, msgs = _run([{"type": "command", "id": "1", "name": "tkinter_check"}])
        check = [m for m in msgs if m["type"] == "log" and "tkinter" in m["message"]]
        self.assertTrue(check)
        self.assertIn("none", check[0]["message"].lower())


if __name__ == "__main__":
    unittest.main()
