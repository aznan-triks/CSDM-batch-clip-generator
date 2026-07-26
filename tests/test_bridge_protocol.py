"""One JSON object per line, and never two writers interleaving one."""
import io
import json
import threading
import unittest

from csdm.bridge.protocol import LineWriter, decode, encode


class TestEncodeDecode(unittest.TestCase):
    def test_round_trip(self):
        obj = {"type": "log", "message": "hello", "level": "info"}
        self.assertEqual(decode(encode(obj)), obj)

    def test_encoded_line_holds_no_newline(self):
        """A newline inside a value would split one message into two lines."""
        line = encode({"type": "log", "message": "a\nb", "level": "info"})
        self.assertNotIn("\n", line)
        self.assertEqual(decode(line)["message"], "a\nb")

    def test_non_ascii_survives(self):
        self.assertEqual(decode(encode({"m": "démo ▰"}))["m"], "démo ▰")

    def test_decode_rejects_garbage(self):
        with self.assertRaises(ValueError):
            decode("not json at all")


class TestLineWriter(unittest.TestCase):
    def test_ten_threads_produce_ten_intact_lines(self):
        stream = io.StringIO()
        writer = LineWriter(stream)
        barrier = threading.Barrier(10)

        def work(i):
            barrier.wait()          # maximise the chance of a real collision
            for j in range(20):
                writer.send({"type": "log", "message": f"t{i}-{j}", "level": "info"})

        threads = [threading.Thread(target=work, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        lines = [l for l in stream.getvalue().split("\n") if l]
        self.assertEqual(len(lines), 200)
        for line in lines:                       # every one must parse on its own
            self.assertIn("message", json.loads(line))


if __name__ == "__main__":
    unittest.main()
