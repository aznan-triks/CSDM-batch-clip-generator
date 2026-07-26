"""The production host: runs the engine with no window, fed over stdio.

Same shape as `HeadlessHost` in `tests/test_engine_headless.py` -- inherit the
engine mixins, call `init_engine_state()`, wire the four sockets. The test
keeps its own copy on purpose (see the plan): a test host that imports
production code stops proving the contract holds.
"""
import sys
import threading
import traceback

from csdm.bridge.ports import PipePorts
from csdm.bridge.protocol import LineWriter, MSG_FATAL, MSG_LOG, MSG_RESULT, decode
from csdm.engine.core import EngineMixin
from csdm.engine.state import EngineStateMixin


class BridgeHost(EngineStateMixin, EngineMixin):
    """Everything an engine host needs, wired to the JSON pipe instead of Tk."""

    def __init__(self, ports):
        self.init_engine_state()
        self.log, self.log_parts = ports.log, ports.log_parts
        self.state, self.ask = ports.state, ports.ask


def _cmd_ping(host, command):
    return {}


def _cmd_demo_logs(host, command):
    for level in ("info", "warn", "err", "ok", "dim"):
        host.log(f"demo log at level {level}", level)
    host.log_parts([("prefix", "dim"), ("value", "ok")])
    host.state("buttons_idle")
    host.state("buttons_busy")
    return {}


def _cmd_demo_ask(host, command):
    answer = host.ask("confirm", "include this clip?", ["T", "include", "skip"])
    host.log(f"received answer: {answer}")
    return {}


def _cmd_tkinter_check(host, command):
    loaded = [m for m in sys.modules if m == "tkinter" or m.startswith("tkinter.")]
    host.log(f"tkinter modules loaded: {'none' if not loaded else loaded}")
    return {}


COMMANDS = {
    "ping": _cmd_ping,
    "demo_logs": _cmd_demo_logs,
    "demo_ask": _cmd_demo_ask,
    "tkinter_check": _cmd_tkinter_check,
}


def _run_command(host, writer, command):
    """Execute one command in its own thread and send its `result` line.

    Runs off the reader thread: `demo_ask` blocks on an engine socket waiting
    for an answer, and that answer can only arrive if the reader thread is
    free to keep reading lines from stdin. Running commands inline would
    deadlock the exchange the moment a command asks a question.
    """
    command_id = command.get("id")
    name = command.get("name")
    try:
        handler = COMMANDS[name]
    except KeyError:
        writer.send({"type": MSG_RESULT, "id": command_id, "ok": False,
                     "error": f"unknown command: {name}"})
        return
    try:
        payload = handler(host, command) or {}
        writer.send({"type": MSG_RESULT, "id": command_id, "ok": True, **payload})
    except Exception as exc:  # noqa: BLE001 -- fail fast inside, report clean outside
        writer.send({"type": MSG_RESULT, "id": command_id, "ok": False, "error": str(exc)})


def serve(stdin, stdout):
    """Read commands from `stdin`, write protocol lines to `stdout`. Returns an exit code."""
    writer = LineWriter(stdout)
    ports = PipePorts(writer)
    host = BridgeHost(ports)
    threads = []

    try:
        for raw_line in stdin:
            line = raw_line.rstrip("\n")
            if not line.strip():
                continue
            try:
                message = decode(line)
            except ValueError as exc:
                writer.send({"type": MSG_LOG, "message": f"unreadable line ignored: {exc}",
                             "level": "err"})
                continue

            msg_type = message.get("type")
            if msg_type == "command":
                t = threading.Thread(target=_run_command, args=(host, writer, message))
                t.start()
                threads.append(t)
            elif msg_type == "answer":
                ports.resolve_answer(message.get("id"), message.get("value"))
            else:
                writer.send({"type": MSG_LOG,
                             "message": f"unknown message type ignored: {msg_type}",
                             "level": "err"})
    except Exception as exc:  # noqa: BLE001 -- report the fatal cause before exiting
        writer.send({"type": MSG_FATAL, "error": str(exc), "traceback": traceback.format_exc()})
        for t in threads:
            t.join()
        return 1

    # Stdin closed: wait for in-flight commands so their `result` line is
    # written before the process exits, or the parent sees a dead pipe first.
    for t in threads:
        t.join()
    return 0
