"""The engine's four sockets, wired to the JSON pipe.

`csdm/engine/ports.py` defines the contract; Tkinter implements it against
widgets and `CollectingPorts` against a list. This is the third implementation
and the engine cannot tell them apart -- that is the whole point of D21.
"""
import itertools
import threading

from csdm.bridge.protocol import (MSG_ASK, MSG_LOG, MSG_LOG_PARTS, MSG_STATE)


class PipePorts:
    """Writes engine output to the pipe, and blocks on `ask` until an answer returns."""

    def __init__(self, writer):
        self._writer = writer
        self._ids = itertools.count(1)
        self._pending = {}                 # answer id -> [Event, value holder]
        self._lock = threading.Lock()      # guards _pending only, never the stream

    # -- engine -> UI ----------------------------------------------------
    def log(self, message, level=""):
        self._writer.send({"type": MSG_LOG, "message": message, "level": level})

    def log_parts(self, parts):
        self._writer.send({"type": MSG_LOG_PARTS,
                           "parts": [list(p) for p in parts]})

    def state(self, name, payload=None):
        self._writer.send({"type": MSG_STATE, "name": name, "payload": payload or {}})

    # -- round trip ------------------------------------------------------
    def ask(self, kind, message, options):
        """Send a question and BLOCK this thread until the answer comes back.

        Called from an engine worker thread, never from the stdin reader --
        that would deadlock the very thread that has to deliver the answer.
        """
        answer_id = str(next(self._ids))
        done, holder = threading.Event(), [None]
        with self._lock:
            self._pending[answer_id] = (done, holder)
        self._writer.send({"type": MSG_ASK, "id": answer_id, "kind": kind,
                           "message": message, "options": list(options)})
        done.wait()
        return holder[0]

    def resolve_answer(self, answer_id, value):
        """Deliver an answer. Returns False for an id nobody is waiting on."""
        with self._lock:
            entry = self._pending.pop(answer_id, None)
        if entry is None:
            return False
        done, holder = entry
        holder[0] = value
        done.set()
        return True
