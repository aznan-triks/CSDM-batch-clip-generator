"""One JSON object per line, on one pipe, with exactly one writer at a time.

`ensure_ascii=False` keeps the log text readable; `separators` drops the padding
so a busy log stream stays cheap. A newline inside a value is escaped by `json`
itself, so a message can never split into two lines.
"""
import json
import threading

# Message types. Protocol constants, not configuration -- both ends must agree
# on these exact strings, so they never move to DEFAULT_CONFIG.
MSG_LOG = "log"
MSG_LOG_PARTS = "log_parts"
MSG_STATE = "state"
MSG_ASK = "ask"
MSG_ANSWER = "answer"
MSG_COMMAND = "command"
MSG_RESULT = "result"
MSG_FATAL = "fatal"


def encode(obj):
    """Serialize one message to a single line, without its trailing newline."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def decode(line):
    """Parse one line into a message. Raises ValueError on anything else."""
    obj = json.loads(line)
    if not isinstance(obj, dict):
        raise ValueError(f"expected a JSON object, got {type(obj).__name__}")
    return obj


class LineWriter:
    """Serializes writes from every thread onto one stream.

    A lock, not a queue with a draining thread: that would be a pump, and the
    log pump was removed in v190 because it lagged. The lock gives the same
    guarantee -- no interleaved lines -- with no latency and no extra thread.
    """

    def __init__(self, stream):
        self._stream = stream
        self._lock = threading.Lock()

    def send(self, obj):
        line = encode(obj)
        with self._lock:
            self._stream.write(line + "\n")
            self._stream.flush()
