"""The bridge's stdin read must not freeze a worker's first numpy import.

On Windows, a thread that loads numpy for the first time hangs forever while
the main thread sits in a blocking read on the process's standard input pipe.
py-spy on a stuck process showed the worker inside `LoadLibraryExW` ->
`RtlEnterCriticalSection` while the main thread sat in `ReadFile` on stdin,
and the same hang reproduced in isolation from just those two threads -- but
the exact call inside the DLL's initialisation that they collide on is
inferred from that trace, not pinned down. That is exactly the bridge's idle
state: `serve()` waits on stdin while the engine's worker threads run. The
first demoparser2 parse converts its result to pandas, which imports numpy on
a pre-parse worker -- so every dp2 filter (spray transfer, one tap...) froze
the Electron app's preview for good. The Tkinter host never blocks on stdin,
so it never saw this.

Driven as a real subprocess through the real entry point: only a real pipe
reproduces it. The worker's numpy import is triggered only after a round-trip
command/result exchange over that pipe confirms the bridge's reader has
already dispatched a command and gone back to blocking on the next line --
never on a fixed timer, which could fire before the bridge is actually
waiting and pass the test vacuously.
"""
import json
import os
import subprocess
import sys
import textwrap

import pytest

np = pytest.importorskip("numpy")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Starts the bridge exactly as Electron does (`-m csdm.bridge`). Registers one
# extra command, "import_numpy_worker", whose handler spawns a thread that
# does the first numpy import -- a stand-in for demoparser2's pre-parse
# worker -- so the test can trigger it deterministically from outside instead
# of guessing with a timer.
_CHILD = textwrap.dedent("""
    import os, runpy, sys, threading

    from csdm.bridge import host as _host

    def _import_numpy_worker(host, command):
        def _do_import():
            import numpy  # noqa: F401 -- the import itself is the test
            sys.__stderr__.write("NUMPY_IMPORTED\\n")
            sys.__stderr__.flush()
            os._exit(0)
        threading.Thread(target=_do_import, daemon=True).start()
        return {}

    _host.COMMANDS["import_numpy_worker"] = _import_numpy_worker
    runpy.run_module("csdm.bridge", run_name="__main__", alter_sys=True)
""")


def _send(proc, command_id, name):
    line = json.dumps({"type": "command", "id": command_id, "name": name})
    proc.stdin.write((line + "\n").encode("utf-8"))
    proc.stdin.flush()


@pytest.mark.skipif(sys.platform != "win32", reason="the loader hang is Windows-only")
def test_worker_can_import_numpy_while_bridge_waits_on_stdin():
    proc = subprocess.Popen(
        [sys.executable, "-c", _CHILD], cwd=REPO_ROOT,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        # "ping" is harmless and answers instantly. Its result line proves the
        # reader already consumed this line and dispatched a command thread --
        # `serve()`'s loop has no join, so it is back on (or about to re-enter)
        # its next blocking read on stdin by the time the reply lands here.
        _send(proc, "1", "ping")
        reply = proc.stdout.readline().decode("utf-8", "replace")
        assert json.loads(reply).get("ok") is True, reply

        # The read that follows is now guaranteed pending: trigger the worker
        # thread's first numpy import on the far side of that same read.
        _send(proc, "2", "import_numpy_worker")
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        pytest.fail("a worker thread's first numpy import hung while the bridge "
                    "was blocked reading stdin")
    err = proc.stderr.read().decode("utf-8", "replace")
    assert "NUMPY_IMPORTED" in err, err
