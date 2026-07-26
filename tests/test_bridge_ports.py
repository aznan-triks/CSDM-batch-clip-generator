"""The four sockets, wired to the pipe instead of to widgets."""
import io
import json
import threading
import unittest

from csdm.bridge.ports import PipePorts
from csdm.bridge.protocol import LineWriter


def _lines(stream):
    return [json.loads(l) for l in stream.getvalue().split("\n") if l]


class TestOutboundPorts(unittest.TestCase):
    def setUp(self):
        self.stream = io.StringIO()
        self.ports = PipePorts(LineWriter(self.stream))

    def test_log_carries_message_and_level(self):
        self.ports.log("hello", "warn")
        self.assertEqual(_lines(self.stream),
                         [{"type": "log", "message": "hello", "level": "warn"}])

    def test_log_defaults_to_empty_level(self):
        self.ports.log("hello")
        self.assertEqual(_lines(self.stream)[0]["level"], "")

    def test_log_parts_keeps_segments_and_order(self):
        self.ports.log_parts([("a", "dim"), ("b", "ok")])
        sent = _lines(self.stream)[0]
        self.assertEqual(sent["type"], "log_parts")
        self.assertEqual(sent["parts"], [["a", "dim"], ["b", "ok"]])

    def test_state_defaults_to_empty_payload(self):
        self.ports.state("buttons_idle")
        self.assertEqual(_lines(self.stream),
                         [{"type": "state", "name": "buttons_idle", "payload": {}}])


class TestAskRoundTrip(unittest.TestCase):
    def setUp(self):
        self.stream = io.StringIO()
        self.ports = PipePorts(LineWriter(self.stream))

    def test_ask_blocks_until_the_answer_comes_back(self):
        result = {}

        def engine_thread():
            result["value"] = self.ports.ask("confirm", "go?", ["T", "yes", "no"])

        t = threading.Thread(target=engine_thread)
        t.start()

        # The question must be on the wire before any answer exists.
        deadline = threading.Event()
        waited = 0.0
        while not _lines(self.stream):
            waited += 0.01
            if waited > 5:
                self.fail("ask never wrote the question to the wire")
            threading.Event().wait(0.01)
        question = _lines(self.stream)[0]
        self.assertEqual(question["type"], "ask")
        self.assertEqual(question["kind"], "confirm")
        self.assertEqual(question["options"], ["T", "yes", "no"])
        self.assertTrue(question["id"])

        self.assertTrue(t.is_alive(), "ask returned without an answer")

        self.assertTrue(self.ports.resolve_answer(question["id"], "yes"))
        t.join(timeout=5)
        self.assertFalse(t.is_alive(), "ask never unblocked")
        self.assertEqual(result["value"], "yes")

    def test_unknown_answer_id_is_ignored(self):
        self.assertFalse(self.ports.resolve_answer("nope", "yes"))

    def test_each_question_gets_its_own_id(self):
        ids = set()
        for _ in range(3):
            t = threading.Thread(
                target=lambda: self.ports.ask("confirm", "go?", ["T", "y", "n"]))
            t.daemon = True
            t.start()
        waited = 0.0
        while len(_lines(self.stream)) < 3:
            waited += 0.01
            if waited > 5:
                self.fail("not all 3 questions reached the wire")
            threading.Event().wait(0.01)
        for q in _lines(self.stream):
            ids.add(q["id"])
        self.assertEqual(len(ids), 3)


if __name__ == "__main__":
    unittest.main()
