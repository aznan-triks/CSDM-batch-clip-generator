"""The bridge's stdin read must not freeze a worker's first numpy import.

On Windows, a thread that loads numpy for the first time (its OpenBLAS DLL
initialises on load) hangs forever while the main thread sits in a blocking
read on the process's standard input pipe. That is exactly the bridge's idle
state: `serve()` waits on stdin while the engine's worker threads run. The
first demoparser2 parse converts its result to pandas, which imports numpy on
a pre-parse worker -- so every dp2 filter (spray transfer, one tap...) froze
the Electron app's preview for good. The Tkinter host never blocks on stdin,
so it never saw this.

Driven as a real subprocess through the real entry point: only a real pipe
reproduces it.
"""
import os
import subprocess
import sys
import textwrap

import pytest

np = pytest.importorskip("numpy")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Starts the bridge exactly as Electron does (`-m csdm.bridge`), plus one timer
# thread that does the first numpy import while `serve()` is blocked on stdin.
_CHILD = textwrap.dedent("""
    import os, runpy, sys, threading

    def first_numpy_import():
        import numpy  # noqa: F401 -- the import itself is the test
        sys.__stderr__.write("NUMPY_IMPORTED\\n")
        sys.__stderr__.flush()
        os._exit(0)

    threading.Timer(0.5, first_numpy_import).start()
    runpy.run_module("csdm.bridge", run_name="__main__", alter_sys=True)
""")


@pytest.mark.skipif(sys.platform != "win32", reason="the loader hang is Windows-only")
def test_worker_can_import_numpy_while_bridge_waits_on_stdin():
    proc = subprocess.Popen(
        [sys.executable, "-c", _CHILD], cwd=REPO_ROOT,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        # stdin stays open and empty: the bridge is idle, as between commands.
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        pytest.fail("a worker thread's first numpy import hung while the bridge "
                    "was blocked reading stdin")
    err = proc.stderr.read().decode("utf-8", "replace")
    assert "NUMPY_IMPORTED" in err, err
